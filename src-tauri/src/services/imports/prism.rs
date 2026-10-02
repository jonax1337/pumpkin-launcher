//! Prism Launcher und MultiMC: `instance.cfg` (INI) und `mmc-pack.json` (Komponenten) im Instanzordner,
//! das Spiel in `minecraft` bzw. `.minecraft` darunter.
use std::{
    collections::HashMap,
    path::{Path, PathBuf},
};

use serde::Deserialize;

use super::{folder_name, foreign_commands, from_json, read_icon, read_marker, skip_unreadable, split_args, window_size, Found, Setup};
use crate::{coded, error::{AppError, AppResult}, models::{GameWindow, ModLoader}, services::require_plain_name};

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

/// Gruppen der Instanzen, `instgroups.json` im Instanzordner des Launchers.
#[derive(Deserialize)]
struct Groups {
    #[serde(default)]
    groups: HashMap<String, Group>,
}

#[derive(Deserialize)]
struct Group {
    #[serde(default)]
    instances: Vec<String>,
}

/// Bilder, die Prism als eigene Icons in `icons` neben dem Instanzordner ablegt.
const ICON_EXTENSIONS: [&str; 5] = ["png", "jpg", "jpeg", "webp", "gif"];

pub fn read(dir: &Path) -> AppResult<Option<Found>> {
    let Some(cfg) = read_marker(&dir.join("instance.cfg"))? else { return Ok(None) };
    let pack = read_marker(&dir.join("mmc-pack.json"))?.ok_or_else(|| AppError::invalid(coded!("errors.app.import.packFileMissing")))?;
    let cfg = parse_cfg(&String::from_utf8_lossy(&cfg));
    let folder = folder_name(dir);
    let setup = Setup {
        group: skip_unreadable(dir, group(dir, &folder), "Gruppen der Prism-Instanzen nicht lesbar; ohne Gruppe"),
        icon: cfg.get("iconKey").and_then(|key| icon(dir, key)),
        ..setup(&cfg, &pack, &folder)?
    };
    Ok(Some(Found { game_dir: game_dir(dir), setup }))
}

/// Gruppe der Instanz aus `instgroups.json`, die neben den Instanzordnern liegt.
fn group(dir: &Path, folder: &str) -> AppResult<Option<String>> {
    let Some(instances) = dir.parent() else { return Ok(None) };
    let Some(data) = read_marker(&instances.join("instgroups.json"))? else { return Ok(None) };
    let groups: Groups = from_json(&data)?;
    Ok(groups.groups.into_iter().find(|(_, group)| group.instances.iter().any(|id| id == folder)).map(|(name, _)| name))
}

/// Eigenes Icon: Prism legt es als `icons/<iconKey>.<Endung>` neben den Instanzordner. Ein mitgeliefertes Icon
/// (`iconKey` ohne Datei) gibt es nur in Prism selbst.
fn icon(dir: &Path, key: &str) -> Option<String> {
    let icons = dir.parent()?.parent()?.join("icons");
    require_plain_name(key).ok()?;
    ICON_EXTENSIONS.iter().find_map(|extension| read_icon(&icons.join(format!("{key}.{extension}"))))
}

/// Spielordner wie bei Prism: `.minecraft`, wenn es nur diesen gibt, sonst `minecraft`.
fn game_dir(dir: &Path) -> PathBuf {
    let dot = dir.join(".minecraft");
    if dot.is_dir() && !dir.join("minecraft").exists() {
        dot
    } else {
        dir.join("minecraft")
    }
}

/// Pro Instanz wählbare Einstellungen (RAM, JVM-Argumente, Java, Fenster, Befehle) gelten nur, wenn die Instanz die
/// globalen Einstellungen überschreibt.
fn setup(cfg: &HashMap<String, String>, pack: &[u8], folder: &str) -> AppResult<Setup> {
    let pack: Pack = from_json(pack)?;
    let version = |uid: &str| {
        let component = pack.components.iter().find(|c| c.uid == uid)?;
        component.version.clone().or_else(|| component.cached_version.clone())
    };
    let minecraft_version = version("net.minecraft").ok_or_else(|| AppError::invalid(coded!("errors.app.import.noMinecraftVersion")))?;
    let loader = LOADERS.iter().find(|(uid, _)| pack.components.iter().any(|c| c.uid == *uid));
    // Der Wert von `key`, wenn die Instanz die Einstellung `switch` überschreibt.
    let overridden = |switch: &str, key: &str| {
        let on = cfg.get(switch).is_some_and(|v| v == "true");
        cfg.get(key).map(String::as_str).filter(|_| on)
    };
    let number = |switch: &str, key: &str| overridden(switch, key).and_then(|value| value.parse::<u32>().ok());
    let max_memory = number("OverrideMemory", "MaxMemAlloc");
    let min_memory = number("OverrideMemory", "MinMemAlloc").filter(|min| max_memory.is_none_or(|max| *min <= max));
    let maximized = overridden("OverrideWindow", "LaunchMaximized") == Some("true");
    Ok(Setup {
        memory_mb: max_memory,
        min_memory_mb: min_memory,
        jvm_args: overridden("OverrideJavaArgs", "JvmArgs").map(split_args).unwrap_or_default(),
        java_path: overridden("OverrideJavaLocation", "JavaPath").filter(|path| !path.is_empty()).map(String::from),
        window: if maximized { GameWindow::Default } else { window_size(number("OverrideWindow", "MinecraftWinWidth"), number("OverrideWindow", "MinecraftWinHeight")) },
        notes: cfg.get("notes").cloned().unwrap_or_default(),
        not_adopted: foreign_commands(
            overridden("OverrideCommands", "PreLaunchCommand"),
            overridden("OverrideCommands", "PostExitCommand"),
            overridden("OverrideCommands", "WrapperCommand"),
        ),
        ..Setup::new(
            cfg.get("name").cloned().unwrap_or_else(|| folder.into()),
            minecraft_version,
            loader.map_or(ModLoader::Vanilla, |(_, l)| *l),
            loader.and_then(|(uid, _)| version(uid)),
        )
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
        if c != '\\' {
            out.push(c);
            continue;
        }
        out.push(match chars.next() {
            Some('n') => '\n',
            Some('t') => '\t',
            Some(escaped) => escaped,
            None => c,
        });
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::services::{data_url, imports::NotAdopted, write_files};

    /// So schreibt Prism Launcher 9 eine Instanz mit eigenem RAM, eigenen JVM-Argumenten, Notizen und Befehlen.
    const CFG: &str = r#"[General]
ConfigVersion=1.3
InstanceType=OneSix
JavaPath=C:/Java/bin/javaw.exe
JvmArgs="-XX:+UseG1GC -Dfile.encoding=UTF-8"
MaxMemAlloc=6144
MinMemAlloc=512
MinecraftWinHeight=720
MinecraftWinWidth=1280
OverrideCommands=true
OverrideJavaArgs=true
OverrideJavaLocation=true
OverrideMemory=true
OverrideWindow=true
PostExitCommand=backup.cmd
PreLaunchCommand=
WrapperCommand=gamemoderun
iconKey=default
name=Create \"Astral\"
notes=Erste Zeile\nZweite Zeile
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
        let setup = setup(&parse_cfg(CFG), PACK.as_bytes(), "ordner").unwrap();
        assert_eq!(
            setup,
            Setup {
                memory_mb: Some(6144),
                min_memory_mb: Some(512),
                jvm_args: vec!["-XX:+UseG1GC".into(), "-Dfile.encoding=UTF-8".into()],
                java_path: Some("C:/Java/bin/javaw.exe".into()),
                window: GameWindow::Size { width: 1280, height: 720 },
                notes: "Erste Zeile\nZweite Zeile".into(),
                not_adopted: vec![NotAdopted::PostExitCommand, NotAdopted::WrapperCommand],
                ..Setup::new("Create \"Astral\"".into(), "1.20.1".into(), ModLoader::Forge, Some("47.2.0".into()))
            }
        );
    }

    #[test]
    fn old_multimc_cfg_without_overrides_keeps_launcher_defaults() {
        let cfg = "InstanceType=OneSix\nMaxMemAlloc=4096\nOverrideMemory=false\nJvmArgs=-Xss2M\nJavaPath=/usr/bin/java\nMinecraftWinWidth=800\nMinecraftWinHeight=600\nWrapperCommand=x\nnotes=Hallo\n";
        let pack = r#"{"components": [{"uid": "net.minecraft", "cachedVersion": "1.21.1"}, {"uid": "org.quiltmc.quilt-loader"}]}"#;
        let setup = setup(&parse_cfg(cfg), pack.as_bytes(), "Alte Welt").unwrap();
        assert_eq!((setup.name.as_str(), setup.minecraft_version.as_str()), ("Alte Welt", "1.21.1"));
        assert_eq!((setup.loader, setup.loader_version.as_deref(), setup.memory_mb, setup.jvm_args.len()), (ModLoader::Quilt, None, None, 0));
        assert_eq!((setup.java_path, setup.window, setup.not_adopted, setup.notes.as_str()), (None, GameWindow::Default, vec![], "Hallo"));
        assert!(super::setup(&parse_cfg(cfg), br#"{"components": []}"#, "x").is_err());
    }

    #[test]
    fn maximized_windows_and_a_minimum_above_the_maximum_are_not_taken_over() {
        let cfg = "OverrideWindow=true\nLaunchMaximized=true\nMinecraftWinWidth=800\nMinecraftWinHeight=600\nOverrideMemory=true\nMaxMemAlloc=2048\nMinMemAlloc=4096\n";
        let setup = setup(&parse_cfg(cfg), PACK.as_bytes(), "x").unwrap();
        assert_eq!((setup.window, setup.memory_mb, setup.min_memory_mb), (GameWindow::Default, Some(2048), None));
    }

    #[test]
    fn read_adds_group_and_custom_icon_from_the_launcher_folders() {
        let root = std::env::temp_dir().join(crate::models::new_id());
        let png = [&[0x89, b'P', b'N', b'G'][..], b"rest"].concat();
        write_files(
            &root,
            &[
                ("instances/Welt/instance.cfg", "name=Welt\niconKey=eigenes\n".as_bytes()),
                ("instances/Welt/mmc-pack.json", PACK.as_bytes()),
                ("instances/instgroups.json", br#"{"formatVersion": "1", "groups": {"Freunde": {"hidden": false, "instances": ["Welt"]}}}"#.as_slice()),
                ("icons/eigenes.png", png.as_slice()),
            ],
        );

        let found = read(&root.join("instances/Welt")).unwrap().unwrap();

        assert_eq!(found.setup.group.as_deref(), Some("Freunde"));
        assert_eq!(found.setup.icon, Some(data_url("image/png", &png)));
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn icon_keys_cannot_leave_the_icons_folder_and_only_images_count() {
        let root = std::env::temp_dir().join(crate::models::new_id());
        write_files(&root, &[("instances/Welt/x", b"".as_slice()), ("icons/text.png", b"kein Bild".as_slice()), ("geheim.png", b"\x89PNG".as_slice())]);
        let dir = root.join("instances/Welt");

        assert_eq!(icon(&dir, "../geheim"), None);
        assert_eq!(icon(&dir, "text"), None);
        assert_eq!(icon(&dir, "default"), None);
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn unescape_turns_line_breaks_back_into_text() {
        assert_eq!(unescape(r"a\nb\\n\tc\"), "a\nb\\n\tc\\");
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
