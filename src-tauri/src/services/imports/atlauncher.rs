//! ATLauncher: `instance.json` im Instanzordner, der zugleich Spielordner ist. `id` ist die Minecraft-Version,
//! der Rest steht unter `launcher`.
use std::path::Path;

use serde::Deserialize;

use super::{from_json, loader_named, read_marker, split_args, Setup};
use crate::{error::AppResult, models::ModLoader};

#[derive(Deserialize)]
struct Manifest {
    id: String,
    launcher: Launcher,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Launcher {
    name: String,
    /// Fehlt bei Vanilla.
    #[serde(default)]
    loader_version: Option<LoaderVersion>,
    /// MiB; ohne gilt die Einstellung von ATLauncher.
    #[serde(default)]
    maximum_memory: Option<u32>,
    #[serde(default)]
    java_arguments: Option<String>,
}

#[derive(Deserialize)]
struct LoaderVersion {
    version: String,
    r#type: String,
}

pub fn read(dir: &Path) -> AppResult<Option<Setup>> {
    let Some(data) = read_marker(&dir.join("instance.json"))? else { return Ok(None) };
    setup(&data).map(Some)
}

fn setup(data: &[u8]) -> AppResult<Setup> {
    let Manifest { id, launcher } = from_json(data)?;
    let (loader, loader_version) = match launcher.loader_version {
        None => (ModLoader::Vanilla, None),
        Some(l) => (loader_named(&l.r#type)?, Some(l.version)),
    };
    Ok(Setup {
        name: launcher.name,
        minecraft_version: id,
        loader,
        loader_version,
        memory_mb: launcher.maximum_memory,
        jvm_args: launcher.java_arguments.as_deref().map(split_args).unwrap_or_default(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Auszug einer `instance.json` (Gson, Feldnamen wie in ATLauncher `Instance`/`InstanceLauncher`).
    const NEOFORGE: &str = r#"{
        "id": "1.21.1",
        "launcher": {
            "name": "Mein Pack",
            "pack": "Mein Pack",
            "version": "1.0",
            "loaderVersion": {"version": "21.1.172", "rawVersion": "21.1.172", "recommended": false, "type": "NeoForge"},
            "maximumMemory": 8192,
            "javaArguments": "-XX:+UseZGC  -XX:+ZGenerational",
            "mods": []
        }
    }"#;

    #[test]
    fn reads_atlauncher_instance() {
        let setup = setup(NEOFORGE.as_bytes()).unwrap();
        assert_eq!(
            setup,
            Setup {
                name: "Mein Pack".into(),
                minecraft_version: "1.21.1".into(),
                loader: ModLoader::NeoForge,
                loader_version: Some("21.1.172".into()),
                memory_mb: Some(8192),
                jvm_args: vec!["-XX:+UseZGC".into(), "-XX:+ZGenerational".into()],
            }
        );
    }

    #[test]
    fn vanilla_instance_has_no_loader_version() {
        let vanilla = setup(br#"{"id": "1.21.4", "launcher": {"name": "Pur", "vanillaInstance": true}}"#).unwrap();
        assert_eq!((vanilla.loader, vanilla.memory_mb, vanilla.jvm_args.len()), (ModLoader::Vanilla, None, 0));
        let legacy = br#"{"id": "1.8.9", "launcher": {"name": "Alt", "loaderVersion": {"version": "0.14", "type": "LegacyFabric"}}}"#;
        assert!(setup(legacy).is_err());
    }
}
