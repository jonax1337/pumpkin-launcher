//! Aufräumen beim Start: was ein unterbrochener Vorgang unter `backups/` liegen ließ.
use std::{
    fs, io,
    path::{Path, PathBuf},
};

use super::backup::{backup_stem, DELETING, PART};
use crate::services::{blocking, entries};
use crate::{error::AppResult, state::AppState};

/// Räumt beim Start unter `backups/` aller Instanzen auf, was ein unterbrochener Vorgang liegen ließ: halbe Sicherungen
/// und gelöschte Welten, deren Ordner nicht ganz wegging. Läuft schon ein anderer Vorgang, bleibt alles bis zum nächsten Start.
pub async fn remove_leftovers(state: &AppState) -> AppResult<usize> {
    let Ok(_guard) = state.operation(None) else { return Ok(0) };
    let dirs: Vec<PathBuf> = state.instances.list().iter().map(|i| state.dirs.backups(&i.id)).collect();
    blocking(move |_| Ok(dirs.iter().map(|dir| remove_leftovers_in(dir)).sum())).await
}

/// Was sich nicht entfernen lässt (unter Windows etwa eine noch geöffnete Datei) oder nicht lesbar ist, bleibt bis zum
/// nächsten Start und hält die übrigen Instanzen nicht auf.
fn remove_leftovers_in(dir: &Path) -> usize {
    let entries = entries(dir).unwrap_or_else(|err| {
        tracing::warn!(path = %dir.display(), %err, "Sicherungsordner nicht lesbar");
        Vec::new()
    });
    let mut removed = 0;
    for entry in entries.iter().filter(|entry| entry.file_name().to_str().is_some_and(is_leftover)) {
        match remove_entry(entry) {
            Ok(()) => removed += 1,
            Err(err) => {
                tracing::warn!(path = %entry.path().display(), %err, "Rest eines unterbrochenen Vorgangs nicht entfernt")
            }
        }
    }
    removed
}

fn remove_entry(entry: &fs::DirEntry) -> io::Result<()> {
    let path = entry.path();
    if entry.file_type()?.is_dir() { fs::remove_dir_all(path) } else { fs::remove_file(path) }
}

/// Namen, die nur `backup` (`<Welt>-<Unix-ms>.zip.part`) und `delete` (`<Welt>-<Unix-ms>.deleting`) vergeben.
fn is_leftover(name: &str) -> bool {
    [PART, DELETING].iter().any(|ext| name.strip_suffix(ext).and_then(|n| n.strip_suffix('.')).and_then(backup_stem).is_some())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::{new_id, Instance, ModLoader, NewInstance};
    use crate::services::write_files;

    #[test]
    fn only_names_of_interrupted_backups_and_deletes_are_leftovers() {
        assert!(is_leftover("Meine-Welt-1700000000000.zip.part"));
        assert!(is_leftover("Meine Welt-1700000000000.deleting"));
        for name in ["Welt-1700000000000.zip", "Welt.zip.part", "Welt-gestern.deleting", "-1.deleting", "notiz.part", "Welt-1.deleting.txt"] {
            assert!(!is_leftover(name), "{name}");
        }
    }

    #[tokio::test]
    async fn startup_removes_leftovers_but_keeps_backups() {
        let root = std::env::temp_dir().join(new_id());
        let state = AppState::load(&root).unwrap();
        let new = NewInstance { name: "Welten".into(), minecraft_version: "1.21.4".into(), loader: ModLoader::Vanilla, loader_version: None };
        let id = state.instances.insert(Instance::from_new(new)).unwrap().id;
        let backups = state.dirs.backups(&id);
        write_files::<&[u8]>(&backups, &[("Alt-1.zip", b"zip"), ("Alt-2.zip.part", b"halb"), ("Neu-3.deleting/level.dat", b"weg"), ("notiz.txt", b"x")]);

        assert_eq!(remove_leftovers(&state).await.unwrap(), 2);

        let mut left: Vec<_> = entries(&backups).unwrap().iter().map(|e| e.file_name().into_string().unwrap()).collect();
        left.sort();
        assert_eq!(left, ["Alt-1.zip", "notiz.txt"]);
        fs::remove_dir_all(root).unwrap();
    }
}
