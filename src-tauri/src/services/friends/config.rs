//! Einstellungen der Freunde (SPEC 9): `friends/config.json` im App-Datenverzeichnis. Fehlt die Datei, sind die
//! Freunde aus und alles steht auf den Standardwerten; der Anzeigename wird erst beim Aktivieren aus dem Konto vorbelegt.
use std::fs;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use super::contract::FriendsSettings;
use crate::error::AppResult;
use crate::services::{free_name, none_if_missing, write_atomic, Dirs};

const CONFIG_VERSION: u32 = 2;
const CONFIG_FILE: &str = "config.json";

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct FriendsConfig {
    pub version: u32,
    pub enabled: bool,
    pub settings: FriendsSettings,
    pub third_party_relays_accepted: bool,
}

impl Default for FriendsConfig {
    fn default() -> Self {
        Self {
            version: CONFIG_VERSION,
            enabled: false,
            settings: FriendsSettings { display_name: String::new(), always_relay: false },
            third_party_relays_accepted: false,
        }
    }
}

/// Ordner aller Freunde-Dateien.
pub fn friends_dir(dirs: &Dirs) -> PathBuf {
    dirs.root.join("friends")
}

impl FriendsConfig {
    /// Eine unlesbare Datei wird nach `config.json.corrupt` gesichert statt beim nächsten Speichern überschrieben.
    pub fn load(dir: &Path) -> AppResult<Self> {
        let path = dir.join(CONFIG_FILE);
        let Some(raw) = none_if_missing(fs::read_to_string(&path))? else { return Ok(Self::default()) };
        match serde_json::from_str(&raw) {
            Ok(config) => Ok(config),
            Err(err) => {
                set_aside(&path, &err)?;
                Ok(Self::default())
            }
        }
    }

    pub fn save(&self, dir: &Path) -> AppResult<()> {
        fs::create_dir_all(dir)?;
        write_atomic(&dir.join(CONFIG_FILE), &serde_json::to_vec_pretty(self)?)
    }
}

fn set_aside(path: &Path, err: &serde_json::Error) -> AppResult<()> {
    let name = path.file_name().unwrap_or_default().to_string_lossy();
    let backup = path.with_file_name(free_name(&name, ".corrupt", |n| path.with_file_name(n).exists()));
    tracing::warn!(?path, ?backup, %err, "defekte Freunde-Konfiguration gesichert, starte mit Standardwerten");
    fs::rename(path, backup)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::services::friends::test_support::TempDir;

    #[test]
    fn missing_file_means_everything_off() {
        let dir = TempDir::new();
        let config = FriendsConfig::load(dir.path()).unwrap();
        assert!(!config.enabled);
        assert!(!config.settings.always_relay);
        assert!(!config.third_party_relays_accepted);
        assert_eq!(config.settings.display_name, "");
        assert_eq!(config.version, 2);
    }

    #[test]
    fn saved_config_loads_back_and_creates_the_folder() {
        let dir = TempDir::new();
        let folder = dir.path().join("friends");
        let config = FriendsConfig {
            enabled: true,
            settings: FriendsSettings { display_name: "Jonas".into(), always_relay: true },
            third_party_relays_accepted: true,
            ..FriendsConfig::default()
        };
        config.save(&folder).unwrap();
        assert_eq!(FriendsConfig::load(&folder).unwrap(), config);
    }

    #[test]
    fn file_has_the_documented_shape() {
        let dir = TempDir::new();
        FriendsConfig::default().save(dir.path()).unwrap();
        let written: serde_json::Value = serde_json::from_slice(&fs::read(dir.path().join(CONFIG_FILE)).unwrap()).unwrap();
        let expected = serde_json::json!({
            "version": 2,
            "enabled": false,
            "settings": { "displayName": "", "alwaysRelay": false },
            "thirdPartyRelaysAccepted": false
        });
        assert_eq!(written, expected);
    }

    #[test]
    fn missing_fields_take_their_defaults() {
        let dir = TempDir::new();
        fs::write(dir.path().join(CONFIG_FILE), r#"{ "enabled": true }"#).unwrap();
        let config = FriendsConfig::load(dir.path()).unwrap();
        assert!(config.enabled);
        assert!(!config.settings.always_relay);
    }

    #[test]
    fn unreadable_file_is_set_aside_and_never_overwritten() {
        let dir = TempDir::new();
        fs::write(dir.path().join(CONFIG_FILE), "{kaputt").unwrap();
        assert_eq!(FriendsConfig::load(dir.path()).unwrap(), FriendsConfig::default());
        assert_eq!(fs::read_to_string(dir.path().join("config.json.corrupt")).unwrap(), "{kaputt");
        assert!(!dir.path().join(CONFIG_FILE).exists());
    }

    #[test]
    fn friends_dir_is_below_the_app_data_dir() {
        assert_eq!(friends_dir(&Dirs::new("/daten")), Path::new("/daten").join("friends"));
    }
}
