//! Pfad- und Dateisicherheit: Namen, die unter jedem System anlegbar sind und im Zielordner bleiben, keine Symlinks
//! auf dem Weg zum Ziel und neue Dateien nur exklusiv, mit Zurückrollen, wenn ein Vorgang scheitert.
use std::{
    fs,
    io::Write,
    path::{Path, PathBuf},
};

use crate::{
    coded,
    error::{AppError, AppResult},
    services::none_if_missing,
};

const MAX_PATH_LEN: usize = 240;

/// Relativer Pfad mit `/` als Trenner, der unter Windows anlegbar ist und nicht aus dem Zielordner führt.
pub fn safe_path(value: &str) -> AppResult<PathBuf> {
    if value.is_empty() || value.len() > MAX_PATH_LEN || value.contains('\\') {
        return Err(AppError::invalid(coded!("errors.modrinth.unsafePath")));
    }
    if value.split('/').any(is_unsafe_component) {
        return Err(AppError::invalid(coded!("errors.modrinth.unsafeWindowsPath", path = value)));
    }
    Ok(PathBuf::from(value))
}

/// Ein Pfadstück, das unter Windows nicht anlegbar ist oder aus dem Ordner führt.
fn is_unsafe_component(part: &str) -> bool {
    part.is_empty()
        || part == "."
        || part == ".."
        || part.ends_with(['.', ' '])
        || has_unsafe_chars(part)
        || is_reserved_windows_name(part)
}

fn has_unsafe_chars(part: &str) -> bool {
    part.chars().any(|c| c.is_control() || "<>:\"|?*".contains(c))
}

/// Gerätenamen wie `CON` oder `COM1`, auch mit Endung (`CON.txt`).
fn is_reserved_windows_name(part: &str) -> bool {
    let base = part.split('.').next().unwrap_or("").to_ascii_uppercase();
    let numbered = (base.starts_with("COM") || base.starts_with("LPT"))
        && matches!(&base[3..], "1" | "2" | "3" | "4" | "5" | "6" | "7" | "8" | "9" | "¹" | "²" | "³");
    numbered || matches!(base.as_str(), "CON" | "PRN" | "AUX" | "NUL" | "CONIN$" | "CONOUT$")
}

/// Kein Symlink und keine Junction zwischen `root` und `path`. Oberhalb von `root` zählt nichts: Unter macOS ist schon
/// `/var` ein Symlink, unter manchen Linux-Systemen `/home`. Unter Windows meldet `is_symlink` Symlinks und Junctions,
/// also jedes Reparse-Tag, das auf einen anderen Namen zeigt. Das bloße Reparse-Point-Attribut genügt nicht: Cloud-Dateien
/// (OneDrive) und komprimierte Dateien tragen es, sind aber gewöhnliche Dateien und Ordner.
pub(crate) fn regular_parents(root: &Path, path: &Path) -> AppResult<()> {
    if !path.starts_with(root) {
        return Err(AppError::invalid(coded!("errors.game.pathOutsideGameDir")));
    }
    for ancestor in path.ancestors().take_while(|ancestor| *ancestor != root) {
        match none_if_missing(fs::symlink_metadata(ancestor))? {
            Some(m) if m.file_type().is_symlink() => {
                return Err(AppError::invalid(coded!("errors.modrinth.symlinkInTarget")))
            }
            Some(_) | None => {}
        }
    }
    Ok(())
}

/// Schreibt `data` als neue Datei nach `path`; eine vorhandene wird nie ersetzt. Scheitert das Schreiben, verschwindet
/// die halbe Datei wieder.
pub(crate) fn write_new(root: &Path, path: &Path, data: &[u8]) -> AppResult<()> {
    regular_parents(root, path)?;
    let parent = path.parent().ok_or_else(|| AppError::invalid(coded!("errors.modrinth.missingParentPath")))?;
    fs::create_dir_all(parent)?;
    let mut file = fs::OpenOptions::new().write(true).create_new(true).open(path)?;
    if let Err(e) = file.write_all(data).and_then(|()| file.sync_all()) {
        drop(file);
        return Err(match fs::remove_file(path) {
            Ok(()) => e.into(),
            Err(cleanup) => AppError::invalid(coded!("errors.modrinth.cleanupFailed", original = e, cleanup = cleanup)),
        });
    }
    Ok(())
}

/// Ist `path` schon belegt? Verweise werden nicht aufgelöst; nur ein fehlendes Ziel ist frei, jeder andere Fehler bleibt einer.
pub(crate) fn is_occupied(path: &Path) -> AppResult<bool> {
    Ok(none_if_missing(fs::symlink_metadata(path))?.is_some())
}

/// Löscht die neu angelegten `paths` (jüngste zuerst) und hängt Fehler dabei an `original` an.
pub(crate) fn rollback(paths: &[PathBuf], original: AppError) -> AppError {
    let mut errors = Vec::new();
    for path in paths.iter().rev() {
        if let Err(e) = fs::remove_file(path) {
            errors.push(format!("{}: {e}", path.display()));
        }
    }
    if errors.is_empty() {
        original
    } else {
        AppError::invalid(coded!("errors.modrinth.rollbackFailed", original = original, failures = errors.join("; ")))
    }
}

/// Neue Dateien eines Vorgangs, die nur gemeinsam gelten: Ziele werden vor dem Laden geprüft, dann exklusiv
/// geschrieben; scheitert der Abschluss, verschwinden alle schon geschriebenen wieder.
pub(crate) struct StagedInstall<'a> {
    root: &'a Path,
    created: Vec<PathBuf>,
}

impl<'a> StagedInstall<'a> {
    /// `root` ist der Datenordner: Unter ihm darf auf dem Weg zu einem Ziel kein Symlink liegen.
    pub(crate) fn new(root: &'a Path) -> Self {
        Self { root, created: Vec::new() }
    }

    /// Prüft vor dem Laden, dass `target` frei ist und kein Symlink davor liegt.
    pub(crate) fn reserve(&self, target: &Path) -> AppResult<()> {
        regular_parents(self.root, target)?;
        if is_occupied(target)? {
            return Err(AppError::invalid(coded!("errors.modrinth.targetFileExists")));
        }
        Ok(())
    }

    /// Schreibt `data` als neue Datei nach `target`.
    pub(crate) fn write_file(&mut self, target: PathBuf, data: &[u8]) -> AppResult<()> {
        write_new(self.root, &target, data)?;
        self.created.push(target);
        Ok(())
    }

    /// Führt `finish` aus, das über [`Self::write_file`] schreibt und das Ergebnis festschreibt. Scheitert es,
    /// verschwinden alle geschriebenen Dateien wieder.
    pub(crate) fn commit_or_rollback<T>(mut self, finish: impl FnOnce(&mut Self) -> AppResult<T>) -> AppResult<T> {
        finish(&mut self).map_err(|e| rollback(&self.created, e))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Symlinks anlegen darf unter Windows nicht jeder Benutzer; geprüft wird daher unter Unix.
    #[cfg(unix)]
    #[test]
    fn only_symlinks_below_the_data_root_count() {
        let base = std::env::temp_dir().join(crate::models::new_id());
        let real = base.join("real");
        fs::create_dir_all(real.join("mods")).unwrap();
        let linked_root = base.join("data");
        std::os::unix::fs::symlink(&real, &linked_root).unwrap();
        assert!(regular_parents(&linked_root, &linked_root.join("mods/a.jar")).is_ok());
        assert!(regular_parents(&base, &linked_root.join("mods/a.jar")).is_err());
        fs::remove_dir_all(base).unwrap();
    }

    /// Eine Junction anzulegen braucht unter Windows keine besonderen Rechte, ein Symlink schon.
    #[cfg(windows)]
    #[test]
    fn junctions_below_the_root_are_refused_but_plain_folders_pass() {
        use std::os::windows::process::CommandExt;
        let base = std::env::temp_dir().join(crate::models::new_id());
        let (data, real) = (base.join("data"), base.join("real"));
        fs::create_dir_all(real.join("mods")).unwrap();
        fs::create_dir_all(data.join("plain/mods")).unwrap();
        let output = std::process::Command::new("cmd")
            .args(["/S", "/C"])
            .raw_arg(format!("\"mklink /J \"{}\" \"{}\"\"", data.join("linked").display(), real.display()))
            .output()
            .unwrap();
        assert!(output.status.success(), "{output:?}");
        assert!(regular_parents(&data, &data.join("plain/mods/a.jar")).is_ok());
        assert!(regular_parents(&data, &data.join("linked/mods/a.jar")).is_err());
        assert!(regular_parents(&data.join("linked"), &data.join("linked/mods/a.jar")).is_ok());
        fs::remove_dir_all(base).unwrap();
    }

    #[test]
    fn paths_that_leave_the_folder_or_windows_cannot_store_are_unsafe() {
        for p in ["../x", "/x", "C:/x", "a\\b", "CON.jar", "mods/NUL", "a.", "a ", "x:y", "a//b", "LPT¹.txt"] {
            assert!(safe_path(p).is_err(), "{p}");
        }
        assert!(safe_path("mods/good.jar").is_ok());
    }

    #[test]
    fn windows_device_names_are_reserved_with_or_without_extension() {
        for name in ["CON", "con.txt", "Nul", "COM1", "lpt9.log", "COM¹", "CONIN$", "aux.tar.gz"] {
            assert!(is_reserved_windows_name(name), "{name}");
        }
        for name in ["COM0", "COM10", "console", "LPT", "a.CON"] {
            assert!(!is_reserved_windows_name(name), "{name}");
        }
    }

    #[test]
    fn characters_windows_cannot_store_are_unsafe() {
        for name in ["a:b", "a*", "a\tb", "a|b", "a?", "a\"b", "<a>"] {
            assert!(has_unsafe_chars(name), "{name:?}");
        }
        assert!(!has_unsafe_chars("sodium-fabric-0.5.8+mc1.20.4.jar"));
    }

    #[test]
    fn only_a_missing_path_is_free() {
        let dir = std::env::temp_dir().join(crate::models::new_id());
        fs::create_dir_all(&dir).unwrap();
        fs::write(dir.join("file"), "x").unwrap();

        assert!(!is_occupied(&dir.join("missing")).unwrap());
        assert!(is_occupied(&dir.join("file")).unwrap());
        assert!(is_occupied(&dir).unwrap());
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn staged_files_stay_on_commit_and_vanish_when_it_fails() {
        let root = std::env::temp_dir().join(crate::models::new_id());
        let (kept, dropped) = (root.join("mods/kept.jar"), root.join("mods/dropped.jar"));

        let staged = StagedInstall::new(&root);
        staged.reserve(&kept).unwrap();
        staged.commit_or_rollback(|s| s.write_file(kept.clone(), b"k")).unwrap();
        let failed: AppResult<()> = StagedInstall::new(&root).commit_or_rollback(|s| {
            s.write_file(dropped.clone(), b"d")?;
            Err(AppError::invalid("Abbruch"))
        });

        assert_eq!(failed.unwrap_err().to_string(), "Abbruch");
        assert!(kept.exists() && !dropped.exists());
        assert!(StagedInstall::new(&root).reserve(&kept).is_err());
        fs::remove_dir_all(root).unwrap();
    }
}
