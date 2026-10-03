//! Präsenz (SPEC 4.4, 4.5): die Verbindungen zu Freunden, der eigene Status, das Anwählen nach Zeitplan (eifrig mit
//! Backoff, träge stündlich), der Netzwerkstatus und die Befehle rund um die Freundesliste.
use std::collections::{HashMap, HashSet};
use std::str::FromStr;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use futures::future::BoxFuture;
use tokio::sync::{broadcast, mpsc, watch, Notify, Semaphore};
use tokio::time::{Instant, MissedTickBehavior};
use tokio_util::sync::CancellationToken;

use super::contract::{
    BlockedPeer, DegradedReason, Friend, FriendNotice, FriendPresenceEvent, NetworkStatus, PathKind, Presence,
};
use super::control::{self, ControlMessage, WireProfile, PEER_ALPN};
use super::events::FriendsEvent;
use super::identity::fingerprint;
use super::limits::{Attempts, SlidingWindow, LINK_REPLACEMENTS, REQUEST_STREAMS};
use super::records::{BlockedRecord, FriendRecord, OutboxKind, RecordStores};
use super::service::{now_secs, relay_host, Core, Friends, NotConnected, Runtime};
use super::{requests, sanitize};
use crate::coded;
use crate::error::{AppError, AppResult};
use crate::services::gamesignal::GameSignal;
use crate::services::lock;
use crate::services::p2p::{find_relay, CloseCode, CloseReason, NetError, NetState, PeerConn, PeerId, RelayEntry};

/// Höchstens so viele Anwahlversuche laufen zugleich; weitere warten.
const MAX_CONCURRENT_DIALS: usize = 4;
const TICK: Duration = Duration::from_secs(1);
/// Freunde, die länger nicht online waren, werden einmal kurz nach dem Start und dann stündlich angewählt.
const FIRST_LAZY_ROUND: Duration = Duration::from_secs(60);
const LAZY_INTERVAL: Duration = Duration::from_secs(3600);
/// Wer in dieser Zeit online war, wird mit Backoff angewählt statt nur stündlich.
const RECENTLY_SEEN_SECS: u64 = 7 * 24 * 3600;
/// `friends_retry_now` überspringt Anfragen, deren Versuch jünger ist, und Freunde, deren Versuch jünger ist.
const RETRY_REQUEST_GAP: Duration = Duration::from_secs(10);
const RETRY_FRIEND_GAP: Duration = Duration::from_secs(120);
/// Höchstens ein Schreiben von `friends.json` für Profil und „zuletzt online“ je Intervall.
const PATCH_FLUSH_INTERVAL: Duration = Duration::from_secs(5);

/// Die Verbindungen zu Freunden, je Peer höchstens eine, und der eigene Status.
pub(super) struct Links {
    links: Mutex<HashMap<PeerId, Link>>,
    next_id: AtomicU64,
    own: Mutex<OwnPresence>,
    /// Je Freund über alle seine Verbindungen hinweg: ein neues Verbinden setzt die Grenzen nicht zurück.
    request_streams: Mutex<SlidingWindow<PeerId>>,
    replacements: Mutex<SlidingWindow<PeerId>>,
}

impl Default for Links {
    fn default() -> Self {
        Self {
            links: Mutex::default(),
            next_id: AtomicU64::default(),
            own: Mutex::default(),
            request_streams: Mutex::new(SlidingWindow::new(REQUEST_STREAMS)),
            replacements: Mutex::new(SlidingWindow::new(LINK_REPLACEMENTS)),
        }
    }
}

#[derive(Default)]
struct OwnPresence {
    playing: bool,
}

/// Eine Verbindung mit laufendem Steuer-Stream.
#[derive(Clone)]
pub(super) struct Link {
    pub(super) id: u64,
    pub(super) conn: PeerConn,
    sender: mpsc::Sender<ControlMessage>,
    /// Meldet das `ack` des Peers auf ein `unfriend` oder `identityRotated`.
    pub(super) acked: Arc<Notify>,
    presence: Presence,
    path: Option<PathKind>,
}

/// Was beim Eintragen einer Verbindung geschah.
pub(super) enum Registration {
    /// Eingetragen; eine ersetzte Verbindung zu demselben Peer muss geschlossen werden.
    Kept { replaced: Option<Link> },
    /// Eine bestehende Verbindung bleibt nach der Regel für doppelte Verbindungen (SPEC 4.4).
    Duplicate,
    /// Der Peer ersetzt seine Verbindung zu oft; die eingetragene bleibt.
    TooFrequent,
}

impl Link {
    /// Reiht eine Steuernachricht ein; eine volle Warteschlange gilt als nicht verbunden.
    pub(super) fn send(&self, message: ControlMessage) -> Result<(), NotConnected> {
        self.sender.try_send(message).map_err(|_| NotConnected)
    }

    pub(super) fn state(&self) -> (Presence, Option<PathKind>) {
        (self.presence, self.path)
    }
}

impl Links {
    pub(super) fn new_link(&self, conn: PeerConn, sender: mpsc::Sender<ControlMessage>) -> Link {
        let id = self.next_id.fetch_add(1, Ordering::Relaxed);
        let path = conn.path();
        Link { id, conn, sender, acked: Arc::new(Notify::new()), presence: Presence::Online, path }
    }

    /// Bei zwei Verbindungen zu demselben Peer bleibt die, die der Peer mit der kleineren ID angewählt hat; zwei in
    /// derselben Richtung ersetzt die neuere, denn die ältere ist dann meist schon tot. Ersetzen ist begrenzt
    /// (`LINK_REPLACEMENTS`), damit ständiges Neuverbinden nicht zur Last wird.
    pub(super) fn register(&self, local: &PeerId, link: Link) -> Registration {
        let peer = link.conn.remote();
        let mut links = lock(&self.links);
        let Some(existing) = links.get(&peer) else {
            links.insert(peer, link);
            return Registration::Kept { replaced: None };
        };
        if existing.conn.direction() != link.conn.direction()
            && link.conn.direction() != crate::services::p2p::duplicate_survivor(local, &peer)
        {
            return Registration::Duplicate;
        }
        if !lock(&self.replacements).try_hit(peer, Instant::now()) {
            return Registration::TooFrequent;
        }
        Registration::Kept { replaced: links.insert(peer, link) }
    }

    /// Zählt einen Request-Stream des Freundes; `false` über der Grenze von SPEC 12.4.
    pub(super) fn admit_request_stream(&self, peer: &PeerId) -> bool {
        lock(&self.request_streams).try_hit(*peer, Instant::now())
    }

    /// Entfernt die Verbindung nur, wenn sie noch die eingetragene ist.
    pub(super) fn remove(&self, peer: &PeerId, id: u64) -> bool {
        let mut links = lock(&self.links);
        let current = links.get(peer).is_some_and(|link| link.id == id);
        if current {
            links.remove(peer);
        }
        current
    }

    pub(super) fn take(&self, peer: &PeerId) -> Option<Link> {
        lock(&self.links).remove(peer)
    }

    pub(super) fn get(&self, peer: &PeerId) -> Option<Link> {
        lock(&self.links).get(peer).cloned()
    }

    pub(super) fn conn(&self, peer: &PeerId) -> Option<PeerConn> {
        self.get(peer).map(|link| link.conn)
    }

    pub(super) fn send(&self, peer: &PeerId, message: ControlMessage) -> Result<(), NotConnected> {
        self.get(peer).ok_or(NotConnected)?.send(message)
    }

    pub(super) fn broadcast_profile(&self, profile: WireProfile) {
        self.broadcast(&ControlMessage::Profile { profile });
    }

    pub(super) fn own_presence(&self) -> Presence {
        if lock(&self.own).playing {
            Presence::Playing
        } else {
            Presence::Online
        }
    }

    /// Ein laufendes Spiel macht aus „online“ „spielt“; Freunde erfahren nur Änderungen.
    fn set_playing(&self, playing: bool) {
        let changed = std::mem::replace(&mut lock(&self.own).playing, playing) != playing;
        if changed {
            self.broadcast(&ControlMessage::Status { presence: self.own_presence() });
        }
    }

    /// Präsenz und Weg eines Peers ändern; `Some` mit dem neuen Stand, wenn sich etwas geändert hat.
    pub(super) fn update(
        &self,
        peer: &PeerId,
        id: u64,
        change: impl FnOnce(&mut Presence, &mut Option<PathKind>),
    ) -> Option<(Presence, Option<PathKind>)> {
        let mut links = lock(&self.links);
        let link = links.get_mut(peer).filter(|link| link.id == id)?;
        let before = (link.presence, link.path);
        change(&mut link.presence, &mut link.path);
        let after = (link.presence, link.path);
        (before != after).then_some(after)
    }

    pub(super) fn view(&self, peer: &PeerId) -> (Presence, Option<PathKind>) {
        lock(&self.links).get(peer).map_or((Presence::Offline, None), |link| (link.presence, link.path))
    }

    fn broadcast(&self, message: &ControlMessage) {
        for link in lock(&self.links).values() {
            if link.sender.try_send(message.clone()).is_err() {
                tracing::debug!(peer = %link.conn.remote().short(), "Steuernachricht nicht eingereiht");
            }
        }
    }

    fn drain(&self) -> Vec<(PeerId, Link)> {
        lock(&self.links).drain().collect()
    }

    fn connected(&self) -> HashSet<PeerId> {
        lock(&self.links).keys().copied().collect()
    }
}

/// Profil- und „zuletzt online“-Änderungen der Freunde, gesammelt und höchstens alle 5 s geschrieben (SPEC 4.4).
#[derive(Default)]
pub(super) struct Patches {
    pending: Mutex<HashMap<String, FriendPatch>>,
}

#[derive(Debug, Default, Clone)]
pub(super) struct FriendPatch {
    pub(super) last_seen: Option<u64>,
    pub(super) profile: Option<WireProfile>,
    pub(super) home_relay: Option<u8>,
    pub(super) notice: Option<FriendNotice>,
}

impl FriendPatch {
    fn merge(&mut self, newer: FriendPatch) {
        self.last_seen = newer.last_seen.or(self.last_seen);
        self.profile = newer.profile.or(self.profile.take());
        self.home_relay = newer.home_relay.or(self.home_relay);
        self.notice = newer.notice.or(self.notice.take());
    }

    fn apply(&self, record: &mut FriendRecord) {
        if let Some(last_seen) = self.last_seen {
            record.last_seen = Some(last_seen);
        }
        if let Some(profile) = &self.profile {
            record.display_name.clone_from(&profile.display_name);
            record.mc_name.clone_from(&profile.mc_name);
            record.mc_uuid.clone_from(&profile.mc_uuid);
        }
        if let Some(home_relay) = self.home_relay {
            record.home_relay = Some(home_relay);
        }
        if let Some(notice) = &self.notice {
            record.notice = Some(notice.clone());
        }
    }
}

impl Patches {
    pub(super) fn add(&self, id: &str, patch: FriendPatch) {
        lock(&self.pending).entry(id.to_owned()).or_default().merge(patch);
    }

    /// Der Datensatz so, wie er nach dem nächsten Schreiben aussieht.
    pub(super) fn effective(&self, mut record: FriendRecord) -> FriendRecord {
        if let Some(patch) = lock(&self.pending).get(&record.id) {
            patch.apply(&mut record);
        }
        record
    }

    pub(super) fn forget(&self, id: &str) {
        lock(&self.pending).remove(id);
    }

    pub(super) fn flush(&self, stores: &RecordStores) {
        let pending = std::mem::take(&mut *lock(&self.pending));
        for (id, patch) in pending {
            if let Err(err) = stores.friends.modify(&id, |record| patch.apply(record)) {
                tracing::debug!(%err, "Änderung eines entfernten Freundes verworfen");
            }
        }
    }
}

/// Wen der Zeitplan anwählt: einen Freund auf `pumpkin/peer/1` oder den Code-Besitzer einer ausgehenden Anfrage.
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub(super) enum Target {
    Friend(PeerId),
    Request(String),
}

/// Was angewählt wird und wie; im Dienst über den Haupt-Endpunkt, in Tests über einen falschen `Dialer`.
pub(super) trait DialPlan: Send + Sync + 'static {
    /// Ziele, die nach dem Backoff von selbst wieder dran sind.
    fn eager(&self) -> Vec<Target>;
    /// Offline-Freunde, die nur in den trägen Runden angewählt werden.
    fn lazy(&self) -> Vec<Target>;
    /// Ein Versuch; `true`, wenn das Ziel erreicht wurde.
    fn attempt(&self, target: Target) -> BoxFuture<'static, bool>;
}

/// Wählt eifrige Ziele mit Backoff und träge Ziele stündlich an, höchstens vier zugleich (SPEC 4.3, 4.4).
pub(super) struct Scheduler {
    attempts: Mutex<Attempts<Target>>,
    slots: Arc<Semaphore>,
    stop: CancellationToken,
}

impl Scheduler {
    pub(super) fn new(stop: CancellationToken) -> Self {
        Self { attempts: Mutex::default(), slots: Arc::new(Semaphore::new(MAX_CONCURRENT_DIALS)), stop }
    }

    /// Läuft bis zum Abbruch. Nur online wird angewählt; jedes Online-Werden macht alle eifrigen Ziele sofort fällig.
    pub(super) async fn run(self: Arc<Self>, plan: Arc<dyn DialPlan>, mut online: watch::Receiver<bool>) {
        let mut next_lazy_round = Instant::now() + FIRST_LAZY_ROUND;
        let mut was_online = false;
        let mut ticks = tokio::time::interval(TICK);
        ticks.set_missed_tick_behavior(MissedTickBehavior::Delay);
        loop {
            ticks.tick().await;
            let is_online = *online.borrow_and_update();
            if is_online && !was_online {
                self.schedule_now(plan.eager());
            }
            was_online = is_online;
            if !is_online {
                continue;
            }
            let now = Instant::now();
            let mut due = lock(&self.attempts).due(plan.eager(), now);
            if now >= next_lazy_round {
                due.extend(lock(&self.attempts).idle_for(plan.lazy(), Duration::ZERO, now));
                next_lazy_round = now + LAZY_INTERVAL;
            }
            for target in due {
                self.spawn_attempt(&plan, target);
            }
        }
    }

    /// Anfragen sofort und mit frischem Backoff, Freunde, deren letzter Versuch über 2 min her ist (SPEC 4.3, 4.4).
    pub(super) fn retry_now(self: &Arc<Self>, plan: &Arc<dyn DialPlan>, requests: Vec<Target>, friends: Vec<Target>) {
        let now = Instant::now();
        let chosen = {
            let mut attempts = lock(&self.attempts);
            let mut chosen = attempts.idle_for(requests, RETRY_REQUEST_GAP, now);
            for target in &chosen {
                attempts.restart(target.clone());
            }
            chosen.extend(attempts.idle_for(friends, RETRY_FRIEND_GAP, now));
            chosen
        };
        for target in chosen {
            self.spawn_attempt(plan, target);
        }
    }

    /// Ein Versuch jetzt, wenn keiner läuft (neue Anfrage, gerade angenommener Freund).
    pub(super) fn dial_now(self: &Arc<Self>, plan: &Arc<dyn DialPlan>, target: Target) {
        let idle = lock(&self.attempts).idle_for([target], Duration::ZERO, Instant::now());
        for target in idle {
            self.spawn_attempt(plan, target);
        }
    }

    /// Hört auf anzuwählen; laufende Versuche brechen ab.
    pub(super) fn halt(&self) {
        self.stop.cancel();
    }

    /// Eine Verbindung kam zustande (auch eingehend): der Backoff beginnt von vorn.
    pub(super) fn connected(&self, target: &Target) {
        lock(&self.attempts).succeeded(target);
    }

    /// Nach dem Ende einer Verbindung wird das Ziel nach dem ersten Backoff-Schritt wieder angewählt.
    pub(super) fn disconnected(&self, target: Target) {
        let mut attempts = lock(&self.attempts);
        attempts.succeeded(&target);
        attempts.failed(target, Instant::now());
    }

    pub(super) fn forget(&self, target: &Target) {
        lock(&self.attempts).succeeded(target);
    }

    fn schedule_now(&self, targets: Vec<Target>) {
        let mut attempts = lock(&self.attempts);
        for target in targets {
            attempts.schedule_now(target);
        }
    }

    fn spawn_attempt(self: &Arc<Self>, plan: &Arc<dyn DialPlan>, target: Target) {
        lock(&self.attempts).begin(target.clone(), Instant::now());
        let (scheduler, plan) = (self.clone(), plan.clone());
        tokio::spawn(self.stop.clone().run_until_cancelled_owned(async move {
            let reached = match scheduler.slots.acquire().await {
                Ok(_slot) => plan.attempt(target.clone()).await,
                Err(_) => false,
            };
            let mut attempts = lock(&scheduler.attempts);
            if reached {
                attempts.succeeded(&target);
            } else {
                attempts.failed(target, Instant::now());
            }
        }));
    }
}

/// Der Zeitplan des Dienstes über den Haupt-Endpunkt dieser Aktivierung.
struct PresencePlan {
    core: Arc<Core>,
    runtime: Arc<Runtime>,
}

pub(super) fn presence_plan(core: &Arc<Core>, runtime: &Arc<Runtime>) -> Arc<dyn DialPlan> {
    Arc::new(PresencePlan { core: core.clone(), runtime: runtime.clone() })
}

impl DialPlan for PresencePlan {
    fn eager(&self) -> Vec<Target> {
        let now = now_secs();
        let mut targets = offline_friends(&self.core, |friend| is_eager(friend, now));
        targets.extend(requests::delivering(&self.core).into_iter().map(Target::Request));
        targets
    }

    fn lazy(&self) -> Vec<Target> {
        let now = now_secs();
        offline_friends(&self.core, |friend| !is_eager(friend, now))
    }

    fn attempt(&self, target: Target) -> BoxFuture<'static, bool> {
        let (core, runtime) = (self.core.clone(), self.runtime.clone());
        Box::pin(async move {
            match target {
                Target::Friend(peer) => connect_friend(&core, &runtime, peer).await.is_ok(),
                Target::Request(id) => requests::deliver(&core, &runtime, &id).await,
            }
        })
    }
}

/// Unbestätigte und kürzlich gesehene Freunde werden mit Backoff angewählt, alle anderen nur träge.
fn is_eager(friend: &FriendRecord, now: u64) -> bool {
    !friend.confirmed || friend.last_seen.is_some_and(|seen| now.saturating_sub(seen) <= RECENTLY_SEEN_SECS)
}

/// Offline-Freunde, die noch angewählt werden (nicht die, die uns entfernt haben).
pub(super) fn offline_friends(core: &Core, include: impl Fn(&FriendRecord) -> bool) -> Vec<Target> {
    let connected = core.links.connected();
    friends(core)
        .iter()
        .filter(|friend| !friend.removed_by_peer && include(friend))
        .filter_map(|friend| PeerId::from_str(&friend.id).ok())
        .filter(|peer| !connected.contains(peer))
        .map(Target::Friend)
        .collect()
}

/// Wählt einen Freund an und baut den Steuer-Stream auf; ein `NOT_FRIEND` heißt: er hat uns entfernt.
pub(super) async fn connect_friend(
    core: &Arc<Core>,
    runtime: &Arc<Runtime>,
    peer: PeerId,
) -> Result<PeerConn, NetError> {
    let conn = runtime.main.dial(&peer, PEER_ALPN).await?;
    match control::run_outgoing(core, runtime, conn.clone()).await {
        Ok(()) => Ok(conn),
        Err(err) => {
            tracing::debug!(peer = %peer.short(), %err, "Steuer-Stream nicht aufgebaut");
            let reason = conn.closed().await;
            notice_close(core, &peer, reason);
            Err(NetError::Closed(reason))
        }
    }
}

/// Netzwerkstatus, eingehende Verbindungen, Zeitplan und das Schreiben gesammelter Änderungen dieser Aktivierung.
pub(super) fn spawn_presence(core: &Arc<Core>, runtime: &Arc<Runtime>) {
    let (online_tx, online) = watch::channel(false);
    let stop = &runtime.stop;
    let scheduler = runtime.scheduler.clone();
    tokio::spawn(stop.clone().run_until_cancelled_owned(watch_network(core.clone(), runtime.clone(), online_tx)));
    tokio::spawn(stop.clone().run_until_cancelled_owned(accept_peers(core.clone(), runtime.clone())));
    tokio::spawn(scheduler.stop.clone().run_until_cancelled_owned(scheduler.run(presence_plan(core, runtime), online)));
    tokio::spawn(stop.clone().run_until_cancelled_owned(flush_patches_regularly(core.clone())));
}

/// Hält den eigenen Status („spielt“) aktuell, solange der Dienst lebt.
pub(super) fn spawn_signal_consumer(core: &Arc<Core>, mut signals: broadcast::Receiver<GameSignal>) {
    let core = Arc::downgrade(core);
    tokio::spawn(async move {
        let mut running = HashSet::new();
        loop {
            match signals.recv().await {
                Ok(GameSignal::Spawned { instance_id, .. }) => running.insert(instance_id),
                Ok(GameSignal::Exited { instance_id }) => running.remove(&instance_id),
                Ok(_) => continue,
                Err(broadcast::error::RecvError::Lagged(missed)) => {
                    tracing::warn!(missed, "Spielsignale verpasst, Spielstatus kann veraltet sein");
                    continue;
                }
                Err(broadcast::error::RecvError::Closed) => return,
            };
            let Some(core) = core.upgrade() else { return };
            core.links.set_playing(!running.is_empty());
        }
    });
}

/// Nimmt beim Abschalten alle Verbindungen heraus: Freunde gelten als offline, die Endpunkte schließen sie danach.
pub(super) fn take_all_links(core: &Core) -> Vec<Link> {
    let links = core.links.drain();
    for (peer, _) in &links {
        went_offline(core, peer);
    }
    links.into_iter().map(|(_, link)| link).collect()
}

/// Eine Verbindung ist zu Ende: der Freund ist offline, und wie sie endete, entscheidet über das weitere Anwählen.
pub(super) fn link_ended(core: &Core, runtime: &Runtime, peer: &PeerId, id: u64, reason: CloseReason) {
    if core.links.remove(peer, id) {
        went_offline(core, peer);
        runtime.scheduler.disconnected(Target::Friend(*peer));
    }
    notice_close(core, peer, reason);
}

pub(super) fn emit_presence(core: &Core, peer: &PeerId, (presence, path): (Presence, Option<PathKind>)) {
    core.emit(FriendsEvent::Presence(FriendPresenceEvent { friend_id: peer.to_string(), presence, path }));
}

/// Der Freund mit dieser ID, mit noch nicht geschriebenen Änderungen.
pub(super) fn friend(core: &Core, id: &str) -> Option<FriendRecord> {
    core.stores.friends.get(id).ok().map(|record| core.patches.effective(record))
}

pub(super) fn friends(core: &Core) -> Vec<FriendRecord> {
    core.stores.friends.list().into_iter().map(|record| core.patches.effective(record)).collect()
}

/// Übernimmt ein bereinigtes Profil; ein neuer Anzeigename hinterlässt einen Hinweis für die Oberfläche (SPEC 5.3).
pub(super) fn apply_profile(core: &Core, peer: &PeerId, profile: WireProfile) {
    let id = peer.to_string();
    let Some(record) = friend(core, &id) else { return };
    let unchanged = record.display_name == profile.display_name
        && record.mc_name == profile.mc_name
        && record.mc_uuid == profile.mc_uuid;
    if unchanged {
        return;
    }
    let renamed = record.display_name != profile.display_name;
    let notice = renamed.then(|| FriendNotice::Renamed { previous_name: record.display_name.clone() });
    core.patches.add(&id, FriendPatch { profile: Some(profile), notice, ..FriendPatch::default() });
    if renamed {
        core.emit(FriendsEvent::Changed);
    }
}

/// Ein `homeRelay` außerhalb der eigenen Karte wird nie gespeichert (SPEC 3.2).
pub(super) fn apply_home_relay(core: &Core, peer: &PeerId, home_relay: Option<u8>, relay_map: &[RelayEntry]) {
    let Some(index) = home_relay.filter(|index| find_relay(relay_map, *index).is_some()) else { return };
    core.patches.add(&peer.to_string(), FriendPatch { home_relay: Some(index), ..FriendPatch::default() });
}

/// `unfriend` oder `NOT_FRIEND`: der Freund hat die Freundschaft beendet und wird nicht mehr angewählt (SPEC 4.5).
pub(super) fn mark_removed_by_peer(core: &Core, peer: &PeerId) {
    let id = peer.to_string();
    let marked = core.stores.friends.modify(&id, |record| record.removed_by_peer = true);
    if marked.is_ok() {
        core.emit(FriendsEvent::Changed);
    }
}

/// Zuordnung von `NetState` zum Vertrag (SPEC 3.4).
pub(super) fn network_status(state: NetState, relay_map: &[RelayEntry]) -> NetworkStatus {
    match state {
        NetState::Starting => NetworkStatus::Starting,
        NetState::Online { home_relay } => match find_relay(relay_map, home_relay) {
            Some(entry) => NetworkStatus::Online { relay_host: relay_host(entry) },
            None => NetworkStatus::Degraded { reason: DegradedReason::RelayUnreachable },
        },
        NetState::RelayUnreachable => NetworkStatus::Degraded { reason: DegradedReason::RelayUnreachable },
    }
}

impl Friends {
    pub async fn list(&self) -> AppResult<Vec<Friend>> {
        let core = &self.core;
        core.ensure_enabled()?;
        Ok(friends(core).into_iter().map(|record| friend_view(core, record)).collect())
    }

    /// Eigener Spitzname, bereinigt; leer entfernt ihn.
    pub async fn rename(&self, friend_id: &str, alias: Option<String>) -> AppResult<()> {
        let core = &self.core;
        core.ensure_enabled()?;
        let alias = alias.as_deref().and_then(sanitize::alias);
        core.stores.friends.modify(friend_id, |record| record.alias = alias)?;
        core.emit(FriendsEvent::Changed);
        Ok(())
    }

    /// Nimmt den Hinweis (neuer Name, neue Identität) zur Kenntnis.
    pub async fn acknowledge(&self, friend_id: &str) -> AppResult<()> {
        let core = &self.core;
        core.ensure_enabled()?;
        core.patches.flush(&core.stores);
        core.stores.friends.modify(friend_id, |record| record.notice = None)?;
        core.emit(FriendsEvent::Changed);
        Ok(())
    }

    /// Entfernt den Freund; ist er verbunden, erfährt er es über `unfriend` (SPEC 4.5).
    pub async fn remove(&self, friend_id: &str) -> AppResult<()> {
        let core = &self.core;
        core.ensure_enabled()?;
        core.stores.friends.remove(friend_id)?;
        core.patches.forget(friend_id);
        core.emit(FriendsEvent::Changed);
        if let Ok(peer) = PeerId::from_str(friend_id) {
            forget_target(core, &peer);
            if let Some(link) = core.links.take(&peer) {
                went_offline(core, &peer);
                tokio::spawn(control::say_goodbye(link, ControlMessage::Unfriend));
            }
        }
        Ok(())
    }

    /// Sperrt einen Freund oder den Peer einer Anfrage: wie Entfernen, aber ohne `unfriend` (SPEC 4.5).
    pub async fn block(&self, peer_id: &str) -> AppResult<()> {
        let core = &self.core;
        core.ensure_enabled()?;
        let display_name = known_name(core, peer_id)
            .ok_or_else(|| AppError::NotFound(coded!("errors.friends.notFound.friend", id = peer_id).into()))?;
        if core.stores.friends.remove(peer_id).is_ok() {
            core.patches.forget(peer_id);
        }
        requests::remove_requests_of(core, peer_id)?;
        core.stores.blocked.upsert(BlockedRecord {
            id: peer_id.to_owned(),
            display_name,
            blocked_at: now_secs(),
            mc_uuid: None,
        })?;
        core.emit(FriendsEvent::Changed);
        if let Ok(peer) = PeerId::from_str(peer_id) {
            forget_target(core, &peer);
            if let Some(link) = core.links.take(&peer) {
                went_offline(core, &peer);
                link.conn.close(CloseCode::NORMAL);
            }
        }
        Ok(())
    }

    pub async fn unblock(&self, peer_id: &str) -> AppResult<()> {
        let core = &self.core;
        core.ensure_enabled()?;
        core.stores.blocked.remove(peer_id)?;
        core.emit(FriendsEvent::Changed);
        Ok(())
    }

    pub async fn blocked(&self) -> AppResult<Vec<BlockedPeer>> {
        let core = &self.core;
        core.ensure_enabled()?;
        let blocked = core.stores.blocked.list().into_iter();
        Ok(blocked
            .map(|record| BlockedPeer {
                peer_id: record.id,
                display_name: record.display_name,
                blocked_at: record.blocked_at,
            })
            .collect())
    }
}

fn friend_view(core: &Core, record: FriendRecord) -> Friend {
    let (presence, path) =
        PeerId::from_str(&record.id).map_or((Presence::Offline, None), |peer| core.links.view(&peer));
    Friend {
        fingerprint: fingerprint(&record.id),
        id: record.id,
        display_name: record.display_name,
        alias: record.alias,
        mc_name: record.mc_name,
        mc_uuid: record.mc_uuid,
        added_at: record.added_at,
        last_seen: record.last_seen,
        confirmed: record.confirmed,
        removed_by_peer: record.removed_by_peer,
        notice: record.notice,
        presence,
        path,
    }
}

/// Name eines Freundes oder des Peers einer Anfrage, für die Sperrliste.
fn known_name(core: &Core, peer_id: &str) -> Option<String> {
    if let Some(friend) = friend(core, peer_id) {
        return Some(friend.display_name);
    }
    let request = requests::request_of(core, peer_id)?;
    Some(request.display_name.unwrap_or_else(|| sanitize::display_name("", peer_id)))
}

fn forget_target(core: &Core, peer: &PeerId) {
    if let Some(runtime) = core.runtime() {
        runtime.scheduler.forget(&Target::Friend(*peer));
    }
}

fn went_offline(core: &Core, peer: &PeerId) {
    core.patches.add(&peer.to_string(), FriendPatch { last_seen: Some(now_secs()), ..FriendPatch::default() });
    emit_presence(core, peer, (Presence::Offline, None));
}

/// `NOT_FRIEND` von einem Freund heißt „entfernt“, außer er kennt unsere neue ID noch nicht (SPEC 4.6).
fn notice_close(core: &Core, peer: &PeerId, reason: CloseReason) {
    if reason != CloseReason::Peer(CloseCode::NOT_FRIEND) {
        return;
    }
    let id = peer.to_string();
    let rotation_pending = core.stores.outbox.get(&id).is_ok_and(|item| item.kind == OutboxKind::Rotated);
    if !rotation_pending && friend(core, &id).is_some() {
        mark_removed_by_peer(core, peer);
    }
}

async fn watch_network(core: Arc<Core>, runtime: Arc<Runtime>, online: watch::Sender<bool>) {
    let mut status = runtime.main.status();
    loop {
        let state = *status.borrow_and_update();
        core.set_network(network_status(state, &core.options.relay_map));
        online.send_replace(matches!(state, NetState::Online { .. }));
        if status.changed().await.is_err() {
            return;
        }
    }
}

async fn accept_peers(core: Arc<Core>, runtime: Arc<Runtime>) {
    while let Some((_, conn)) = runtime.main.accept().await {
        let stop = runtime.stop.clone();
        tokio::spawn(stop.run_until_cancelled_owned(control::run_incoming(core.clone(), runtime.clone(), conn)));
    }
}

async fn flush_patches_regularly(core: Arc<Core>) {
    let mut ticks = tokio::time::interval(PATCH_FLUSH_INTERVAL);
    loop {
        ticks.tick().await;
        core.patches.flush(&core.stores);
    }
}

#[cfg(test)]
mod tests {
    use iroh::SecretKey;

    use super::*;
    use crate::services::p2p::{Dialer, DIAL_TIMEOUT};

    fn peer(seed: u8) -> PeerId {
        PeerId::from(SecretKey::from_bytes(&[seed; 32]).public())
    }

    /// Ein `Dialer`, der nie verbindet: er wartet `delay` und scheitert, und merkt sich, wann er wen anwählte.
    struct FakeDialer {
        delay: Duration,
        dials: Mutex<Vec<(PeerId, Instant)>>,
        done: Mutex<Vec<(PeerId, Instant)>>,
    }

    impl FakeDialer {
        fn new(delay: Duration) -> Arc<Self> {
            Arc::new(Self { delay, dials: Mutex::default(), done: Mutex::default() })
        }

        fn dials_of(&self, target: &PeerId) -> Vec<Instant> {
            lock(&self.dials).iter().filter(|(peer, _)| peer == target).map(|(_, at)| *at).collect()
        }
    }

    impl Dialer for FakeDialer {
        fn dial<'a>(&'a self, peer: &'a PeerId, _alpn: &'static [u8]) -> BoxFuture<'a, Result<PeerConn, NetError>> {
            Box::pin(async move {
                lock(&self.dials).push((*peer, Instant::now()));
                tokio::time::sleep(self.delay).await;
                lock(&self.done).push((*peer, Instant::now()));
                Err(NetError::Timeout)
            })
        }
    }

    /// Ein fester Plan über den falschen `Dialer`; Anfragen werden als Peer `request_peer` angewählt.
    struct FakePlan {
        dialer: Arc<FakeDialer>,
        eager: Vec<Target>,
        lazy: Vec<Target>,
        request_peer: PeerId,
    }

    impl DialPlan for FakePlan {
        fn eager(&self) -> Vec<Target> {
            self.eager.clone()
        }

        fn lazy(&self) -> Vec<Target> {
            self.lazy.clone()
        }

        fn attempt(&self, target: Target) -> BoxFuture<'static, bool> {
            let peer = match target {
                Target::Friend(peer) => peer,
                Target::Request(_) => self.request_peer,
            };
            let dialer = self.dialer.clone();
            Box::pin(async move { dialer.dial(&peer, PEER_ALPN).await.is_ok() })
        }
    }

    /// Startet den Zeitplan online; er läuft, solange der zurückgegebene Sender lebt.
    fn start(plan: Arc<FakePlan>) -> (Arc<Scheduler>, watch::Sender<bool>) {
        let scheduler = Arc::new(Scheduler::new(CancellationToken::new()));
        let (online, receiver) = watch::channel(true);
        tokio::spawn(scheduler.clone().run(plan, receiver));
        (scheduler, online)
    }

    async fn sleep_until(at: Instant) {
        tokio::time::sleep_until(at).await;
    }

    #[tokio::test(start_paused = true)]
    async fn retry_now_dials_a_request_in_the_ten_minute_step_at_once_but_not_twice_within_ten_seconds() {
        let dialer = FakeDialer::new(Duration::ZERO);
        let request = Target::Request("r1".into());
        let plan = Arc::new(FakePlan {
            dialer: dialer.clone(),
            eager: vec![request.clone()],
            lazy: vec![],
            request_peer: peer(1),
        });
        let start_at = Instant::now();
        let (scheduler, _online) = start(plan.clone());
        // Versuche bei 0 s, 30 s, 2:30 und 7:30; der nächste wäre erst nach dem 10-min-Schritt bei 17:30 dran.
        sleep_until(start_at + Duration::from_secs(8 * 60)).await;
        assert_eq!(dialer.dials_of(&peer(1)).len(), 4);
        let plan: Arc<dyn DialPlan> = plan;

        scheduler.retry_now(&plan, vec![request.clone()], vec![]);
        tokio::time::sleep(Duration::from_secs(1)).await;
        scheduler.retry_now(&plan, vec![request], vec![]);
        tokio::time::sleep(Duration::from_secs(1)).await;

        let dials = dialer.dials_of(&peer(1));
        assert_eq!(dials.len(), 5, "one immediate dial, none for the second call");
        assert_eq!(dials[4], start_at + Duration::from_secs(8 * 60));
    }

    #[tokio::test(start_paused = true)]
    async fn after_retry_now_the_backoff_starts_again_at_thirty_seconds() {
        let dialer = FakeDialer::new(Duration::ZERO);
        let request = Target::Request("r1".into());
        let plan = Arc::new(FakePlan {
            dialer: dialer.clone(),
            eager: vec![request.clone()],
            lazy: vec![],
            request_peer: peer(1),
        });
        let start_at = Instant::now();
        let (scheduler, _online) = start(plan.clone());
        sleep_until(start_at + Duration::from_secs(8 * 60)).await;
        let plan: Arc<dyn DialPlan> = plan;

        scheduler.retry_now(&plan, vec![request], vec![]);
        sleep_until(start_at + Duration::from_secs(8 * 60 + 31)).await;

        assert_eq!(dialer.dials_of(&peer(1)).len(), 6);
    }

    #[tokio::test(start_paused = true)]
    async fn lazy_friends_are_dialed_once_after_a_minute_and_then_hourly() {
        let dialer = FakeDialer::new(Duration::ZERO);
        let old_friend = peer(2);
        let plan = Arc::new(FakePlan {
            dialer: dialer.clone(),
            eager: vec![],
            lazy: vec![Target::Friend(old_friend)],
            request_peer: peer(1),
        });
        let start_at = Instant::now();
        let _running = start(plan);

        sleep_until(start_at + Duration::from_secs(2 * 3600 + 61)).await;

        let offsets: Vec<u64> = dialer.dials_of(&old_friend).iter().map(|at| (*at - start_at).as_secs()).collect();
        assert_eq!(offsets, [60, 3660, 7260]);
    }

    #[tokio::test(start_paused = true)]
    async fn startup_batch_of_fifty_friends_dials_only_the_recent_ones_within_four_rounds() {
        let dialer = FakeDialer::new(DIAL_TIMEOUT);
        let recent: Vec<Target> = (0..16).map(|seed| Target::Friend(peer(seed + 10))).collect();
        let old: Vec<Target> = (0..34).map(|seed| Target::Friend(peer(seed + 100))).collect();
        let plan =
            Arc::new(FakePlan { dialer: dialer.clone(), eager: recent.clone(), lazy: old, request_peer: peer(1) });
        let start_at = Instant::now();
        let _running = start(plan);

        sleep_until(start_at + Duration::from_secs(59)).await;

        let first_done: Vec<Instant> = recent
            .iter()
            .map(|target| {
                let Target::Friend(friend) = target else { unreachable!() };
                lock(&dialer.done).iter().find(|(peer, _)| peer == friend).map(|(_, at)| *at).expect("dialed")
            })
            .collect();
        let last = first_done.into_iter().max().unwrap();
        assert!(last - start_at <= 4 * DIAL_TIMEOUT + TICK, "batch took {:?}", last - start_at);
        let peers_dialed: HashSet<PeerId> = lock(&dialer.dials).iter().map(|(peer, _)| *peer).collect();
        assert_eq!(peers_dialed.len(), 16, "old friends wait for the lazy round");
    }

    #[tokio::test(start_paused = true)]
    async fn never_more_than_four_dials_run_at_once() {
        let dialer = FakeDialer::new(DIAL_TIMEOUT);
        let eager: Vec<Target> = (0..10).map(|seed| Target::Friend(peer(seed + 10))).collect();
        let plan = Arc::new(FakePlan { dialer: dialer.clone(), eager, lazy: vec![], request_peer: peer(1) });
        let _running = start(plan);

        tokio::time::sleep(Duration::from_secs(1)).await;

        assert_eq!(lock(&dialer.dials).len(), MAX_CONCURRENT_DIALS);
    }

    #[test]
    fn online_state_names_the_home_relay_host_and_unreachable_is_degraded() {
        let map = vec![RelayEntry {
            index: 0,
            url: std::borrow::Cow::Borrowed("https://relay-eu1.example.org/"),
            operator: crate::services::p2p::RelayOperator::Pumpkin,
            quic_port: None,
        }];

        assert_eq!(network_status(NetState::Starting, &map), NetworkStatus::Starting);
        assert_eq!(
            network_status(NetState::Online { home_relay: 0 }, &map),
            NetworkStatus::Online { relay_host: "relay-eu1.example.org".into() }
        );
        assert_eq!(
            network_status(NetState::RelayUnreachable, &map),
            NetworkStatus::Degraded { reason: DegradedReason::RelayUnreachable }
        );
    }

    #[test]
    fn unconfirmed_and_recently_seen_friends_are_eager() {
        let now = 10 * RECENTLY_SEEN_SECS;
        let friend = |confirmed, last_seen| FriendRecord {
            id: String::new(),
            display_name: String::new(),
            alias: None,
            mc_name: None,
            mc_uuid: None,
            home_relay: None,
            added_at: 0,
            last_seen,
            confirmed,
            removed_by_peer: false,
            notice: None,
        };

        assert!(is_eager(&friend(false, None), now));
        assert!(is_eager(&friend(true, Some(now - RECENTLY_SEEN_SECS)), now));
        assert!(!is_eager(&friend(true, Some(now - RECENTLY_SEEN_SECS - 1)), now));
        assert!(!is_eager(&friend(true, None), now));
    }
}
