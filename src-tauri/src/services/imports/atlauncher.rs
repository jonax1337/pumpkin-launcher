//! ATLauncher: `instance.json` im Instanzordner, der zugleich Spielordner ist. `id` ist die Minecraft-Version,
//! der Rest steht unter `launcher`.
use std::path::Path;

use serde::Deserialize;

use super::{foreign_commands, from_json, loader_named, read_icon, read_marker, split_args, Found, Setup};
use crate::{error::AppResult, models::ModLoader};

#[derive(Deserialize)]
struct Manifest {
    id: String,
    launcher: LauncherSection,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct LauncherSection {
    name: String,
    /// Fehlt bei Vanilla.
    #[serde(default)]
    loader_version: Option<LoaderVersion>,
    /// MiB; ohne gilt die Einstellung von ATLauncher.
    #[serde(default)]
    maximum_memory: Option<u32>,
    #[serde(default)]
    java_arguments: Option<String>,
    #[serde(default)]
    java_path: Option<String>,
    #[serde(default)]
    pre_launch_command: Option<String>,
    #[serde(default)]
    post_exit_command: Option<String>,
    #[serde(default)]
    wrapper_command: Option<String>,
}

#[derive(Deserialize)]
struct LoaderVersion {
    version: String,
    r#type: String,
}

/// Kennungsdatei der Instanz.
pub(super) const MANIFEST: &str = "instance.json";

/// Das eigene Bild der Instanz im Instanzordner.
const ICON: &str = "instance.png";

pub fn read(dir: &Path) -> AppResult<Option<Found>> {
    let Some(data) = read_marker(&dir.join(MANIFEST))? else { return Ok(None) };
    let setup = Setup { icon: read_icon(&dir.join(ICON)), ..setup(&data)? };
    Ok(Some(Found { game_dir: dir.to_owned(), setup }))
}

fn setup(data: &[u8]) -> AppResult<Setup> {
    let Manifest { id, launcher } = from_json(data)?;
    let (loader, loader_version) = match launcher.loader_version {
        None => (ModLoader::Vanilla, None),
        Some(l) => (loader_named(&l.r#type)?, Some(l.version)),
    };
    Ok(Setup {
        memory_mb: launcher.maximum_memory,
        jvm_args: launcher.java_arguments.as_deref().map(split_args).unwrap_or_default(),
        java_path: launcher.java_path.filter(|path| !path.is_empty()),
        not_adopted: foreign_commands(
            launcher.pre_launch_command.as_deref(),
            launcher.post_exit_command.as_deref(),
            launcher.wrapper_command.as_deref(),
        ),
        ..Setup::new(launcher.name, id, loader, loader_version)
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::services::imports::NotAdopted;

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
            "javaPath": "C:/Java/bin/javaw.exe",
            "preLaunchCommand": "backup.cmd",
            "wrapperCommand": "",
            "mods": []
        }
    }"#;

    #[test]
    fn reads_atlauncher_instance() {
        let setup = setup(NEOFORGE.as_bytes()).unwrap();
        assert_eq!(
            setup,
            Setup {
                memory_mb: Some(8192),
                jvm_args: vec!["-XX:+UseZGC".into(), "-XX:+ZGenerational".into()],
                java_path: Some("C:/Java/bin/javaw.exe".into()),
                not_adopted: vec![NotAdopted::PreLaunchCommand],
                ..Setup::new("Mein Pack".into(), "1.21.1".into(), ModLoader::NeoForge, Some("21.1.172".into()))
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
