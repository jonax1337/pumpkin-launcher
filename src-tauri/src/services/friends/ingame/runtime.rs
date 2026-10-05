//! Was die Einspeisung zur Laufzeit des Launchers braucht und über Starts hinweg behält: die Quelle der Mod, den Zustand
//! je Instanz, die gemerkten Java-Versionen und den Mod-Id-Scan der Instanzordner.
use std::path::Path;

use super::embedded::build_source;
use super::index::ModSource;
use super::java_cache::JavaMajors;
use super::store::InjectionStore;
use crate::error::AppResult;
use crate::services::content::ModIdScanner;

pub struct Ingame {
    source: &'static (dyn ModSource + Send + Sync),
    pub store: InjectionStore,
    pub java: JavaMajors,
    pub mod_ids: ModIdScanner,
}

impl Ingame {
    /// Mit den JARs dieses Builds; der Zustand liegt in `friends_dir`.
    pub fn open(friends_dir: &Path, launcher_version: &str) -> AppResult<Self> {
        Self::with_source(build_source(), friends_dir, launcher_version)
    }

    pub fn with_source(
        source: &'static (dyn ModSource + Send + Sync),
        friends_dir: &Path,
        launcher_version: &str,
    ) -> AppResult<Self> {
        Ok(Self {
            source,
            store: InjectionStore::open(friends_dir, launcher_version)?,
            java: JavaMajors::default(),
            mod_ids: ModIdScanner::default(),
        })
    }

    pub fn source(&self) -> &'static (dyn ModSource + Send + Sync) {
        self.source
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::services::friends::ingame::materialise::runtime_dir;
    use crate::services::friends::test_support::TempDir;
    use crate::services::Dirs;

    #[test]
    fn the_jars_of_a_mod_version_lie_below_the_friends_mod_folder_of_the_data_dir() {
        let dirs = Dirs::new("/daten");

        assert_eq!(
            dirs.friends_mod().join("2.1.0"),
            runtime_dir(&dirs.root, "2.1.0")
        );
    }

    #[test]
    fn the_runtime_opens_with_the_sources_of_this_build_and_an_empty_state() {
        let dir = TempDir::new();

        let ingame = Ingame::open(dir.path(), "2.1.0").unwrap();

        assert_eq!(ingame.store.get("i1"), super::super::InjectionState::Active);
        assert_eq!(
            ingame.source().index().nodes.is_empty(),
            build_source().index().nodes.is_empty()
        );
    }
}
