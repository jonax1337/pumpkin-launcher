//! Services: Persistenz, Auth, Installation (Mojang-Formate, Downloads, Java) und Spielstart.
use std::path::{Path, PathBuf};

pub mod auth;
pub mod download;
pub mod fabric;
pub mod gamelog;
pub mod install;
pub mod java;
pub mod launch;
pub mod mods;
pub mod modrinth;
pub mod content;
pub mod mojang;
pub mod rules;
pub mod store;
pub mod templates;

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

    pub fn library(&self, path: &str) -> PathBuf {
        self.libraries().join(Path::new(path))
    }
}
