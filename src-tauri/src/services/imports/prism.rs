//! Prism Launcher und MultiMC: `instance.cfg` (INI) und `mmc-pack.json` (Komponenten) im Instanzordner,
//! das Spiel in `minecraft` bzw. `.minecraft` darunter.
use std::{
    collections::HashMap,
    path::{Path, PathBuf},
};

use serde::Deserialize;

use super::{folder_name, from_json, read_marker, split_args, Setup};
use crate::{error::AppResult, models::ModLoader, services::modrinth::invalid};

#[derive(Deserialize)]
struct Pack {
    components: Vec<Component>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Component {
    uid: String,
    #[serde(default)]
    version: Option<String>,
    #[serde(default)]
    cached_version: Option<String>,
}

/// Loader-Komponenten nach ihrer UID.
const LOADERS: [(&str, ModLoader); 4] = [
    ("net.fabricmc.fabric-loader", ModLoader::Fabric),
    ("org.quiltmc.quilt-loader", ModLoader::Quilt),
    ("net.minecraftforge", ModLoader::Forge),
    ("net.neoforged", ModLoader::NeoForge),
];

pub fn read(dir: &Path) -> AppResult<Option<Setup>> {
    let Some(cfg) = read_marker(&dir.join("instance.cfg"))? else { return Ok(None) };
    let pack = read_marker(&dir.join("mmc-pack.json"))?.ok_or_else(|| invalid("mmc-pack.json fehlt"))?;
    setup(&String::from_utf8_lossy(&cfg), &pack, &folder_name(dir)).map(Some)
}

/// Spielordner wie bei Prism: `.minecraft`, wenn es nur diesen gibt, sonst `minecraft`.
pub fn game_dir(dir: &Path) -> PathBuf {
    let dot = dir.join(".minecraft");
    if dot.is_dir() && !dir.join("minecraft").exists() {
        dot
    } else {
        dir.join("minecraft")
    }
}

/// RAM und JVM-Argumente gelten nur, wenn die Instanz die globalen Einstellungen überschreibt.
fn setup(cfg: &str, pack: &[u8], folder: &str) -> AppResult<Setup> {
    let cfg = parse_cfg(cfg);
    let pack: Pack = from_json(pack)?;
    let version = |uid: &str| {
        let component = pack.components.iter().find(|c| c.uid == uid)?;
        component.version.clone().or_else(|| component.cached_version.clone())
    };
    let minecraft_version = version("net.minecraft").ok_or_else(|| invalid("Instanz ohne Minecraft-Version"))?;
    let loader = LOADERS.iter().find(|(uid, _)| pack.components.iter().any(|c| c.uid == *uid));
    let overrides = |key: &str| cfg.get(key).is_some_and(|v| v == "true");
    Ok(Setup {
        name: cfg.get("name").cloned().unwrap_or_else(|| folder.into()),
        minecraft_version,
        loader: loader.map_or(ModLoader::Vanilla, |(_, l)| *l),
        loader_version: loader.and_then(|(uid, _)| version(uid)),
        memory_mb: cfg.get("MaxMemAlloc").filter(|_| overrides("OverrideMemory")).and_then(|m| m.parse().ok()),
        jvm_args: cfg.get("JvmArgs").filter(|_| overrides("OverrideJavaArgs")).map(|a| split_args(a)).unwrap_or_default(),
    })
}

/// Schlüssel und Werte aus `instance.cfg`. Neuere Versionen schreiben per QSettings unter `[General]` und setzen
/// Werte mit `=`, `;` oder `,` in Anführungszeichen; ältere schreiben ohne Abschnitt. Beide escapen mit `\`.
fn parse_cfg(text: &str) -> HashMap<String, String> {
    text.lines()
        .filter_map(|line| line.split_once('='))
        .map(|(key, value)| {
            let value = value.trim();
            let value = value.strip_prefix('"').and_then(|v| v.strip_suffix('"')).unwrap_or(value);
            (key.trim().to_owned(), unescape(value))
        })
        .collect()
}

fn unescape(value: &str) -> String {
    let mut out = String::with_capacity(value.len());
    let mut chars = value.chars();
    while let Some(c) = chars.next() {
        out.push(if c == '\\' { chars.next().unwrap_or(c) } else { c });
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    /// So schreibt Prism Launcher 9 eine Instanz mit eigenem RAM und eigenen JVM-Argumenten.
    const CFG: &str = r#"[General]
ConfigVersion=1.3
InstanceType=OneSix
JvmArgs="-XX:+UseG1GC -Dfile.encoding=UTF-8"
MaxMemAlloc=6144
MinMemAlloc=512
OverrideJavaArgs=true
OverrideMemory=true
iconKey=default
name=Create \"Astral\"
"#;

    const PACK: &str = r#"{
    "components": [
        {"cachedName": "LWJGL 3", "cachedVersion": "3.3.3", "dependencyOnly": true, "uid": "org.lwjgl3", "version": "3.3.3"},
        {"cachedName": "Minecraft", "cachedVersion": "1.20.1", "important": true, "uid": "net.minecraft", "version": "1.20.1"},
        {"cachedName": "Forge", "cachedVersion": "47.2.0", "uid": "net.minecraftforge", "version": "47.2.0"}
    ],
    "formatVersion": 1
}"#;

    #[test]
    fn reads_prism_instance_with_overrides() {
        let setup = setup(CFG, PACK.as_bytes(), "ordner").unwrap();
        assert_eq!(
            setup,
            Setup {
                name: "Create \"Astral\"".into(),
                minecraft_version: "1.20.1".into(),
                loader: ModLoader::Forge,
                loader_version: Some("47.2.0".into()),
                memory_mb: Some(6144),
                jvm_args: vec!["-XX:+UseG1GC".into(), "-Dfile.encoding=UTF-8".into()],
            }
        );
    }

    #[test]
    fn old_multimc_cfg_without_overrides_keeps_launcher_defaults() {
        let cfg = "InstanceType=OneSix\nMaxMemAlloc=4096\nOverrideMemory=false\nJvmArgs=-Xss2M\n";
        let pack = r#"{"components": [{"uid": "net.minecraft", "cachedVersion": "1.21.1"}, {"uid": "org.quiltmc.quilt-loader"}]}"#;
        let setup = setup(cfg, pack.as_bytes(), "Alte Welt").unwrap();
        assert_eq!((setup.name.as_str(), setup.minecraft_version.as_str()), ("Alte Welt", "1.21.1"));
        assert_eq!((setup.loader, setup.loader_version, setup.memory_mb, setup.jvm_args.len()), (ModLoader::Quilt, None, None, 0));
        assert!(super::setup(cfg, br#"{"components": []}"#, "x").is_err());
    }

    #[test]
    fn game_dir_prefers_minecraft_unless_only_dot_minecraft_exists() {
        let dir = std::env::temp_dir().join(crate::models::new_id());
        std::fs::create_dir_all(dir.join(".minecraft")).unwrap();
        assert_eq!(game_dir(&dir), dir.join(".minecraft"));
        std::fs::create_dir_all(dir.join("minecraft")).unwrap();
        assert_eq!(game_dir(&dir), dir.join("minecraft"));
        std::fs::remove_dir_all(dir).unwrap();
    }
}
