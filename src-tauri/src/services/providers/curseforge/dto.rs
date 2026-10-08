//! Datenformen der CurseForge-API, wie der Proxy sie durchreicht (nur die Felder, die der Launcher braucht), und
//! die Zahlencodes ihrer Felder.
use crate::{
    coded,
    error::{AppError, AppResult},
    models::ModLoader,
    services::providers::RemoteFile,
};
use percent_encoding::{utf8_percent_encode, AsciiSet, NON_ALPHANUMERIC};
use serde::Deserialize;
use std::collections::BTreeMap;

pub(super) const WEBSITE: &str = "https://www.curseforge.com/";
/// Wurzel der Dateien auf dem CDN (`<Kennung / 1000>/<Kennung % 1000>/<Dateiname>`).
const CDN_FILES: &str = "https://mediafilez.forgecdn.net/files";
/// Ein Pfadsegment der CDN-Adresse maskiert alles außer Buchstaben, Ziffern und `-._~` (auch `+` und Leerzeichen).
const PATH_SEGMENT: &AsciiSet = &NON_ALPHANUMERIC.remove(b'-').remove(b'.').remove(b'_').remove(b'~');

/// `releaseType` einer Datei.
pub(super) const RELEASE: u8 = 1;
const BETA: u8 = 2;
const ALPHA: u8 = 3;

/// `algo` des SHA-1 in der Hash-Liste einer Datei.
const HASH_SHA1: u8 = 1;

/// `relationType` einer Abhängigkeit.
pub(super) const REQUIRED: u8 = 3;
const OPTIONAL: u8 = 2;
pub(super) const INCOMPATIBLE: u8 = 5;

#[derive(Debug, Clone, Deserialize)]
pub(super) struct One<T> {
    pub(super) data: T,
}

#[derive(Debug, Clone, Deserialize)]
pub(super) struct Page<T> {
    pub(super) data: Vec<T>,
    #[serde(default)]
    pub(super) pagination: Option<Pagination>,
}

#[derive(Debug, Clone, Deserialize)]
pub(super) struct Pagination {
    #[serde(rename = "totalCount", default)]
    pub(super) total_count: u64,
}

#[derive(Debug, Clone, Deserialize)]
pub(super) struct CfMod {
    pub(super) id: u64,
    #[serde(default)]
    pub(super) slug: String,
    #[serde(default)]
    pub(super) name: String,
    #[serde(default)]
    pub(super) summary: String,
    #[serde(rename = "downloadCount", default)]
    pub(super) download_count: f64,
    #[serde(default)]
    pub(super) logo: Option<Logo>,
    #[serde(default)]
    pub(super) authors: Vec<Named>,
    #[serde(default)]
    pub(super) categories: Vec<Named>,
    #[serde(rename = "classId", default)]
    pub(super) class_id: Option<u32>,
    #[serde(default)]
    links: Option<Links>,
    #[serde(rename = "latestFilesIndexes", default)]
    pub(super) latest_files_indexes: Vec<FileIndex>,
}

/// Neueste Datei je Minecraft-Version, Loader und Release-Art; reicht, um eine Abhängigkeit ohne Dateiliste zu wählen.
#[derive(Debug, Clone, Deserialize)]
pub(super) struct FileIndex {
    #[serde(rename = "gameVersion", default)]
    pub(super) game_version: String,
    #[serde(rename = "fileId")]
    pub(super) file_id: u64,
    #[serde(rename = "releaseType", default)]
    pub(super) release_type: u8,
    #[serde(rename = "modLoader", default)]
    pub(super) mod_loader: Option<u8>,
}

#[derive(Debug, Clone, Deserialize)]
pub(super) struct Logo {
    #[serde(default)]
    pub(super) url: String,
    #[serde(rename = "thumbnailUrl", default)]
    pub(super) thumbnail_url: String,
}

#[derive(Debug, Clone, Deserialize)]
pub(super) struct Named {
    #[serde(default)]
    pub(super) name: String,
}

#[derive(Debug, Clone, Deserialize)]
struct Links {
    #[serde(rename = "websiteUrl", default)]
    website_url: String,
}

#[derive(Debug, Clone, Deserialize)]
pub(super) struct CfFile {
    pub(super) id: u64,
    #[serde(rename = "modId", default)]
    pub(super) mod_id: u64,
    #[serde(rename = "displayName", default)]
    pub(super) display_name: String,
    #[serde(rename = "fileName", default)]
    pub(super) file_name: String,
    #[serde(rename = "releaseType", default)]
    release_type: u8,
    #[serde(rename = "fileDate", default)]
    pub(super) file_date: String,
    #[serde(rename = "fileLength", default)]
    pub(super) file_length: u64,
    #[serde(rename = "downloadUrl", default)]
    pub(super) download_url: Option<String>,
    #[serde(rename = "gameVersions", default)]
    pub(super) game_versions: Vec<String>,
    #[serde(default)]
    hashes: Vec<HashDoc>,
    #[serde(default)]
    pub(super) dependencies: Vec<DepDoc>,
}

#[derive(Debug, Clone, Deserialize)]
struct HashDoc {
    value: String,
    algo: u8,
}

#[derive(Debug, Clone, Deserialize)]
pub(super) struct DepDoc {
    #[serde(rename = "modId")]
    pub(super) mod_id: u64,
    #[serde(rename = "relationType", default)]
    pub(super) relation_type: u8,
}

impl CfMod {
    /// Projektseite auf CurseForge; eine Adresse anderswo wäre ein Link aus fremder Hand.
    pub(super) fn website(&self) -> Option<String> {
        self.links.as_ref().map(|l| l.website_url.clone()).filter(|u| u.starts_with(WEBSITE))
    }
}

impl CfFile {
    /// Anzeigename der Datei; ohne ihn der Dateiname.
    pub(super) fn title(&self) -> &str {
        if self.display_name.is_empty() { &self.file_name } else { &self.display_name }
    }

    /// Loader-Namen der Datei (Schreibweise wie bei Modrinth).
    pub(super) fn loaders(&self) -> Vec<String> {
        self.game_versions
            .iter()
            .map(|v| v.to_ascii_lowercase())
            .filter(|v| ModLoader::from_modded_name(v).is_some())
            .collect()
    }

    pub(super) fn minecraft_versions(&self) -> Vec<String> {
        self.game_versions.iter().filter(|v| v.starts_with(|c: char| c.is_ascii_digit()) && v.contains('.')).cloned().collect()
    }

    pub(super) fn sha1(&self) -> Option<String> {
        self.hashes.iter().find(|h| h.algo == HASH_SHA1).map(|h| h.value.to_ascii_lowercase())
    }

    /// Release-Art in der Schreibweise von Modrinth.
    pub(super) fn release_kind(&self) -> &'static str {
        match self.release_type {
            BETA => "beta",
            ALPHA => "alpha",
            _ => "release",
        }
    }

    /// Abhängigkeiten als (Projekt, Art in der Schreibweise von Modrinth); andere Beziehungen fallen weg.
    pub(super) fn dependency_kinds(&self) -> impl Iterator<Item = (u64, &'static str)> + '_ {
        self.dependencies.iter().filter_map(|d| {
            let kind = match d.relation_type {
                REQUIRED => "required",
                OPTIONAL => "optional",
                INCOMPATIBLE => "incompatible",
                _ => return None,
            };
            Some((d.mod_id, kind))
        })
    }

    /// Projekte, die die Datei zwingend braucht.
    pub(super) fn required(&self) -> impl Iterator<Item = u64> + '_ {
        self.dependencies.iter().filter(|d| d.relation_type == REQUIRED).map(|d| d.mod_id)
    }

    /// Ob die API eine Download-Adresse nennt. Fehlt sie, haben die Autoren Downloads durch andere Launcher abgewählt.
    pub(super) fn has_api_url(&self) -> bool {
        self.download_url.as_deref().is_some_and(|url| !url.is_empty())
    }

    /// Adresse der Datei auf dem CDN von CurseForge: fest aus Kennung und Dateiname gebildet, so wie die Webseite sie
    /// selbst benutzt. Das CDN gibt auch Dateien heraus, zu denen die API keine Adresse nennt.
    pub(super) fn cdn_url(&self) -> String {
        format!("{CDN_FILES}/{}/{}/{}", self.id / 1000, self.id % 1000, utf8_percent_encode(&self.file_name, PATH_SEGMENT))
    }

    /// Die Adresse der API, sonst die des CDN.
    pub(super) fn download_url(&self) -> String {
        self.download_url.clone().filter(|url| !url.is_empty()).unwrap_or_else(|| self.cdn_url())
    }

    /// Download-Adresse und Prüfsumme; ohne Prüfsumme wird nichts geladen.
    pub(super) fn remote_file(&self) -> AppResult<RemoteFile> {
        let sha1 = self.sha1().ok_or_else(|| AppError::invalid(coded!("errors.providers.fileWithoutChecksum")))?;
        Ok(RemoteFile { urls: vec![self.download_url()], size: self.file_length, hashes: BTreeMap::from([("sha1", sha1)]) })
    }
}

/// Gemeinsame Testdaten der CurseForge-Module.
#[cfg(test)]
pub(super) mod fixtures {
    use super::*;
    use crate::models::{Instance, NewInstance};
    use serde_json::json;

    pub(in super::super) fn file(v: serde_json::Value) -> CfFile {
        serde_json::from_value(v).unwrap()
    }

    pub(in super::super) fn jei() -> CfFile {
        file(json!({
            "id": 9019497, "modId": 238222, "displayName": "31.8.0.49 for NeoForge 26.3", "fileName": "jei-26.3-neoforge-31.8.0.49.jar",
            "releaseType": 2, "fileDate": "2026-09-30T15:38:17.03Z", "fileLength": 2381616,
            "downloadUrl": "https://edge.forgecdn.net/files/9019/497/jei-26.3-neoforge-31.8.0.49.jar",
            "gameVersions": ["Client", "NeoForge", "Server", "26.3", "Java 21"],
            "hashes": [{"value": "ABCDEF0123456789ABCDEF0123456789ABCDEF01", "algo": 1}, {"value": "md5", "algo": 2}],
            "dependencies": [{"modId": 1, "relationType": 3}, {"modId": 2, "relationType": 2}, {"modId": 3, "relationType": 5}, {"modId": 4, "relationType": 1}]
        }))
    }

    pub(in super::super) fn instance(loader: ModLoader, mc: &str) -> Instance {
        Instance::from_new(NewInstance { name: "t".into(), minecraft_version: mc.into(), loader, loader_version: None })
    }
}

#[cfg(test)]
mod tests {
    use super::fixtures::jei;

    #[test]
    fn files_without_an_api_url_get_the_cdn_path_of_the_website() {
        let mut f = jei();
        assert!(f.has_api_url());
        assert_eq!(f.download_url(), "https://edge.forgecdn.net/files/9019/497/jei-26.3-neoforge-31.8.0.49.jar");
        f.download_url = None;
        assert!(!f.has_api_url());
        assert_eq!(f.download_url(), "https://mediafilez.forgecdn.net/files/9019/497/jei-26.3-neoforge-31.8.0.49.jar");
        assert_eq!(f.remote_file().unwrap().urls, [f.cdn_url()]);
        f.download_url = Some(String::new());
        assert!(!f.has_api_url(), "eine leere Adresse zählt nicht");
        assert_eq!(jei().remote_file().unwrap().hashes["sha1"], "abcdef0123456789abcdef0123456789abcdef01");
    }

    #[test]
    fn the_cdn_path_masks_everything_but_plain_file_name_characters() {
        let mut f = jei();
        f.id = 8_942_319;
        f.file_name = "Mod [Fabric] 1.0+mc1.21 ü_x-y~z.jar".into();
        assert_eq!(f.cdn_url(), "https://mediafilez.forgecdn.net/files/8942/319/Mod%20%5BFabric%5D%201.0%2Bmc1.21%20%C3%BC_x-y~z.jar");
        f.id = 7;
        f.file_name = "a/../b?c#d.jar".into();
        assert_eq!(f.cdn_url(), "https://mediafilez.forgecdn.net/files/0/7/a%2F..%2Fb%3Fc%23d.jar");
    }

    #[test]
    fn a_file_without_a_checksum_is_never_loaded() {
        let mut f = jei();
        f.hashes.clear();
        assert!(f.remote_file().is_err());
    }

    #[test]
    fn the_title_falls_back_to_the_file_name() {
        let mut f = jei();
        assert_eq!(f.title(), "31.8.0.49 for NeoForge 26.3");
        f.display_name.clear();
        assert_eq!(f.title(), "jei-26.3-neoforge-31.8.0.49.jar");
    }
}
