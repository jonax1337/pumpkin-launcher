//! Die Datei-Änderungen eines Pack-Updates im Spielordner als Transaktion. Ersetzte und entfernte Dateien wandern
//! unter demselben relativen Pfad nach `<Arbeitsordner>/old/`, neue werden exklusiv angelegt; vorher steht ihr Pfad im
//! Journal `placed`. Scheitert etwas, auch das Speichern danach, kommt alles zurück; nach einem Absturz stellt
//! [`recover`] den alten Stand wieder her, außer der Aufrufer weiß, dass das Update schon gespeichert war: dann ist
//! nichts mehr zurückzuholen.
use std::{
    fs,
    io::Write,
    path::{Path, PathBuf},
};

use crate::{
    coded,
    error::{AppError, AppResult},
    services::{
        content::{fs_safety::is_occupied, regular_parents, safe_path, write_new},
        none_if_missing, remove_logged, walk,
    },
};

/// Unter dem Arbeitsordner: die Dateien, die das Update ersetzt oder entfernt hat.
const OLD: &str = "old";
/// Unter dem Arbeitsordner: die Pfade, die das Update neu anlegt, je Zeile, geschrieben bevor die Datei entsteht.
const PLACED: &str = "placed";

/// Was die Transaktion auf der Platte getan hat und wie es sich zurücknehmen lässt.
enum Done {
    Placed(PathBuf),
    Moved { from: PathBuf, to: PathBuf },
}

pub(super) struct Transaction<'a> {
    /// Datenordner: unter ihm darf auf dem Weg zu einem Ziel kein Symlink liegen.
    root: &'a Path,
    game: PathBuf,
    work: PathBuf,
    done: Vec<Done>,
}

impl<'a> Transaction<'a> {
    pub(super) fn new(root: &'a Path, game: PathBuf, work: &Path) -> Self {
        Self { root, game, work: work.to_owned(), done: Vec::new() }
    }

    /// Legt `rel` (relativ zum Spielordner, mit `/`) neu an; eine vorhandene Datei wird nie überschrieben.
    pub(super) fn place(&mut self, rel: &str, data: &[u8]) -> AppResult<()> {
        let target = self.target(rel)?;
        if is_occupied(&target)? {
            return Err(AppError::invalid(coded!("errors.modrinth.targetFileExists")));
        }
        self.journal_placed(rel)?;
        self.create(target, data)
    }

    fn journal_placed(&self, rel: &str) -> AppResult<()> {
        let journal = self.work.join(PLACED);
        regular_parents(self.root, &journal)?;
        fs::create_dir_all(&self.work)?;
        let mut file = fs::OpenOptions::new().create(true).append(true).open(journal)?;
        writeln!(file, "{rel}")?;
        Ok(file.sync_data()?)
    }

    fn create(&mut self, target: PathBuf, data: &[u8]) -> AppResult<()> {
        write_new(self.root, &target, data)?;
        self.done.push(Done::Placed(target));
        Ok(())
    }

    /// Nimmt `rel` aus dem Spielordner; bis zum Abschluss liegt die Datei im Arbeitsordner.
    pub(super) fn remove(&mut self, rel: &str) -> AppResult<()> {
        let from = self.target(rel)?;
        let to = self.old().join(safe_path(rel)?);
        regular_parents(self.root, &to)?;
        if let Some(parent) = to.parent() {
            fs::create_dir_all(parent)?;
        }
        fs::rename(&from, &to)?;
        self.done.push(Done::Moved { from, to });
        Ok(())
    }

    /// Anders als [`Self::place`] ohne Journal: [`recover`] holt die alte Datei aus `old/` über die neue zurück.
    pub(super) fn replace(&mut self, rel: &str, data: &[u8]) -> AppResult<()> {
        self.remove(rel)?;
        let target = self.target(rel)?;
        self.create(target, data)
    }

    /// Führt `work` aus, das über diese Transaktion ändert und am Ende speichert. Scheitert es, wird alles
    /// zurückgenommen; sonst verschwinden die alten Dateien.
    pub(super) fn run<T>(mut self, work: impl FnOnce(&mut Self) -> AppResult<T>) -> AppResult<T> {
        match work(&mut self) {
            Ok(value) => {
                self.finish();
                Ok(value)
            }
            Err(original) => Err(self.rollback(original)),
        }
    }

    fn old(&self) -> PathBuf {
        self.work.join(OLD)
    }

    fn target(&self, rel: &str) -> AppResult<PathBuf> {
        target_in(self.root, &self.game, rel)
    }

    /// Räumt das Journal vor `old/` weg: bleibt vom Aufräumen etwas liegen, kann das Journal nie neue Dateien
    /// löschen, deren Update längst gespeichert ist.
    fn finish(&self) {
        remove_logged(&self.work.join(PLACED));
        remove_logged(&self.old());
    }

    /// Nimmt alles in umgekehrter Reihenfolge zurück; was dabei nicht gelingt, hängt an `original`.
    fn rollback(self, original: AppError) -> AppError {
        let (old, journal) = (self.old(), self.work.join(PLACED));
        let failures: Vec<String> =
            self.done.into_iter().rev().filter_map(|done| undo(done).err()).map(|err| err.to_string()).collect();
        if failures.is_empty() {
            remove_logged(&old);
            remove_logged(&journal);
            original
        } else {
            AppError::invalid(coded!("errors.packs.update.rollbackFailed", original = original, failures = failures.join("; ")))
        }
    }
}

fn undo(done: Done) -> AppResult<()> {
    match done {
        Done::Placed(target) => Ok(fs::remove_file(target)?),
        Done::Moved { from, to } => Ok(fs::rename(to, from)?),
    }
}

/// Pfad von `rel` im Spielordner `game`; auf dem Weg dorthin liegt unter dem Datenordner `root` kein Symlink.
fn target_in(root: &Path, game: &Path, rel: &str) -> AppResult<PathBuf> {
    let target = game.join(safe_path(rel)?);
    regular_parents(root, &target)?;
    Ok(target)
}

/// Liegt von einem Update, das nicht ganz zurückgenommen wurde oder dessen Aufräumen scheiterte, noch etwas im
/// Arbeitsordner? Dann muss er bleiben, bis [`recover`] ihn bearbeitet.
pub(super) fn left_behind(work: &Path) -> bool {
    work.join(OLD).exists() || work.join(PLACED).exists()
}

/// Nach einem Absturz oder halben Zurücknehmen mitten im Update: entfernt die neu angelegten Dateien, legt die alten
/// aus dem Arbeitsordner an ihren Platz (auch über die neue Fassung hinweg) und räumt den Arbeitsordner weg. War das
/// Update schon gespeichert (`committed`), räumt es nur weg. `root` ist der Ordner aller Instanzen.
pub(super) fn recover(root: &Path, game: &Path, work: &Path, committed: bool) -> AppResult<()> {
    if !committed {
        remove_placed(root, game, work)?;
        restore_old(root, game, work)?;
    }
    remove_logged(work);
    Ok(())
}

/// Nur vollständige Zeilen zählen: eine beim Absturz halb geschriebene könnte auf eine fremde Datei zeigen.
fn remove_placed(root: &Path, game: &Path, work: &Path) -> AppResult<()> {
    let Some(journal) = none_if_missing(fs::read_to_string(work.join(PLACED)))? else { return Ok(()) };
    for rel in journal.split_inclusive('\n').filter_map(|line| line.strip_suffix('\n')) {
        none_if_missing(fs::remove_file(target_in(root, game, rel)?))?;
    }
    Ok(())
}

fn restore_old(root: &Path, game: &Path, work: &Path) -> AppResult<()> {
    let old = work.join(OLD);
    for (rel, path) in walk(&old, &old)? {
        let target = target_in(root, game, &rel)?;
        if let Some(parent) = target.parent() {
            fs::create_dir_all(parent)?;
        }
        fs::rename(&path, &target)?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::services::write_files;

    struct Setup {
        root: PathBuf,
        game: PathBuf,
        work: PathBuf,
    }

    fn setup() -> Setup {
        let root = std::env::temp_dir().join(crate::models::new_id());
        let game = root.join("instances/i/minecraft");
        write_files(&game, &[("mods/alt.jar", "alt"), ("config/a.toml", "a=1"), ("config/weg.toml", "weg")]);
        Setup { work: root.join("instances/i/pack-update"), root, game }
    }

    fn read(game: &Path, rel: &str) -> Option<String> {
        fs::read_to_string(game.join(rel)).ok()
    }

    fn change(tx: &mut Transaction) -> AppResult<()> {
        tx.replace("config/a.toml", b"a=2")?;
        tx.remove("config/weg.toml")?;
        tx.remove("mods/alt.jar")?;
        tx.place("mods/neu.jar", b"neu")
    }

    #[test]
    fn a_failed_save_takes_every_change_back() {
        let Setup { root, game, work } = setup();

        let result: AppResult<()> = Transaction::new(&root, game.clone(), &work).run(|tx| {
            change(tx)?;
            Err(AppError::invalid("Speichern fehlgeschlagen"))
        });

        assert_eq!(result.unwrap_err().to_string(), "Speichern fehlgeschlagen");
        assert_eq!(read(&game, "config/a.toml").as_deref(), Some("a=1"));
        assert_eq!(read(&game, "config/weg.toml").as_deref(), Some("weg"));
        assert_eq!(read(&game, "mods/alt.jar").as_deref(), Some("alt"));
        assert!(!game.join("mods/neu.jar").exists() && !left_behind(&work));
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn a_failure_midway_takes_back_what_was_done() {
        let Setup { root, game, work } = setup();

        let result = Transaction::new(&root, game.clone(), &work).run(|tx| {
            tx.replace("config/a.toml", b"a=2")?;
            // Liegt schon da: neu anlegen scheitert.
            tx.place("mods/alt.jar", b"anders")
        });

        assert!(result.is_err());
        assert_eq!(read(&game, "config/a.toml").as_deref(), Some("a=1"));
        assert_eq!(read(&game, "mods/alt.jar").as_deref(), Some("alt"));
        assert!(!left_behind(&work), "die verweigerte Datei steht nicht im Journal");
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn a_successful_update_keeps_the_new_state_and_drops_the_old_files() {
        let Setup { root, game, work } = setup();

        Transaction::new(&root, game.clone(), &work).run(change).unwrap();

        assert_eq!(read(&game, "config/a.toml").as_deref(), Some("a=2"));
        assert_eq!(read(&game, "mods/neu.jar").as_deref(), Some("neu"));
        assert!(read(&game, "config/weg.toml").is_none() && read(&game, "mods/alt.jar").is_none());
        assert!(!work.join(OLD).exists() && !left_behind(&work));
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn unsafe_paths_are_refused() {
        let Setup { root, game, work } = setup();
        let mut tx = Transaction::new(&root, game, &work);
        assert!(tx.place("../ausserhalb.txt", b"x").is_err());
        assert!(tx.remove("config/../../instances.json").is_err());
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn recovery_after_a_crash_brings_back_the_old_files() {
        let Setup { root, game, work } = setup();
        // Absturz mitten im Ersetzen: die alte Konfiguration liegt schon im Arbeitsordner, die neue fehlt noch.
        write_files(&work.join(OLD), &[("config/a.toml", "a=1"), ("mods/alt.jar", "alt")]);
        fs::remove_file(game.join("config/a.toml")).unwrap();
        fs::remove_file(game.join("mods/alt.jar")).unwrap();

        assert!(left_behind(&work));
        recover(&root, &game, &work, false).unwrap();

        assert_eq!(read(&game, "config/a.toml").as_deref(), Some("a=1"));
        assert_eq!(read(&game, "mods/alt.jar").as_deref(), Some("alt"));
        assert!(!work.exists());
        assert!(recover(&root, &game, &work, false).is_ok(), "ohne Reste gibt es nichts zu tun");
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn recovery_after_a_crash_at_the_very_end_undoes_replaced_and_placed_files_too() {
        let Setup { root, game, work } = setup();
        // Absturz, bevor die Instanz gespeichert war: alle Dateien sind schon gewechselt, nichts wurde zurückgenommen.
        change(&mut Transaction::new(&root, game.clone(), &work)).unwrap();
        assert_eq!(read(&game, "config/a.toml").as_deref(), Some("a=2"));

        recover(&root, &game, &work, false).unwrap();

        assert_eq!(read(&game, "config/a.toml").as_deref(), Some("a=1"));
        assert_eq!(read(&game, "config/weg.toml").as_deref(), Some("weg"));
        assert_eq!(read(&game, "mods/alt.jar").as_deref(), Some("alt"));
        assert!(!game.join("mods/neu.jar").exists() && !work.exists());
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn a_successful_update_leaves_neither_journal_nor_old_files() {
        let Setup { root, game, work } = setup();

        Transaction::new(&root, game, &work).run(change).unwrap();

        assert!(!work.join(PLACED).exists() && !work.join(OLD).exists());
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn leftovers_of_a_saved_update_are_swept_but_never_restored() {
        let Setup { root, game, work } = setup();
        Transaction::new(&root, game.clone(), &work).run(change).unwrap();
        // Das Aufräumen scheiterte zum Beispiel an einem Virenscanner.
        write_files(&work, &[("placed", "mods/neu.jar\n")]);
        write_files(&work.join(OLD), &[("config/weg.toml", "weg"), ("mods/alt.jar", "alt")]);

        assert!(left_behind(&work));
        recover(&root, &game, &work, true).unwrap();

        assert!(read(&game, "config/weg.toml").is_none() && read(&game, "mods/alt.jar").is_none());
        assert_eq!(read(&game, "mods/neu.jar").as_deref(), Some("neu"));
        assert!(!work.exists());
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn a_half_written_journal_line_never_touches_a_file() {
        let Setup { root, game, work } = setup();
        write_files(&work, &[("placed", "mods/alt.jar\nmods/al")]);

        recover(&root, &game, &work, false).unwrap();

        assert!(!game.join("mods/alt.jar").exists(), "die vollständige Zeile gilt");
        assert!(game.join("config/a.toml").exists());
        fs::remove_dir_all(root).unwrap();
    }

    /// Symlinks anlegen darf unter Windows nicht jeder Benutzer; geprüft wird daher unter Unix.
    #[cfg(unix)]
    #[test]
    fn recovery_does_not_follow_a_symlinked_folder() {
        let Setup { root, game, work } = setup();
        let elsewhere = root.join("anderswo");
        fs::create_dir_all(&elsewhere).unwrap();
        write_files(&work.join(OLD), &[("linked/alt.jar", "alt")]);
        std::os::unix::fs::symlink(&elsewhere, game.join("linked")).unwrap();

        assert!(recover(&root, &game, &work, false).is_err());

        assert!(!elsewhere.join("alt.jar").exists());
        assert!(left_behind(&work), "bleibt für einen neuen Versuch liegen");
        fs::remove_dir_all(root).unwrap();
    }
}
