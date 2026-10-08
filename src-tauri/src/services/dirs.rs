//! Verzeichnislayout unter dem App-Datenverzeichnis.
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

use super::fsutil::entries;
use crate::error::AppResult;

/// Ordner im Spielverzeichnis, die Minecraft und Loader von selbst neu anlegen (Fabric: `.fabric`
/// mit umgemappten JARs); Kopien und Exporte lassen sie weg.
pub(crate) const REGENERATED: [&str; 3] = ["logs", "crash-reports", ".fabric"];

/// Verzeichnislayout unter dem App-Datenverzeichnis. Libraries, Assets, Versionen und
/// Java-Runtimes teilen sich alle Instanzen; jede Instanz hat ihr eigenes Spiel- und Natives-Verzeichnis.
#[derive(Debug, Clone)]
pub struct Dirs {
    pub root: PathBuf,
    instances: Arc<Mutex<PathBuf>>,
}

impl Dirs {
    pub fn new(root: impl Into<PathBuf>) -> Self {
        let root = root.into();
        Self { instances: Arc::new(Mutex::new(root.join("instances"))), root }
    }

    pub fn instances_dir(&self) -> PathBuf {
        super::lock(&self.instances).clone()
    }

    pub(crate) fn set_instances_dir(&self, path: PathBuf) {
        *super::lock(&self.instances) = path;
    }

    pub fn libraries(&self) -> PathBuf {
        self.root.join("libraries")
    }

    pub fn assets(&self) -> PathBuf {
        self.root.join("assets")
    }

    pub fn runtime(&self, component: &str) -> PathBuf {
        self.root.join("runtime").join(component)
    }

    /// Hier legt der Launcher die Mod-JARs für die Einspeisung ab, je Mod-Version ein Unterordner (docs/bridge/README.md, "Support selection").
    pub fn bridge_mod(&self) -> PathBuf {
        self.root.join("runtime").join("bridge-mod")
    }

    /// `versions/<id>/<id>.<ext>` (Versions-JSON und Client-JAR).
    pub fn version_file(&self, id: &str, ext: &str) -> PathBuf {
        self.root.join("versions").join(id).join(format!("{id}.{ext}"))
    }

    pub fn instance(&self, instance_id: &str) -> PathBuf {
        self.instances_dir().join(instance_id)
    }

    pub fn game_dir(&self, instance_id: &str) -> PathBuf {
        self.instance(instance_id).join("minecraft")
    }

    /// Protokoll des letzten Starts, von Minecraft selbst geschrieben.
    pub fn latest_log(&self, instance_id: &str) -> PathBuf {
        self.game_dir(instance_id).join("logs").join("latest.log")
    }

    /// Gesicherte Protokolle früherer Sitzungen; außerhalb des Spielordners, damit Exporte und Kopien sie nicht mitnehmen.
    pub fn session_logs(&self, instance_id: &str) -> PathBuf {
        self.instance(instance_id).join("session-logs")
    }

    /// `mods/` im Spielverzeichnis, dort sucht Fabric (und jeder andere Loader).
    pub fn mods_dir(&self, instance_id: &str) -> PathBuf {
        self.game_dir(instance_id).join("mods")
    }

    /// Welten des Spiels, je eine als Ordner.
    pub fn saves(&self, instance_id: &str) -> PathBuf {
        self.game_dir(instance_id).join("saves")
    }

    /// Sicherungen der Welten; außerhalb des Spielordners, damit Exporte und Kopien sie nicht mitnehmen.
    pub fn backups(&self, instance_id: &str) -> PathBuf {
        self.instance(instance_id).join("backups")
    }

    /// `screenshots/` im Spielverzeichnis, dort legt Minecraft mit F2 ab.
    pub fn screenshots_dir(&self, instance_id: &str) -> PathBuf {
        self.game_dir(instance_id).join("screenshots")
    }

    /// Globaler Mod-Cache, Dateien als `<sha1>.jar`.
    pub fn mod_cache(&self) -> PathBuf {
        self.root.join("cache").join("mods")
    }

    /// Skin-Bibliothek, Dateien als `<sha1>.png`.
    pub fn skins(&self) -> PathBuf {
        self.root.join("skins")
    }

    /// Vorlagen, Dateien als `<id>.mrpack`.
    pub fn templates(&self) -> PathBuf {
        self.root.join("templates")
    }

    pub fn natives_dir(&self, instance_id: &str) -> PathBuf {
        self.instance(instance_id).join("natives")
    }

    /// Markerdatei einer vollständigen Installation; ihr Inhalt hängt nur an Version und Loader.
    pub fn installed_marker(&self, instance_id: &str) -> PathBuf {
        self.instance(instance_id).join("installed")
    }

    /// Ordner und Dateien direkt im Spielverzeichnis, sortiert und ohne Neuerzeugtes.
    pub fn game_entries(&self, instance_id: &str) -> AppResult<Vec<String>> {
        let mut names: Vec<String> = entries(&self.game_dir(instance_id))?
            .iter()
            .filter_map(|entry| entry.file_name().into_string().ok())
            .filter(|name| !REGENERATED.contains(&name.as_str()))
            .collect();
        names.sort();
        Ok(names)
    }

    pub fn library(&self, path: &str) -> PathBuf {
        self.libraries().join(Path::new(path))
    }
}
