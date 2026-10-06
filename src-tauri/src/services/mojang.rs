//! Formate von piston-meta (Version-Manifest v2 und Versions-JSON), nach Mojangs JSON-Struktur.
use std::collections::HashMap;

use serde::{Deserialize, Serialize};

use crate::services::rules::{self, Env, Rule};

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
    #[serde(flatten)]
    pub download: Download,
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
    /// Library, die nur aus einem JAR besteht, ohne Regeln und Natives (so liefern Mod-Loader ihre Libraries).
    pub fn from_artifact(name: &str, artifact: Download) -> Self {
        Self {
            name: name.to_owned(),
            downloads: LibraryDownloads { artifact: Some(artifact), classifiers: HashMap::new() },
            rules: Vec::new(),
            natives: HashMap::new(),
            extract: Extract::default(),
        }
    }

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
pub struct JavaVersion {
    pub component: String,
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

impl VersionJson {
    /// Java-Komponente der Version; sehr alte Versions-JSONs haben keine Angabe → Java 8.
    pub fn java_component(&self) -> &str {
        self.java_version.as_ref().map_or("jre-legacy", |j| j.component.as_str())
    }

    /// Library-Artefakte, die laut Regeln auf diese Plattform gehören (Classpath und Download).
    pub fn artifacts<'a>(&'a self, env: &'a Env) -> impl Iterator<Item = (&'a Library, &'a Download)> {
        self.libraries
            .iter()
            .filter(|l| rules::allowed(&l.rules, env))
            .filter_map(|l| l.downloads.artifact.as_ref().map(|a| (l, a)))
    }
}

/// Nur verwundbare Koordinaten ersetzen; Mojangs und der Loader originale JSONs bleiben SHA-1-prüfbar.
/// 2.17.1 unterstützt Java 8 und schützt auch bei einer eigenen Logging-Konfiguration des Loaders.
pub(crate) fn secure_logging_libraries(libraries: &mut [Library]) {
    for library in libraries {
        if let Some((name, artifact)) = patched_logging_artifact(&library.name) {
            library.name = name;
            library.downloads.artifact = Some(artifact);
        }
    }
}

pub(crate) fn patched_logging_artifact(name: &str) -> Option<(String, Download)> {
    let mut parts = name.split(':');
    let (Some("org.apache.logging.log4j"), Some(module), Some(version), None) =
        (parts.next(), parts.next(), parts.next(), parts.next())
    else { return None };
    let sha1 = patched_log4j_sha1(module)?;
    let (release, prerelease) = version.split_once('-').map_or((version, false), |(v, _)| (v, true));
    let mut numbers = [0_u32; 3];
    for (index, part) in release.split('.').enumerate() {
        *numbers.get_mut(index)? = part.parse().ok()?;
    }
    if numbers > [2, 17, 1] || (numbers == [2, 17, 1] && !prerelease) {
        return None;
    }
    let path = format!("org/apache/logging/log4j/{module}/2.17.1/{module}-2.17.1.jar");
    Some((format!("org.apache.logging.log4j:{module}:2.17.1"), Download {
        url: format!("https://repo.maven.apache.org/maven2/{path}"),
        path: Some(path),
        sha1: sha1.to_owned(),
    }))
}

fn patched_log4j_sha1(module: &str) -> Option<&'static str> {
    // SHA-1 aus den offiziellen Maven-Central .jar.sha1-Dateien für 2.17.1.
    match module {
        "log4j-api" => Some("d771af8e336e372fb5399c99edabe0919aeaf5b2"),
        "log4j-core" => Some("779f60f3844dadc3ef597976fcb1e5127b1f343d"),
        "log4j-slf4j18-impl" => Some("ca499d751f4ddd8afb016ef698c30be0da1d09f7"),
        "log4j-slf4j-impl" => Some("84692d456bcce689355d33d68167875e486954dd"),
        "log4j-to-slf4j" => Some("3619fd18278a1a895c1dca8c5be002768071a20e"),
        "log4j-jul" => Some("881333b463d47828eda7443b19811763367b1916"),
        "log4j-jcl" => Some("09a61078c937a2c064b73c3b2bf5801a86182533"),
        "log4j-1.2-api" => Some("db3a7e7f07e878b92ac4a8f1100bee8325d5713a"),
        "log4j-web" => Some("1a9e4a6ba9ac4e82c9d57ba7425168555b636d4f"),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn vulnerable_logging_modules_use_java_eight_compatible_patched_artifacts() {
        for module in ["log4j-api", "log4j-core", "log4j-slf4j18-impl"] {
            let mut lib = Library::from_artifact(
                &format!("org.apache.logging.log4j:{module}:2.8.1"),
                Download { path: Some("old.jar".into()), sha1: "old".into(), url: "old".into() },
            );
            secure_logging_libraries(std::slice::from_mut(&mut lib));
            assert_eq!(lib.name, format!("org.apache.logging.log4j:{module}:2.17.1"));
            let artifact = lib.downloads.artifact.unwrap();
            assert_eq!(artifact.path.unwrap(), format!("org/apache/logging/log4j/{module}/2.17.1/{module}-2.17.1.jar"));
            assert!(crate::services::download::is_sha1(&artifact.sha1));
            assert!(artifact.url.starts_with("https://repo.maven.apache.org/maven2/"));
        }
    }

    #[test]
    fn safe_logging_and_unrelated_libraries_keep_their_original_artifacts() {
        for name in [
            "org.apache.logging.log4j:log4j-core:2.17.1",
            "org.apache.logging.log4j:log4j-core:2.17.2",
            "org.apache.logging.log4j:log4j-api:2.24.1",
            "other.group:log4j-core:2.8.1",
        ] {
            let mut lib = Library::from_artifact(name, Download { path: Some("original.jar".into()), sha1: "original".into(), url: "original".into() });
            secure_logging_libraries(std::slice::from_mut(&mut lib));
            assert_eq!(lib.name, name);
            assert_eq!(lib.downloads.artifact.unwrap().url, "original");
        }
    }
}

#[derive(Debug, Clone, Deserialize)]
pub struct AssetObject {
    pub hash: String,
}

#[derive(Debug, Clone, Deserialize)]
pub struct AssetIndex {
    pub objects: HashMap<String, AssetObject>,
}
