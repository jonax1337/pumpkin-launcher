//! Screenshots einer Instanz: PNG-Dateien in `screenshots/` (F2 im Spiel) auflisten und in den Papierkorb legen.
//! Die Vorschau lädt das Frontend selbst über das Asset-Protokoll (Scope in `tauri.conf.json`).
use std::{cmp::Reverse, fs, path::Path, time::UNIX_EPOCH};

use serde::Serialize;

use super::{entries, has_extension, trash_listed};
use crate::error::AppResult;

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Screenshot {
    pub file_name: String,
    /// Absolut: Quelle der Vorschau und Ziel von „Öffnen“/„Im Ordner zeigen“.
    pub path: String,
    /// Änderungszeit in ms; Minecraft schreibt die Datei im Moment der Aufnahme.
    pub taken_at: u64,
    /// Dateigröße in Bytes.
    pub size: u64,
}

/// PNG-Dateien in `dir`, neueste zuerst. Fehlt der Ordner (noch nie F2 gedrückt), ist die Liste leer.
pub fn list(dir: &Path) -> AppResult<Vec<Screenshot>> {
    let mut shots: Vec<Screenshot> = entries(dir)?.iter().filter_map(screenshot).collect();
    shots.sort_by_key(|s| Reverse(s.taken_at));
    Ok(shots)
}

/// Eintrag als Screenshot, falls er eine PNG-Datei ist. Was sich nicht lesen lässt (gerade gelöscht), fällt weg.
fn screenshot(entry: &fs::DirEntry) -> Option<Screenshot> {
    let file_name = entry.file_name().into_string().ok().filter(|name| has_extension(name, "png"))?;
    // DirEntry-Metadaten folgen keinen Symlinks: ein Link ist hier keine Datei.
    let meta = entry.metadata().ok().filter(fs::Metadata::is_file)?;
    let taken_at = meta.modified().ok()?.duration_since(UNIX_EPOCH).ok()?.as_millis() as u64;
    Some(Screenshot { path: entry.path().to_string_lossy().into_owned(), file_name, taken_at, size: meta.len() })
}

/// Legt den Screenshot `file_name` aus `dir` in den Papierkorb (lässt sich dort wiederherstellen).
pub fn delete(dir: &Path, file_name: &str) -> AppResult<()> {
    trash_listed(dir, file_name, "Screenshot", |entry| screenshot(entry).is_some())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::error::AppError;
    use std::time::{Duration, SystemTime};

    /// Datei mit `len` Bytes, zuletzt geändert vor `age` Sekunden.
    fn create(path: &Path, len: usize, age: u64) {
        fs::write(path, vec![0u8; len]).unwrap();
        let file = fs::File::options().write(true).open(path).unwrap();
        file.set_modified(SystemTime::now() - Duration::from_secs(age)).unwrap();
    }

    #[test]
    fn lists_pngs_newest_first() {
        let dir = std::env::temp_dir().join(crate::models::new_id());
        assert_eq!(list(&dir).unwrap(), []);
        fs::create_dir_all(dir.join("folder.png")).unwrap();
        create(&dir.join("old.png"), 3, 60);
        create(&dir.join("new.PNG"), 5, 0);
        create(&dir.join("notes.txt"), 1, 0);

        let shots = list(&dir).unwrap();
        let names: Vec<_> = shots.iter().map(|s| s.file_name.as_str()).collect();
        assert_eq!(names, ["new.PNG", "old.png"]);
        assert_eq!(shots[1].size, 3);
        assert_eq!(shots[1].path, dir.join("old.png").to_string_lossy());
        assert!(shots[0].taken_at > shots[1].taken_at);
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn delete_only_listed_screenshots() {
        let dir = std::env::temp_dir().join(crate::models::new_id());
        fs::create_dir_all(&dir).unwrap();
        create(&dir.join("notes.txt"), 1, 0);
        for name in ["notes.txt", "../instances.json", "missing.png"] {
            assert!(matches!(delete(&dir, name), Err(AppError::NotFound { .. })), "{name}");
        }
        assert!(dir.join("notes.txt").is_file());
        fs::remove_dir_all(dir).unwrap();
    }
}
