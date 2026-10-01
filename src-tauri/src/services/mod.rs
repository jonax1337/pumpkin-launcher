//! Services: Persistenz, Auth, Installation (Mojang-Formate, Downloads, Java), Spielstart, Kopie und Export
//! von Instanzen, Skins und Support.
use std::{
    fs, io,
    path::{Path, PathBuf},
};

use tokio_util::sync::CancellationToken;

use crate::error::{AppError, AppResult};
use modrinth::invalid;

pub mod auth;
pub mod debuginfo;
pub mod download;
pub mod duplicate;
pub mod fabric;
pub mod forge;
pub mod gamelog;
pub mod install;
pub mod java;
pub mod launch;
pub mod logshare;
pub mod mods;
pub mod modrinth;
pub mod content;
pub mod mojang;
pub mod mrpack;
pub mod providers;
pub mod rules;
pub mod skins;
pub mod store;
pub mod system;
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

    /// Protokoll des letzten Starts, von Minecraft selbst geschrieben.
    pub fn latest_log(&self, instance_id: &str) -> PathBuf {
        self.game_dir(instance_id).join("logs").join("latest.log")
    }

    /// `mods/` im Spielverzeichnis, dort sucht Fabric (und jeder andere Loader).
    pub fn mods_dir(&self, instance_id: &str) -> PathBuf {
        self.game_dir(instance_id).join("mods")
    }

    /// Globaler Mod-Cache, Dateien als `<sha1>.jar`.
    pub fn mod_cache(&self) -> PathBuf {
        self.root.join("cache").join("mods")
    }

    /// Skin-Bibliothek, Dateien als `<sha1>.png`.
    pub fn skins(&self) -> PathBuf {
        self.root.join("skins")
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

/// Dateien unter `path` (Datei oder Ordner, rekursiv, ohne Symlinks/Junctions) als
/// (Pfad relativ zu `base` mit `/`, Pfad). Fehlt `path`, kommt nichts hinzu.
pub(crate) fn walk(base: &Path, path: &Path, out: &mut Vec<(String, PathBuf)>) -> AppResult<()> {
    let kind = match fs::symlink_metadata(path) {
        Ok(meta) => meta.file_type(),
        Err(e) if e.kind() == io::ErrorKind::NotFound => return Ok(()),
        Err(e) => return Err(e.into()),
    };
    if kind.is_dir() {
        for entry in fs::read_dir(path)? {
            walk(base, &entry?.path(), out)?;
        }
    } else if kind.is_file() {
        let rel = path.strip_prefix(base).map_err(|_| invalid("Pfad außerhalb des Spielordners"))?;
        let rel = rel.to_str().ok_or_else(|| invalid("Dateiname ist kein gültiger Text"))?.replace('\\', "/");
        out.push((rel, path.to_owned()));
    }
    Ok(())
}

/// Führt blockierende Dateiarbeit aus. Verwirft der Aufrufer das Future (Abbruch über `AppState::cancellable`),
/// läuft der Thread weiter, bis `work` das Token prüft ([`check_cancelled`]); aufräumen muss `work` selbst,
/// erst dann schreibt nichts mehr in das, was weg soll.
pub(crate) async fn blocking<T: Send + 'static>(
    work: impl FnOnce(&CancellationToken) -> AppResult<T> + Send + 'static,
) -> AppResult<T> {
    let stop = CancellationToken::new();
    let _stop_on_drop = stop.clone().drop_guard();
    tokio::task::spawn_blocking(move || work(&stop))
        .await
        .map_err(|e| invalid(format!("Der Vorgang ist unerwartet abgebrochen: {e}")))?
}

pub(crate) fn check_cancelled(stop: &CancellationToken) -> AppResult<()> {
    if stop.is_cancelled() {
        return Err(AppError::Cancelled);
    }
    Ok(())
}
