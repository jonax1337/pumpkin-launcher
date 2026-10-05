//! Der Freunde-Dienst (SPEC 3.7, 4.1, 4.6, 8.7): Verfügbarkeit, Aktivieren und Abschalten, Identität erneuern oder
//! zurücksetzen, die Endpunkte mit ihrem Lebenszyklus und die Naht für Sitzungen (R5). Anfragen, Codes, Präsenz,
//! Postausgang und das Verzeichnis liegen in eigenen Modulen, die [`Friends`] um ihre Befehle erweitern.
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::{Arc, Mutex, OnceLock, RwLock, Weak};
use std::time::Duration;

use futures::future::BoxFuture;
use tokio::sync::{broadcast, mpsc, oneshot};
use tokio_util::sync::CancellationToken;

use super::by_name::DirectoryClient;
use super::config::{friends_dir, FriendsConfig};
use super::contract::{
    Availability, DegradedReason, FriendsEnableInput, FriendsSettings, FriendsState, Me,
    NetworkStatus, RelayInfo, RelayOperatorKind, REQUEST_TTL_SECS,
};
use super::control::{SessionControl, WireProfile, PEER_ALPN};
use super::directory::DirectoryDeps;
use super::events::{EventSink, FriendsEvent, NoEvents};
use super::identity::{self, Identity, Renewal};
use super::outbox;
use super::records::RecordStores;
use super::sanitize;
use super::status::{self, Links, Patches, Scheduler};
use super::{by_name, hello, requests};
use crate::coded;
use crate::error::{AppError, AppResult};
use crate::models::now_ms;
use crate::services::gamesignal::{GameSignal, GameSignals};
use crate::services::modbridge::ModBridge;
use crate::services::p2p::{
    Admission, BiStream, CloseCode, Gate, NetConfig, NetError, PeerConn, PeerId, PeerNet,
    RelayEntry, RelayOperator, RelaySelection, RelayTls, RELAY_MAP,
};
use crate::services::secrets::SecretStore;
use crate::services::{lock, Dirs};

const PRODUCTION_IDLE_TIMEOUT: Duration = Duration::from_secs(40);
/// So lange warten Disable, Rebind, Identitätswechsel und Beenden höchstens auf die Abonnenten des Lebenszyklus.
const LIFECYCLE_WAIT: Duration = Duration::from_millis(500);
const LIFECYCLE_QUEUE: usize = 4;
/// QUIC verwirft beim Schließen Stream-Daten, die noch nicht auf der Leitung sind; die letzten Steuernachrichten
/// (etwa das `inviteRevoke` einer endenden Sitzung) bekommen so lange Zeit, hinauszugehen.
const FLUSH_GRACE: Duration = Duration::from_millis(100);

/// Netzwerk-Einstellungen des Dienstes (SPEC 3.7). Es gibt keine Einstellung dafür: die App nimmt
/// [`NetOptions::production`], Tests ein In-Process-Relay.
#[derive(Debug, Clone)]
pub struct NetOptions {
    pub relay_map: Vec<RelayEntry>,
    /// Hello-Endpunkte ohne IP-Transporte; nur reine Logiktests ohne Hello-Endpunkt schalten das ab.
    pub hello_relay_only: bool,
    pub relay_tls: RelayTls,
    /// Leerlaufzeit jeder Verbindung; nur Absturz-Tests kürzen sie.
    pub idle_timeout: Duration,
}

impl NetOptions {
    pub fn production() -> Self {
        Self {
            relay_map: RELAY_MAP.to_vec(),
            hello_relay_only: true,
            relay_tls: RelayTls::Verify,
            idle_timeout: PRODUCTION_IDLE_TIMEOUT,
        }
    }
}

/// Was der Dienst vom Microsoft-Konto ankündigt (selbst angegeben, SPEC 4.1).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AccountProfile {
    pub name: String,
    /// 32 kleine Hex-Zeichen, ohne Bindestriche.
    pub uuid: String,
}

impl AccountProfile {
    /// `uuid` darf die Bindestrich-Schreibweise des Kontenspeichers haben.
    pub fn new(name: &str, uuid: &str) -> Self {
        Self {
            name: name.to_owned(),
            uuid: uuid.replace('-', "").to_lowercase(),
        }
    }
}

/// Empfängt die Streams und Steuernachrichten der Sitzungen (R5); der Dienst selbst kennt keine Sitzungen.
pub trait PeerStreamHandler: Send + Sync + 'static {
    /// Request-Stream nach dem Öffnungsrahmen `{"type":"request"}`; der Handler liest die Anfrage und antwortet selbst.
    fn on_request_stream<'a>(&'a self, peer: &'a PeerId, stream: BiStream) -> BoxFuture<'a, ()>;
    /// Tunnel-Stream nach `{"type":"tunnel","sessionId":…}`; der Handler antwortet mit `tunnelOk` oder `error`.
    fn on_tunnel_stream<'a>(
        &'a self,
        peer: &'a PeerId,
        session_id: String,
        stream: BiStream,
    ) -> BoxFuture<'a, ()>;
    /// Steuernachrichten `invite`, `inviteRevoke`, `inviteDecline` (schon größengeprüft und bereinigt).
    fn on_control_message<'a>(
        &'a self,
        peer: &'a PeerId,
        message: SessionControl,
    ) -> BoxFuture<'a, ()>;
}

/// Was mit den Endpunkten gleich geschieht; Abonnenten räumen davor ihre Sitzungen ab.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Lifecycle {
    Disabled,
    Rebind,
    IdentityChanged,
    Shutdown,
}

/// Ein Lebenszyklus-Ereignis; `done` senden oder fallen lassen, sobald das eigene Aufräumen fertig ist.
#[derive(Debug)]
pub struct LifecycleEvent {
    pub kind: Lifecycle,
    pub done: oneshot::Sender<()>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, thiserror::Error)]
#[error("ein Stream-Handler ist schon registriert")]
pub struct HandlerAlreadySet;

#[derive(Debug, Clone, Copy, PartialEq, Eq, thiserror::Error)]
#[error("keine Verbindung zu diesem Freund")]
pub struct NotConnected;

/// Der Freunde-Dienst; billig zu klonen.
#[derive(Clone)]
pub struct Friends {
    pub(super) core: Arc<Core>,
}

/// Zustand des Dienstes über alle Aktivierungen hinweg.
pub(super) struct Core {
    dir: PathBuf,
    pub(super) secrets: Arc<dyn SecretStore>,
    pub(super) options: NetOptions,
    pub(super) stores: RecordStores,
    pub(super) links: Links,
    pub(super) patches: Patches,
    bridge: ModBridge,
    config: Mutex<FriendsConfig>,
    availability: Mutex<Availability>,
    identity: Mutex<Option<Identity>>,
    account: Mutex<Option<AccountProfile>>,
    events: RwLock<Arc<dyn EventSink>>,
    handler: OnceLock<Arc<dyn PeerStreamHandler>>,
    lifecycle: Mutex<Vec<mpsc::Sender<LifecycleEvent>>>,
    network: Mutex<NetworkStatus>,
    runtime: Mutex<Option<Arc<Runtime>>>,
    /// Aktivieren, Abschalten, Neu-Binden und Identitätswechsel laufen nacheinander.
    transitions: tokio::sync::Mutex<()>,
    signals: Mutex<Option<broadcast::Receiver<GameSignal>>>,
    /// Worker, Mojang und Konto für Freunde per Name; fehlt in Builds ohne Verzeichnis (BYNAME 9.1).
    pub(super) directory: OnceLock<DirectoryDeps>,
    pub(super) by_name: DirectoryClient,
}

/// Was nur lebt, solange die Funktion aktiv ist und der Haupt-Endpunkt gebunden.
pub(super) struct Runtime {
    pub(super) identity: Identity,
    pub(super) main: Arc<PeerNet>,
    /// Hello-Endpunkte je Code-ID.
    pub(super) hellos: Mutex<HashMap<String, Arc<PeerNet>>>,
    pub(super) scheduler: Arc<Scheduler>,
    /// Beendet alle Aufgaben dieser Aktivierung.
    pub(super) stop: CancellationToken,
}

impl Friends {
    /// Lädt Einstellungen und Datensätze; bindet nichts und fragt den Schlüsselbund erst in [`Friends::start`].
    pub fn new(
        dirs: &Dirs,
        secrets: Arc<dyn SecretStore>,
        signals: GameSignals,
        bridge: ModBridge,
        net: NetOptions,
    ) -> AppResult<Self> {
        let dir = friends_dir(dirs);
        let core = Core {
            stores: RecordStores::open(&dir)?,
            config: Mutex::new(FriendsConfig::load(&dir)?),
            dir,
            secrets,
            options: net,
            links: Links::default(),
            patches: Patches::default(),
            bridge,
            availability: Mutex::new(Availability::Available),
            identity: Mutex::new(None),
            account: Mutex::new(None),
            events: RwLock::new(Arc::new(NoEvents)),
            handler: OnceLock::new(),
            lifecycle: Mutex::new(Vec::new()),
            network: Mutex::new(NetworkStatus::Off),
            runtime: Mutex::new(None),
            transitions: tokio::sync::Mutex::new(()),
            signals: Mutex::new(Some(signals.subscribe())),
            directory: OnceLock::new(),
            by_name: DirectoryClient::default(),
        };
        Ok(Self {
            core: Arc::new(core),
        })
    }

    /// Beim App-Start: Empfänger der Ereignisse setzen, Verfügbarkeit prüfen, Abgelaufenes aufräumen und die Funktion
    /// starten, wenn sie aktiviert ist.
    pub async fn start(&self, events: Arc<dyn EventSink>, account: Option<AccountProfile>) {
        let core = &self.core;
        *core
            .events
            .write()
            .unwrap_or_else(|poisoned| poisoned.into_inner()) = events;
        *lock(&core.account) = account;
        if let Some(signals) = lock(&core.signals).take() {
            status::spawn_signal_consumer(core, signals);
        }
        let _transition = core.transitions.lock().await;
        requests::prune_expired(core);
        core.refresh_availability();
        core.bridge.set_friends_enabled(core.config().enabled);
        if core.config().enabled {
            core.activate().await;
        }
    }

    /// Beim Beenden der App: Abonnenten räumen ab, dann gehen alle Verbindungen mit `SHUTDOWN` zu.
    pub async fn shutdown(&self) {
        let _transition = self.core.transitions.lock().await;
        self.core.deactivate(Lifecycle::Shutdown).await;
    }

    pub fn state(&self) -> FriendsState {
        self.core.state()
    }

    pub async fn enable(
        &self,
        input: FriendsEnableInput,
        account: Option<AccountProfile>,
    ) -> AppResult<FriendsState> {
        let core = &self.core;
        let _transition = core.transitions.lock().await;
        core.refresh_availability();
        core.ensure_available()?;
        let account =
            account.ok_or_else(|| AppError::invalid(coded!("errors.friends.msAccountRequired")))?;
        ensure_relay_consent(&core.options.relay_map, input.accept_third_party_relays)?;
        if core.identity().is_none() {
            core.set_identity(identity::create(&*core.secrets)?);
        }
        *lock(&core.account) = Some(account);
        core.update_config(|config| {
            config.enabled = true;
            config.third_party_relays_accepted = input.accept_third_party_relays;
        })?;
        core.bridge.set_friends_enabled(true);
        let kept = core.config().settings;
        let settings = FriendsSettings {
            always_relay: input.always_relay,
            findable_by_name: input.findable_by_name,
            ..kept
        };
        core.apply_settings(settings).await?;
        core.activate().await;
        core.emit(FriendsEvent::Changed);
        Ok(core.state())
    }

    /// Die Microsoft-Konten haben sich geändert (Anmelden, Entfernen): verbundene Freunde bekommen das neue Profil,
    /// wenn sich das angekündigte Konto geändert hat (SPEC 4.1), und das Verzeichnis erfährt den Wechsel (BYNAME 7.5).
    pub fn update_account(&self, account: Option<AccountProfile>) {
        let core = &self.core;
        let (changed, same_uuid) = {
            let mut current = lock(&core.account);
            let previous = current.clone();
            let changed = previous != account;
            let same_uuid = previous.as_ref().map(|account| account.uuid.as_str())
                == account.as_ref().map(|account| account.uuid.as_str());
            *current = account;
            (changed, same_uuid)
        };
        if !changed {
            return;
        }
        core.links.broadcast_profile(core.own_profile());
        // Eine Umbenennung behält die Verzeichnungs-Anmeldung derselben UUID; nur ein gewechseltes Konto verliert sie (BYNAME 7.5).
        if !same_uuid {
            by_name::account_changed(core);
        }
        core.emit(FriendsEvent::Changed);
    }

    /// Schaltet ab und behält alle Daten.
    pub async fn disable(&self) -> AppResult<FriendsState> {
        let core = &self.core;
        let _transition = core.transitions.lock().await;
        core.ensure_available()?;
        core.update_config(|config| config.enabled = false)?;
        core.bridge.set_friends_enabled(false);
        core.deactivate(Lifecycle::Disabled).await;
        by_name::leave_directory(core).await;
        core.set_network(NetworkStatus::Off);
        core.emit(FriendsEvent::Changed);
        Ok(core.state())
    }

    /// „Immer über Relay“ bindet neu und beendet Sitzungen.
    pub async fn update_settings(&self, settings: FriendsSettings) -> AppResult<FriendsState> {
        let core = &self.core;
        let _transition = core.transitions.lock().await;
        let previous = core.config().settings;
        if previous.always_relay != settings.always_relay || previous.findable_by_name != settings.findable_by_name {
            core.ensure_available()?;
        }
        core.apply_settings(settings).await?;
        core.emit(FriendsEvent::Changed);
        Ok(core.state())
    }

    /// Neuer Schlüssel (SPEC 4.6): Freunde erfahren ihn über den Postausgang; Codes und an die alte ID gebundene
    /// Anfragen verfallen.
    pub async fn rotate_identity(&self) -> AppResult<FriendsState> {
        let core = &self.core;
        let _transition = core.transitions.lock().await;
        core.ensure_enabled()?;
        core.bridge.set_friends_enabled(false);
        core.deactivate(Lifecycle::IdentityChanged).await;
        let rotated = core.rotate_records();
        core.bridge.set_friends_enabled(core.config().enabled);
        core.activate().await;
        rotated?;
        core.emit(FriendsEvent::Changed);
        Ok(core.state())
    }

    /// Alle Freunde und Daten weg, neue Identität (SPEC 4.6); geht auch bei verlorener Identität.
    pub async fn reset(&self) -> AppResult<FriendsState> {
        let core = &self.core;
        let _transition = core.transitions.lock().await;
        core.refresh_availability();
        if *lock(&core.availability) == Availability::NoSecretStore {
            return Err(AppError::invalid(coded!("errors.friends.unavailable")));
        }
        core.bridge.set_friends_enabled(false);
        core.deactivate(Lifecycle::IdentityChanged).await;
        let reset = core.reset_records();
        core.bridge.set_friends_enabled(core.config().enabled);
        core.activate().await;
        reset?;
        core.emit(FriendsEvent::Changed);
        Ok(core.state())
    }

    /// Genau einmal möglich.
    pub fn register_stream_handler(
        &self,
        handler: Arc<dyn PeerStreamHandler>,
    ) -> Result<(), HandlerAlreadySet> {
        self.core
            .handler
            .set(handler)
            .map_err(|_| HandlerAlreadySet)
    }

    /// Jeder Abonnent bekommt jedes Ereignis.
    pub fn subscribe_lifecycle(&self) -> mpsc::Receiver<LifecycleEvent> {
        let (sender, receiver) = mpsc::channel(LIFECYCLE_QUEUE);
        lock(&self.core.lifecycle).push(sender);
        receiver
    }

    /// Schickt eine Sitzungs-Steuernachricht über die bestehende Verbindung; eine verstopfte gilt als nicht verbunden.
    pub fn send_control(&self, peer: &PeerId, message: SessionControl) -> Result<(), NotConnected> {
        self.core.links.send(peer, message.into())
    }

    pub fn connection(&self, peer: &PeerId) -> Option<PeerConn> {
        self.core.links.conn(peer)
    }

    /// Die bestehende Verbindung oder eine neu angewählte (mit Steuer-Stream).
    pub async fn dial_friend(&self, peer: &PeerId) -> Result<PeerConn, NetError> {
        if let Some(conn) = self.connection(peer) {
            return Ok(conn);
        }
        let runtime = self.core.runtime().ok_or(NetError::Unreachable)?;
        status::connect_friend(&self.core, &runtime, *peer).await
    }
}

impl Core {
    pub(super) fn state(&self) -> FriendsState {
        let config = self.config();
        let me = self.identity().map(|identity| {
            let peer_id = identity.peer_id();
            Me {
                fingerprint: identity::fingerprint(&peer_id),
                peer_id,
                display_name: self.own_profile().display_name,
            }
        });
        FriendsState {
            availability: *lock(&self.availability),
            enabled: config.enabled,
            me,
            settings: config.settings,
            network: lock(&self.network).clone(),
            relays: relay_infos(&self.options.relay_map),
            third_party_relays_accepted: config.third_party_relays_accepted,
            directory: by_name::directory_status(self),
        }
    }

    pub(super) fn ensure_available(&self) -> AppResult<()> {
        match *lock(&self.availability) {
            Availability::Available => Ok(()),
            Availability::NoSecretStore => {
                Err(AppError::invalid(coded!("errors.friends.unavailable")))
            }
            Availability::IdentityLost => {
                Err(AppError::invalid(coded!("errors.friends.identityLost")))
            }
        }
    }

    pub(super) fn ensure_enabled(&self) -> AppResult<()> {
        self.ensure_available()?;
        if self.config().enabled {
            Ok(())
        } else {
            Err(AppError::invalid(coded!("errors.friends.disabled")))
        }
    }

    pub(super) fn config(&self) -> FriendsConfig {
        lock(&self.config).clone()
    }

    pub(super) fn identity(&self) -> Option<Identity> {
        lock(&self.identity).clone()
    }

    pub(super) fn runtime(&self) -> Option<Arc<Runtime>> {
        lock(&self.runtime).clone()
    }

    pub(super) fn handler(&self) -> Option<Arc<dyn PeerStreamHandler>> {
        self.handler.get().cloned()
    }

    pub(super) fn emit(&self, event: FriendsEvent) {
        self.events
            .read()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .emit(event);
    }

    pub(super) fn set_network(&self, status: NetworkStatus) {
        let changed = {
            let mut network = lock(&self.network);
            let changed = *network != status;
            *network = status.clone();
            changed
        };
        if changed {
            self.emit(FriendsEvent::Network(status));
        }
    }

    /// Das Profil, das Freunde in `hello` und `profile` bekommen.
    pub(super) fn own_profile(&self) -> WireProfile {
        let account = lock(&self.account);
        let mc_name = sanitize::mc_name(account.as_ref().map(|account| account.name.as_str()));
        WireProfile {
            display_name: mc_name.clone().unwrap_or_default(),
            mc_name,
            mc_uuid: sanitize::mc_uuid(account.as_ref().map(|account| account.uuid.as_str())),
        }
    }

    /// UUID des ersten Microsoft-Kontos, 32 Hex-Zeichen.
    pub(super) fn account_uuid(&self) -> Option<String> {
        lock(&self.account)
            .as_ref()
            .map(|account| account.uuid.clone())
    }

    /// Dauer der Freundschaftsanfragen und der unbestätigten Freunde.
    pub(super) fn request_deadline(&self) -> u64 {
        now_secs() + REQUEST_TTL_SECS
    }

    fn set_identity(&self, identity: Identity) {
        *lock(&self.identity) = Some(identity);
    }

    pub(super) fn update_config(&self, change: impl FnOnce(&mut FriendsConfig)) -> AppResult<()> {
        let mut config = lock(&self.config);
        change(&mut config);
        config.save(&self.dir)
    }

    /// Fragt den Schlüsselbund (SPEC 4.1) und lädt die Identität, wenn sie verfügbar ist.
    fn refresh_availability(&self) {
        let has_friends_data = self.config().enabled || self.stores.any();
        let availability = identity::availability(&*self.secrets, has_friends_data);
        let loaded = match availability {
            Availability::Available => identity::load(&*self.secrets).unwrap_or_default(),
            Availability::NoSecretStore | Availability::IdentityLost => None,
        };
        *lock(&self.availability) = availability;
        *lock(&self.identity) = loaded;
    }

    /// Die Datensätze zum neuen Schlüssel; erst nach dem Abbau der alten Endpunkte, sonst stellte der alte Postausgang
    /// schon zu, während die alten Verbindungen noch offen sind.
    fn rotate_records(&self) -> AppResult<()> {
        let Renewal { retired, current } = identity::renew(&*self.secrets)?;
        let old =
            retired.ok_or_else(|| AppError::invalid(coded!("errors.friends.identityLost")))?;
        self.set_identity(current.clone());
        by_name::forget_session(self);
        outbox::replace_with_rotation(self, &old, &current)?;
        by_name::retract_own_letters(self);
        hello::delete_all_codes(self)?;
        requests::drop_requests_bound_to_old_id(self)
    }

    /// Mit altem Schlüssel erfahren die Freunde das Ende; ohne (verlorene Identität) gibt es niemanden zu
    /// benachrichtigen.
    fn reset_records(&self) -> AppResult<()> {
        if self.identity().is_some() {
            outbox::replace_with_unfriend(self)?;
        }
        let Renewal { current, .. } = identity::renew(&*self.secrets)?;
        self.set_identity(current);
        by_name::forget_session(self);
        requests::delete_all_records(self)?;
        *lock(&self.availability) = Availability::Available;
        Ok(())
    }

    async fn apply_settings(self: &Arc<Self>, settings: FriendsSettings) -> AppResult<()> {
        let previous = self.config().settings;
        self.update_config(|config| config.settings = settings.clone())?;
        if previous.findable_by_name != settings.findable_by_name {
            by_name::findability_changed(self, settings.findable_by_name);
        }
        if previous.always_relay != settings.always_relay && self.runtime().is_some() {
            self.restart(Lifecycle::Rebind).await;
        }
        Ok(())
    }

    /// Startet die Endpunkte, wenn die Funktion an ist und eine Identität hat; ein Bindefehler zeigt sich nur im
    /// Netzwerkstatus.
    async fn activate(self: &Arc<Self>) {
        if self.runtime().is_some() || !self.config().enabled {
            return;
        }
        let Some(identity) = self.identity() else {
            return;
        };
        let config = main_net_config(
            &self.options,
            &identity,
            self.config().settings.always_relay,
        );
        let gate = Arc::new(MainGate {
            core: Arc::downgrade(self),
        });
        let main = match PeerNet::bind(config, gate).await {
            Ok(main) => Arc::new(main),
            Err(err) => {
                tracing::warn!(%err, "Freunde-Endpunkt nicht gebunden");
                self.set_network(NetworkStatus::Degraded {
                    reason: DegradedReason::BindFailed,
                });
                return;
            }
        };
        self.set_network(NetworkStatus::Starting);
        let stop = CancellationToken::new();
        let runtime = Arc::new(Runtime {
            identity,
            main,
            hellos: Mutex::new(HashMap::new()),
            scheduler: Arc::new(Scheduler::new(stop.child_token())),
            stop,
        });
        *lock(&self.runtime) = Some(runtime.clone());
        status::spawn_presence(self, &runtime);
        hello::bind_active_codes(self, &runtime).await;
        requests::spawn_hourly_prune(self, &runtime);
        outbox::spawn_delivery(self, &runtime);
        by_name::spawn_directory_loop(self, &runtime.stop);
    }

    /// Meldet `kind` an alle Abonnenten, wartet auf sie und schließt erst dann die Endpunkte (SPEC 8.7).
    async fn deactivate(&self, kind: Lifecycle) {
        self.deliver_lifecycle(kind).await;
        let Some(runtime) = lock(&self.runtime).take() else {
            return;
        };
        // Sonst wählte der Zeitplan die gleich als offline geltenden Freunde noch einmal an.
        runtime.scheduler.halt();
        self.patches.flush(&self.stores);
        let links = status::take_all_links(self);
        if !links.is_empty() {
            tokio::time::sleep(FLUSH_GRACE).await;
        }
        // Erst schließen, dann die Aufgaben abbrechen: ein abgebrochener Leser beendete den Steuer-Stream, und der
        // Freund schlösse dann selbst, bevor ihn `SHUTDOWN` erreicht.
        runtime.main.close(CloseCode::SHUTDOWN).await;
        hello::close_all(&runtime).await;
        runtime.stop.cancel();
        self.patches.flush(&self.stores);
    }

    async fn restart(self: &Arc<Self>, kind: Lifecycle) {
        self.deactivate(kind).await;
        self.activate().await;
    }

    async fn deliver_lifecycle(&self, kind: Lifecycle) {
        let subscribers = lock(&self.lifecycle).clone();
        let deliver = async {
            let mut finished = Vec::new();
            for subscriber in subscribers {
                let (done, finish) = oneshot::channel();
                if subscriber.send(LifecycleEvent { kind, done }).await.is_ok() {
                    finished.push(finish);
                }
            }
            futures::future::join_all(finished).await;
        };
        if tokio::time::timeout(LIFECYCLE_WAIT, deliver).await.is_err() {
            tracing::warn!(
                ?kind,
                "Lebenszyklus-Abonnent hat nicht rechtzeitig aufgeräumt"
            );
        }
        lock(&self.lifecycle).retain(|subscriber| !subscriber.is_closed());
    }
}

/// Lässt auf `pumpkin/peer/1` nur Freunde (nicht gesperrt) und Peers zu, auf deren Antwort eine eigene Anfrage
/// wartet (SPEC 3.5); alle anderen sehen `NOT_FRIEND`.
struct MainGate {
    core: Weak<Core>,
}

impl Gate for MainGate {
    fn admit(&self, peer: &PeerId, alpn: &[u8]) -> Admission {
        let Some(core) = self.core.upgrade() else {
            return Admission::Reject(CloseCode::SHUTDOWN);
        };
        if alpn == PEER_ALPN && requests::may_connect(&core, &peer.to_string()) {
            Admission::Accept
        } else {
            Admission::Reject(CloseCode::NOT_FRIEND)
        }
    }
}

pub(super) fn main_net_config(
    options: &NetOptions,
    identity: &Identity,
    always_relay: bool,
) -> NetConfig {
    NetConfig {
        secret: identity.secret_bytes(),
        alpns: vec![PEER_ALPN],
        relay_map: options.relay_map.clone(),
        relays: RelaySelection::All,
        relay_only: always_relay,
        relay_tls: options.relay_tls,
        idle_timeout: options.idle_timeout,
    }
}

/// Ein Hello-Endpunkt hört nur am Relay seines Codes und hat (in Produktion) keine IP-Transporte (SPEC 3.3).
pub(super) fn hello_net_config(
    options: &NetOptions,
    identity: &Identity,
    salt: &[u8; 16],
    relay_index: u8,
) -> NetConfig {
    NetConfig {
        secret: identity.hello_secret(salt),
        alpns: vec![hello::HELLO_ALPN],
        relay_map: options.relay_map.clone(),
        relays: RelaySelection::Only(relay_index),
        relay_only: options.hello_relay_only,
        relay_tls: options.relay_tls,
        idle_timeout: options.idle_timeout,
    }
}

/// Der Endpunkt des ausgemusterten Schlüssels wählt nur an, immer über ein Relay.
pub(super) fn retired_net_config(options: &NetOptions, retired: &Identity) -> NetConfig {
    NetConfig {
        secret: retired.secret_bytes(),
        alpns: Vec::new(),
        relay_map: options.relay_map.clone(),
        relays: RelaySelection::All,
        relay_only: true,
        relay_tls: options.relay_tls,
        idle_timeout: options.idle_timeout,
    }
}

pub(super) fn now_secs() -> u64 {
    now_ms() / 1000
}

/// Host eines Relays für die Anzeige, ohne den abschließenden Punkt der voll qualifizierten Namen.
pub(super) fn relay_host(entry: &RelayEntry) -> String {
    let host = reqwest::Url::parse(&entry.url)
        .ok()
        .and_then(|url| url.host_str().map(str::to_owned));
    host.unwrap_or_else(|| entry.url.to_string())
        .trim_end_matches('.')
        .to_owned()
}

fn relay_infos(map: &[RelayEntry]) -> Vec<RelayInfo> {
    map.iter()
        .map(|entry| RelayInfo {
            host: relay_host(entry),
            operator: match entry.operator {
                RelayOperator::Pumpkin => RelayOperatorKind::Pumpkin,
                RelayOperator::N0 => RelayOperatorKind::N0,
            },
            third_party: entry.operator == RelayOperator::N0,
        })
        .collect()
}

/// Relays eines Dritten (n0) brauchen die ausdrückliche Zustimmung (SPEC 3.2).
fn ensure_relay_consent(map: &[RelayEntry], accepted: bool) -> AppResult<()> {
    if accepted || map.iter().all(|entry| entry.operator != RelayOperator::N0) {
        Ok(())
    } else {
        Err(AppError::invalid(coded!(
            "errors.friends.relayConsentRequired"
        )))
    }
}

#[cfg(test)]
mod tests {
    use std::borrow::Cow;

    use super::super::code;
    use super::*;

    fn entry(index: u8, url: &'static str, operator: RelayOperator) -> RelayEntry {
        RelayEntry {
            index,
            url: Cow::Borrowed(url),
            operator,
            quic_port: Some(7842),
        }
    }

    #[test]
    fn production_hello_endpoint_is_relay_only_at_the_code_relay() {
        let identity = Identity::generate();
        let issued = code::issue(&identity, 202).unwrap();

        let config = hello_net_config(
            &NetOptions::production(),
            &identity,
            &issued.salt,
            issued.parts.relay_index,
        );

        assert!(config.relay_only);
        assert_eq!(config.relays, RelaySelection::Only(202));
        assert_eq!(config.secret, identity.hello_secret(&issued.salt));
        assert_eq!(config.alpns, [hello::HELLO_ALPN]);
        assert_eq!(config.relay_tls, RelayTls::Verify);
        assert_eq!(config.idle_timeout, Duration::from_secs(40));
    }

    #[test]
    fn main_endpoint_uses_the_whole_map_and_always_relay_drops_ip_transports() {
        let identity = Identity::generate();

        let direct = main_net_config(&NetOptions::production(), &identity, false);
        let relayed = main_net_config(&NetOptions::production(), &identity, true);

        assert_eq!(
            (direct.relays, direct.relay_only, relayed.relay_only),
            (RelaySelection::All, false, true)
        );
        assert_eq!(direct.secret, identity.secret_bytes());
        assert_eq!(direct.relay_map.len(), RELAY_MAP.len());
    }

    #[test]
    fn retired_endpoint_only_dials_through_relays() {
        let config = retired_net_config(&NetOptions::production(), &Identity::generate());

        assert!(config.alpns.is_empty());
        assert!(config.relay_only);
    }

    #[test]
    fn third_party_relays_need_consent() {
        let ours = [entry(
            0,
            "https://relay-eu1.example.org/",
            RelayOperator::Pumpkin,
        )];
        let with_n0 = [
            ours[0].clone(),
            entry(
                200,
                "https://use1-1.relay.n0.iroh.link./",
                RelayOperator::N0,
            ),
        ];

        assert!(ensure_relay_consent(&ours, false).is_ok());
        assert!(ensure_relay_consent(&with_n0, true).is_ok());
        assert!(ensure_relay_consent(&with_n0, false).is_err());
    }

    #[test]
    fn relay_host_drops_the_trailing_dot() {
        let n0 = entry(
            200,
            "https://use1-1.relay.n0.iroh.link./",
            RelayOperator::N0,
        );

        assert_eq!(relay_host(&n0), "use1-1.relay.n0.iroh.link");
    }

    #[test]
    fn account_uuid_loses_its_hyphens() {
        let account = AccountProfile::new("Alex", "069A79F4-44E9-4726-A5BE-FCA90E38AAF5");

        assert_eq!(account.uuid, "069a79f444e94726a5befca90e38aaf5");
    }
}
