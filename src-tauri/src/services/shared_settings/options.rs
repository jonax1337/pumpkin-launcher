//! Die gemeinsamen Spieloptionen samt Tastenbelegung (`options.txt`). Geteilt wird jede Zeile außer denen, die zur
//! Instanz gehören (`OWN_KEYS`); abgeglichen wird Zeile für Zeile. Eine ältere Version ignoriert Zeilen, die sie nicht
//! kennt, und lässt sie beim Speichern weg: weil nur Geändertes zurückfließt, gehen sie der gemeinsamen Kopie nicht
//! verloren.
use std::{collections::HashMap, fs};

use super::{read_base, remove_base, write_base};
use crate::{
    error::AppResult,
    models::Instance,
    services::{
        options_txt::{entries, line_value, read_text, set_line, write_text},
        Dirs,
    },
};

const OPTIONS: &str = "options.txt";
/// Kopie der eigenen Optionen, bevor die Instanz zum ersten Mal die gemeinsamen bekam.
const BACKUP: &str = "options.txt.before-sharing";
/// Gemeinsame Kopie ab 1.13: Tasten stehen als Namen in der Datei (`key.keyboard.w`).
const KEY_NAMES_FILE: &str = "options.txt";
/// Gemeinsame Kopie davor: Tasten stehen als Zahlencodes in der Datei (`17`).
const KEY_CODES_FILE: &str = "options-legacy.txt";
const SEPARATOR: char = ':';
/// Datenversion der Datei; das Spiel rechnet ältere beim Laden um.
const VERSION: &str = "version";
/// Datenversion von Minecraft 1.13; ab ihr stehen Tasten sicher als Namen in der Datei.
const RELEASE_1_13_DATA_VERSION: u32 = 1519;
/// Was zur Instanz gehört statt zum Spieler: Datenversion, gewählte Ressourcenpakete, letzter Server, Tutorial.
const OWN_KEYS: [&str; 5] = [VERSION, "resourcePacks", "incompatibleResourcePacks", "lastServer", "tutorialStep"];

pub(super) fn hand_out(dirs: &Dirs, instance: &Instance) -> AppResult<()> {
    let name = shared_file(&instance.minecraft_version);
    let shared = read_text(&dirs.shared_settings().join(name))?;
    let path = dirs.game_dir(&instance.id).join(OPTIONS);
    let own = read_text(&path)?;
    let mut options = shareable(&shared).fold(own.clone(), |text, (key, value)| set_line(&text, key, SEPARATOR, Some(value)));
    if let Some(version) = line_value(&shared, VERSION, SEPARATOR).filter(|_| needs_shared_version(name, &own)) {
        options = set_line(&options, VERSION, SEPARATOR, Some(version));
    }
    if options != own {
        write_text(&path, &options)?;
    }
    write_base(dirs, &instance.id, name, shared.as_bytes())
}

pub(super) fn take_back(dirs: &Dirs, instance_id: &str) -> AppResult<()> {
    for name in [KEY_NAMES_FILE, KEY_CODES_FILE] {
        let Some(base) = read_base(dirs, instance_id, name)? else { continue };
        let own = read_text(&dirs.game_dir(instance_id).join(OPTIONS))?;
        let path = dirs.shared_settings().join(name);
        let shared = read_text(&path)?;
        let merged = merge(&shared, &String::from_utf8_lossy(&base), &own);
        if merged != shared {
            write_text(&path, &merged)?;
        }
        remove_base(dirs, instance_id, name)?;
    }
    Ok(())
}

/// Gibt es noch keine gemeinsamen Optionen, werden die der Instanz dazu. Sonst bekommt sie beim nächsten Start die
/// gemeinsamen; ihre eigenen bleiben daneben als `BACKUP`, die erste Sicherung wird nie überschrieben.
pub(super) fn join(dirs: &Dirs, instance: &Instance) -> AppResult<()> {
    let name = shared_file(&instance.minecraft_version);
    let path = dirs.shared_settings().join(name);
    let own_path = dirs.game_dir(&instance.id).join(OPTIONS);
    let own = read_text(&own_path)?;
    let shared = read_text(&path)?;
    if shared.is_empty() {
        // Nach einem Versionswechsel ohne Start stehen womöglich noch Zahlencodes darin: dann gründet erst die Sitzung.
        return if own.is_empty() || predates_key_names(name, &own) { Ok(()) } else { write_text(&path, &merge("", "", &own)) };
    }
    let backup = dirs.game_dir(&instance.id).join(BACKUP);
    if !own.is_empty() && !backup.exists() {
        fs::copy(&own_path, &backup)?;
    }
    Ok(())
}

/// Was die Sitzung geändert hat (anders als in `given`, dem Stand vom Start), kommt in die gemeinsame Kopie; alles
/// andere bleibt dort, wie es ist. Die Datenversion wird die neuere der beiden.
fn merge(shared: &str, given: &str, own: &str) -> String {
    let given: HashMap<&str, &str> = entries(given, SEPARATOR).collect();
    let changed = shareable(own).filter(|(key, value)| given.get(key) != Some(value));
    let merged = changed.fold(shared.to_owned(), |text, (key, value)| set_line(&text, key, SEPARATOR, Some(value)));
    match (data_version(shared), data_version(own)) {
        (old, Some(newer)) if old.is_none_or(|old| newer > old) => set_line(&merged, VERSION, SEPARATOR, Some(&newer.to_string())),
        _ => merged,
    }
}

/// Hält das Spiel die Datei für eine von vor 1.13 (ohne Datenversion oder mit älterer), liest es die Tasten als
/// Zahlencodes und rechnet sie um: wer Tastennamen aus der Kopie ab 1.13 bekommt, braucht deren Datenversion.
fn needs_shared_version(shared_file: &str, own: &str) -> bool {
    data_version(own).is_none() || predates_key_names(shared_file, own)
}

/// Gehört die Instanz zur Kopie mit Tastennamen, während ihre Datei noch eine Datenversion von vor 1.13 trägt (etwa
/// nach einem Versionswechsel, bevor das Spiel sie umgerechnet hat)?
fn predates_key_names(shared_file: &str, own: &str) -> bool {
    shared_file == KEY_NAMES_FILE && data_version(own).is_none_or(|version| version < RELEASE_1_13_DATA_VERSION)
}

fn data_version(text: &str) -> Option<u32> {
    line_value(text, VERSION, SEPARATOR).and_then(|version| version.trim().parse().ok())
}

fn shareable(text: &str) -> impl Iterator<Item = (&str, &str)> {
    entries(text, SEPARATOR).filter(|(key, _)| !OWN_KEYS.contains(key))
}

/// Die gemeinsame Kopie für diese Minecraft-Version: bis 1.12 stehen Tasten als Zahlencodes in der Datei, seit 1.13
/// (Snapshot 17w43a) als Namen. Die beiden Formate teilen sich keine Kopie.
fn shared_file(minecraft_version: &str) -> &'static str {
    if uses_key_names(minecraft_version) { KEY_NAMES_FILE } else { KEY_CODES_FILE }
}

fn uses_key_names(version: &str) -> bool {
    const FIRST_SNAPSHOT: (u32, u32) = (17, 43);
    if let Some(week) = snapshot_week(version) {
        return week >= FIRST_SNAPSHOT;
    }
    let mut numbers = version.split(['.', '-', ' ']).map(str::parse::<u32>);
    match (numbers.next(), numbers.next()) {
        (Some(Ok(1)), Some(Ok(minor))) => minor >= 13,
        (Some(Ok(major)), _) => major > 1,
        // Alpha, Beta, Classic und Ähnliches.
        _ => false,
    }
}

/// Jahr und Woche eines Snapshots (`24w14a`).
fn snapshot_week(version: &str) -> Option<(u32, u32)> {
    let (year, rest) = version.split_once('w')?;
    let week = rest.get(..2)?;
    Some((year.parse().ok()?, week.parse().ok()?))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::{new_id, ModLoader, NewInstance};

    fn instance(minecraft_version: &str) -> Instance {
        Instance::from_new(NewInstance {
            name: "Test".into(),
            minecraft_version: minecraft_version.into(),
            loader: ModLoader::Vanilla,
            loader_version: None,
        })
    }

    fn write_options(dirs: &Dirs, instance: &Instance, text: &str) {
        write_text(&dirs.game_dir(&instance.id).join(OPTIONS), text).unwrap();
    }

    fn options_of(dirs: &Dirs, instance: &Instance) -> String {
        read_text(&dirs.game_dir(&instance.id).join(OPTIONS)).unwrap()
    }

    #[test]
    fn key_bindings_change_their_format_with_1_13() {
        for version in ["1.13", "1.13-pre1", "1.21.4", "26.1", "17w43a", "24w14a", "1.20.5-rc1"] {
            assert_eq!(shared_file(version), KEY_NAMES_FILE, "{version}");
        }
        for version in ["1.12.2", "1.8.9", "17w31a", "b1.7.3", "a1.2.6", "rd-132211", "c0.30_01c"] {
            assert_eq!(shared_file(version), KEY_CODES_FILE, "{version}");
        }
    }

    #[test]
    fn only_lines_the_session_changed_flow_back() {
        let shared = "version:3955\nfov:0.5\nkey_key.jump:key.keyboard.space\n";
        let given = "version:3955\nfov:0.0\nkey_key.jump:key.keyboard.space\n";
        // Die Sitzung hat die Taste geändert; „fov“ hat inzwischen eine andere Instanz geändert.
        let own = "version:3955\nfov:0.0\nkey_key.jump:key.keyboard.j\nresourcePacks:[\"vanilla\"]\n";
        assert_eq!(merge(shared, given, own), "version:3955\nfov:0.5\nkey_key.jump:key.keyboard.j\n");
    }

    #[test]
    fn lines_an_older_version_drops_stay_shared_and_the_newer_data_version_wins() {
        let shared = "version:3955\nnarratorHotkey:true\n";
        assert_eq!(merge(shared, shared, "version:3700\n"), shared);
        assert_eq!(merge(shared, shared, "version:4100\n"), "version:4100\nnarratorHotkey:true\n");
    }

    #[test]
    fn the_first_instance_seeds_the_copy_and_the_next_gets_it_with_its_own_lines_kept() {
        let dirs = Dirs::new(std::env::temp_dir().join(new_id()));
        let first = instance("1.21.1");
        write_options(&dirs, &first, "version:3955\nresourcePacks:[\"file/a.zip\"]\nfov:0.5\n");
        join(&dirs, &first).unwrap();
        assert_eq!(read_text(&dirs.shared_settings().join(KEY_NAMES_FILE)).unwrap(), "fov:0.5\nversion:3955\n");

        let second = instance("1.20.1");
        write_options(&dirs, &second, "version:3465\r\nresourcePacks:[\"file/b.zip\"]\r\nfov:0.0\r\n");
        join(&dirs, &second).unwrap();
        assert!(dirs.game_dir(&second.id).join(BACKUP).is_file());
        hand_out(&dirs, &second).unwrap();
        assert_eq!(options_of(&dirs, &second), "version:3465\r\nresourcePacks:[\"file/b.zip\"]\r\nfov:0.5\r\n");

        write_options(&dirs, &second, "version:3465\r\nresourcePacks:[\"file/b.zip\"]\r\nfov:0.75\r\n");
        take_back(&dirs, &second.id).unwrap();
        assert_eq!(read_text(&dirs.shared_settings().join(KEY_NAMES_FILE)).unwrap(), "fov:0.75\nversion:3955\n");
        fs::remove_dir_all(&dirs.root).unwrap();
    }

    #[test]
    fn a_fresh_instance_gets_the_data_version_with_the_options() {
        let dirs = Dirs::new(std::env::temp_dir().join(new_id()));
        write_text(&dirs.shared_settings().join(KEY_NAMES_FILE), "version:3955\nkey_key.jump:key.keyboard.j\n").unwrap();
        let fresh = instance("1.21.1");
        hand_out(&dirs, &fresh).unwrap();
        assert_eq!(options_of(&dirs, &fresh), "key_key.jump:key.keyboard.j\nversion:3955\n");
        fs::remove_dir_all(&dirs.root).unwrap();
    }

    #[test]
    fn an_instance_moved_past_1_13_gets_the_data_version_of_the_key_names() {
        let dirs = Dirs::new(std::env::temp_dir().join(new_id()));
        write_text(&dirs.shared_settings().join(KEY_NAMES_FILE), "version:3955\nkey_key.jump:key.keyboard.j\n").unwrap();
        let upgraded = instance("1.20.1");
        write_options(&dirs, &upgraded, "version:1343\nkey_key.jump:57\n");
        hand_out(&dirs, &upgraded).unwrap();
        assert_eq!(options_of(&dirs, &upgraded), "version:3955\nkey_key.jump:key.keyboard.j\n");

        let legacy = instance("1.12.2");
        write_text(&dirs.shared_settings().join(KEY_CODES_FILE), "version:1343\nkey_key.jump:57\n").unwrap();
        write_options(&dirs, &legacy, "version:1139\nkey_key.jump:39\n");
        hand_out(&dirs, &legacy).unwrap();
        assert_eq!(options_of(&dirs, &legacy), "version:1139\nkey_key.jump:57\n", "vor 1.13 bleibt die eigene Datenversion");
        fs::remove_dir_all(&dirs.root).unwrap();
    }

    #[test]
    fn an_instance_moved_past_1_13_but_never_started_does_not_seed_key_codes() {
        let dirs = Dirs::new(std::env::temp_dir().join(new_id()));
        let moved = instance("1.21.1");
        write_options(&dirs, &moved, "version:1343
key_key.jump:57
");
        join(&dirs, &moved).unwrap();
        assert!(!dirs.shared_settings().join(KEY_NAMES_FILE).exists());
        fs::remove_dir_all(&dirs.root).unwrap();
    }

    #[test]
    fn an_instance_without_options_seeds_the_copy_after_its_first_session() {
        let dirs = Dirs::new(std::env::temp_dir().join(new_id()));
        let fresh = instance("1.21.1");
        join(&dirs, &fresh).unwrap();
        hand_out(&dirs, &fresh).unwrap();
        assert!(!dirs.game_dir(&fresh.id).join(OPTIONS).exists(), "ohne gemeinsame Optionen bleibt die Instanz unberührt");
        write_options(&dirs, &fresh, "version:3955\nfov:0.5\n");
        take_back(&dirs, &fresh.id).unwrap();
        assert_eq!(read_text(&dirs.shared_settings().join(KEY_NAMES_FILE)).unwrap(), "fov:0.5\nversion:3955\n");
        fs::remove_dir_all(&dirs.root).unwrap();
    }
}
