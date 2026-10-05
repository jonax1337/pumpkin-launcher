//! Manifest einer geteilten Instanz (SPEC 5.5): was der Gastgeber seinen Freunden über Version, Loader und
//! Mod-Liste verrät, und wie der Gast es prüft. Es gehen nur Hashes und Anzeigenamen über die Leitung, nie Pfade.
use std::collections::{HashMap, HashSet};
use std::fs::File;
use std::io;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::SystemTime;

use serde::{Deserialize, Serialize};

use super::contract::{MIN_MC_LABEL, MIN_MC_RELEASE_TIME};
use super::sanitize;
use crate::coded;
use crate::error::AppError;
use crate::models::{Instance, Mod, ModKind, ModLoader};
use crate::services::mojang::VersionManifest;
use crate::services::transport::Digests;
use crate::services::{lock, require_plain_name};

/// Mehr Mods nimmt der Gast nicht an; ein größeres Manifest ist ungültig.
pub const MAX_MANIFEST_MODS: usize = 500;
const LOADER_VERSION_MAX: usize = 64;
const SHA512_HEX_LEN: usize = 128;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Manifest {
    pub minecraft_version: String,
    pub loader: ModLoader,
    #[serde(default)]
    pub loader_version: Option<String>,
    pub mods: Vec<ManifestMod>,
}

/// Eine Mod-Datei: ihr SHA-512 ist die Identität, der Dateiname nur Anzeige.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ManifestMod {
    pub sha512: String,
    pub file_name: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, thiserror::Error)]
pub enum ManifestError {
    #[error("Manifest ungültig: {0}")]
    Invalid(&'static str),
    #[error("Minecraft-Version zu alt für geteilte Welten")]
    VersionUnsupported,
}

impl From<ManifestError> for AppError {
    fn from(err: ManifestError) -> Self {
        match err {
            ManifestError::Invalid(_) => {
                AppError::invalid(coded!("errors.friends.manifestInvalid"))
            }
            ManifestError::VersionUnsupported => AppError::invalid(coded!(
                "errors.friends.versionUnsupported",
                min = MIN_MC_LABEL
            )),
        }
    }
}

/// Minecraft-Version → Erscheinungszeit aus Mojangs Versions-Manifest.
pub struct VersionIndex(HashMap<String, String>);

impl VersionIndex {
    pub fn new(entries: impl IntoIterator<Item = (String, String)>) -> Self {
        Self(entries.into_iter().collect())
    }

    pub fn from_manifest(manifest: &VersionManifest) -> Self {
        Self::new(
            manifest
                .versions
                .iter()
                .map(|entry| (entry.id.clone(), entry.release_time.clone())),
        )
    }

    fn release_time(&self, version: &str) -> Option<&str> {
        self.0.get(version).map(String::as_str)
    }
}

/// Das Manifest der Instanz: jede aktive Mod-Datei mit ihrem SHA-512 (die Freunde-Mod liegt nie in der Instanz). Eine Datei, die
/// sich nicht lesen lässt, fehlt; dieselbe Datei unter zwei Namen steht nur einmal drin.
pub fn build(
    instance: &Instance,
    mods_dir: &Path,
    hasher: &dyn Fn(&Path) -> io::Result<String>,
) -> Manifest {
    let mut seen = HashSet::new();
    let mods = hashed_mods(instance, mods_dir, hasher)
        .into_iter()
        .filter(|file| seen.insert(file.sha512.clone()))
        .collect();
    Manifest {
        minecraft_version: instance.minecraft_version.clone(),
        loader: instance.loader,
        loader_version: instance.loader_version.clone(),
        mods,
    }
}

/// Aktive Mods der Instanz (keine Ressourcenpakete oder Shader) mit dem SHA-512 ihrer Datei in `mods_dir`.
pub fn hashed_mods(
    instance: &Instance,
    mods_dir: &Path,
    hasher: &dyn Fn(&Path) -> io::Result<String>,
) -> Vec<ManifestMod> {
    let active = instance
        .mods
        .iter()
        .filter(|m| m.enabled && m.kind == ModKind::Mod);
    active.filter_map(|m| hashed(m, mods_dir, hasher)).collect()
}

fn hashed(
    m: &Mod,
    mods_dir: &Path,
    hasher: &dyn Fn(&Path) -> io::Result<String>,
) -> Option<ManifestMod> {
    let path = mods_dir.join(require_plain_name(&m.file_name).ok()?);
    match hasher(&path) {
        Ok(sha512) => Some(ManifestMod {
            sha512,
            file_name: m.file_name.clone(),
        }),
        Err(err) => {
            tracing::warn!(file = %m.file_name, %err, "Mod-Datei ohne Hash, sie fehlt im Manifest");
            None
        }
    }
}

/// Prüft ein fremdes Manifest und liefert es mit bereinigten Dateinamen zurück.
pub fn validate(raw: Manifest, versions: &VersionIndex) -> Result<Manifest, ManifestError> {
    ensure_supported_version(&raw.minecraft_version, versions)?;
    ensure_loader_version(raw.loader_version.as_deref())?;
    if raw.mods.len() > MAX_MANIFEST_MODS {
        return Err(ManifestError::Invalid("zu viele Mods"));
    }
    let mut seen = HashSet::new();
    let mut mods = Vec::with_capacity(raw.mods.len());
    for m in raw.mods {
        if !is_sha512(&m.sha512) || !seen.insert(m.sha512.clone()) {
            return Err(ManifestError::Invalid("Hash ungültig oder doppelt"));
        }
        let file_name = sanitize::file_name(&m.file_name);
        if file_name.is_empty() {
            return Err(ManifestError::Invalid("Dateiname leer"));
        }
        mods.push(ManifestMod {
            sha512: m.sha512,
            file_name,
        });
    }
    Ok(Manifest { mods, ..raw })
}

/// ISO-8601 mit demselben Format (`+00:00`) wie [`MIN_MC_RELEASE_TIME`], daher als Text vergleichbar.
fn ensure_supported_version(version: &str, versions: &VersionIndex) -> Result<(), ManifestError> {
    let released = versions
        .release_time(version)
        .ok_or(ManifestError::Invalid("unbekannte Minecraft-Version"))?;
    if released < MIN_MC_RELEASE_TIME {
        return Err(ManifestError::VersionUnsupported);
    }
    Ok(())
}

fn ensure_loader_version(version: Option<&str>) -> Result<(), ManifestError> {
    let well_formed = |v: &str| {
        (1..=LOADER_VERSION_MAX).contains(&v.len())
            && v.bytes()
                .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'.' | b'+' | b'_' | b'-'))
    };
    if version.is_some_and(|v| !well_formed(v)) {
        return Err(ManifestError::Invalid("Loader-Version ungültig"));
    }
    Ok(())
}

fn is_sha512(hash: &str) -> bool {
    hash.len() == SHA512_HEX_LEN && hash.bytes().all(|b| matches!(b, b'0'..=b'9' | b'a'..=b'f'))
}

/// SHA-512 einer Datei in Kleinbuchstaben-Hex. Blockiert: aus `spawn_blocking` aufrufen.
pub fn sha512_file(path: &Path) -> io::Result<String> {
    let digests = Digests::of_reader(File::open(path)?)?;
    Ok(digests.hex("sha512").expect("sha512 wird immer berechnet"))
}

/// Merkt sich den SHA-512 je Datei, solange Größe und Änderungszeit gleich bleiben (SPEC 5.5).
#[derive(Default)]
pub struct HashCache {
    entries: Mutex<HashMap<PathBuf, CachedHash>>,
}

struct CachedHash {
    size: u64,
    modified: SystemTime,
    sha512: String,
}

impl HashCache {
    /// Hash aus dem Merker, sonst aus der Datei. Blockiert: aus `spawn_blocking` aufrufen.
    pub fn hash(&self, path: &Path) -> io::Result<String> {
        let meta = path.metadata()?;
        let (size, modified) = (meta.len(), meta.modified()?);
        if let Some(sha512) = self.cached(path, size, modified) {
            return Ok(sha512);
        }
        let sha512 = sha512_file(path)?;
        let entry = CachedHash {
            size,
            modified,
            sha512: sha512.clone(),
        };
        lock(&self.entries).insert(path.to_owned(), entry);
        Ok(sha512)
    }

    fn cached(&self, path: &Path, size: u64, modified: SystemTime) -> Option<String> {
        let entries = lock(&self.entries);
        entries
            .get(path)
            .filter(|e| e.size == size && e.modified == modified)
            .map(|e| e.sha512.clone())
    }
}
