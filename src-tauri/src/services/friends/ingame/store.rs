//! Der gespeicherte Zustand der Einspeisung je Instanz (INGAME 3.8, 3.9): `friends/ingame.json` im Datenordner des
//! Launchers. Hier steht nur, was vom Standard (`Active`) abweicht; die Übergänge selbst liegen in [`InjectionState`].
use std::collections::BTreeMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use serde::{Deserialize, Serialize};

use super::breaker::{FailureKind, InjectionState};
use crate::error::AppResult;
use crate::services::friends::config;
use crate::services::{lock, none_if_missing, write_atomic};

const STATE_FILE: &str = "ingame.json";
const STATE_VERSION: u32 = 1;

#[derive(Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
struct StateFile {
    version: u32,
    instances: BTreeMap<String, InjectionState>,
}

impl Default for StateFile {
    fn default() -> Self {
        Self {
            version: STATE_VERSION,
            instances: BTreeMap::new(),
        }
    }
}

/// Die Zustände aller Instanzen, im Speicher und auf der Platte. Jede Änderung wird sofort atomar gespeichert.
pub struct InjectionStore {
    path: PathBuf,
    launcher_version: String,
    states: Mutex<BTreeMap<String, InjectionState>>,
}

impl InjectionStore {
    /// Liest die Datei in `dir`. Ein Ausschalten durch einen Startfehler unter einer anderen Launcher-Version gilt nicht
    /// mehr (dort kann ein behobener Knoten liegen) und wird beim Öffnen aufgehoben. Eine unlesbare Datei wird
    /// gesichert statt überschrieben.
    pub fn open(dir: &Path, launcher_version: &str) -> AppResult<Self> {
        let path = dir.join(STATE_FILE);
        let stored = read(&path)?;
        let lifted: BTreeMap<_, _> = stored
            .instances
            .iter()
            .map(|(id, state)| (id.clone(), state.clone().lifted_for(launcher_version)))
            .collect();
        let was_lifted = lifted != stored.instances;
        let store = Self {
            path,
            launcher_version: launcher_version.to_owned(),
            states: Mutex::new(lifted),
        };
        if was_lifted {
            store.save(&lock(&store.states))?;
        }
        Ok(store)
    }

    /// Der Zustand der Instanz; eine unbekannte Instanz ist `Active`.
    pub fn get(&self, instance_id: &str) -> InjectionState {
        lock(&self.states)
            .get(instance_id)
            .cloned()
            .unwrap_or_default()
    }

    /// Der Spieler legt den Schalter der Instanz um; das hebt auch ein automatisches Ausschalten auf.
    pub fn set_switch(&self, instance_id: &str, on: bool) -> AppResult<InjectionState> {
        self.change(instance_id, |_| InjectionState::from_switch(on))
    }

    /// „Erneut versuchen“: hebt ein automatisches Ausschalten auf und lässt den Schalter des Spielers, wie er ist.
    pub fn retry(&self, instance_id: &str) -> AppResult<InjectionState> {
        self.change(instance_id, |state| match state {
            InjectionState::AutoOff { .. } => InjectionState::Active,
            other => other,
        })
    }

    /// Ein Startfehler, den der Launcher der Mod zuschreibt: die Einspeisung der Instanz ist unter dieser Version aus.
    pub fn trip(&self, instance_id: &str, reason: FailureKind) -> AppResult<InjectionState> {
        let version = self.launcher_version.clone();
        self.change(instance_id, move |state| state.tripped(reason, &version))
    }

    /// Die Instanz ist gelöscht: ihr Zustand wird nicht mehr gebraucht.
    pub fn forget(&self, instance_id: &str) -> AppResult<()> {
        let mut states = lock(&self.states);
        if states.remove(instance_id).is_some() {
            self.save(&states)?;
        }
        Ok(())
    }

    fn change(
        &self,
        instance_id: &str,
        transition: impl FnOnce(InjectionState) -> InjectionState,
    ) -> AppResult<InjectionState> {
        let mut states = lock(&self.states);
        let next = transition(states.get(instance_id).cloned().unwrap_or_default());
        let mut changed = states.clone();
        if next == InjectionState::Active {
            changed.remove(instance_id);
        } else {
            changed.insert(instance_id.to_owned(), next.clone());
        }
        self.save(&changed)?;
        *states = changed;
        Ok(next)
    }

    fn save(&self, states: &BTreeMap<String, InjectionState>) -> AppResult<()> {
        if let Some(dir) = self.path.parent() {
            fs::create_dir_all(dir)?;
        }
        let file = StateFile {
            version: STATE_VERSION,
            instances: states.clone(),
        };
        write_atomic(&self.path, &serde_json::to_vec_pretty(&file)?)
    }
}

fn read(path: &Path) -> AppResult<StateFile> {
    let Some(raw) = none_if_missing(fs::read_to_string(path))? else {
        return Ok(StateFile::default());
    };
    match serde_json::from_str(&raw) {
        Ok(file) => Ok(file),
        Err(error) => {
            config::set_aside(path, &error)?;
            Ok(StateFile::default())
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::services::friends::test_support::TempDir;

    const LAUNCHER: &str = "2.1.0";

    fn open(dir: &TempDir, version: &str) -> InjectionStore {
        InjectionStore::open(dir.path(), version).unwrap()
    }

    fn auto_off(reason: FailureKind, version: &str) -> InjectionState {
        InjectionState::AutoOff {
            reason,
            launcher_version: version.to_owned(),
        }
    }

    #[test]
    fn an_instance_without_an_entry_is_active() {
        let dir = TempDir::new();
        assert_eq!(open(&dir, LAUNCHER).get("i1"), InjectionState::Active);
    }

    #[test]
    fn the_players_switch_survives_a_restart() {
        let dir = TempDir::new();
        open(&dir, LAUNCHER).set_switch("i1", false).unwrap();

        let after_restart = open(&dir, LAUNCHER);

        assert_eq!(after_restart.get("i1"), InjectionState::UserOff);
        assert_eq!(after_restart.get("i2"), InjectionState::Active);
    }

    #[test]
    fn a_trip_survives_a_restart_under_the_same_launcher_version() {
        let dir = TempDir::new();
        let tripped = open(&dir, LAUNCHER)
            .trip("i1", FailureKind::MixinApplyFailed)
            .unwrap();

        assert_eq!(tripped, auto_off(FailureKind::MixinApplyFailed, LAUNCHER));
        assert_eq!(open(&dir, LAUNCHER).get("i1"), tripped);
    }

    #[test]
    fn a_new_launcher_version_lifts_a_trip_and_stores_the_lifting() {
        let dir = TempDir::new();
        open(&dir, "2.1.0")
            .trip("i1", FailureKind::ModLoadingError)
            .unwrap();

        assert_eq!(open(&dir, "2.1.1").get("i1"), InjectionState::Active);

        let written = fs::read_to_string(dir.path().join(STATE_FILE)).unwrap();
        assert!(!written.contains("autoOff"), "{written}");
        assert_eq!(
            open(&dir, "2.1.0").get("i1"),
            InjectionState::Active,
            "aufgehoben bleibt aufgehoben"
        );
    }

    #[test]
    fn a_new_launcher_version_keeps_the_players_off_switch() {
        let dir = TempDir::new();
        open(&dir, "2.1.0").set_switch("i1", false).unwrap();

        assert_eq!(open(&dir, "2.2.0").get("i1"), InjectionState::UserOff);
    }

    #[test]
    fn a_trip_never_overrides_the_players_off_switch() {
        let dir = TempDir::new();
        let store = open(&dir, LAUNCHER);
        store.set_switch("i1", false).unwrap();

        assert_eq!(
            store
                .trip("i1", FailureKind::UnsupportedClassVersion)
                .unwrap(),
            InjectionState::UserOff
        );
    }

    #[test]
    fn retry_lifts_a_trip_but_not_the_players_off_switch() {
        let dir = TempDir::new();
        let store = open(&dir, LAUNCHER);
        store
            .trip("i1", FailureKind::FabricIncompatibleModSet)
            .unwrap();
        store.set_switch("i2", false).unwrap();

        assert_eq!(store.retry("i1").unwrap(), InjectionState::Active);
        assert_eq!(store.retry("i2").unwrap(), InjectionState::UserOff);
        assert_eq!(open(&dir, LAUNCHER).get("i1"), InjectionState::Active);
    }

    #[test]
    fn the_players_switch_on_lifts_a_trip() {
        let dir = TempDir::new();
        let store = open(&dir, LAUNCHER);
        store.trip("i1", FailureKind::MixinApplyFailed).unwrap();

        assert_eq!(
            store.set_switch("i1", true).unwrap(),
            InjectionState::Active
        );
    }

    #[test]
    fn active_instances_leave_no_entry_in_the_file() {
        let dir = TempDir::new();
        let store = open(&dir, LAUNCHER);
        store.set_switch("i1", false).unwrap();
        store.set_switch("i1", true).unwrap();

        let written: StateFile =
            serde_json::from_str(&fs::read_to_string(dir.path().join(STATE_FILE)).unwrap())
                .unwrap();

        assert!(written.instances.is_empty());
    }

    #[test]
    fn the_file_has_the_documented_shape() {
        let dir = TempDir::new();
        let store = open(&dir, LAUNCHER);
        store.trip("i1", FailureKind::ModLoadingError).unwrap();
        store.set_switch("i2", false).unwrap();

        let written: serde_json::Value =
            serde_json::from_str(&fs::read_to_string(dir.path().join(STATE_FILE)).unwrap())
                .unwrap();

        let expected = serde_json::json!({
            "version": 1,
            "instances": {
                "i1": { "state": "autoOff", "reason": "modLoadingError", "launcherVersion": "2.1.0" },
                "i2": { "state": "userOff" }
            }
        });
        assert_eq!(written, expected);
    }

    #[test]
    fn a_forgotten_instance_is_active_again_after_a_restart() {
        let dir = TempDir::new();
        let store = open(&dir, LAUNCHER);
        store.set_switch("i1", false).unwrap();
        store.forget("i1").unwrap();
        store.forget("never-known").unwrap();

        assert_eq!(open(&dir, LAUNCHER).get("i1"), InjectionState::Active);
    }

    #[test]
    fn an_unreadable_file_is_set_aside_and_the_store_starts_empty() {
        let dir = TempDir::new();
        fs::write(dir.path().join(STATE_FILE), "{kaputt").unwrap();

        assert_eq!(open(&dir, LAUNCHER).get("i1"), InjectionState::Active);
        assert_eq!(
            fs::read_to_string(dir.path().join("ingame.json.corrupt")).unwrap(),
            "{kaputt"
        );
    }
}
