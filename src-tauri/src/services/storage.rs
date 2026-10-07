//! Speicherübersicht des Datenordners und das Aufräumen des Mod-Caches. Gelöscht wird nur, was keine Instanz mehr
//! braucht; alles andere (Instanzen, Libraries, Assets, Java) fasst dieses Modul nicht an.
use std::collections::HashSet;
use std::fs;
use std::path::{Path, PathBuf};

use serde::Serialize;

use crate::error::AppResult;
use crate::models::Instance;
use crate::services::download::is_sha1;
use crate::services::{entries, none_if_missing, system, Dirs};

/// Ordner, die sich alle Instanzen teilen: Libraries, Assets, Minecraft-Versionen und Java-Runtimes.
const SHARED_FOLDERS: [&str; 4] = ["libraries", "assets", "versions", "runtime"];

/// Platz einer Instanz auf der Platte (Spielordner, Sicherungen, Protokolle).
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InstanceUsage {
    pub id: String,
    pub bytes: u64,
}

/// Wo der Platz im Datenordner bleibt. Mods liegen als Hardlink im Mod-Cache und in der Instanz: dort zählen sie
/// in beiden Summen, belegen aber nur einmal Platz.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StorageOverview {
    pub data_dir: String,
    pub free_mb: Option<u64>,
    pub instances: Vec<InstanceUsage>,
    pub mod_cache_bytes: u64,
    /// Teil des Mod-Caches, den keine Instanz mehr braucht und [`clear_unused_cache`] löscht.
    pub unused_cache_bytes: u64,
    pub shared_bytes: u64,
}

/// Größe von `path` samt Inhalt; Links werden nicht verfolgt, Unlesbares zählt nicht.
fn dir_size(path: &Path) -> u64 {
    let Ok(meta) = fs::symlink_metadata(path) else { return 0 };
    if !meta.is_dir() {
        return if meta.is_file() { meta.len() } else { 0 };
    }
    fs::read_dir(path).map_or(0, |children| children.filter_map(Result::ok).map(|child| dir_size(&child.path())).sum())
}

pub fn overview(dirs: &Dirs, instances: &[Instance]) -> AppResult<StorageOverview> {
    let unused_cache_bytes = unused_cache_files(dirs, instances)?.iter().map(|(_, bytes)| bytes).sum();
    Ok(StorageOverview {
        data_dir: dirs.root.to_string_lossy().into_owned(),
        free_mb: system::free_space_mb(&dirs.root).ok(),
        instances: instances.iter().map(|i| InstanceUsage { id: i.id.clone(), bytes: dir_size(&dirs.instance(&i.id)) }).collect(),
        mod_cache_bytes: dir_size(&dirs.mod_cache()),
        unused_cache_bytes,
        shared_bytes: SHARED_FOLDERS.iter().map(|folder| dir_size(&dirs.root.join(folder))).sum(),
    })
}

/// Dateien des Mod-Caches (`<sha1>.jar`), auf die keine Instanz verweist, mit ihrer Größe.
fn unused_cache_files(dirs: &Dirs, instances: &[Instance]) -> AppResult<Vec<(PathBuf, u64)>> {
    let used: HashSet<String> = instances.iter().flat_map(|i| &i.mods).filter_map(|m| m.sha1.as_ref()).map(|h| h.to_ascii_lowercase()).collect();
    let unused = entries(&dirs.mod_cache())?
        .into_iter()
        .filter_map(|entry| {
            let name = entry.file_name().into_string().ok()?;
            let hash = name.strip_suffix(".jar")?;
            let is_cache_entry = is_sha1(hash);
            (is_cache_entry && !used.contains(&hash.to_ascii_lowercase())).then(|| (entry.path(), entry.metadata().map_or(0, |m| m.len())))
        })
        .collect();
    Ok(unused)
}

/// Löscht die ungenutzten Dateien des Mod-Caches und liefert die freigegebenen Bytes. Eine Instanz läuft auch mit
/// geleertem Cache (`mods::recache`), hier fällt aber nur Ungenutztes weg.
pub fn clear_unused_cache(dirs: &Dirs, instances: &[Instance]) -> AppResult<u64> {
    let mut freed = 0;
    for (path, bytes) in unused_cache_files(dirs, instances)? {
        match none_if_missing(fs::remove_file(&path)) {
            Ok(_) => freed += bytes,
            Err(err) => tracing::warn!(path = %path.display(), %err, "Cache-Datei nicht gelöscht"),
        }
    }
    Ok(freed)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::{Mod, ModKind, ModLoader, ModSource, NewInstance};

    const USED: &str = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
    const UNUSED: &str = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";

    fn instance_using(sha1: &str) -> Instance {
        let mut instance = Instance::from_new(NewInstance {
            name: "A".into(),
            minecraft_version: "1.21.1".into(),
            loader: ModLoader::Fabric,
            loader_version: None,
        });
        instance.mods.push(Mod {
            id: "m".into(),
            name: "M".into(),
            version: "1".into(),
            source: ModSource::Local,
            file_name: "m.jar".into(),
            sha1: Some(sha1.to_ascii_uppercase()),
            enabled: false,
            kind: ModKind::Mod,
            required_by: Vec::new(),
            pinned: false,
            pack_managed: false,
        });
        instance
    }

    fn cache_with(dirs: &Dirs, files: &[(&str, usize)]) {
        fs::create_dir_all(dirs.mod_cache()).unwrap();
        for (name, size) in files {
            fs::write(dirs.mod_cache().join(name), vec![0u8; *size]).unwrap();
        }
    }

    #[test]
    fn only_unreferenced_cache_entries_are_cleared() {
        let dirs = Dirs::new(std::env::temp_dir().join(crate::models::new_id()));
        cache_with(&dirs, &[(&format!("{USED}.jar"), 10), (&format!("{UNUSED}.jar"), 7), ("notes.txt", 5), ("kurz.jar", 3)]);
        let instances = [instance_using(USED)];

        let overview = overview(&dirs, &instances).unwrap();
        assert_eq!((overview.mod_cache_bytes, overview.unused_cache_bytes), (25, 7));
        assert_eq!(clear_unused_cache(&dirs, &instances).unwrap(), 7);
        assert!(dirs.mod_cache().join(format!("{USED}.jar")).exists(), "Referenziertes bleibt");
        assert!(dirs.mod_cache().join("notes.txt").exists() && dirs.mod_cache().join("kurz.jar").exists(), "Fremdes bleibt");
        assert!(!dirs.mod_cache().join(format!("{UNUSED}.jar")).exists());
        assert_eq!(clear_unused_cache(&dirs, &instances).unwrap(), 0);
        fs::remove_dir_all(&dirs.root).unwrap();
    }

    #[test]
    fn without_a_cache_folder_there_is_nothing_to_clear() {
        let dirs = Dirs::new(std::env::temp_dir().join(crate::models::new_id()));
        assert_eq!(clear_unused_cache(&dirs, &[]).unwrap(), 0);
    }

    #[test]
    fn sizes_add_up_per_instance_and_shared_folder() {
        let dirs = Dirs::new(std::env::temp_dir().join(crate::models::new_id()));
        let instance = instance_using(USED);
        fs::create_dir_all(dirs.game_dir(&instance.id).join("saves")).unwrap();
        fs::write(dirs.game_dir(&instance.id).join("saves/level.dat"), [0u8; 100]).unwrap();
        fs::write(dirs.instance(&instance.id).join("installed"), [0u8; 4]).unwrap();
        fs::create_dir_all(dirs.libraries()).unwrap();
        fs::write(dirs.libraries().join("lib.jar"), [0u8; 50]).unwrap();
        fs::create_dir_all(dirs.assets()).unwrap();
        fs::write(dirs.assets().join("index.json"), [0u8; 25]).unwrap();

        let overview = overview(&dirs, std::slice::from_ref(&instance)).unwrap();
        assert_eq!(overview.instances, [InstanceUsage { id: instance.id, bytes: 104 }]);
        assert_eq!(overview.shared_bytes, 75);
        assert_eq!(overview.mod_cache_bytes, 0);
        fs::remove_dir_all(&dirs.root).unwrap();
    }
}
