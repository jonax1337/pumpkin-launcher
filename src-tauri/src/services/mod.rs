//! Services: Persistenz, Auth, Installation (Mojang-Formate, Downloads, Java) und Spielstart.
use std::{
    fs, io,
    path::{Path, PathBuf},
};

pub mod auth;
pub mod download;
pub mod duplicate;
pub mod fabric;
pub mod forge;
pub mod gamelog;
pub mod install;
pub mod java;
pub mod launch;
pub mod mods;
pub mod modrinth;
pub mod content;
pub mod mojang;
pub mod mrpack;
pub mod providers;
pub mod rules;
pub mod store;
pub mod templates;

/// Ordner im Spielverzeichnis, die Minecraft und Loader von selbst neu anlegen (Fabric: `.fabric`
/// mit umgemappten JARs); Kopien und Exporte lassen sie weg.
const REGENERATED: [&str; 3] = ["logs", "crash-reports", ".fabric"];

/// Verzeichnislayout unter dem App-Datenverzeichnis. Libraries, Assets, Versionen und
/// Java-Runtimes teilen sich alle Instanzen; jede Instanz hat ihr eigenes Spiel- und Natives-Verzeichnis.
#[derive(Debug, Clone)]
pub struct Dirs {
    pub root: PathBuf,
}

impl Dirs {
    pub fn new(root: impl Into<PathBuf>) -> Self {
        Self { root: root.into() }
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

    /// `versions/<id>/<id>.<ext>` (Versions-JSON und Client-JAR).
    pub fn version_file(&self, id: &str, ext: &str) -> PathBuf {
        self.root.join("versions").join(id).join(format!("{id}.{ext}"))
    }

    pub fn instance(&self, instance_id: &str) -> PathBuf {
        self.root.join("instances").join(instance_id)
    }

    pub fn game_dir(&self, instance_id: &str) -> PathBuf {
        self.instance(instance_id).join("minecraft")
    }

    /// `mods/` im Spielverzeichnis, dort sucht Fabric (und jeder andere Loader).
    pub fn mods_dir(&self, instance_id: &str) -> PathBuf {
        self.game_dir(instance_id).join("mods")
    }

    /// Globaler Mod-Cache, Dateien als `<sha1>.jar`.
    pub fn mod_cache(&self) -> PathBuf {
        self.root.join("cache").join("mods")
    }

    pub fn natives_dir(&self, instance_id: &str) -> PathBuf {
        self.instance(instance_id).join("natives")
    }

    /// Markerdatei einer vollständigen Installation; ihr Inhalt hängt nur an Version und Loader.
    pub fn installed_marker(&self, instance_id: &str) -> PathBuf {
        self.instance(instance_id).join("installed")
    }

    /// Ordner und Dateien direkt im Spielverzeichnis, sortiert und ohne Neuerzeugtes.
    pub fn game_entries(&self, instance_id: &str) -> io::Result<Vec<String>> {
        let entries = match fs::read_dir(self.game_dir(instance_id)) {
            Ok(entries) => entries,
            Err(e) if e.kind() == io::ErrorKind::NotFound => return Ok(Vec::new()),
            Err(e) => return Err(e),
        };
        let mut names = Vec::new();
        for entry in entries {
            if let Some(name) = entry?.file_name().to_str().filter(|n| !REGENERATED.contains(n)) {
                names.push(name.to_owned());
            }
        }
        names.sort();
        Ok(names)
    }

    pub fn library(&self, path: &str) -> PathBuf {
        self.libraries().join(Path::new(path))
    }
}
