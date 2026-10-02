//! CurseForge App: `minecraftinstance.json` im Instanzordner, der zugleich Spielordner ist. Unter `installedAddons`
//! steht, welche Dateien die App von CurseForge geladen hat.
use std::{collections::HashMap, path::Path};

use serde::Deserialize;
use serde_json::Value;

use super::{folder_name, from_json, loader_named, read_marker, skip_unreadable, split_args, Found, Setup};
use crate::{coded, error::{AppError, AppResult}, models::ModLoader};

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Manifest {
    #[serde(default)]
    name: Option<String>,
    game_version: String,
    /// Fehlt bei Vanilla.
    #[serde(default)]
    base_mod_loader: Option<BaseModLoader>,
    /// Eigene Einstellungen der Instanz; als `Value` gelesen, damit ein anderer Typ die Instanz nicht unlesbar macht.
    #[serde(default)]
    is_memory_override: Option<Value>,
    #[serde(default)]
    allocated_memory: Option<Value>,
    #[serde(default)]
    java_args_override: Option<Value>,
}

#[derive(Deserialize)]
struct BaseModLoader {
    name: String,
}

/// Nur für die Herkunft gelesen, damit eine fremde Addon-Liste das Erkennen der Instanz nicht stört.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Installed {
    #[serde(default)]
    installed_addons: Vec<Addon>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Addon {
    #[serde(rename = "addonID")]
    addon_id: u32,
    installed_file: InstalledFile,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct InstalledFile {
    id: u32,
    /// Name ohne `.disabled`, auch wenn die Datei deaktiviert ist.
    file_name: String,
}

/// Kennungsdatei der Instanz.
pub(super) const MANIFEST: &str = "minecraftinstance.json";

pub fn read(dir: &Path) -> AppResult<Option<Found>> {
    let Some(data) = read_marker(&dir.join(MANIFEST))? else { return Ok(None) };
    Ok(Some(Found { game_dir: dir.to_owned(), setup: setup(&data, &folder_name(dir))? }))
}

/// Dateiname -> (CurseForge-Projekt, Datei) der Inhalte, die die App von CurseForge geladen hat; leer, wenn `dir`
/// keine Instanz der CurseForge App ist. Ist die Liste unlesbar, bleiben die Mods lokal.
pub fn origins(dir: &Path) -> HashMap<String, (u32, u32)> {
    skip_unreadable(dir, read_origins(dir), "Herkunft der CurseForge-Inhalte nicht lesbar; als lokal erfasst")
}

fn read_origins(dir: &Path) -> AppResult<HashMap<String, (u32, u32)>> {
    let Some(data) = read_marker(&dir.join(MANIFEST))? else { return Ok(HashMap::new()) };
    let installed: Installed = from_json(&data)?;
    Ok(installed.installed_addons.into_iter().map(|a| (a.installed_file.file_name, (a.addon_id, a.installed_file.id))).collect())
}

/// Der Loader steht als `<loader>-<version>` in `baseModLoader.name`, bei Fabric mit `-<Minecraft-Version>` dahinter.
fn setup(data: &[u8], folder: &str) -> AppResult<Setup> {
    let manifest: Manifest = from_json(data)?;
    let (loader, loader_version) = match &manifest.base_mod_loader {
        None => (ModLoader::Vanilla, None),
        Some(base) => {
            let (kind, version) = base.name.split_once('-').ok_or_else(|| AppError::invalid(coded!("errors.app.import.unknownLoader", name = base.name)))?;
            let version = version.strip_suffix(&format!("-{}", manifest.game_version)).unwrap_or(version);
            (loader_named(kind)?, Some(version.to_owned()))
        }
    };
    let overrides_memory = manifest.is_memory_override.as_ref().and_then(Value::as_bool).unwrap_or(false);
    Ok(Setup {
        memory_mb: manifest.allocated_memory.as_ref().filter(|_| overrides_memory).and_then(Value::as_u64).and_then(|mb| u32::try_from(mb).ok()),
        jvm_args: manifest.java_args_override.as_ref().and_then(Value::as_str).map(split_args).unwrap_or_default(),
        ..Setup::new(manifest.name.unwrap_or_else(|| folder.into()), manifest.game_version, loader, loader_version)
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Auszug einer `minecraftinstance.json` mit den Feldern, die der Import liest.
    const FABRIC: &str = r#"{
        "baseModLoader": {"name": "fabric-0.15.11-1.20.4"},
        "gameVersion": "1.20.4",
        "name": "Fabulously Optimized",
        "installedAddons": [
            {"addonID": 394468, "installedFile": {"id": 5126735, "displayName": "Sodium", "fileName": "sodium-fabric-0.5.8+mc1.20.4.jar",
                "FileNameOnDisk": "sodium-fabric-0.5.8+mc1.20.4.jar.disabled"}}
        ]
    }"#;

    #[test]
    fn reads_loader_and_version_from_base_mod_loader() {
        let fabric = setup(FABRIC.as_bytes(), "ordner").unwrap();
        assert_eq!(
            (fabric.name.as_str(), fabric.minecraft_version.as_str(), fabric.loader, fabric.loader_version.as_deref()),
            ("Fabulously Optimized", "1.20.4", ModLoader::Fabric, Some("0.15.11"))
        );
        let neo = br#"{"baseModLoader": {"name": "neoforge-20.4.237-beta"}, "gameVersion": "1.20.4"}"#;
        let neo = setup(neo, "Neo").unwrap();
        assert_eq!((neo.name.as_str(), neo.loader, neo.loader_version.as_deref()), ("Neo", ModLoader::NeoForge, Some("20.4.237-beta")));
    }

    #[test]
    fn own_memory_and_java_arguments_count_only_when_the_instance_overrides_the_app() {
        let own = br#"{"gameVersion": "1.21.1", "isMemoryOverride": true, "allocatedMemory": 6144, "javaArgsOverride": "-Xss2M -XX:+UseZGC"}"#;
        let own = setup(own, "x").unwrap();
        assert_eq!((own.memory_mb, own.jvm_args), (Some(6144), vec!["-Xss2M".to_owned(), "-XX:+UseZGC".to_owned()]));
        let app = setup(br#"{"gameVersion": "1.21.1", "isMemoryOverride": false, "allocatedMemory": 4096, "javaArgsOverride": null}"#, "x").unwrap();
        assert_eq!((app.memory_mb, app.jvm_args.len()), (None, 0));
        assert!(setup(br#"{"gameVersion": "1.21.1", "isMemoryOverride": "ja", "allocatedMemory": 4.5}"#, "x").is_ok());
    }

    #[test]
    fn vanilla_has_no_base_mod_loader_and_bom_is_ignored() {
        let vanilla = setup(b"\xEF\xBB\xBF{\"gameVersion\": \"1.21.1\", \"name\": \"Pur\", \"baseModLoader\": null}", "x").unwrap();
        assert_eq!((vanilla.loader, vanilla.loader_version), (ModLoader::Vanilla, None));
        assert!(setup(br#"{"gameVersion": "1.7.10", "baseModLoader": {"name": "liteloader-1.7.10"}}"#, "x").is_err());
    }

    #[test]
    fn origins_map_file_names_to_curseforge_project_and_file() {
        let dir = std::env::temp_dir().join(crate::models::new_id());
        std::fs::create_dir_all(&dir).unwrap();
        assert!(origins(&dir).is_empty());
        std::fs::write(dir.join(MANIFEST), FABRIC).unwrap();
        assert_eq!(origins(&dir), HashMap::from([("sodium-fabric-0.5.8+mc1.20.4.jar".to_owned(), (394468, 5126735))]));
        std::fs::write(dir.join(MANIFEST), r#"{"gameVersion": "1.20.4", "installedAddons": [{"addonID": "kaputt"}]}"#).unwrap();
        assert!(origins(&dir).is_empty());
        std::fs::remove_dir_all(dir).unwrap();
    }
}
