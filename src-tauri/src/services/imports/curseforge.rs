//! CurseForge App: `minecraftinstance.json` im Instanzordner, der zugleich Spielordner ist.
use std::path::Path;

use serde::Deserialize;

use super::{folder_name, from_json, loader_named, read_marker, Setup};
use crate::{error::AppResult, models::ModLoader, services::modrinth::invalid};

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Manifest {
    #[serde(default)]
    name: Option<String>,
    game_version: String,
    /// Fehlt bei Vanilla.
    #[serde(default)]
    base_mod_loader: Option<BaseModLoader>,
}

#[derive(Deserialize)]
struct BaseModLoader {
    name: String,
}

pub fn read(dir: &Path) -> AppResult<Option<Setup>> {
    let Some(data) = read_marker(&dir.join("minecraftinstance.json"))? else { return Ok(None) };
    setup(&data, &folder_name(dir)).map(Some)
}

/// Der Loader steht als `<loader>-<version>` in `baseModLoader.name`, bei Fabric mit `-<Minecraft-Version>` dahinter.
fn setup(data: &[u8], folder: &str) -> AppResult<Setup> {
    let manifest: Manifest = from_json(data)?;
    let (loader, loader_version) = match &manifest.base_mod_loader {
        None => (ModLoader::Vanilla, None),
        Some(base) => {
            let (kind, version) = base.name.split_once('-').ok_or_else(|| invalid(format!("Unbekannter Loader „{}“", base.name)))?;
            let version = version.strip_suffix(&format!("-{}", manifest.game_version)).unwrap_or(version);
            (loader_named(kind)?, Some(version.to_owned()))
        }
    };
    Ok(Setup {
        name: manifest.name.unwrap_or_else(|| folder.into()),
        minecraft_version: manifest.game_version,
        loader,
        loader_version,
        memory_mb: None,
        jvm_args: Vec::new(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Auszug einer `minecraftinstance.json` mit den Feldern, die der Import liest.
    const FABRIC: &str = r#"{
        "baseModLoader": {"name": "fabric-0.15.11-1.20.4"},
        "gameVersion": "1.20.4",
        "name": "Fabulously Optimized"
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
    fn vanilla_has_no_base_mod_loader_and_bom_is_ignored() {
        let vanilla = setup(b"\xEF\xBB\xBF{\"gameVersion\": \"1.21.1\", \"name\": \"Pur\", \"baseModLoader\": null}", "x").unwrap();
        assert_eq!((vanilla.loader, vanilla.loader_version), (ModLoader::Vanilla, None));
        assert!(setup(br#"{"gameVersion": "1.7.10", "baseModLoader": {"name": "liteloader-1.7.10"}}"#, "x").is_err());
    }
}
