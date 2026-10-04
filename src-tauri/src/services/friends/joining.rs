//! Beitreten (SPEC 6.2): eine Einladung prüfen (Manifest und Abgleich), dann ein Zuhörer an einer zufälligen
//! Loopback-Adresse, an den nur das gestartete Spiel kommt. Jede lokale Verbindung muss dem Spielprozess gehören und
//! im Handshake genau diese Adresse nennen, bevor ein Tunnel-Stream zum Gastgeber aufgeht. Zeitgrenzen beenden einen
//! Beitritt, der nicht vorankommt.
use std::io;
use std::net::{IpAddr, Ipv4Addr, SocketAddr};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, OnceLock, Weak};
use std::time::Duration;

use bytes::Bytes;
use futures::FutureExt;
use tokio::net::TcpStream;
use tokio::sync::mpsc;
use tokio::time::Instant;
use tokio_util::sync::CancellationToken;

use super::contract::{JoinPlan, JoinSessionEvent, JoinState, JoinTicket, JoinVerdict, SessionEnd, MIN_MC_LABEL};
use super::control::OpenFrame;
use super::hosting::{RequestMessage, RequestReply, TunnelReply};
use super::invites::Received;
use super::limits::{OPEN_FRAME_LIMIT, REQUEST_FRAME_LIMIT};
use super::manifest::{self, Manifest, ManifestError};
use super::matching::{self, Classification, DiskHashes};
use super::mcproto::{self, GUEST_WINDOW};
use super::mod_link;
use super::session_events::SessionEvent;
use super::sessions::{FriendSessions, Shared};
use super::{Friends, Lifecycle};
use crate::coded;
use crate::error::{AppError, AppResult};
use crate::models::{new_id, Instance};
use crate::services::modbridge::protocol::ModNotify;
use crate::services::modbridge::topics::{JoinPhase, JoinView};
use crate::services::p2p::tunnel::{ListenerLimits, LocalListener, TunnelError};
use crate::services::p2p::{frame, BiStream, FrameError, PeerConn, PeerId};
use crate::services::{blocking, lock, sockowner};

/// Vor der ersten gültigen Verbindung eine ungeprüfte zugleich, danach vier (SPEC 6.2).
const LISTENER_LIMITS: ListenerLimits = ListenerLimits { before_first_valid: 1, after_first_valid: 4 };
/// Wartezeit auf `tunnelOk` und auf die Antwort einer Manifest-Anfrage (SPEC 5.1, 6.2).
const TUNNEL_OK_WAIT: Duration = Duration::from_secs(10);
const REQUEST_WAIT: Duration = Duration::from_secs(30);
/// Höchstens so oft geht der Stand einer verbundenen Sitzung an die Oberfläche.
const STATUS_INTERVAL: Duration = Duration::from_secs(5);
/// So oft wird während der Schonfrist nachgesehen, ob die Verbindung zum Gastgeber wieder steht.
const HOST_POLL: Duration = Duration::from_millis(250);
/// Bei einem Beitritt aus dem laufenden Spiel muss die erste gültige Verbindung binnen dieser Zeit kommen (INGAME 7).
const HERE_FIRST_CONNECTION: Duration = Duration::from_secs(120);

/// Zeitgrenzen eines Beitritts; die App nimmt [`JoinTimers::production`], Tests kurze Werte.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct JoinTimers {
    /// Ohne Spielstart und ohne Fortschritt des Starts endet der Beitritt nach dieser Zeit.
    pub spawn_wait: Duration,
    /// Ohne Spielstart endet er spätestens so lange nach `invite_join`, auch wenn der Start Fortschritt meldet.
    pub spawn_wait_cap: Duration,
    /// Nach dem Spielstart muss in dieser Zeit die erste gültige Verbindung kommen.
    pub first_connection: Duration,
    /// So lange darf die Verbindung zum Gastgeber fehlen, bevor der Beitritt mit `hostOffline` endet.
    pub host_offline_grace: Duration,
}

impl JoinTimers {
    pub fn production() -> Self {
        Self {
            spawn_wait: Duration::from_secs(600),
            spawn_wait_cap: Duration::from_secs(1800),
            first_connection: Duration::from_secs(600),
            host_offline_grace: Duration::from_secs(30),
        }
    }
}

/// Wann ein Beitritt ohne weiteren Fortschritt endet (SPEC 6.2); ohne Sockets prüfbar.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) struct JoinClock {
    timers: JoinTimers,
    cap: Instant,
    phase: Phase,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Phase {
    AwaitingSpawn { until: Instant },
    AwaitingConnection { until: Instant },
    Connected,
}

impl JoinClock {
    pub(super) fn start(timers: JoinTimers, now: Instant) -> Self {
        let phase = Phase::AwaitingSpawn { until: now + timers.spawn_wait };
        Self { timers, cap: now + timers.spawn_wait_cap, phase }
    }

    /// `None`, sobald die erste gültige Verbindung da ist.
    pub(super) fn deadline(&self) -> Option<Instant> {
        match self.phase {
            Phase::AwaitingSpawn { until } => Some(until.min(self.cap)),
            Phase::AwaitingConnection { until } => Some(until),
            Phase::Connected => None,
        }
    }

    /// Der Start meldet Fortschritt: die Wartezeit auf das Spiel beginnt neu, die Obergrenze bleibt.
    pub(super) fn progressed(&mut self, now: Instant) {
        if let Phase::AwaitingSpawn { .. } = self.phase {
            self.phase = Phase::AwaitingSpawn { until: now + self.timers.spawn_wait };
        }
    }

    pub(super) fn spawned(&mut self, now: Instant) {
        if let Phase::AwaitingSpawn { .. } = self.phase {
            self.phase = Phase::AwaitingConnection { until: now + self.timers.first_connection };
        }
    }

    pub(super) fn connected(&mut self) {
        self.phase = Phase::Connected;
    }
}

/// Der (höchstens eine) laufende Beitritt.
#[derive(Default)]
pub(super) struct Joins {
    current: Mutex<Option<ActiveJoin>>,
}

struct ActiveJoin {
    ticket: JoinTicket,
    /// Der Name des Gastgebers, wie ihn die Mod zeigt.
    host_name: String,
    /// Wie weit der Beitritt ist, für das Thema `join` der Mod.
    state: JoinState,
    /// Prozess-ID des Spiels, sobald es läuft; vorher gehört keine lokale Verbindung zu ihm.
    game: Arc<OnceLock<u32>>,
    inputs: mpsc::UnboundedSender<Input>,
    /// Schließt den Zuhörer und setzt jeden Tunnel zurück.
    stop: CancellationToken,
}

/// Was den Zeitplan eines Beitritts weiterbringt.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Input {
    Progress,
    Spawned,
    FirstConnection,
    TunnelOpened,
}

impl Joins {
    fn send(&self, join_id: &str, input: Input) {
        let current = lock(&self.current);
        if let Some(join) = current.as_ref().filter(|join| join.ticket.join_id == join_id) {
            let _ = join.inputs.send(input);
        }
    }

    pub(super) fn progressed(&self, join_id: &str) {
        self.send(join_id, Input::Progress);
    }

    /// Das Spiel des Beitritts läuft: ab jetzt gehören ihm die lokalen Verbindungen mit seiner Prozess-ID.
    pub(super) fn spawned(&self, join_id: &str, pid: u32) {
        let current = lock(&self.current);
        if let Some(join) = current.as_ref().filter(|join| join.ticket.join_id == join_id) {
            let _ = join.game.set(pid);
            let _ = join.inputs.send(Input::Spawned);
        }
    }

    /// Ob ein Beitritt läuft, gleich von welcher Instanz.
    pub(super) fn is_active(&self) -> bool {
        lock(&self.current).is_some()
    }

    /// Die Kennung des Beitritts, den die Spiel-Instanz gerade macht.
    fn join_of_instance(&self, instance_id: &str) -> Option<(String, JoinState)> {
        let current = lock(&self.current);
        let join = current.as_ref().filter(|join| join.ticket.instance_id == instance_id)?;
        Some((join.ticket.join_id.clone(), join.state.clone()))
    }

    /// Der Beitritt dieser Instanz, wie die Mod ihn sieht (Thema `join`); `None`, wenn sie keinem beigetreten ist.
    pub(super) fn view_for_mod(&self, instance_id: &str) -> Option<JoinView> {
        let current = lock(&self.current);
        let join = current.as_ref().filter(|join| join.ticket.instance_id == instance_id)?;
        let (state, path, rtt_ms) = match &join.state {
            JoinState::WaitingForGame => (JoinPhase::WaitingForGame, None, None),
            JoinState::Connecting => (JoinPhase::Connecting, None, None),
            JoinState::Connected { path, rtt_ms } => (JoinPhase::Connected, Some(*path), *rtt_ms),
            JoinState::Ended { .. } => return None,
        };
        Some(JoinView { invite_id: join.ticket.invite_id.clone(), host_name: join.host_name.clone(), state, path, rtt_ms })
    }

    fn remember(&self, join_id: &str, state: &JoinState) {
        let mut current = lock(&self.current);
        if let Some(join) = current.as_mut().filter(|join| join.ticket.join_id == join_id) {
            join.state = state.clone();
        }
    }
}

/// Wie ein Beitritt endet: mit Ereignis an die Oberfläche oder still (die App beendet sich).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Ending {
    Announced(SessionEnd),
    Silent,
}

/// Beendet den laufenden Beitritt, wenn `applies` auf ihn zutrifft; der Zuhörer schließt im selben Schritt.
fn end_join(shared: &Shared, applies: impl FnOnce(&ActiveJoin) -> bool, ending: Ending) {
    let ended = {
        let mut current = lock(&shared.joins.current);
        if current.as_ref().is_some_and(applies) { current.take() } else { None }
    };
    let Some(join) = ended else { return };
    join.stop.cancel();
    if let Ending::Announced(reason) = ending {
        emit_state(shared, &join.ticket, JoinState::Ended { reason });
        tell_mod_about_the_end(shared, &join.ticket.instance_id, reason);
    }
}

/// Wer selbst geht (`left`), braucht keinen Toast; jedes andere Ende erfährt die Mod des Beitritts.
fn tell_mod_about_the_end(shared: &Shared, instance_id: &str, reason: SessionEnd) {
    if reason != SessionEnd::Left {
        mod_link::notify(shared, instance_id, ModNotify::JoinEnded, None);
    }
}

fn end_by_id(shared: &Shared, join_id: &str, reason: SessionEnd) {
    end_join(shared, |join| join.ticket.join_id == join_id, Ending::Announced(reason));
}

pub(super) fn end_for_invite(shared: &Shared, invite_id: &str, reason: SessionEnd) {
    end_join(shared, |join| join.ticket.invite_id == invite_id, Ending::Announced(reason));
}

/// Der Start ist vor dem Spielprozess gescheitert: sofort `error` (SPEC 6.2).
pub(super) fn launch_failed(shared: &Shared, join_id: &str) {
    end_by_id(shared, join_id, SessionEnd::Error);
}

/// Nur das Spiel des Beitritts zählt, und erst nachdem es gestartet ist.
pub(super) fn game_exited(shared: &Shared, instance_id: &str) {
    let ours = |join: &ActiveJoin| join.ticket.instance_id == instance_id && join.game.get().is_some();
    end_join(shared, ours, Ending::Announced(SessionEnd::GameExited));
}

/// Vor dem Abbau der Endpunkte (SPEC 6.2): Abschalten `disabled`, neu binden oder neue Identität `left`, beim Beenden
/// der App kein Ereignis.
pub(super) fn end_for_lifecycle(shared: &Shared, kind: Lifecycle) {
    let ending = match kind {
        Lifecycle::Disabled => Ending::Announced(SessionEnd::Disabled),
        Lifecycle::Rebind | Lifecycle::IdentityChanged => Ending::Announced(SessionEnd::Left),
        Lifecycle::Shutdown => Ending::Silent,
    };
    end_join(shared, |_| true, ending);
}

fn emit_state(shared: &Shared, ticket: &JoinTicket, state: JoinState) {
    shared.emit(SessionEvent::JoinSession(JoinSessionEvent {
        join_id: ticket.join_id.clone(),
        invite_id: ticket.invite_id.clone(),
        instance_id: ticket.instance_id.clone(),
        state,
    }));
}

impl FriendSessions {
    /// Holt das Manifest des Gastgebers und gleicht es mit den eigenen Instanzen ab (SPEC 5.6).
    pub async fn invite_plan(&self, invite_id: &str) -> AppResult<JoinPlan> {
        let shared = &self.shared;
        shared.ensure_enabled()?;
        let received = shared.invites.open_invite(invite_id)?;
        plan_for(shared, &received, shared.instances.list()).await
    }

    /// Bereitet den Beitritt mit einer passenden Instanz vor; das Spiel startet danach die Oberfläche (SPEC 6.2).
    pub async fn invite_join(&self, invite_id: &str, instance_id: &str) -> AppResult<JoinTicket> {
        let shared = &self.shared;
        shared.ensure_enabled()?;
        let received = shared.invites.open_invite(invite_id)?;
        let instance = shared.instances.get(instance_id)?;
        ensure_matches(&plan_for(shared, &received, vec![instance]).await?)?;
        let listener = LocalListener::bind(join_ip()?).await?;
        let ticket = JoinTicket {
            join_id: new_id(),
            invite_id: invite_id.to_owned(),
            instance_id: instance_id.to_owned(),
            address: listener.addr.to_string(),
        };
        start_join(shared, &received, ticket.clone(), listener);
        Ok(ticket)
    }

    pub async fn join_leave(&self, join_id: &str) -> AppResult<()> {
        self.shared.ensure_enabled()?;
        end_by_id(&self.shared, join_id, SessionEnd::Left);
        Ok(())
    }

    /// Der Abgleich der Einladung mit allen Instanzen, die laufende vorn (INGAME 7, Schritt 3): die Mod fragt für das Spiel,
    /// in dem sie läuft. Nichts wird geladen.
    pub(super) async fn plan_with_running_first(
        &self,
        invite_id: &str,
        running_instance_id: &str,
    ) -> AppResult<(Received, JoinPlan)> {
        let shared = &self.shared;
        shared.ensure_enabled()?;
        let received = shared.invites.open_invite(invite_id)?;
        shared.instances.get(running_instance_id)?;
        let mut instances = shared.instances.list();
        instances.sort_by_key(|instance| instance.id != running_instance_id);
        let plan = plan_for(shared, &received, instances).await?;
        Ok((received, plan))
    }

    /// Der Beitritt aus dem laufenden Spiel (INGAME 7, Schritt 4): ein Zuhörer an einer Loopback-Adresse, dem nur der Prozess
    /// `game_pid` gehört. Das Spiel läuft schon, also gibt es keine Wartezeit auf den Start, und die erste Verbindung muss
    /// binnen [`HERE_FIRST_CONNECTION`] kommen. Vorher hat der Aufrufer geprüft, dass nichts anderes beitritt.
    pub(super) async fn start_join_here(
        &self,
        received: &Received,
        instance_id: &str,
        game_pid: u32,
    ) -> AppResult<(JoinTicket, SocketAddr)> {
        let shared = &self.shared;
        let listener = LocalListener::bind(join_ip()?).await?;
        let address = listener.addr;
        let ticket = JoinTicket {
            join_id: new_id(),
            invite_id: received.invite.id.clone(),
            instance_id: instance_id.to_owned(),
            address: address.to_string(),
        };
        start_join_with(shared, received, ticket.clone(), listener, here_timers(shared.timers));
        shared.joins.spawned(&ticket.join_id, game_pid);
        Ok((ticket, address))
    }

    /// Das Spiel der Instanz verlässt die Welt, der es beigetreten ist; ohne Beitritt gibt es nichts zu tun.
    pub(super) fn leave_join_of_instance(&self, instance_id: &str) {
        if let Some((join_id, _)) = self.shared.joins.join_of_instance(instance_id) {
            end_by_id(&self.shared, &join_id, SessionEnd::Left);
        }
    }

    /// Die Mod meldet, dass das Spiel nicht in die Welt kam. Hat der Tunnel schon eine gültige Verbindung, irrt sie sich.
    pub(super) fn fail_join_of_instance(&self, instance_id: &str) {
        let Some((join_id, state)) = self.shared.joins.join_of_instance(instance_id) else { return };
        if !matches!(state, JoinState::Connected { .. }) {
            end_by_id(&self.shared, &join_id, SessionEnd::Error);
        }
    }
}

/// Die Zeiten eines Beitritts aus dem laufenden Spiel: die erste Verbindung kommt binnen zwei Minuten oder gar nicht,
/// kürzere Vorgaben (Tests) bleiben.
fn here_timers(timers: JoinTimers) -> JoinTimers {
    JoinTimers { first_connection: timers.first_connection.min(HERE_FIRST_CONNECTION), ..timers }
}

fn peer_offline(received: &Received) -> AppError {
    AppError::invalid(coded!("errors.friends.peerOffline", name = received.invite.from_name))
}

fn ensure_matches(plan: &JoinPlan) -> AppResult<()> {
    match plan.verdict {
        JoinVerdict::Ready => Ok(()),
        JoinVerdict::VersionUnsupported => {
            Err(AppError::invalid(coded!("errors.friends.versionUnsupported", min = MIN_MC_LABEL)))
        }
        JoinVerdict::MissingContent | JoinVerdict::NoInstance => {
            Err(AppError::invalid(coded!("errors.friends.instanceMismatch")))
        }
    }
}

/// Windows und Linux: eine zufällige Adresse `127.a.b.c` (je 1..=254), so dass niemand sie errät. macOS kennt auf
/// lo0 nur `127.0.0.1`.
fn join_ip() -> io::Result<IpAddr> {
    if cfg!(target_os = "macos") {
        return Ok(IpAddr::V4(Ipv4Addr::LOCALHOST));
    }
    let mut random = [0u8; 3];
    getrandom::fill(&mut random).map_err(|err| io::Error::other(err.to_string()))?;
    let [a, b, c] = random.map(|byte| 1 + byte % 254);
    Ok(IpAddr::V4(Ipv4Addr::new(127, a, b, c)))
}

/// Manifest holen, prüfen und mit `instances` abgleichen; nichts wird geladen.
async fn plan_for(shared: &Shared, received: &Received, instances: Vec<Instance>) -> AppResult<JoinPlan> {
    let Some(manifest) = validated_manifest(shared, received).await? else {
        return Ok(matching::version_unsupported(&received.invite));
    };
    let (manifest, instances) = (Arc::new(manifest), Arc::new(instances));
    let (host, local) = (manifest.clone(), instances.clone());
    let to_classify = with_local_hashes(shared, move |disk| matching::hashes_to_classify(&host, &local, disk)).await?;
    let classification = Classification::fetch(&*shared.lookup, &to_classify).await;
    let invite = received.invite.clone();
    with_local_hashes(shared, move |disk| matching::plan(&invite, &manifest, &instances, disk, &classification)).await
}

/// Das geprüfte Manifest des Gastgebers; `None`, wenn seine Minecraft-Version älter als 1.20 ist.
async fn validated_manifest(shared: &Shared, received: &Received) -> AppResult<Option<Manifest>> {
    let raw = fetch_manifest(shared, received).await?;
    match manifest::validate(raw, &shared.versions.index().await?) {
        Ok(manifest) => Ok(Some(manifest)),
        Err(ManifestError::VersionUnsupported) => Ok(None),
        Err(err) => Err(err.into()),
    }
}

/// Arbeit mit den Hashes der eigenen Mod-Dateien; sie liest Dateien und läuft deshalb abseits des Executors.
async fn with_local_hashes<T: Send + 'static>(
    shared: &Shared,
    work: impl FnOnce(&DiskHashes) -> T + Send + 'static,
) -> AppResult<T> {
    let (dirs, cache) = (shared.dirs.clone(), shared.hashes.clone());
    blocking(move |_| Ok(work(&DiskHashes { dirs: &dirs, cache: &cache }))).await
}

/// Warum eine Manifest-Anfrage keine Antwort brachte.
enum FetchFailure {
    Offline,
    Malformed,
}

async fn fetch_manifest(shared: &Shared, received: &Received) -> AppResult<Manifest> {
    let conn = shared.friends.dial_friend(&received.host).await.map_err(|_| peer_offline(received))?;
    match ask_manifest(&conn, &received.invite.session_id).await {
        Ok(RequestReply::Manifest { manifest }) => Ok(manifest),
        Ok(RequestReply::Error { code }) => Err(refused(&code)),
        Err(FetchFailure::Offline) => Err(peer_offline(received)),
        Err(FetchFailure::Malformed) => Err(AppError::invalid(coded!("errors.friends.manifestInvalid"))),
    }
}

async fn ask_manifest(conn: &PeerConn, session_id: &str) -> Result<RequestReply, FetchFailure> {
    let mut stream = conn.open_bi().await.map_err(|_| FetchFailure::Offline)?;
    let exchange = async {
        frame::write(&mut stream, &OpenFrame::Request, OPEN_FRAME_LIMIT).await?;
        let request = RequestMessage::ManifestRequest { session_id: session_id.to_owned() };
        frame::write(&mut stream, &request, REQUEST_FRAME_LIMIT).await?;
        stream.read_frame::<RequestReply>(REQUEST_FRAME_LIMIT).await
    };
    match tokio::time::timeout(REQUEST_WAIT, exchange).await {
        Ok(Ok(reply)) => Ok(reply),
        Ok(Err(FrameError::Io(_))) | Err(_) => Err(FetchFailure::Offline),
        Ok(Err(FrameError::TooLarge { .. } | FrameError::Json(_))) => Err(FetchFailure::Malformed),
    }
}

/// Die Fehlercodes des Gastgebers (SPEC 5.3) als Meldung; unbekannte stammen von einer anderen Version.
fn refused(code: &str) -> AppError {
    let coded = match code {
        "sessionNotFound" => coded!("errors.friends.sessionNotFound"),
        "notInvited" => coded!("errors.friends.notInvited"),
        "rateLimited" => coded!("errors.friends.rateLimited"),
        _ => coded!("errors.friends.protocolUnsupported"),
    };
    AppError::invalid(coded)
}

/// Startet Zuhörer, Zeitplan und die Beobachtung des Gastgebers und setzt den Beitritt an die Stelle des laufenden.
pub(super) fn start_join(shared: &Arc<Shared>, received: &Received, ticket: JoinTicket, listener: LocalListener) {
    start_join_with(shared, received, ticket, listener, shared.timers);
}

fn start_join_with(shared: &Arc<Shared>, received: &Received, ticket: JoinTicket, listener: LocalListener, timers: JoinTimers) {
    let (inputs, receiver) = mpsc::unbounded_channel();
    let join = ActiveJoin {
        ticket,
        host_name: received.invite.from_name.clone(),
        state: JoinState::WaitingForGame,
        game: Arc::new(OnceLock::new()),
        inputs,
        stop: CancellationToken::new(),
    };
    serve_listener(shared, received, &join, listener);
    let (weak, host, stop) = (Arc::downgrade(shared), received.host, &join.stop);
    tokio::spawn(stop.clone().run_until_cancelled_owned(drive(weak.clone(), join.ticket.clone(), host, receiver, timers)));
    tokio::spawn(stop.clone().run_until_cancelled_owned(watch_host(weak, join.ticket.join_id.clone(), host)));
    replace_join(shared, join);
}

/// Ein Schritt unter der Sperre: der vorige Beitritt endet genau einmal mit `left`, der neue wartet auf das Spiel.
/// So bleibt auch bei zwei gleichzeitigen `invite_join` kein Zuhörer übrig, und die Ereignisse kommen in Reihenfolge.
fn replace_join(shared: &Shared, join: ActiveJoin) {
    let mut current = lock(&shared.joins.current);
    if let Some(previous) = current.take() {
        previous.stop.cancel();
        emit_state(shared, &previous.ticket, JoinState::Ended { reason: SessionEnd::Left });
    }
    emit_state(shared, &join.ticket, JoinState::WaitingForGame);
    *current = Some(join);
}

fn serve_listener(shared: &Shared, received: &Received, join: &ActiveJoin, listener: LocalListener) {
    let gate = Arc::new(LocalGate {
        listener: listener.addr,
        game: join.game.clone(),
        inputs: join.inputs.clone(),
        owner: sockowner::connects_from,
        lookup_failed: AtomicBool::new(false),
    });
    let opener = Arc::new(TunnelOpener {
        friends: shared.friends.clone(),
        host: received.host,
        session_id: received.invite.session_id.clone(),
        inputs: join.inputs.clone(),
    });
    let admit = move |tcp, client| {
        let gate = gate.clone();
        async move { gate.admit(tcp, client).await }
    };
    let open = move || {
        let opener = opener.clone();
        async move { opener.open().await }
    };
    listener.serve(admit, open, LISTENER_LIMITS, join.stop.clone());
}

/// Fragt das Betriebssystem, ob dem Prozess (`u32`) die Verbindung vom ersten zum zweiten Endpunkt gehört.
type OwnerLookup = fn(u32, SocketAddr, SocketAddr) -> io::Result<bool>;

/// Prüft lokale Verbindungen, bevor ein Tunnel aufgeht (SPEC 6.2, Schritte 3 bis 5).
struct LocalGate {
    listener: SocketAddr,
    game: Arc<OnceLock<u32>>,
    inputs: mpsc::UnboundedSender<Input>,
    owner: OwnerLookup,
    lookup_failed: AtomicBool,
}

impl LocalGate {
    async fn admit(&self, mut tcp: TcpStream, client: SocketAddr) -> Option<(TcpStream, Bytes)> {
        let pid = *self.game.get()?;
        if !self.owned_by_game(pid, client).await {
            return None;
        }
        let check = |bytes: &[u8]| mcproto::check_handshake(bytes, GUEST_WINDOW.max_bytes);
        let ((handshake, _), peeked) = mcproto::read_checked(&mut tcp, GUEST_WINDOW, check).await?;
        if !handshake.is_addressed_to(self.listener) {
            return None;
        }
        let _ = self.inputs.send(Input::FirstConnection);
        Some((tcp, Bytes::from(peeked)))
    }

    /// Gehört die Verbindung vom Client zum Zuhörer dem Spiel? Lässt sich das nicht feststellen, gilt sie als fremd:
    /// eine Abfrage, die ein anderer Prozess scheitern lassen kann, darf die Prüfung nicht aushebeln.
    async fn owned_by_game(&self, pid: u32, client: SocketAddr) -> bool {
        let (owner, server) = (self.owner, self.listener);
        match tokio::task::spawn_blocking(move || owner(pid, client, server)).await {
            Ok(Ok(owned)) => owned,
            Ok(Err(err)) => {
                if !self.lookup_failed.swap(true, Ordering::Relaxed) {
                    tracing::warn!(%err, "Besitzer lokaler Verbindungen nicht ermittelbar, Verbindung abgelehnt");
                }
                false
            }
            Err(err) => {
                tracing::warn!(%err, "Abfrage des Verbindungsbesitzers abgebrochen");
                false
            }
        }
    }
}

/// Öffnet je geprüfter lokaler Verbindung einen Tunnel-Stream zum Gastgeber.
struct TunnelOpener {
    friends: Friends,
    host: PeerId,
    session_id: String,
    inputs: mpsc::UnboundedSender<Input>,
}

impl TunnelOpener {
    async fn open(&self) -> Result<BiStream, TunnelError> {
        let conn = self.friends.dial_friend(&self.host).await?;
        let mut stream = conn.open_bi().await?;
        let open = OpenFrame::Tunnel { session_id: self.session_id.clone() };
        frame::write(&mut stream, &open, OPEN_FRAME_LIMIT).await?;
        let reply = tokio::time::timeout(TUNNEL_OK_WAIT, stream.read_frame::<TunnelReply>(OPEN_FRAME_LIMIT)).await;
        match reply.map_err(|_| TunnelError::Timeout)?? {
            TunnelReply::TunnelOk => {
                let _ = self.inputs.send(Input::TunnelOpened);
                Ok(stream)
            }
            TunnelReply::Error { code } => Err(TunnelError::Refused(code)),
        }
    }
}

/// Warum der Zeitplan eines Beitritts aufwacht.
enum Wake {
    Deadline,
    Input(Input),
    Status,
    Closed,
}

/// Führt den Zeitplan (SPEC 6.2) und meldet die Zustände; endet der Plan, endet der Beitritt mit `error`.
async fn drive(
    shared: Weak<Shared>,
    ticket: JoinTicket,
    host: PeerId,
    mut inputs: mpsc::UnboundedReceiver<Input>,
    timers: JoinTimers,
) {
    let mut clock = JoinClock::start(timers, Instant::now());
    let mut tunnel_open = false;
    loop {
        let wake = tokio::select! {
            () = sleep_until(clock.deadline()) => Wake::Deadline,
            input = inputs.recv() => input.map_or(Wake::Closed, Wake::Input),
            () = tokio::time::sleep(STATUS_INTERVAL), if tunnel_open => Wake::Status,
        };
        let Some(shared) = shared.upgrade() else { return };
        match wake {
            Wake::Closed => return,
            Wake::Deadline => return end_by_id(&shared, &ticket.join_id, SessionEnd::Error),
            Wake::Status => report_connected(&shared, &ticket, &host),
            Wake::Input(Input::Progress) => clock.progressed(Instant::now()),
            Wake::Input(Input::Spawned) => {
                clock.spawned(Instant::now());
                announce(&shared, &ticket, JoinState::Connecting);
            }
            Wake::Input(Input::FirstConnection) => clock.connected(),
            Wake::Input(Input::TunnelOpened) => {
                tunnel_open = true;
                report_connected(&shared, &ticket, &host);
            }
        }
    }
}

async fn sleep_until(deadline: Option<Instant>) {
    match deadline {
        Some(deadline) => tokio::time::sleep_until(deadline).await,
        None => std::future::pending().await,
    }
}

/// `connected` mit Weg und Umlaufzeit; ohne gewählten Weg gibt es nichts zu melden.
fn report_connected(shared: &Shared, ticket: &JoinTicket, host: &PeerId) {
    let Some(conn) = shared.friends.connection(host) else { return };
    let Some(path) = conn.path() else { return };
    let rtt_ms = conn.rtt().map(|rtt| u32::try_from(rtt.as_millis()).unwrap_or(u32::MAX));
    announce(shared, ticket, JoinState::Connected { path, rtt_ms });
}

/// Merkt sich den Stand für die Mod und meldet ihn der Oberfläche.
fn announce(shared: &Shared, ticket: &JoinTicket, state: JoinState) {
    shared.joins.remember(&ticket.join_id, &state);
    emit_state(shared, ticket, state);
}

/// Endet mit `hostOffline`, wenn die Verbindung zum Gastgeber länger als die Schonfrist fehlt (SPEC 6.2).
async fn watch_host(shared: Weak<Shared>, join_id: String, host: PeerId) {
    loop {
        let Some(shared) = shared.upgrade() else { return };
        if let Some(conn) = live_connection(&shared.friends, &host) {
            drop(shared);
            conn.closed().await;
            continue;
        }
        if !reconnects_within(&shared.friends, &host, shared.timers.host_offline_grace).await {
            return end_by_id(&shared, &join_id, SessionEnd::HostOffline);
        }
    }
}

async fn reconnects_within(friends: &Friends, host: &PeerId, grace: Duration) -> bool {
    let deadline = Instant::now() + grace;
    while Instant::now() < deadline {
        tokio::time::sleep(HOST_POLL).await;
        if live_connection(friends, host).is_some() {
            return true;
        }
    }
    false
}

/// Die Verbindung zum Gastgeber, wenn sie noch offen ist; eine eben geschlossene steht kurz noch in der Liste.
fn live_connection(friends: &Friends, host: &PeerId) -> Option<PeerConn> {
    friends.connection(host).filter(|conn| conn.closed().now_or_never().is_none())
}

#[cfg(test)]
mod tests {
    use super::*;

    const MINUTE: Duration = Duration::from_secs(60);

    #[tokio::test(start_paused = true)]
    async fn without_spawn_or_progress_the_join_ends_after_the_spawn_wait() {
        let start = Instant::now();
        let clock = JoinClock::start(JoinTimers::production(), start);

        assert_eq!(clock.deadline(), Some(start + 10 * MINUTE));
    }

    #[tokio::test(start_paused = true)]
    async fn progress_for_25_minutes_keeps_the_join_and_the_cap_ends_it_at_30() {
        let start = Instant::now();
        let mut clock = JoinClock::start(JoinTimers::production(), start);

        for minute in 1..=25 {
            let now = start + minute * MINUTE;
            assert!(clock.deadline().unwrap() > now, "alive at minute {minute}");
            clock.progressed(now);
        }
        clock.progressed(start + 29 * MINUTE);

        assert_eq!(clock.deadline(), Some(start + 30 * MINUTE), "31 minutes are past the cap");
    }

    #[tokio::test(start_paused = true)]
    async fn after_spawn_a_first_connection_at_9_minutes_is_in_time_and_at_11_too_late() {
        let start = Instant::now();
        let mut clock = JoinClock::start(JoinTimers::production(), start);

        clock.spawned(start);

        assert!(clock.deadline().unwrap() > start + 9 * MINUTE);
        assert!(clock.deadline().unwrap() < start + 11 * MINUTE);
    }

    #[tokio::test(start_paused = true)]
    async fn spawn_ends_the_cap_and_the_first_connection_ends_all_timers() {
        let start = Instant::now();
        let mut clock = JoinClock::start(JoinTimers::production(), start);

        clock.spawned(start + 29 * MINUTE);
        assert_eq!(clock.deadline(), Some(start + 39 * MINUTE), "the cap only applies before the spawn");
        clock.progressed(start + 30 * MINUTE);
        assert_eq!(clock.deadline(), Some(start + 39 * MINUTE), "progress after the spawn changes nothing");
        clock.connected();

        assert_eq!(clock.deadline(), None);
    }

    #[test]
    fn production_timers_follow_the_spec() {
        let timers = JoinTimers::production();

        assert_eq!(
            (timers.spawn_wait, timers.spawn_wait_cap, timers.first_connection, timers.host_offline_grace),
            (10 * MINUTE, 30 * MINUTE, 10 * MINUTE, Duration::from_secs(30))
        );
    }

    #[test]
    fn a_join_from_the_running_game_waits_two_minutes_for_the_first_connection_at_most() {
        let production = here_timers(JoinTimers::production());
        let quick = JoinTimers { first_connection: Duration::from_secs(3), ..JoinTimers::production() };

        assert_eq!(production.first_connection, Duration::from_secs(120));
        assert_eq!((production.spawn_wait, production.host_offline_grace), (10 * MINUTE, Duration::from_secs(30)));
        assert_eq!(here_timers(quick).first_connection, Duration::from_secs(3));
    }

    #[test]
    fn join_address_is_a_random_loopback_address_other_than_127_0_0_1() {
        let ip = join_ip().unwrap();

        assert!(ip.is_loopback());
        if !cfg!(target_os = "macos") {
            assert_ne!(ip, IpAddr::V4(Ipv4Addr::LOCALHOST));
            let IpAddr::V4(v4) = ip else { panic!("{ip}") };
            assert!(v4.octets()[1..].iter().all(|octet| (1..=254).contains(octet)));
        }
    }

    #[test]
    fn only_a_ready_plan_may_be_joined() {
        let plan = |verdict| JoinPlan {
            invite_id: "i".into(),
            summary: super::super::contract::InstanceSummary {
                name: "Welt".into(),
                minecraft_version: "1.19.4".into(),
                loader: super::super::contract::ModLoader::Vanilla,
                loader_version: None,
                mod_count: 0,
            },
            verdict,
            candidates: Vec::new(),
            create_vanilla: false,
            lookup_failed: false,
        };
        let key = |verdict| super::super::test_support::error_key(&ensure_matches(&plan(verdict)).unwrap_err());

        assert!(ensure_matches(&plan(JoinVerdict::Ready)).is_ok());
        assert_eq!(key(JoinVerdict::VersionUnsupported), "errors.friends.versionUnsupported");
        assert_eq!(key(JoinVerdict::MissingContent), "errors.friends.instanceMismatch");
        assert_eq!(key(JoinVerdict::NoInstance), "errors.friends.instanceMismatch");
    }

    fn gate(owner: OwnerLookup) -> LocalGate {
        LocalGate {
            listener: "127.1.2.3:40000".parse().unwrap(),
            game: Arc::new(OnceLock::new()),
            inputs: mpsc::unbounded_channel().0,
            owner,
            lookup_failed: AtomicBool::new(false),
        }
    }

    #[tokio::test]
    async fn an_unverifiable_owner_counts_as_foreign() {
        let client = "127.0.0.1:50000".parse().unwrap();
        let broken = gate(|_, _, _| Err(io::Error::other("table grew too fast")));

        assert!(!broken.owned_by_game(7, client).await);
        assert!(!broken.owned_by_game(7, client).await, "also after the first warning");
    }

    #[tokio::test]
    async fn the_owner_is_asked_about_the_connection_to_the_listener() {
        let client: SocketAddr = "127.0.0.1:50000".parse().unwrap();
        let owned = gate(|pid, from, to| Ok(pid == 7 && from.port() == 50000 && to == "127.1.2.3:40000".parse().unwrap()));

        assert!(owned.owned_by_game(7, client).await);
        assert!(!owned.owned_by_game(8, client).await);
    }

    #[test]
    fn host_refusals_become_messages() {
        let key = |code: &str| super::super::test_support::error_key(&refused(code));

        assert_eq!(key("notInvited"), "errors.friends.notInvited");
        assert_eq!(key("sessionNotFound"), "errors.friends.sessionNotFound");
        assert_eq!(key("rateLimited"), "errors.friends.rateLimited");
        assert_eq!(key("somethingNew"), "errors.friends.protocolUnsupported");
    }
}
