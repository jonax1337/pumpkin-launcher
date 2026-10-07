//! `.mrpack`-Dateien, mit denen der Launcher geöffnet wird (Doppelklick im Dateimanager, „Öffnen mit“).
//! Beim ersten Start steht die Datei in der Kommandozeile, bei einem zweiten Start meldet sie die laufende Instanz
//! (Single-Instance) und auf macOS das Betriebssystem. Die Oberfläche holt sie mit `pack_open_take` ab und zeigt
//! den Import-Dialog; `pack-opened` sagt ihr, dass etwas Neues wartet.
use std::{
    path::{Path, PathBuf},
    sync::Mutex,
};

use tauri::{AppHandle, Emitter, Manager, State};

use crate::services::lock;

/// Die zuletzt geöffnete Pack-Datei, die die Oberfläche noch nicht abgeholt hat.
#[derive(Default)]
pub struct OpenedPack(Mutex<Option<PathBuf>>);

impl OpenedPack {
    /// Die Datei, mit der dieser Prozess gestartet wurde.
    pub fn from_process_args() -> Self {
        let args: Vec<String> = std::env::args_os().filter_map(|arg| arg.into_string().ok()).collect();
        let cwd = std::env::current_dir().unwrap_or_default();
        Self(Mutex::new(pack_in_args(&args, &cwd)))
    }

    fn set(&self, path: PathBuf) {
        *lock(&self.0) = Some(path);
    }

    fn take(&self) -> Option<PathBuf> {
        lock(&self.0).take()
    }
}

/// Die erste `.mrpack`-Datei unter den Argumenten (das erste ist das Programm); relative Pfade gelten ab `cwd`.
/// Nur existierende Dateien: alles andere in der Kommandozeile geht den Launcher nichts an.
pub fn pack_in_args(args: &[String], cwd: &Path) -> Option<PathBuf> {
    args.iter()
        .skip(1)
        .filter(|arg| !arg.starts_with('-'))
        .map(|arg| cwd.join(arg))
        .find(|path| is_pack_file(path))
}

pub fn is_pack_file(path: &Path) -> bool {
    path.extension().is_some_and(|ext| ext.eq_ignore_ascii_case("mrpack")) && path.is_file()
}

/// Merkt sich die Datei eines weiteren Starts und sagt der Oberfläche Bescheid.
/// Vor dem Ende von `setup` gibt es den Zustand noch nicht; dann steht die Datei schon in der Kommandozeile.
pub fn announce(app: &AppHandle, path: PathBuf) {
    let Some(state) = app.try_state::<OpenedPack>() else {
        return;
    };
    state.set(path);
    if let Err(err) = app.emit("pack-opened", ()) {
        tracing::warn!(%err, "Event pack-opened nicht gesendet");
    }
}

/// Zweiter Start: Argumente wie bei einem ersten.
pub fn announce_args(app: &AppHandle, args: &[String], cwd: &Path) {
    if let Some(path) = pack_in_args(args, cwd) {
        announce(app, path);
    }
}

/// Die geöffnete Pack-Datei (absoluter Pfad), solange die Oberfläche sie noch nicht abgeholt hat.
#[tauri::command]
pub fn pack_open_take(state: State<'_, OpenedPack>) -> Option<String> {
    state.take().map(|path| path.to_string_lossy().into_owned())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::new_id;

    fn args(list: &[&str]) -> Vec<String> {
        list.iter().map(|a| a.to_string()).collect()
    }

    #[test]
    fn only_existing_mrpack_files_among_the_arguments_count() {
        let dir = std::env::temp_dir().join(new_id());
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join("Pack.MRPACK"), "x").unwrap();
        std::fs::write(dir.join("notes.txt"), "x").unwrap();
        let program = "pumpkin-launcher.exe";

        assert_eq!(pack_in_args(&args(&[program, "--flag", "notes.txt", "Pack.MRPACK"]), &dir), Some(dir.join("Pack.MRPACK")));
        let absolute = dir.join("Pack.MRPACK").to_string_lossy().into_owned();
        assert_eq!(pack_in_args(&args(&[program, &absolute]), Path::new("/elsewhere")), Some(dir.join("Pack.MRPACK")));
        assert_eq!(pack_in_args(&args(&[program, "missing.mrpack"]), &dir), None);
        assert_eq!(pack_in_args(&args(&["Pack.MRPACK"]), &dir), None);
        assert_eq!(pack_in_args(&args(&[program, "--Pack.mrpack"]), &dir), None);
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn a_pack_is_handed_over_once() {
        let opened = OpenedPack::default();
        assert_eq!(opened.take(), None);

        opened.set(PathBuf::from("a.mrpack"));
        opened.set(PathBuf::from("b.mrpack"));

        assert_eq!(opened.take(), Some(PathBuf::from("b.mrpack")));
        assert_eq!(opened.take(), None);
    }
}
