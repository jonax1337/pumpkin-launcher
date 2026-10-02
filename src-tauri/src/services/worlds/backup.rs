//! Sicherungen der Welten als ZIP unter `instances/<id>/backups/`: `<Welt>-<Unix-ms>.zip`. Löschen sichert vorher,
//! aus der Sicherung lässt sich die Welt wiederherstellen; die Sicherungen gehören zur Instanz und verschwinden mit ihr.
use std::{
    cmp::Reverse,
    collections::HashSet,
    fs,
    io::{self, Read},
    path::{Path, PathBuf},
};

use serde::Serialize;
use tokio_util::sync::CancellationToken;

use super::{read_world, world_dir, World};
use crate::services::progress::{Phase, ProgressFn};
use crate::services::{
    add_zip_file, check_cancelled, content, download::RemoveOnDrop, entries, free_name, providers::zip_paths, remove_logged,
    require_plain_name, walk, write_zip_atomic, Dirs,
};
use crate::{
    coded,
    error::{AppError, AppResult},
    models::now_ms,
};

/// Sperrdatei des laufenden Spiels; gehört nicht in eine Sicherung.
pub(super) const SESSION_LOCK: &str = "session.lock";
/// Endung einer gelöschten Welt, solange ihr Ordner unter `backups/` noch entfernt wird.
pub(super) const DELETING: &str = "deleting";
/// Endung einer Sicherung, solange sie geschrieben wird.
pub(super) const PART: &str = "zip.part";

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorldBackup {
    /// Dateiname unter `backups/`: `<Welt>-<Unix-ms>.zip`.
    pub id: String,
    /// Ordnername der gesicherten Welt.
    pub world: String,
    pub created_at: u64,
    pub size_bytes: u64,
}

/// Kommentar im ZIP einer automatischen Sicherung (vor dem Spielstart): so unterscheidet sie sich von einer
/// eigenen und nur sie wird aufgeräumt.
const AUTOMATIC_COMMENT: &str = "pumpkin:automatic";

/// Sichert die Welt als ZIP mit dem Ordner als oberstem Eintrag (wie die Sicherung im Spiel), ohne `session.lock`.
pub fn backup(dirs: &Dirs, instance_id: &str, id: &str, progress: ProgressFn<'_>) -> AppResult<WorldBackup> {
    backup_cancellable(dirs, instance_id, id, progress, &CancellationToken::new())
}

/// Wie [`backup`]; ist `stop` abgebrochen, endet es vor der nächsten Datei mit `AppError::Cancelled` und lässt keine
/// halbe Sicherung liegen.
pub fn backup_cancellable(
    dirs: &Dirs,
    instance_id: &str,
    id: &str,
    progress: ProgressFn<'_>,
    stop: &CancellationToken,
) -> AppResult<WorldBackup> {
    create_backup(dirs, instance_id, id, "", progress, stop)
}

/// Wie [`backup`], aber als automatische Sicherung, die [`super::auto`] später aufräumen darf.
pub(super) fn backup_automatic(dirs: &Dirs, instance_id: &str, id: &str) -> AppResult<WorldBackup> {
    create_backup(dirs, instance_id, id, AUTOMATIC_COMMENT, &|_, _, _| {}, &CancellationToken::new())
}

/// Ob die Sicherung `backup_id` automatisch entstanden ist; was sich nicht lesen lässt, gilt als eigene.
pub(super) fn is_automatic(dirs: &Dirs, instance_id: &str, backup_id: &str) -> bool {
    fs::File::open(dirs.backups(instance_id).join(backup_id))
        .ok()
        .and_then(|file| zip::ZipArchive::new(file).ok())
        .is_some_and(|zip| zip.comment() == AUTOMATIC_COMMENT.as_bytes())
}

fn create_backup(
    dirs: &Dirs,
    instance_id: &str,
    id: &str,
    comment: &str,
    progress: ProgressFn<'_>,
    stop: &CancellationToken,
) -> AppResult<WorldBackup> {
    let dir = world_dir(dirs, instance_id, id)?;
    let mut files = walk(&dirs.saves(instance_id), &dir)?;
    let prefix = format!("{id}/");
    files.retain(|(name, _)| name.strip_prefix(&prefix) != Some(SESSION_LOCK));
    ensure_restorable(&files, &prefix)?;
    let backup_dir = dirs.backups(instance_id);
    fs::create_dir_all(&backup_dir)?;
    let backup_id = format!("{id}-{}.zip", now_ms());
    write_zip(&backup_dir.join(&backup_id), &files, comment, progress, stop)?;
    tracing::info!(instance = %instance_id, world = %id, backup = %backup_id, "Welt gesichert");
    read_backup(&backup_dir, &backup_id)
}

/// Eine Sicherung, die `restore` ablehnen würde, wird gar nicht erst geschrieben: sonst löschte `delete` die Welt
/// und ihre einzige Wiederherstellung schlüge fehl. Das trifft eine Welt ohne Dateien (ein Ordner-Link wird nicht
/// verfolgt) und Namen, die unter Windows nicht gehen oder sich nur in der Schreibweise unterscheiden; Linux und
/// macOS lassen beides in einer Welt zu.
fn ensure_restorable(files: &[(String, PathBuf)], prefix: &str) -> AppResult<()> {
    if files.is_empty() {
        return Err(AppError::invalid(coded!("errors.packs.backup.unrestorableEmpty")));
    }
    let mut seen = HashSet::new();
    for (name, _) in files {
        let rel = name.strip_prefix(prefix).unwrap_or(name);
        content::safe_path(rel).map_err(|err| AppError::invalid(coded!("errors.packs.backup.unrestorablePath", reason = err)))?;
        if !seen.insert(rel.to_lowercase()) {
            return Err(AppError::invalid(coded!("errors.packs.backup.unrestorableDuplicate", name = rel)));
        }
    }
    Ok(())
}

/// Sicherungen aller Welten der Instanz (auch gelöschter), neueste zuerst.
pub fn backups(dirs: &Dirs, instance_id: &str) -> AppResult<Vec<WorldBackup>> {
    let dir = dirs.backups(instance_id);
    let mut list: Vec<WorldBackup> = entries(&dir)?
        .iter()
        .filter_map(|entry| read_backup(&dir, entry.file_name().to_str()?).ok())
        .collect();
    list.sort_by_key(|b| Reverse(b.created_at));
    Ok(list)
}

/// Stellt eine Sicherung als neue Welt her: unter dem alten Ordnernamen oder, ist der belegt, als „<Name> (2)“ usw.
/// Eine bestehende Welt wird nie überschrieben.
pub fn restore(dirs: &Dirs, instance_id: &str, backup_id: &str) -> AppResult<World> {
    let backup_dir = dirs.backups(instance_id);
    let saved = read_backup(&backup_dir, backup_id)?;
    let mut zip = zip::ZipArchive::new(fs::File::open(backup_dir.join(backup_id))?)?;
    // Nur Pfadregeln: die Grenzen gegen ZIP-Bomben aus Pack-Importen würden große Welten aussperren, die `backup` sichert.
    let files = zip_paths(&mut zip, &format!("{}/", saved.world), &[])?;
    if files.is_empty() {
        return Err(AppError::invalid(coded!("errors.packs.backup.noWorld")));
    }
    let saves = dirs.saves(instance_id);
    fs::create_dir_all(&saves)?;
    let id = free_name(&saved.world, "", |name| saves.join(name).exists());
    let target = saves.join(&id);
    // `create_dir` statt `create_dir_all`: taucht der Ordner gerade erst auf, wird er nicht befüllt.
    fs::create_dir(&target)?;
    let guard = RemoveOnDrop::new(target.clone());
    extract(&mut zip, files, &target, &|_, _, _| {})?;
    guard.disarm();
    tracing::info!(instance = %instance_id, backup = %backup_id, world = %id, "Welt wiederhergestellt");
    Ok(read_world(&target, &id))
}

/// Löscht die Welt, nachdem sie gesichert wurde; die Sicherung kommt zurück. Der Ordner verlässt zuerst `saves/`:
/// hält unter Windows ein anderes Programm eine Datei offen, bleibt so keine halbe Welt in der Liste.
pub fn delete(dirs: &Dirs, instance_id: &str, id: &str, progress: ProgressFn<'_>) -> AppResult<WorldBackup> {
    let saved = backup(dirs, instance_id, id, progress)?;
    let doomed = dirs.backups(instance_id).join(&saved.id).with_extension(DELETING);
    fs::rename(world_dir(dirs, instance_id, id)?, &doomed)?;
    remove_logged(&doomed);
    tracing::info!(instance = %instance_id, world = %id, "Welt gelöscht");
    Ok(saved)
}

pub fn delete_backup(dirs: &Dirs, instance_id: &str, backup_id: &str) -> AppResult<()> {
    let dir = dirs.backups(instance_id);
    read_backup(&dir, backup_id)?;
    fs::remove_file(dir.join(backup_id))?;
    Ok(())
}

/// Sicherung `id` in `dir`; ihr Name verrät Welt und Zeitpunkt.
fn read_backup(dir: &Path, id: &str) -> AppResult<WorldBackup> {
    let not_found = || AppError::NotFound(coded!("errors.packs.backup.notFound", id = id).into());
    let (world, created_at) = backup_name(require_plain_name(id)?).ok_or_else(not_found)?;
    let size_bytes = fs::metadata(dir.join(id)).map_err(|_| not_found())?.len();
    Ok(WorldBackup { id: id.into(), world: world.into(), created_at, size_bytes })
}

/// `<Welt>-<Unix-ms>.zip` → (Welt, Zeitpunkt).
fn backup_name(name: &str) -> Option<(&str, u64)> {
    backup_stem(name.strip_suffix(".zip")?)
}

/// `<Welt>-<Unix-ms>` → (Welt, Zeitpunkt). Der Weltname darf selbst Bindestriche enthalten.
pub(super) fn backup_stem(stem: &str) -> Option<(&str, u64)> {
    let (world, at) = stem.rsplit_once('-')?;
    (!world.is_empty()).then_some((world, at.parse().ok()?))
}

/// Entpackt die geprüften Einträge `files` (aus `zip_paths`) nach `target`. Jede Datei hat genau die Länge, die das
/// Archiv angibt: eine längere (ein Archiv, das über seine Größe lügt) füllte sonst die Platte.
pub(super) fn extract(
    zip: &mut zip::ZipArchive<fs::File>,
    files: Vec<(PathBuf, usize)>,
    target: &Path,
    progress: ProgressFn<'_>,
) -> AppResult<()> {
    let total = files.len() as u64;
    progress(Phase::Extract, 0, total);
    for (done, (path, index)) in (1..).zip(files) {
        let dest = target.join(path);
        if let Some(parent) = dest.parent() {
            fs::create_dir_all(parent)?;
        }
        let entry = zip.by_index(index)?;
        let size = entry.size();
        let written = io::copy(&mut entry.take(size + 1), &mut fs::File::create(&dest)?)?;
        if written != size {
            return Err(AppError::invalid(coded!("errors.packs.backup.badZipSize")));
        }
        progress(Phase::Extract, done, total);
    }
    Ok(())
}

/// Schreibt das Archiv über `<path>.part`; bei einem Fehler bleibt nichts Halbes liegen.
fn write_zip(
    path: &Path,
    files: &[(String, PathBuf)],
    comment: &str,
    progress: ProgressFn<'_>,
    stop: &CancellationToken,
) -> AppResult<()> {
    let total = files.len() as u64;
    progress(Phase::Backup, 0, total);
    write_zip_atomic(path, PART, |zip| {
        zip.set_comment(comment)?;
        for (done, (name, source)) in (1..).zip(files) {
            check_cancelled(stop)?;
            add_zip_file(zip, name, &mut fs::File::open(source)?)?;
            progress(Phase::Backup, done, total);
        }
        Ok(())
    })
}

#[cfg(test)]
mod tests {
    use super::super::fixtures::setup;
    use super::*;

    #[test]
    fn backup_restore_and_delete() {
        let (root, dirs) = setup();
        let saved = backup(&dirs, "i", "Neue Welt", &|_, _, _| {}).unwrap();
        assert_eq!(saved.world, "Neue Welt");
        assert_eq!(backups(&dirs, "i").unwrap(), std::slice::from_ref(&saved));

        // Die Welt gibt es noch: die Sicherung kommt daneben, ohne Sperrdatei.
        let copy = restore(&dirs, "i", &saved.id).unwrap();
        assert_eq!((copy.id.as_str(), copy.name.as_str()), ("Neue Welt (2)", "Abenteuer"));
        let restored = dirs.saves("i").join("Neue Welt (2)");
        assert_eq!(fs::read(restored.join("region/r.0.0.mca")).unwrap(), b"region");
        assert!(!restored.join(SESSION_LOCK).exists());

        let safety = delete(&dirs, "i", "Neue Welt", &|_, _, _| {}).unwrap();
        assert!(!dirs.saves("i").join("Neue Welt").exists());
        assert!(!dirs.backups("i").join(&safety.id).with_extension(DELETING).exists());
        assert_eq!(restore(&dirs, "i", &safety.id).unwrap().id, "Neue Welt");

        delete_backup(&dirs, "i", &saved.id).unwrap();
        assert_eq!(backups(&dirs, "i").unwrap().len(), 1);
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn restores_worlds_beyond_the_pack_import_limits() {
        let (root, dirs) = setup();
        // 2 MiB Nullen packen weit über 200:1, wie große, leere Kartendaten: für einen Pack-Import eine ZIP-Bombe.
        let zeros = vec![0u8; 2 * 1024 * 1024];
        crate::services::write_files::<&[u8]>(&dirs.saves("i"), &[("Alt/data/karte.dat", &zeros)]);
        let safety = delete(&dirs, "i", "Alt", &|_, _, _| {}).unwrap();
        restore(&dirs, "i", &safety.id).unwrap();
        assert_eq!(fs::read(dirs.saves("i").join("Alt/data/karte.dat")).unwrap(), zeros);
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn refuses_backups_that_could_not_be_restored() {
        let file = |name: &str| (format!("Welt/{name}"), PathBuf::new());
        let check = |names: &[&str]| ensure_restorable(&names.iter().map(|n| file(n)).collect::<Vec<_>>(), "Welt/");
        assert!(check(&["level.dat", "region/r.0.0.mca", "datapacks/pack/data/x.json"]).is_ok());
        // Ein Ordner-Link liefert keine Dateien; ohne die Prüfung löschte `delete` die Welt gegen eine leere Sicherung.
        assert!(check(&[]).is_err());
        assert!(check(&["level.dat", "data/aux.mcfunction"]).is_err());
        assert!(check(&["level.dat", "startup", "Startup"]).is_err());
    }

    #[test]
    fn backup_names_carry_world_and_time_and_stay_inside_the_instance() {
        let (root, dirs) = setup();
        assert_eq!(backup_name("Meine-Welt-1700000000000.zip"), Some(("Meine-Welt", 1_700_000_000_000)));
        assert_eq!(backup_name("-1.zip"), None);
        assert_eq!(backup_name("Welt-gestern.zip"), None);
        assert!(restore(&dirs, "i", "../instances.json-1.zip").is_err());
        fs::remove_dir_all(root).unwrap();
    }
}
