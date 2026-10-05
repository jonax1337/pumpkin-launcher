//! Die Mod im Spiel in den Start und in die Statuszeile verdrahtet (docs/friends/INGAME.md, 3.3 bis 3.9): was der Start
//! über die Instanz wissen muss, damit das Tor entscheidet, wie die Argumente der Einspeisung in `LaunchSpec` kommen, der
//! Status ohne Start und die Wache der ersten 90 Sekunden. Die Entscheidungen selbst liegen in `services::modbridge::ingame`.
use std::path::Path;
use std::sync::{Arc, Mutex};
use std::time::Instant;

use tauri::{AppHandle, Manager};

use crate::models::Instance;
use crate::services::friends::contract::{IngameActions, IngameEvent, IngameFailedEvent, IngameStatus};
use crate::services::modbridge::ingame::{
    inject, select, status_of, FailureKind, Injection, InjectionRequest, InjectionState, LaunchFacts, StartupWatch, Target, UserArgs,
};
use crate::services::progress::emit;
use crate::services::{java, loader, lock};
use crate::state::AppState;

pub const INGAME_EVENT: &str = "friends-ingame";
pub const INGAME_FAILED_EVENT: &str = "friends-ingame-failed";

/// Was zur Entscheidung gehört und nicht aus der Instanz selbst kommt: Einstellungen, gespeicherter Zustand, Ordnerinhalt.
struct GateInputs {
    friends_enabled: bool,
    bridge_running: bool,
    global_switch: bool,
    pre_granted: bool,
    instance_state: InjectionState,
    mod_ids: Vec<String>,
}

fn gate_inputs(state: &AppState, instance: &Instance) -> GateInputs {
    let friends = state.friends.state();
    GateInputs {
        friends_enabled: friends.enabled,
        bridge_running: state.bridge.is_running(),
        global_switch: friends.settings.ingame_menu,
        pre_granted: friends.enabled && friends.settings.ingame_actions == IngameActions::Allow,
        instance_state: state.ingame.store.get(&instance.id),
        mod_ids: state.ingame.mod_ids.ids_in(&state.dirs.mods_dir(&instance.id)),
    }
}

impl GateInputs {
    /// Listener availability belongs to Bridge, independently of Friends consent.
    fn facts<'a>(&'a self, instance: &'a Instance, online_account: bool, java_major: Option<u32>) -> LaunchFacts<'a> {
        LaunchFacts {
            friends_enabled: self.friends_enabled,
            bridge_running: self.bridge_running,
            online_account,
            minecraft: &instance.minecraft_version,
            loader: instance.loader,
            loader_version: instance.loader_version.as_deref().unwrap_or_default(),
            java_major,
            global_switch: self.global_switch,
            instance_state: &self.instance_state,
            launcher_version: env!("CARGO_PKG_VERSION"),
            mod_ids_in_instance: &self.mod_ids,
        }
    }
}

/// Die Einspeisung für den Start von `instance` mit dem Java `java`. Scheitert sie, startet das Spiel ohne (INGAME 3.3).
pub fn inject_into_launch(state: &AppState, instance: &Instance, java: &Path, online_account: bool, user_jvm: &[String]) -> Injection {
    let gate = gate_inputs(state, instance);
    let java_major = state.ingame.java.of(java);
    let user = UserArgs { jvm: user_jvm, game: &instance.game_args, game_dir: &state.dirs.game_dir(&instance.id) };
    let request = InjectionRequest {
        facts: gate.facts(instance, online_account, java_major),
        instance_id: &instance.id,
        user,
        pre_granted: gate.pre_granted,
    };
    let injection = inject(state.ingame.source(), &state.dirs.root, &state.bridge, &request);
    log_outcome(&instance.id, &injection);
    injection
}

fn log_outcome(instance_id: &str, injection: &Injection) {
    match injection {
        Injection::Injected(_) => tracing::info!(instance = %instance_id, node = ?injection.node_id(), "Pumpkin Bridge wird eingespeist"),
        Injection::Skipped(reason) => tracing::debug!(instance = %instance_id, reason = reason.code(), "Pumpkin Bridge nicht eingespeist"),
        Injection::Failed(error) => tracing::warn!(instance = %instance_id, %error, "Pumpkin Bridge nicht eingespeist"),
    }
}

/// Der Status der Einspeisung für die Instanzseite, ohne zu starten. Das Java kennt der Launcher erst beim Start; hier
/// zählt das der Instanz (eigener Pfad) oder die installierte Runtime, und fehlt beides, gilt die mitgelieferte
/// Runtime als passend (sie ist die, auf der der Knoten gebaut und geprüft ist).
pub async fn status(state: &AppState, instance: &Instance) -> IngameStatus {
    let gate = gate_inputs(state, instance);
    let index = state.ingame.source().index();
    let java_major = match known_java(state, instance).await {
        Some(major) => Some(major),
        None => select(index, &target_with_any_java(instance)).fit().map(|node| node.java_min),
    };
    let online_account = !state.accounts.list().is_empty();
    let connected = state.bridge.is_connected(&instance.id);
    status_of(index, &gate.facts(instance, online_account, java_major), connected)
}

/// Die Instanz mit einem Java, das jede Anforderung erfüllt: so liefert die Auswahl den Knoten, ohne das Java zu prüfen.
fn target_with_any_java(instance: &Instance) -> Target<'_> {
    Target {
        minecraft: &instance.minecraft_version,
        loader: instance.loader,
        loader_version: instance.loader_version.as_deref().unwrap_or_default(),
        java_major: Some(u32::MAX),
    }
}

async fn known_java(state: &AppState, instance: &Instance) -> Option<u32> {
    let exe = match instance.java_path.as_deref().map(str::trim).filter(|path| !path.is_empty()) {
        Some(path) => java::custom_java(path, java::JavaSetting::Instance).ok()?,
        None => {
            let version = loader::installed_version(&state.dirs, instance.into()).await.ok()?;
            Some(java::java_exe(&state.dirs, version.java_component())).filter(|exe| exe.is_file())?
        }
    };
    state.ingame.java.of(&exe)
}

/// Sendet den Status der Instanz als `friends-ingame`.
pub fn announce(app: &AppHandle, instance_id: &str, status: IngameStatus) {
    emit(app, INGAME_EVENT, IngameEvent { instance_id: instance_id.to_owned(), status });
}

/// Berechnet den Status der Instanz neu und sendet ihn; für Stellen, die keine Antwort geben (Start, Ende, Wache).
pub fn announce_current(app: &AppHandle, instance_id: &str) {
    let (app, instance_id) = (app.clone(), instance_id.to_owned());
    tauri::async_runtime::spawn(async move {
        let state = app.state::<AppState>();
        match state.instances.get(&instance_id) {
            Ok(instance) => announce(&app, &instance_id, status(&state, &instance).await),
            Err(error) => tracing::debug!(instance = %instance_id, %error, "Status des Pumpkin Bridges nicht berechnet"),
        }
    });
}

/// Die Wache über die ersten 90 Sekunden eines Starts mit eingespeister Mod; sie liest die Zeilen mit, aus beliebig
/// vielen Threads.
#[derive(Clone)]
pub struct LaunchWatch {
    app: AppHandle,
    instance_id: Arc<str>,
    started: Instant,
    watch: Arc<Mutex<StartupWatch>>,
}

impl LaunchWatch {
    pub fn new(app: &AppHandle, instance_id: &str) -> Self {
        Self { app: app.clone(), instance_id: instance_id.into(), started: Instant::now(), watch: Arc::default() }
    }

    pub fn on_line(&self, line: &str) {
        let failure = lock(&self.watch).on_line(self.started.elapsed(), line);
        self.report(failure);
    }

    pub fn on_exit(&self, code: Option<i32>) {
        let failure = lock(&self.watch).on_exit(code, self.started.elapsed());
        self.report(failure);
    }

    /// Hat der Spieler die Einspeisung schon selbst ausgeschaltet, bleibt es dabei und niemand wird gefragt.
    fn report(&self, failure: Option<FailureKind>) {
        let Some(reason) = failure else { return };
        let state = self.app.state::<AppState>();
        match state.ingame.store.trip(&self.instance_id, reason) {
            Ok(after) if after.is_tripped() => {
                tracing::warn!(instance = %self.instance_id, ?reason, "Start wahrscheinlich an der Mod gescheitert, Einspeisung ausgeschaltet");
                emit(&self.app, INGAME_FAILED_EVENT, IngameFailedEvent { instance_id: self.instance_id.to_string(), reason });
                announce_current(&self.app, &self.instance_id);
            }
            Ok(_) => {}
            Err(error) => tracing::warn!(instance = %self.instance_id, %error, "Startfehler der Mod nicht gespeichert"),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::{ModLoader, NewInstance};
    use crate::services::friends::config::friends_dir;
    use crate::services::friends::contract::{IngameNode, IngameState};
    use crate::services::modbridge::ingame::{Ingame, Loader, ModIndex, ModSource};

    const INDEX: &str = r#"{ "modVersion": "2.1.0", "nodes": [ { "id": "1.21.1-fabric", "loader": "fabric", "loaderMin": "0.16.0",
        "minecraft": ["1.21.1"], "javaMin": 21, "strategy": "fabricAddMods", "file": "pumpkin_bridge-2.1.0+1.21.1-fabric.jar",
        "sha256": "abababababababababababababababababababababababababababababababab", "verified": { "smoke": "2026-10-03" } } ] }"#;

    struct IndexOnly(ModIndex);

    impl ModSource for IndexOnly {
        fn index(&self) -> &ModIndex {
            &self.0
        }

        fn jar_bytes(&self, _file: &str) -> Option<&[u8]> {
            None
        }
    }

    /// Ein App-Zustand, dessen Mod-Quelle genau den Knoten `1.21.1-fabric` kennt, und eine Instanz mit diesem Loader.
    fn state_with_instance(loader: ModLoader) -> (AppState, Instance, std::path::PathBuf) {
        let root = std::env::temp_dir().join(crate::models::new_id());
        let mut state = AppState::load(&root).unwrap();
        let source: &'static IndexOnly = Box::leak(Box::new(IndexOnly(ModIndex::parse(INDEX).unwrap())));
        state.ingame = Ingame::with_source(source, &friends_dir(&state.dirs), "2.0.1").unwrap();
        let new = NewInstance { name: "Start".into(), minecraft_version: "1.21.1".into(), loader, loader_version: Some("0.16.14".into()) };
        let instance = state.instances.insert(Instance::from_new(new)).unwrap();
        (state, instance, root)
    }

    #[tokio::test]
    async fn disabled_friends_does_not_hide_the_bridge_node_when_the_listener_is_running() {
        let (state, instance, root) = state_with_instance(ModLoader::Fabric);
        state.bridge.start().await.unwrap();
        state.accounts.insert(crate::models::MsAccount {
            id: "online".into(), username: "Player".into(), kind: crate::models::AccountKind::Microsoft, client_id: "client".into(),
        }).unwrap();

        let status = status(&state, &instance).await;

        let node = IngameNode { id: "1.21.1-fabric".into(), minecraft: "1.21.1".into(), loader: Loader::Fabric };
        assert_eq!((status.state, status.reason, status.node), (IngameState::Active, None, Some(node)));
        state.bridge.stop().await;
        std::fs::remove_dir_all(root).unwrap();
    }

    #[tokio::test]
    async fn an_instance_without_a_loader_has_no_node() {
        let (state, instance, root) = state_with_instance(ModLoader::Vanilla);

        let status = status(&state, &instance).await;

        assert_eq!((status.state, status.node), (IngameState::Unavailable, None));
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn the_selection_for_the_status_ignores_the_java_of_the_instance() {
        let new = NewInstance { name: "i".into(), minecraft_version: "1.21.1".into(), loader: ModLoader::Fabric, loader_version: None };
        let instance = Instance::from_new(new);

        let target = target_with_any_java(&instance);

        assert_eq!((target.minecraft, target.loader, target.java_major), ("1.21.1", ModLoader::Fabric, Some(u32::MAX)));
        assert_eq!(target.loader_version, "", "ohne gespeicherte Version ist sie unbekannt, nicht geraten");
    }
}
