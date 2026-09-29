//! Formate von piston-meta (Version-Manifest v2 und Versions-JSON), nach Mojangs JSON-Struktur.
use std::collections::HashMap;

use serde::{Deserialize, Serialize};

use crate::services::rules::Rule;

pub const MANIFEST_URL: &str = "https://piston-meta.mojang.com/mc/game/version_manifest_v2.json";
pub const RESOURCES_URL: &str = "https://resources.download.minecraft.net";

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Latest {
    pub release: String,
    pub snapshot: String,
}

#[derive(Debug, Clone, Deserialize)]
pub struct VersionManifest {
    pub latest: Latest,
    pub versions: Vec<VersionEntry>,
}

/// Eintrag im Manifest; geht so auch an das Frontend (`versions_list`).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VersionEntry {
    pub id: String,
    /// `release`, `snapshot`, `old_beta`, `old_alpha`
    #[serde(rename = "type")]
    pub kind: String,
    pub url: String,
    pub sha1: String,
    pub release_time: String,
}

/// Datei-Download aus der Versions-JSON (`artifact`, `client`, Classifier …).
#[derive(Debug, Clone, Deserialize)]
pub struct Download {
    #[serde(default)]
    pub path: Option<String>,
    pub sha1: String,
    pub url: String,
}

/// Download mit eigener ID (Asset-Index, Logging-Config).
#[derive(Debug, Clone, Deserialize)]
pub struct IdDownload {
    pub id: String,
    pub sha1: String,
    pub url: String,
}

#[derive(Debug, Clone, Default, Deserialize)]
pub struct LibraryDownloads {
    pub artifact: Option<Download>,
    #[serde(default)]
    pub classifiers: HashMap<String, Download>,
}

#[derive(Debug, Clone, Default, Deserialize)]
pub struct Extract {
    #[serde(default)]
    pub exclude: Vec<String>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct Library {
    /// Maven-Koordinate `group:artifact:version[:classifier]`.
    pub name: String,
    #[serde(default)]
    pub downloads: LibraryDownloads,
    #[serde(default)]
    pub rules: Vec<Rule>,
    /// Alte Versionen (< 1.19): OS → Classifier, z. B. `"windows": "natives-windows-${arch}"`.
    #[serde(default)]
    pub natives: HashMap<String, String>,
    #[serde(default)]
    pub extract: Extract,
}

impl Library {
    /// Classifier aus dem Namen (`org.lwjgl:lwjgl:3.3.3:natives-windows` → `natives-windows`).
    pub fn classifier(&self) -> Option<&str> {
        self.name.splitn(4, ':').nth(3)
    }
}

#[derive(Debug, Clone, Deserialize)]
#[serde(untagged)]
pub enum OneOrMany {
    One(String),
    Many(Vec<String>),
}

#[derive(Debug, Clone, Deserialize)]
#[serde(untagged)]
pub enum Argument {
    Plain(String),
    Conditional { rules: Vec<Rule>, value: OneOrMany },
}

#[derive(Debug, Clone, Default, Deserialize)]
pub struct Arguments {
    #[serde(default)]
    pub game: Vec<Argument>,
    #[serde(default)]
    pub jvm: Vec<Argument>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct JavaVersion {
    pub component: String,
    pub major_version: u32,
}

#[derive(Debug, Clone, Deserialize)]
pub struct LoggingClient {
    /// z. B. `-Dlog4j.configurationFile=${path}`
    pub argument: String,
    pub file: IdDownload,
}

#[derive(Debug, Clone, Default, Deserialize)]
pub struct Logging {
    pub client: Option<LoggingClient>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct ClientDownloads {
    pub client: Download,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VersionJson {
    pub id: String,
    #[serde(rename = "type")]
    pub kind: String,
    pub main_class: String,
    pub asset_index: IdDownload,
    pub downloads: ClientDownloads,
    pub libraries: Vec<Library>,
    /// Ab 1.13.
    #[serde(default)]
    pub arguments: Option<Arguments>,
    /// Bis 1.12: Game-Args als ein String.
    #[serde(default)]
    pub minecraft_arguments: Option<String>,
    #[serde(default)]
    pub java_version: Option<JavaVersion>,
    #[serde(default)]
    pub logging: Logging,
}

#[derive(Debug, Clone, Deserialize)]
pub struct AssetObject {
    pub hash: String,
}

#[derive(Debug, Clone, Deserialize)]
pub struct AssetIndex {
    pub objects: HashMap<String, AssetObject>,
}
