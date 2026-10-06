use std::collections::HashMap;
use std::fs;
use std::future::Future;
use std::path::Path;
use std::sync::{Arc, Mutex, MutexGuard};

use tauri::AppHandle;
use tokio_util::sync::CancellationToken;

use crate::coded;
use crate::error::{AppError, AppResult};
use crate::models::{Instance, LibrarySkin, MsAccount, Template};
use crate::services::auth::MsState;
use crate::services::download::http_client;
use crate::services::friends::config::friends_dir;
use crate::services::modbridge::ingame::Ingame;
use crate::services::friends::lookup::{ModrinthHttp, ModrinthLookup};
use crate::services::friends::{
    FriendSessions, Friends, JoinTimers, MojangVersions, NetOptions, SessionContext, PRODUCTION_LIVENESS,
};
use crate::services::gamesignal::GameSignals;
use crate::services::launch::Running;
use crate::services::modbridge::ModBridge;
use crate::services::presence::Presence;
use crate::services::progress::{progress, SharedProgress};
use crate::services::secrets::KeyringSecrets;
use crate::services::store::JsonStore;
use crate::services::{blocking, lock, until_phases_end, Dirs};

/// Globaler App-State (per `app.manage` registriert). Hält die Fachlogik, die über
/// mehrere Stores geht; Commands reichen nur durch.
pub struct AppState {
    /// Geteilt, damit auch Aufgaben abseits des Async-Kontexts (siehe `services::blocking`) die Instanz speichern können.
    pub instances: Arc<JsonStore<Instance>>,
    pub templates: JsonStore<Template>,
    /// Microsoft-Konten (nur Metadaten, Tokens im Schlüsselbund bzw. in `ms`).
    pub accounts: JsonStore<MsAccount>,
    /// Lokale Skin-Bibliothek; die PNG-Dateien liegen unter `skins/`.
    pub skins: JsonStore<LibrarySkin>,
    pub ms: MsState,
    pub dirs: Dirs,
    pub http: reqwest::Client,
    /// Die Anzeige in Discord; gezeigt wird nur, was `LaunchOptions::discord_presence` beim Start erlaubt.
    pub presence: Presence,
    /// Was beim Spielstart und -ende geschieht, für die Freunde-Funktion.
    pub signals: GameSignals,
    /// Shared Bridge listener, available at startup independently of Friends consent.
    pub bridge: ModBridge,
    /// Die Einspeisung der Mod in die Spielstarts: JARs des Builds, Zustand je Instanz, Java-Versionen.
    pub ingame: Ingame,
    /// Die Freunde-Funktion; aus, bis `lib.rs` sie beim Start (oder der Nutzer beim Aktivieren) startet.
    pub friends: Friends,
    /// Geteilte Welten, Einladungen, Beitritte und die Mod; hängt sich erst mit `start` in `friends` ein.
    pub sessions: FriendSessions,
    /// Laufende Spiele je Instanz-ID.
    running: Mutex<HashMap<String, Running>>,
    /// Abbrechbare Vorgänge je Instanz- bzw. operationId.
    cancels: Mutex<HashMap<String, CancellationToken>>,
    /// Eine Sperre für alle Instanzen: Installationen, Inhalte, Starts und Änderungen laufen nacheinander.
    /// TODO: je Instanz aufteilen, falls parallele Vorgänge auf verschiedenen Instanzen gebraucht werden.
    operation: tokio::sync::Mutex<()>,
}

/// Hält die Vorgangssperre von `AppState`, bis er fallen gelassen wird.
pub type OperationGuard<'a> = tokio::sync::MutexGuard<'a, ()>;

impl AppState {
    pub fn load(data_dir: &Path) -> AppResult<Self> {
        fs::create_dir_all(data_dir)?;
        let signals = GameSignals::default();
        let dirs = Dirs::new(data_dir);
        let bridge = ModBridge::new(signals.clone());
        let friends =
            Friends::new(&dirs, Arc::new(KeyringSecrets), signals.clone(), bridge.clone(), NetOptions::production())?;
        let ingame = Ingame::open(&friends_dir(&dirs), env!("CARGO_PKG_VERSION"))?;
        let instances = Arc::new(JsonStore::open(data_dir.join("instances.json"))?);
        let http = http_client()?;
        let sessions = FriendSessions::new(SessionContext {
            friends: friends.clone(),
            signals: signals.clone(),
            bridge: bridge.clone(),
            instances: instances.clone(),
            dirs: dirs.clone(),
            lookup: Arc::new(ModrinthLookup::new(ModrinthHttp::new()?)),
            versions: Arc::new(MojangVersions::new(http.clone())),
            timers: JoinTimers::production(),
            liveness: PRODUCTION_LIVENESS,
        });
        Ok(Self {
            instances,
            templates: JsonStore::open(data_dir.join("templates.json"))?,
            accounts: JsonStore::open(data_dir.join("accounts.json"))?,
            skins: JsonStore::open(data_dir.join("skins.json"))?,
            ms: MsState::default(),
            dirs,
            http,
            presence: Presence::discord(),
            bridge,
            ingame,
            friends,
            sessions,
            signals,
            running: Mutex::new(HashMap::new()),
            operation: tokio::sync::Mutex::new(()),
            cancels: Mutex::new(HashMap::new()),
        })
    }

    /// Nur die ID einer existierenden Instanz wird Teil eines Pfads.
    pub fn require_instance(&self, id: &str) -> AppResult<()> {
        self.instances.get(id).map(drop)
    }

    /// Beginnt einen Vorgang unter der Sperre (siehe `operation`); läuft schon einer, ist das ein Fehler.
    pub fn begin_operation(&self) -> AppResult<OperationGuard<'_>> {
        self.operation.try_lock().map_err(|_| AppError::invalid(coded!("errors.operationRunning")))
    }

    /// Wie `begin_operation` für eine Instanz, die dabei nicht laufen darf.
    pub fn begin_instance_operation(&self, id: &str) -> AppResult<OperationGuard<'_>> {
        let guard = self.begin_operation()?;
        if self.is_running(id) {
            return Err(AppError::invalid(coded!("errors.instance.stillRunning")));
        }
        Ok(guard)
    }

    /// Wie `begin_instance_operation` für eine Instanz, die es auch geben muss.
    pub fn exclusive(&self, id: &str) -> AppResult<OperationGuard<'_>> {
        let guard = self.begin_instance_operation(id)?;
        self.require_instance(id)?;
        Ok(guard)
    }

    /// Führt `work` abbrechbar unter `key` aus; `cancel(key)` verwirft das Future (Aufräumen
    /// über `RemoveOnDrop`) und liefert `AppError::Cancelled`, sobald auch eine laufende Dateiphase von `work` beim
    /// nächsten `check_cancelled` aufgehört hat. Eine Vorgangssperre des Aufrufers bleibt also bis dahin bestehen.
    pub async fn cancellable<T>(&self, key: &str, work: impl Future<Output = AppResult<T>>) -> AppResult<T> {
        let token = CancellationToken::new();
        self.cancels().insert(key.to_owned(), token.clone());
        let result = until_phases_end(async {
            // Abbruch hat Vorrang vor gleichzeitig fertiger Arbeit, bevor diese ihre Instanz einträgt.
            tokio::select! {
                biased;
                _ = token.cancelled() => None,
                result = work => Some(result),
            }
        })
        .await;
        self.cancels().remove(key);
        result.unwrap_or(Err(AppError::Cancelled))
    }

    /// Bricht den Vorgang `key` ab; ist keiner (mehr) aktiv, passiert nichts.
    pub fn cancel(&self, key: &str) {
        if let Some(token) = self.cancels().get(key) {
            token.cancel();
        }
    }

    /// Wie `cancellable` unter der `operationId` des Frontends; `work` bekommt den Rückruf, der den Fortschritt als
    /// `content-progress` meldet.
    pub async fn run_cancellable<T, F: Future<Output = AppResult<T>>>(
        &self,
        app: &AppHandle,
        operation_id: &str,
        work: impl FnOnce(SharedProgress) -> F,
    ) -> AppResult<T> {
        self.cancellable(operation_id, work(progress(app.clone(), operation_id.to_owned()))).await
    }

    /// Führt blockierende Dateiarbeit mit den Verzeichnissen der App aus (siehe `services::blocking`).
    pub async fn blocking_with_dirs<T: Send + 'static>(
        &self,
        work: impl FnOnce(&Dirs) -> AppResult<T> + Send + 'static,
    ) -> AppResult<T> {
        let dirs = self.dirs.clone();
        blocking(move |_| work(&dirs)).await
    }

    pub fn is_running(&self, instance_id: &str) -> bool {
        lock(&self.running).contains_key(instance_id)
    }

    /// Startet das Spiel der Instanz mit `spawn` und trägt es als laufend ein. Prüfen, Starten und Eintragen laufen
    /// unter einer Sperre: sonst könnte ein sofort beendeter Prozess seinen Eintrag über `take_running` entfernen,
    /// bevor er eingetragen ist. Was `spawn` tut, ist damit auch vor dem `instance-exit` dieses Prozesses fertig.
    pub fn spawn_running(&self, instance_id: &str, spawn: impl FnOnce() -> AppResult<Running>) -> AppResult<u32> {
        let mut running = lock(&self.running);
        if running.contains_key(instance_id) {
            return Err(AppError::invalid(coded!("errors.instance.alreadyRunning")));
        }
        let game = spawn()?;
        let pid = game.pid;
        running.insert(instance_id.to_owned(), game);
        Ok(pid)
    }

    /// Nimmt die Instanz aus den laufenden; `None`, wenn sie nicht (mehr) läuft.
    pub fn take_running(&self, instance_id: &str) -> Option<Running> {
        lock(&self.running).remove(instance_id)
    }

    fn cancels(&self) -> MutexGuard<'_, HashMap<String, CancellationToken>> {
        lock(&self.cancels)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::services::check_cancelled;
    use std::sync::atomic::{AtomicBool, Ordering};
    use std::time::Duration;

    #[tokio::test]
    async fn cancel_stops_work_and_reports_cancelled() {
        let root = std::env::temp_dir().join(crate::models::new_id());
        let state = AppState::load(&root).unwrap();
        let work = state.cancellable("op", std::future::pending::<AppResult<()>>());
        let (result, ()) = tokio::join!(work, async {
            tokio::task::yield_now().await;
            state.cancel("op");
        });
        assert!(matches!(result, Err(AppError::Cancelled)));
        assert!(state.cancels().is_empty());
        assert_eq!(state.cancellable("op", async { Ok(1) }).await.unwrap(), 1);
        std::fs::remove_dir_all(root).unwrap();
    }

    #[tokio::test]
    async fn cancellation_wins_before_ready_work_commits_an_instance() {
        let root = std::env::temp_dir().join(crate::models::new_id());
        let state = AppState::load(&root).unwrap();
        let instance = Instance::from_new(crate::models::NewInstance {
            name: "Cancelled copy".into(),
            minecraft_version: "1.21.1".into(),
            loader: crate::models::ModLoader::Vanilla,
            loader_version: None,
        });
        let instance_id = instance.id.clone();
        let (entered, started) = tokio::sync::oneshot::channel();
        let (resume, held) = tokio::sync::oneshot::channel();
        let work = state.cancellable("op", async {
            entered.send(()).unwrap();
            held.await.unwrap();
            state.instances.insert(instance)
        });
        let (result, ()) = tokio::join!(biased; work, async {
            started.await.unwrap();
            state.cancel("op");
            resume.send(()).unwrap();
        });
        assert!(matches!(result, Err(AppError::Cancelled)));
        assert!(state.instances.get(&instance_id).is_err());
        std::fs::remove_dir_all(root).unwrap();
    }

    #[tokio::test]
    async fn cancel_returns_only_after_the_running_file_phase_has_stopped() {
        let root = std::env::temp_dir().join(crate::models::new_id());
        let state = AppState::load(&root).unwrap();
        let phase_ended = Arc::new(AtomicBool::new(false));
        let ended = phase_ended.clone();
        let work = state.cancellable(
            "op",
            blocking(move |stop| {
                while !stop.is_cancelled() {
                    std::thread::sleep(Duration::from_millis(1));
                }
                std::thread::sleep(Duration::from_millis(50));
                ended.store(true, Ordering::SeqCst);
                check_cancelled(stop)
            }),
        );
        let (result, ()) = tokio::join!(work, async {
            tokio::task::yield_now().await;
            state.cancel("op");
        });
        assert!(matches!(result, Err(AppError::Cancelled)));
        assert!(phase_ended.load(Ordering::SeqCst));
        std::fs::remove_dir_all(root).unwrap();
    }
}
