//! Welche Mod-IDs die JARs im Ordner `mods` einer Instanz tragen. Der Launcher fragt das vor jedem Start (und für die
//! Statuszeile der Instanzseite), ob schon eine `pumpkin_bridge` darin liegt (docs/bridge/README.md, "Support selection"); darum merkt sich der
//! [`ModIdScanner`] das Ergebnis je Datei, solange Größe und Änderungszeit gleich bleiben.
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::SystemTime;

use super::jar_meta::{read_jar, JarInfo};
use crate::services::lock;

const JAR_EXTENSION: &str = "jar";

#[derive(Default)]
pub struct ModIdScanner {
    cache: Mutex<HashMap<PathBuf, Scanned>>,
}

struct Scanned {
    size: u64,
    modified: Option<SystemTime>,
    ids: Vec<String>,
}

impl ModIdScanner {
    /// Alle Mod-IDs der JARs in `mods_dir`: die eigenen IDs, deren Aliase (`provides`) und die der eingebetteten JARs.
    /// Ein fehlender Ordner hat keine; eine JAR, die sich nicht lesen lässt, wird übergangen.
    pub fn ids_in(&self, mods_dir: &Path) -> Vec<String> {
        let Ok(entries) = fs::read_dir(mods_dir) else { return Vec::new() };
        let jars = entries.filter_map(Result::ok).map(|entry| entry.path()).filter(|path| is_jar(path));
        let mut ids: Vec<String> = jars.flat_map(|jar| self.ids_of(&jar)).collect();
        ids.sort();
        ids.dedup();
        ids
    }

    fn ids_of(&self, jar: &Path) -> Vec<String> {
        let Ok(meta) = fs::metadata(jar) else { return Vec::new() };
        let (size, modified) = (meta.len(), meta.modified().ok());
        if let Some(known) = lock(&self.cache).get(jar).filter(|known| known.size == size && known.modified == modified) {
            return known.ids.clone();
        }
        let ids = match read_jar(jar) {
            Ok(info) => declared_ids(&info),
            Err(error) => {
                tracing::debug!(jar = %jar.display(), %error, "Mod-IDs einer JAR nicht lesbar, sie wird übergangen");
                Vec::new()
            }
        };
        lock(&self.cache).insert(jar.to_owned(), Scanned { size, modified, ids: ids.clone() });
        ids
    }
}

fn is_jar(path: &Path) -> bool {
    path.extension().is_some_and(|extension| extension.eq_ignore_ascii_case(JAR_EXTENSION))
}

fn declared_ids(info: &JarInfo) -> Vec<String> {
    info.declared.iter().flat_map(|declared| declared.ids.iter()).chain(&info.nested_ids).cloned().collect()
}

#[cfg(test)]
mod tests {
    use std::io::{Cursor, Write};

    use super::*;

    fn jar(entries: &[(&str, &str)]) -> Vec<u8> {
        let mut writer = zip::ZipWriter::new(Cursor::new(Vec::new()));
        for (name, data) in entries {
            writer.start_file(*name, zip::write::SimpleFileOptions::default()).unwrap();
            writer.write_all(data.as_bytes()).unwrap();
        }
        writer.finish().unwrap().into_inner()
    }

    fn fabric_jar(id: &str, provides: &[&str]) -> Vec<u8> {
        let provides = provides.iter().map(|alias| format!("\"{alias}\"")).collect::<Vec<_>>().join(",");
        jar(&[("fabric.mod.json", &format!(r#"{{"id":"{id}","provides":[{provides}]}}"#))])
    }

    fn mods_dir() -> PathBuf {
        let dir = std::env::temp_dir().join(format!("launcher-mod-ids-{}", crate::models::new_id()));
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn it_lists_the_ids_and_aliases_of_every_enabled_jar() {
        let dir = mods_dir();
        fs::write(dir.join("sodium.jar"), fabric_jar("sodium", &["sodium-extra"])).unwrap();
        fs::write(dir.join("LITHIUM.JAR"), fabric_jar("lithium", &[])).unwrap();
        fs::write(dir.join("notes.txt"), "kein JAR").unwrap();
        fs::write(dir.join("pumpkin_bridge.jar.disabled"), fabric_jar("pumpkin_bridge", &[])).unwrap();

        let ids = ModIdScanner::default().ids_in(&dir);

        assert_eq!(ids, ["lithium", "sodium", "sodium-extra"]);
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn a_jar_with_the_id_of_the_friends_mod_is_found_under_any_file_name() {
        let dir = mods_dir();
        fs::write(dir.join("umbenannt.jar"), fabric_jar("pumpkin_bridge", &[])).unwrap();

        assert_eq!(ModIdScanner::default().ids_in(&dir), ["pumpkin_bridge"]);
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn a_missing_folder_and_unreadable_jars_have_no_ids() {
        let dir = mods_dir();
        fs::write(dir.join("kaputt.jar"), "kein ZIP").unwrap();

        let scanner = ModIdScanner::default();

        assert!(scanner.ids_in(&dir).is_empty());
        assert!(scanner.ids_in(&dir.join("gibt-es-nicht")).is_empty());
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn a_changed_jar_is_read_again_and_an_unchanged_one_comes_from_memory() {
        let dir = mods_dir();
        let scanner = ModIdScanner::default();
        fs::write(dir.join("a.jar"), fabric_jar("first", &[])).unwrap();
        assert_eq!(scanner.ids_in(&dir), ["first"]);

        fs::write(dir.join("a.jar"), fabric_jar("second-id", &[])).unwrap();
        assert_eq!(scanner.ids_in(&dir), ["second-id"]);

        fs::remove_file(dir.join("a.jar")).unwrap();
        assert!(scanner.ids_in(&dir).is_empty());
        fs::remove_dir_all(dir).unwrap();
    }
}
