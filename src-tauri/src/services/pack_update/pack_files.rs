//! Welche Dateien ein Pack in den Spielordner gelegt hat (`instances/<id>/pack-files.json`): Pfad relativ zum
//! Spielordner mit `/` → SHA-1. Das nächste Update erkennt daran, was noch so daliegt, wie das Pack es brachte, und
//! was der Spieler geändert hat.
use std::{
    collections::BTreeMap,
    fs,
    path::{Path, PathBuf},
};

use serde::{Deserialize, Serialize};

use crate::{
    error::AppResult,
    services::{none_if_missing, write_atomic, Dirs},
};

const FILE_NAME: &str = "pack-files.json";

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct PackFiles {
    files: BTreeMap<String, String>,
}

impl PackFiles {
    /// Merkt sich, dass das Pack `path` mit dem Inhalt `sha1` abgelegt hat.
    pub(crate) fn record(&mut self, path: &Path, sha1: String) {
        let path = path.to_string_lossy().replace('\\', "/");
        self.files.insert(path, sha1.to_ascii_lowercase());
    }

    /// Liegt neben dem Spielordner: Exporte des Spielordners nehmen sie nicht mit, Kopien der Instanz müssen sie
    /// mitnehmen.
    pub(crate) fn path_of(dirs: &Dirs, instance_id: &str) -> PathBuf {
        dirs.instance(instance_id).join(FILE_NAME)
    }

    pub(crate) fn save(&self, dirs: &Dirs, instance_id: &str) -> AppResult<()> {
        write_atomic(&Self::path_of(dirs, instance_id), &serde_json::to_vec(self)?)
    }

    /// Die Liste der Instanz; Instanzen, die vor ihr installiert wurden, haben keine.
    pub(crate) fn load(dirs: &Dirs, instance_id: &str) -> AppResult<Option<Self>> {
        let Some(bytes) = none_if_missing(fs::read(Self::path_of(dirs, instance_id)))? else { return Ok(None) };
        Ok(Some(serde_json::from_slice(&bytes)?))
    }

    /// (Pfad, SHA-1) je Datei.
    pub(crate) fn iter(&self) -> impl Iterator<Item = (&str, &str)> {
        self.files.iter().map(|(path, sha1)| (path.as_str(), sha1.as_str()))
    }
}


#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn saved_files_load_back_and_a_missing_list_is_none() {
        let dirs = Dirs::new(std::env::temp_dir().join(crate::models::new_id()));
        fs::create_dir_all(dirs.instance("i")).unwrap();
        let mut placed = PackFiles::default();
        placed.record(Path::new("config/a.toml"), "ABC".into());

        placed.save(&dirs, "i").unwrap();

        let loaded = PackFiles::load(&dirs, "i").unwrap().unwrap();
        assert_eq!(loaded.iter().collect::<Vec<_>>(), [("config/a.toml", "abc")]);
        assert!(PackFiles::load(&dirs, "fehlt").unwrap().is_none());
        fs::remove_dir_all(&dirs.root).unwrap();
    }
}
