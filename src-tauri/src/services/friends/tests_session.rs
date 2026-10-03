//! Geteilte Welten mit echten Sockets (SPEC 13.1, Zeile R5): zwei Freunde-Dienste am In-Process-Relay, ein falscher
//! Minecraft-Server (gehört diesem Prozess, beantwortet die Statusabfrage, spiegelt nach dem Login) und ein falsches
//! Spiel, das sich wie der Client mit Handshake und Login Start verbindet. Echte Zeit mit kurzen Werten.
use std::borrow::Cow;
use std::future::Future;
use std::net::{IpAddr, Ipv4Addr, SocketAddr};
use std::str::FromStr;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use futures::future::BoxFuture;
use iroh::test_utils::run_relay_server;
use serde_json::{json, Value};
use tokio::io::{AsyncBufReadExt, AsyncReadExt, AsyncWriteExt, BufReader};
use tokio::net::{TcpListener, TcpStream};
use tokio::sync::{oneshot, Notify};
use tokio_util::sync::CancellationToken;

use super::contract::{
    FriendsEnableInput, FriendsSettings, GuestState, HostSession, Invite, JoinState, JoinTicket, JoinVerdict, LanStatus,
    ModLoader, PortSource, Presence, RevokeReason, SessionEnd,
};
use super::control::OpenFrame;
use super::events::NoEvents;
use super::hosting::RequestMessage;
use super::joining;
use super::limits::{OPEN_FRAME_LIMIT, REQUEST_FRAME_LIMIT};
use super::lookup::{LookupError, ModInfo, ModLookup};
use super::manifest::VersionIndex;
use super::mcproto::wire::{handshake, login_start, packet, varint};
use super::mcproto::{self, HOST_WINDOW};
use super::session_events::{SessionEvent, SessionEvents};
use super::sessions::{FriendSessions, SessionContext, VersionCatalog};
use super::test_support::{error_key, TempDir};
use super::{AccountProfile, Friends, JoinTimers, NetOptions};
use crate::error::AppResult;
use crate::models::{new_id, Instance, Mod, ModKind, ModSource, NewInstance};
use crate::services::gamesignal::{GameSignal, GameSignals};
use crate::services::modbridge::{ModBridge, ENV_PORT, ENV_TOKEN};
use crate::services::p2p::tunnel::LocalListener;
use crate::services::p2p::{frame, BiStream, PeerId, RelayEntry, RelayOperator, RelayTls};
use crate::services::store::JsonStore;
use crate::services::{lock, Dirs};

const LIMIT: Duration = Duration::from_secs(20);
const IDLE_TIMEOUT: Duration = Duration::from_secs(40);
/// Kurze Leerlaufzeit für den Absturz des Gastgebers (SPEC 6.5).
const CRASH_IDLE_TIMEOUT: Duration = Duration::from_secs(2);
/// Was SPEC 6.5 „within 3 s“ nennt.
const PROMPT: Duration = Duration::from_secs(3);
const ACCOUNT_UUID: &str = "069a79f4-44e9-4726-a5be-fca90e38aaf5";
const HOST_INSTANCE: &str = "inst-host";
const GUEST_INSTANCE: &str = "inst-guest";
const WELCOME: &[u8] = b"WELCOME";
/// Zeiten, die in den Szenen nie ablaufen; die Zeitgrenzen haben eigene Tests.
const RELAXED: JoinTimers = JoinTimers {
    spawn_wait: Duration::from_secs(600),
    spawn_wait_cap: Duration::from_secs(1800),
    first_connection: Duration::from_secs(600),
    host_offline_grace: Duration::from_secs(1),
};
/// Die Zeiten aus SPEC 13.1, Zeile R5.
const SHORT: JoinTimers = JoinTimers {
    spawn_wait: Duration::from_secs(2),
    spawn_wait_cap: Duration::from_secs(6),
    first_connection: Duration::from_secs(3),
    host_offline_grace: Duration::from_secs(1),
};

/// Startet ein Relay im Test-Prozess; es läuft, solange der zweite Wert lebt (wie in `tests.rs`).
async fn test_relay() -> (RelayEntry, impl Send) {
    let (map, url, server) = run_relay_server().await.unwrap();
    let quic_port = map.get(&url).unwrap().quic.as_ref().map(|quic| quic.port);
    let entry = RelayEntry { index: 0, url: Cow::Owned(url.to_string()), operator: RelayOperator::Pumpkin, quic_port };
    (entry, server)
}

fn options(relay: &RelayEntry) -> NetOptions {
    NetOptions {
        relay_map: vec![relay.clone()],
        hello_relay_only: true,
        relay_tls: RelayTls::InsecureForTests,
        idle_timeout: IDLE_TIMEOUT,
    }
}

async fn until<F, Fut>(what: &str, mut condition: F)
where
    F: FnMut() -> Fut,
    Fut: Future<Output = bool>,
{
    let deadline = Instant::now() + LIMIT;
    while !condition().await {
        assert!(Instant::now() < deadline, "{what}: not reached within {LIMIT:?}");
        tokio::time::sleep(Duration::from_millis(20)).await;
    }
}

async fn until_true(what: &str, condition: impl Fn() -> bool) {
    until(what, || std::future::ready(condition())).await;
}

/// Mojangs Versionsliste, auf zwei Einträge verkürzt.
struct FixedVersions;

impl VersionCatalog for FixedVersions {
    fn index(&self) -> BoxFuture<'_, AppResult<VersionIndex>> {
        Box::pin(async {
            Ok(VersionIndex::new([
                ("26.3".to_owned(), "2026-09-01T10:00:00+00:00".to_owned()),
                ("1.19.4".to_owned(), "2023-03-14T12:56:18+00:00".to_owned()),
            ]))
        })
    }
}

/// Modrinth kennt keine Datei: jede Mod zählt als erforderlich.
struct UnknownMods;

impl ModLookup for UnknownMods {
    fn classify<'a>(
        &'a self,
        _sha512: &'a [String],
    ) -> BoxFuture<'a, Result<std::collections::HashMap<String, ModInfo>, LookupError>> {
        Box::pin(async { Ok(std::collections::HashMap::new()) })
    }
}

#[derive(Default)]
struct RecordingEvents {
    events: Mutex<Vec<SessionEvent>>,
}

impl SessionEvents for RecordingEvents {
    fn emit(&self, event: SessionEvent) {
        lock(&self.events).push(event);
    }
}

impl RecordingEvents {
    fn collect<T>(&self, pick: impl Fn(&SessionEvent) -> Option<T>) -> Vec<T> {
        lock(&self.events).iter().filter_map(pick).collect()
    }

    fn join_states(&self) -> Vec<JoinState> {
        self.collect(|event| match event {
            SessionEvent::JoinSession(join) => Some(join.state.clone()),
            _ => None,
        })
    }

    fn join_ends(&self) -> Vec<SessionEnd> {
        let states = self.join_states().into_iter();
        states.filter_map(|state| if let JoinState::Ended { reason } = state { Some(reason) } else { None }).collect()
    }

    fn revocations(&self) -> Vec<RevokeReason> {
        self.collect(|event| match event {
            SessionEvent::InviteRevoked(revoked) => Some(revoked.reason),
            _ => None,
        })
    }

    fn host_ends(&self) -> Vec<SessionEnd> {
        self.collect(|event| match event {
            SessionEvent::HostSessionEnded(ended) => Some(ended.reason),
            _ => None,
        })
    }

    fn mod_confirm_requests(&self) -> Vec<String> {
        self.collect(|event| match event {
            SessionEvent::ModConfirm(confirm) => Some(confirm.request_id.clone()),
            _ => None,
        })
    }

    fn lan_events(&self) -> Vec<Option<LanStatus>> {
        self.collect(|event| match event {
            SessionEvent::Lan(lan) => Some(lan.lan.clone()),
            _ => None,
        })
    }
}

/// Ein Freunde-Dienst mit Sitzungen, eigenem Ordner, einer Vanilla-26.3-Instanz und Schlüsselbund im Speicher.
struct Node {
    friends: Friends,
    sessions: FriendSessions,
    events: Arc<RecordingEvents>,
    signals: GameSignals,
    bridge: ModBridge,
    instances: Arc<JsonStore<Instance>>,
    dirs: Dirs,
    _dir: TempDir,
}

impl Node {
    async fn online(options: NetOptions, name: &str, timers: JoinTimers) -> Self {
        Self::online_with(options, name, timers, Duration::from_secs(15)).await
    }

    async fn online_with(options: NetOptions, name: &str, timers: JoinTimers, liveness: Duration) -> Self {
        let dir = TempDir::new();
        let (signals, dirs) = (GameSignals::default(), Dirs::new(dir.path()));
        let bridge = ModBridge::new(signals.clone());
        let secrets = Arc::new(crate::services::secrets::MemorySecretStore::new());
        let friends = Friends::new(&dirs, secrets, signals.clone(), bridge.clone(), options).unwrap();
        let instances = Arc::new(JsonStore::open(dir.path().join("instances.json")).unwrap());
        let sessions = FriendSessions::new(SessionContext {
            friends: friends.clone(),
            signals: signals.clone(),
            bridge: bridge.clone(),
            instances: instances.clone(),
            dirs: dirs.clone(),
            lookup: Arc::new(UnknownMods),
            versions: Arc::new(FixedVersions),
            timers,
            liveness,
        });
        let events = Arc::new(RecordingEvents::default());
        sessions.start(events.clone()).unwrap();
        let account = AccountProfile::new(name, ACCOUNT_UUID);
        friends.start(Arc::new(NoEvents), Some(account.clone())).await;
        let input =
            FriendsEnableInput { display_name: name.into(), always_relay: false, accept_third_party_relays: false };
        friends.enable(input, Some(account)).await.unwrap();
        let node = Self { friends, sessions, events, signals, bridge, instances, dirs, _dir: dir };
        node.add_instance(HOST_INSTANCE, "26.3");
        node.add_instance(GUEST_INSTANCE, "26.3");
        node
    }

    fn add_instance(&self, id: &str, minecraft_version: &str) -> Instance {
        let mut instance = Instance::from_new(NewInstance {
            name: format!("Welt {id}"),
            minecraft_version: minecraft_version.into(),
            loader: ModLoader::Vanilla,
            loader_version: None,
        });
        instance.id = id.into();
        self.instances.upsert(instance).unwrap()
    }

    fn id(&self) -> PeerId {
        PeerId::from_str(&self.friends.state().me.unwrap().peer_id).unwrap()
    }

    /// Das Spiel der Instanz läuft, gestartet von diesem Prozess (seine Sockets gehören also diesem Spiel).
    fn spawn_game(&self, instance_id: &str, friend_join: Option<&str>) {
        self.spawn_game_as(instance_id, std::process::id(), friend_join);
    }

    /// Der Start scheitert, bevor das Spiel läuft.
    fn fail_launch(&self, ticket: &JoinTicket) {
        let (instance_id, friend_join) = (ticket.instance_id.clone(), ticket.join_id.clone());
        self.signals.send(GameSignal::LaunchFailed { instance_id, friend_join });
    }

    /// Das Spiel meldet einen LAN-Port (nur ein Hinweis, SPEC 6.4).
    fn open_lan(&self, port: u16, source: PortSource) {
        self.signals.send(GameSignal::LanOpened { instance_id: HOST_INSTANCE.into(), port, source });
    }

    fn spawn_game_as(&self, instance_id: &str, pid: u32, friend_join: Option<&str>) {
        self.signals.send(GameSignal::Spawned {
            instance_id: instance_id.into(),
            pid,
            online_account: true,
            friend_join: friend_join.map(str::to_owned),
        });
    }

    async fn presence_of(&self, peer: &PeerId) -> Presence {
        let friends = self.friends.list().await.unwrap();
        friends.into_iter().find(|friend| friend.id == peer.to_string()).map_or(Presence::Offline, |f| f.presence)
    }

    async fn session(&self) -> Option<HostSession> {
        self.sessions.host_sessions().await.unwrap().into_iter().next()
    }

    async fn guest_state(&self, guest: &PeerId) -> Option<(GuestState, bool)> {
        let session = self.session().await?;
        let id = guest.to_string();
        session.guests.into_iter().find(|g| g.friend_id == id).map(|guest| (guest.state, guest.kicked))
    }

    async fn wait_guest(&self, guest: &PeerId, expected: (GuestState, bool)) {
        until(&format!("guest {expected:?}"), || async move { self.guest_state(guest).await == Some(expected) }).await;
    }

    async fn open_invite(&self) -> Invite {
        until("invite received", || async move { !self.sessions.invites().await.unwrap().is_empty() }).await;
        self.sessions.invites().await.unwrap().remove(0)
    }

    async fn wait_join_end(&self, reason: SessionEnd) {
        until_true(&format!("join ended {reason:?}"), || self.events.join_ends().contains(&reason)).await;
    }

    async fn wait_revoked(&self, reason: RevokeReason) {
        until_true(&format!("invite revoked {reason:?}"), || self.events.revocations().contains(&reason)).await;
    }

    async fn wait_host_end(&self, reason: SessionEnd) {
        until_true(&format!("host session ended {reason:?}"), || self.events.host_ends().contains(&reason)).await;
    }

    async fn wait_lan(&self, instance_id: &str) -> LanStatus {
        until("verified LAN port", || async move { self.sessions.lan_status(instance_id).await.unwrap().is_some() })
            .await;
        self.sessions.lan_status(instance_id).await.unwrap().unwrap()
    }
}

async fn incoming_request_id(node: &Node) -> String {
    until("incoming request", || async move { !node.friends.requests().await.unwrap().is_empty() }).await;
    node.friends.requests().await.unwrap().remove(0).id
}

async fn befriend(a: &Node, b: &Node) {
    let code = a.friends.code_create().await.unwrap().code.unwrap();
    b.friends.add(&code).await.unwrap();
    let request = incoming_request_id(a).await;
    a.friends.answer_request(&request, true).await.unwrap();
    let (a_id, b_id) = (a.id(), b.id());
    until("both online", || async move {
        a.presence_of(&b_id).await == Presence::Online && b.presence_of(&a_id).await == Presence::Online
    })
    .await;
}

/// Ein Minecraft-Server mit offener LAN-Welt: Statusabfrage wie das Spiel, nach dem Login ein `WELCOME`, dann ein
/// Spiegel. Zählt jede angenommene Verbindung.
struct FakeServer {
    port: u16,
    connections: Arc<AtomicUsize>,
    close: CancellationToken,
}

impl FakeServer {
    async fn start() -> Self {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let port = listener.local_addr().unwrap().port();
        let (connections, close) = (Arc::new(AtomicUsize::new(0)), CancellationToken::new());
        let (counted, closed) = (connections.clone(), close.clone());
        tokio::spawn(async move {
            loop {
                let accepted = tokio::select! {
                    accepted = listener.accept() => accepted,
                    () = closed.cancelled() => return,
                };
                let Ok((stream, _)) = accepted else { return };
                counted.fetch_add(1, Ordering::SeqCst);
                tokio::spawn(serve_game(stream));
            }
        });
        Self { port, connections, close }
    }

    fn connections(&self) -> usize {
        self.connections.load(Ordering::SeqCst)
    }
}

async fn serve_game(mut stream: TcpStream) {
    let check = |bytes: &[u8]| mcproto::check_handshake(bytes, HOST_WINDOW.max_bytes);
    let Some(((opening, _), _)) = mcproto::read_checked(&mut stream, HOST_WINDOW, check).await else { return };
    if opening.next == mcproto::NextState::Status {
        let json = r#"{"version":{"name":"26.3","protocol":774},"players":{"max":8,"online":1},"description":"x"}"#;
        let status = packet(&[varint(0), varint(json.len() as i32), json.as_bytes().to_vec()].concat());
        let _ = stream.write_all(&status).await;
        return;
    }
    let _ = stream.write_all(WELCOME).await;
    let (mut read, mut write) = stream.split();
    let _ = tokio::io::copy(&mut read, &mut write).await;
}

/// Gastgeber `host` teilt seine Welt (LAN-Port aus dem Log, geprüft) und lädt `guest` ein.
async fn share_with(host: &Node, guest: &Node, server: &FakeServer) -> HostSession {
    host.spawn_game(HOST_INSTANCE, None);
    host.open_lan(server.port, PortSource::Log);
    host.wait_lan(HOST_INSTANCE).await;
    let session = host.sessions.host_start(HOST_INSTANCE, None, false).await.unwrap();
    host.sessions.host_invite(&session.id, vec![guest.id().to_string()]).await.unwrap()
}

/// Zwei befreundete Dienste; der Gastgeber teilt und hat den Gast eingeladen.
struct Scene {
    host: Node,
    guest: Node,
    server: FakeServer,
    session: HostSession,
    invite: Invite,
    _relay: Box<dyn Send>,
}

impl Scene {
    async fn shared() -> Self {
        Self::shared_with(RELAXED, Duration::from_secs(15)).await
    }

    async fn shared_with(timers: JoinTimers, liveness: Duration) -> Self {
        let (relay, server_guard) = test_relay().await;
        let host = Node::online_with(options(&relay), "Anna", RELAXED, liveness).await;
        let guest = Node::online(options(&relay), "Bert", timers).await;
        befriend(&host, &guest).await;
        let server = FakeServer::start().await;
        let session = share_with(&host, &guest, &server).await;
        let invite = guest.open_invite().await;
        Self { host, guest, server, session, invite, _relay: Box::new(server_guard) }
    }

    async fn join(&self) -> JoinTicket {
        self.guest.sessions.invite_join(&self.invite.id, GUEST_INSTANCE).await.unwrap()
    }

    /// Beitritt mit gestartetem Spiel, das über den Tunnel beim Server angemeldet ist.
    async fn playing(&self) -> (JoinTicket, TcpStream) {
        let ticket = self.join().await;
        self.guest.spawn_game(GUEST_INSTANCE, Some(&ticket.join_id));
        let game = enter_world(&ticket.address).await;
        self.host.wait_guest(&self.guest.id(), (GuestState::Connected, false)).await;
        (ticket, game)
    }

    /// Ein Stream, wie ihn ein Gast-Launcher öffnet, der Widerrufe nicht beachtet.
    async fn raw_tunnel(&self) -> Value {
        let mut stream = self.raw_stream(&OpenFrame::Tunnel { session_id: self.session.id.clone() }).await;
        stream.read_frame::<Value>(OPEN_FRAME_LIMIT).await.unwrap()
    }

    async fn raw_manifest_request(&self) -> Value {
        let mut stream = self.raw_stream(&OpenFrame::Request).await;
        let request = RequestMessage::ManifestRequest { session_id: self.session.id.clone() };
        frame::write(&mut stream, &request, REQUEST_FRAME_LIMIT).await.unwrap();
        stream.read_frame::<Value>(REQUEST_FRAME_LIMIT).await.unwrap()
    }

    async fn raw_stream(&self, open: &OpenFrame) -> BiStream {
        let conn = self.guest.friends.dial_friend(&self.host.id()).await.unwrap();
        let mut stream = conn.open_bi().await.unwrap();
        frame::write(&mut stream, open, OPEN_FRAME_LIMIT).await.unwrap();
        stream
    }
}

fn tunnel_ok() -> Value {
    json!({ "type": "tunnelOk" })
}

fn refused(code: &str) -> Value {
    json!({ "type": "error", "code": code })
}

/// Verbindet sich wie das Spiel mit der Adresse des Beitritts und meldet sich an; liefert die Verbindung erst, wenn
/// der Server über den Tunnel geantwortet hat.
async fn enter_world(address: &str) -> TcpStream {
    let addr: SocketAddr = address.parse().unwrap();
    let mut game = TcpStream::connect(addr).await.unwrap();
    game.write_all(&opening_for(addr)).await.unwrap();
    let mut reply = [0u8; WELCOME.len()];
    tokio::time::timeout(LIMIT, game.read_exact(&mut reply)).await.unwrap().unwrap();
    assert_eq!(reply, WELCOME);
    game
}

/// Handshake und Login Start, wie das Spiel sie an die Adresse des Beitritts schickt.
fn opening_for(addr: SocketAddr) -> Vec<u8> {
    [handshake(&addr.ip().to_string(), addr.port(), 2), login_start("Bert")].concat()
}

/// Die Verbindung wurde geschlossen (Ende, Fehler oder Zurücksetzen), bevor `wait` um ist.
async fn is_closed_within(game: &mut TcpStream, wait: Duration) -> bool {
    let mut byte = [0u8; 1];
    matches!(tokio::time::timeout(wait, game.read(&mut byte)).await, Ok(Ok(0) | Err(_)))
}

/// Die Adresse nimmt keine Verbindung mehr an, oder schließt sie sofort.
async fn refuses_connections(address: &str) -> bool {
    match TcpStream::connect(address).await {
        Err(_) => true,
        Ok(mut tcp) => is_closed_within(&mut tcp, Duration::from_secs(1)).await,
    }
}

// ---- Gastgeber: Prüfungen vor dem Teilen (SPEC 6.1) ----

#[tokio::test]
async fn hosting_needs_a_running_microsoft_game_of_1_20_or_later() {
    let (relay, _server) = test_relay().await;
    let host = Node::online(options(&relay), "Anna", RELAXED).await;
    host.add_instance("old", "1.19.4");
    let start = |instance: &'static str| host.sessions.host_start(instance, None, false);

    let not_running = start(HOST_INSTANCE).await.unwrap_err();
    host.add_instance("offline", "26.3");
    host.spawn_game("old", None);
    let offline = GameSignal::Spawned { instance_id: "offline".into(), pid: 1, online_account: false, friend_join: None };
    host.signals.send(offline);
    let known = || async { start("offline").await.is_err_and(|e| error_key(&e) != "errors.friends.gameNotRunning") };
    until("games known", known).await;

    assert_eq!(error_key(&not_running), "errors.friends.gameNotRunning");
    assert_eq!(error_key(&start("offline").await.unwrap_err()), "errors.friends.msAccountRequired");
    assert_eq!(error_key(&start("old").await.unwrap_err()), "errors.friends.versionUnsupported");
}

#[tokio::test]
async fn a_port_must_be_given_in_range_owned_by_the_game_and_answering() {
    let (relay, _server) = test_relay().await;
    let host = Node::online(options(&relay), "Anna", RELAXED).await;
    let server = FakeServer::start().await;
    let http = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let http_port = http.local_addr().unwrap().port();
    tokio::spawn(async move {
        while let Ok((mut stream, _)) = http.accept().await {
            let _ = stream.write_all(b"HTTP/1.1 400 Bad Request\r\n\r\n").await;
        }
    });
    let unused = TcpListener::bind("127.0.0.1:0").await.unwrap().local_addr().unwrap().port();
    host.spawn_game(HOST_INSTANCE, None);
    let start = |port: Option<u16>| host.sessions.host_start(HOST_INSTANCE, port, false);
    let known = || async { start(Some(80)).await.is_err_and(|e| error_key(&e) == "errors.friends.portInvalid") };
    until("game known", known).await;

    assert_eq!(error_key(&start(None).await.unwrap_err()), "errors.friends.lanPortUnknown");
    assert_eq!(error_key(&start(Some(unused)).await.unwrap_err()), "errors.friends.portNotGame");
    assert_eq!(error_key(&start(Some(http_port)).await.unwrap_err()), "errors.friends.lanUnreachable");
    let session = start(Some(server.port)).await.unwrap();
    let manual = LanStatus { port: server.port, source: PortSource::Manual, pid: std::process::id() };
    assert_eq!((session.port, session.port_source, session.pid), (manual.port, manual.source, manual.pid));
    assert_eq!(host.events.lan_events().last(), Some(&Some(manual)));
    assert_eq!(error_key(&start(Some(server.port)).await.unwrap_err()), "errors.friends.sessionActive");
}

#[tokio::test]
async fn a_lan_hint_counts_only_after_verification() {
    let (relay, _server) = test_relay().await;
    let host = Node::online(options(&relay), "Anna", RELAXED).await;
    let server = FakeServer::start().await;
    let unused = TcpListener::bind("127.0.0.1:0").await.unwrap().local_addr().unwrap().port();
    host.spawn_game(HOST_INSTANCE, None);

    host.open_lan(unused, PortSource::Mod);
    tokio::time::sleep(Duration::from_millis(500)).await;
    let ignored = host.sessions.lan_status(HOST_INSTANCE).await.unwrap();
    host.open_lan(server.port, PortSource::Mod);
    let verified = host.wait_lan(HOST_INSTANCE).await;
    host.signals.send(GameSignal::LanClosed { instance_id: HOST_INSTANCE.into() });
    until("lan closed", || async { host.sessions.lan_status(HOST_INSTANCE).await.unwrap().is_none() }).await;

    assert_eq!(ignored, None);
    assert_eq!(verified, LanStatus { port: server.port, source: PortSource::Mod, pid: std::process::id() });
    assert_eq!(host.events.lan_events().last(), Some(&None));
}

#[tokio::test]
async fn a_new_port_replaces_the_session_port_only_after_verification() {
    let scene = Scene::shared().await;
    let moved = FakeServer::start().await;
    let unused = TcpListener::bind("127.0.0.1:0").await.unwrap().local_addr().unwrap().port();

    scene.host.open_lan(unused, PortSource::Mod);
    tokio::time::sleep(Duration::from_millis(500)).await;
    let kept = scene.host.session().await.unwrap().port;
    scene.host.open_lan(moved.port, PortSource::Mod);
    until("port switched", || async { scene.host.session().await.unwrap().port == moved.port }).await;
    let (_ticket, _game) = scene.playing().await;

    assert_eq!(kept, scene.server.port);
    assert_eq!(scene.host.session().await.unwrap().port_source, PortSource::Mod);
    assert_eq!(moved.connections(), 2, "the verification ping and the game");
}

#[tokio::test]
async fn only_connected_confirmed_friends_can_be_invited() {
    let scene = Scene::shared().await;
    let stranger = super::identity::Identity::generate().peer_id();

    let unknown = scene.host.sessions.host_invite(&scene.session.id, vec![stranger]).await.unwrap_err();
    scene.guest.friends.disable().await.unwrap();
    until("guest offline", || async { scene.host.presence_of(&scene.guest.id()).await == Presence::Offline }).await;
    let offline = scene.host.sessions.host_invite(&scene.session.id, vec![scene.guest.id().to_string()]).await;

    assert_eq!(error_key(&unknown), "errors.friends.notFound.friend");
    assert_eq!(error_key(&offline.unwrap_err()), "errors.friends.peerOffline");
}

// ---- Tunnel (SPEC 6.1, 6.2) ----

#[tokio::test]
async fn the_game_of_the_guest_reaches_the_host_world_through_the_tunnel() {
    let scene = Scene::shared().await;

    let (_ticket, mut game) = scene.playing().await;
    game.write_all(b"ping").await.unwrap();
    let mut echoed = [0u8; 4];
    tokio::time::timeout(LIMIT, game.read_exact(&mut echoed)).await.unwrap().unwrap();

    assert_eq!(&echoed, b"ping");
    let states = scene.guest.events.join_states();
    assert_eq!(states[..2], [JoinState::WaitingForGame, JoinState::Connecting]);
    until_true("connected reported", || {
        scene.guest.events.join_states().iter().any(|state| matches!(state, JoinState::Connected { .. }))
    })
    .await;
}

#[tokio::test]
async fn a_tunnel_without_a_valid_handshake_never_reaches_the_lan_port() {
    let scene = Scene::shared().await;
    let before = scene.server.connections();
    let openings = [
        vec![0xFE, 0x01, 0xFA],
        handshake("localhost", scene.server.port, 3),
        [handshake("localhost", scene.server.port, 2), login_start("bad name")].concat(),
        varint(2000),
    ];

    for opening in openings {
        let mut stream = scene.raw_stream(&OpenFrame::Tunnel { session_id: scene.session.id.clone() }).await;
        assert_eq!(stream.read_frame::<Value>(OPEN_FRAME_LIMIT).await.unwrap(), tunnel_ok());
        stream.write_all(&opening).await.unwrap();
        let mut rest = Vec::new();
        let read = tokio::time::timeout(LIMIT, stream.read_to_end(&mut rest)).await.unwrap();
        assert!(read.is_err(), "the stream is reset");
    }

    assert_eq!(scene.server.connections(), before);
}

#[tokio::test]
async fn a_local_connection_from_another_process_opens_no_stream() {
    let scene = Scene::shared().await;
    let ticket = scene.join().await;
    let addr: SocketAddr = ticket.address.parse().unwrap();
    let before = scene.server.connections();

    scene.guest.spawn_game_as(GUEST_INSTANCE, std::process::id().wrapping_add(1), Some(&ticket.join_id));
    tokio::time::sleep(Duration::from_millis(200)).await;
    let mut foreign_process = TcpStream::connect(addr).await.unwrap();
    foreign_process.write_all(&opening_for(addr)).await.unwrap();

    assert!(is_closed_within(&mut foreign_process, LIMIT).await);
    assert_eq!(scene.server.connections(), before);
    assert_eq!(scene.host.guest_state(&scene.guest.id()).await, Some((GuestState::Invited, false)));
}

#[tokio::test]
async fn a_handshake_naming_another_address_is_refused() {
    let scene = Scene::shared().await;
    let ticket = scene.join().await;
    let addr: SocketAddr = ticket.address.parse().unwrap();
    scene.guest.spawn_game(GUEST_INSTANCE, Some(&ticket.join_id));
    tokio::time::sleep(Duration::from_millis(200)).await;
    let before = scene.server.connections();

    let mut game = TcpStream::connect(addr).await.unwrap();
    game.write_all(&[handshake("127.0.0.1", addr.port(), 2), login_start("Bert")].concat()).await.unwrap();

    assert!(is_closed_within(&mut game, LIMIT).await);
    assert_eq!(scene.server.connections(), before);
    assert_eq!(scene.host.guest_state(&scene.guest.id()).await, Some((GuestState::Invited, false)));
}

#[tokio::test]
async fn before_the_first_valid_connection_only_one_is_handled_at_a_time() {
    let scene = Scene::shared().await;
    let ticket = scene.join().await;
    scene.guest.spawn_game(GUEST_INSTANCE, Some(&ticket.join_id));
    tokio::time::sleep(Duration::from_millis(200)).await;

    let _waiting = TcpStream::connect(&ticket.address).await.unwrap();
    tokio::time::sleep(Duration::from_millis(100)).await;
    let mut second = TcpStream::connect(&ticket.address).await.unwrap();

    assert!(is_closed_within(&mut second, Duration::from_secs(1)).await);
}

#[tokio::test]
async fn after_the_first_valid_connection_four_run_at_once() {
    let scene = Scene::shared().await;
    let (ticket, _first) = scene.playing().await;

    let mut more = Vec::new();
    for _ in 0..3 {
        more.push(enter_world(&ticket.address).await);
    }

    assert_eq!(more.len(), 3);
}

#[tokio::test]
async fn the_session_ends_when_the_port_stops_listening() {
    let scene = Scene::shared_with(RELAXED, Duration::from_millis(200)).await;
    let (_ticket, mut game) = scene.playing().await;

    scene.server.close.cancel();

    scene.host.wait_host_end(SessionEnd::LanClosed).await;
    scene.guest.wait_join_end(SessionEnd::Stopped).await;
    assert!(is_closed_within(&mut game, LIMIT).await);
}

// ---- Geschlossene Einladungen (SPEC 5.4) ----

#[tokio::test]
async fn a_kicked_guest_gets_not_invited_until_the_host_invites_again() {
    let scene = Scene::shared().await;
    let (_ticket, mut game) = scene.playing().await;
    let guest = scene.guest.id();

    scene.host.sessions.host_kick(&scene.session.id, &guest.to_string()).await.unwrap();

    scene.guest.wait_revoked(RevokeReason::Kicked).await;
    scene.guest.wait_join_end(SessionEnd::Kicked).await;
    assert!(is_closed_within(&mut game, LIMIT).await);
    assert_eq!(scene.host.guest_state(&guest).await, Some((GuestState::Left, true)));
    assert_eq!(scene.raw_tunnel().await, refused("notInvited"));
    assert_eq!(scene.raw_manifest_request().await, refused("notInvited"));
    assert_eq!(scene.host.guest_state(&guest).await, Some((GuestState::Left, true)));
    scene.host.sessions.host_invite(&scene.session.id, vec![guest.to_string()]).await.unwrap();
    assert_eq!(scene.host.guest_state(&guest).await, Some((GuestState::Invited, false)));
    assert_eq!(scene.raw_tunnel().await, tunnel_ok());
}

#[tokio::test]
async fn a_declined_invite_is_closed_until_the_host_invites_again() {
    let scene = Scene::shared().await;
    let guest = scene.guest.id();

    scene.guest.sessions.invite_decline(&scene.invite.id).await.unwrap();

    scene.host.wait_guest(&guest, (GuestState::Declined, false)).await;
    assert!(scene.guest.sessions.invites().await.unwrap().is_empty());
    assert_eq!(scene.raw_tunnel().await, refused("notInvited"));
    assert_eq!(scene.raw_manifest_request().await, refused("notInvited"));
    scene.host.sessions.host_invite(&scene.session.id, vec![guest.to_string()]).await.unwrap();
    assert_eq!(scene.raw_tunnel().await, tunnel_ok());
}

#[tokio::test]
async fn a_guest_who_left_may_rejoin_while_the_invite_is_open() {
    let scene = Scene::shared().await;
    let (ticket, _game) = scene.playing().await;

    scene.guest.sessions.join_leave(&ticket.join_id).await.unwrap();
    scene.host.wait_guest(&scene.guest.id(), (GuestState::Left, false)).await;
    let (_again, _game) = scene.playing().await;

    assert_eq!(scene.host.guest_state(&scene.guest.id()).await, Some((GuestState::Connected, false)));
}

#[tokio::test]
async fn strangers_to_the_session_get_session_not_found() {
    let scene = Scene::shared().await;

    let mut stream = scene.raw_stream(&OpenFrame::Tunnel { session_id: crate::models::new_id() }).await;

    assert_eq!(stream.read_frame::<Value>(OPEN_FRAME_LIMIT).await.unwrap(), refused("sessionNotFound"));
}

// ---- Abgleich vor dem Beitritt (SPEC 5.5, 5.6, 6.2) ----

#[tokio::test]
async fn the_plan_finds_the_matching_instance_and_a_mismatch_cannot_join() {
    let (relay, _server) = test_relay().await;
    let host = Node::online(options(&relay), "Anna", RELAXED).await;
    let guest = Node::online(options(&relay), "Bert", RELAXED).await;
    befriend(&host, &guest).await;
    with_mod(&host, HOST_INSTANCE, "lithium.jar", b"lithium");
    with_mod(&guest, GUEST_INSTANCE, "lithium.jar", b"lithium");
    guest.add_instance("bare", "26.3");
    make_fabric(&guest, "bare");
    let server = FakeServer::start().await;
    share_with(&host, &guest, &server).await;
    let invite = guest.open_invite().await;

    let plan = guest.sessions.invite_plan(&invite.id).await.unwrap();
    let mismatch = guest.sessions.invite_join(&invite.id, "bare").await.unwrap_err();

    assert_eq!(plan.verdict, JoinVerdict::Ready);
    assert_eq!(plan.candidates[0].instance_id, GUEST_INSTANCE);
    assert_eq!(plan.candidates[1].missing[0].file_name, "lithium.jar");
    assert_eq!(error_key(&mismatch), "errors.friends.instanceMismatch");
    assert!(guest.sessions.invite_join(&invite.id, GUEST_INSTANCE).await.is_ok());
}

#[tokio::test]
async fn the_manifest_follows_a_changed_mod_list_of_the_host() {
    let (relay, _server) = test_relay().await;
    let host = Node::online(options(&relay), "Anna", RELAXED).await;
    let guest = Node::online(options(&relay), "Bert", RELAXED).await;
    befriend(&host, &guest).await;
    with_mod(&host, HOST_INSTANCE, "lithium.jar", b"lithium");
    with_mod(&guest, GUEST_INSTANCE, "lithium.jar", b"lithium");
    let server = FakeServer::start().await;
    share_with(&host, &guest, &server).await;
    let invite = guest.open_invite().await;
    let before = guest.sessions.invite_plan(&invite.id).await.unwrap();

    with_mod(&host, HOST_INSTANCE, "sodium.jar", b"sodium");
    let after = guest.sessions.invite_plan(&invite.id).await.unwrap();

    assert_eq!(before.verdict, JoinVerdict::Ready);
    assert_eq!(after.verdict, JoinVerdict::MissingContent);
    assert_eq!(after.candidates[0].missing[0].file_name, "sodium.jar");
}

fn make_fabric(node: &Node, instance_id: &str) {
    node.instances.modify(instance_id, |instance| instance.loader = ModLoader::Fabric).unwrap();
}

/// Legt eine aktive Mod-Datei in eine Fabric-Instanz.
fn with_mod(node: &Node, instance_id: &str, file_name: &str, content: &[u8]) {
    let dir = node.dirs.mods_dir(instance_id);
    std::fs::create_dir_all(&dir).unwrap();
    std::fs::write(dir.join(file_name), content).unwrap();
    make_fabric(node, instance_id);
    node.instances
        .modify(instance_id, |instance| {
            instance.mods.push(Mod {
                id: file_name.into(),
                name: file_name.into(),
                version: "1".into(),
                source: ModSource::Local,
                file_name: file_name.into(),
                sha1: None,
                enabled: true,
                kind: ModKind::Mod,
                required_by: Vec::new(),
                pinned: false,
                pack_managed: false,
            });
        })
        .unwrap();
}

#[tokio::test]
async fn an_unknown_invite_cannot_be_joined() {
    let scene = Scene::shared().await;

    let unknown = scene.guest.sessions.invite_join("nope", GUEST_INSTANCE).await.unwrap_err();

    assert_eq!(error_key(&unknown), "errors.friends.notFound.invite");
}

// ---- Zeitgrenzen des Beitritts auf echter Zeit (SPEC 6.2, 13.1 R5) ----

#[tokio::test]
async fn without_spawn_and_progress_the_join_ends_after_the_spawn_wait() {
    let scene = Scene::shared_with(SHORT, Duration::from_secs(15)).await;
    let joined = Instant::now();

    let ticket = scene.join().await;

    scene.guest.wait_join_end(SessionEnd::Error).await;
    let waited = joined.elapsed();
    assert!(waited >= Duration::from_millis(1800) && waited < Duration::from_millis(3500), "{waited:?}");
    assert!(refuses_connections(&ticket.address).await);
}

#[tokio::test]
async fn progress_keeps_waiting_for_the_game_until_the_cap() {
    let scene = Scene::shared_with(SHORT, Duration::from_secs(15)).await;
    let joined = Instant::now();
    let ticket = scene.join().await;
    let progress = GameSignal::LaunchProgress { instance_id: GUEST_INSTANCE.into(), friend_join: ticket.join_id };

    while joined.elapsed() < Duration::from_secs(3) {
        scene.guest.signals.send(progress.clone());
        tokio::time::sleep(Duration::from_secs(1)).await;
    }
    let alive_past_spawn_wait = scene.guest.events.join_ends().is_empty();
    while scene.guest.events.join_ends().is_empty() && joined.elapsed() < LIMIT {
        scene.guest.signals.send(progress.clone());
        tokio::time::sleep(Duration::from_secs(1)).await;
    }

    assert!(alive_past_spawn_wait);
    assert_eq!(scene.guest.events.join_ends(), [SessionEnd::Error]);
    let waited = joined.elapsed();
    assert!(waited >= Duration::from_millis(5500) && waited < Duration::from_millis(7500), "{waited:?}");
}

#[tokio::test]
async fn after_the_spawn_a_connection_at_two_seconds_is_in_time() {
    let scene = Scene::shared_with(SHORT, Duration::from_secs(15)).await;
    let ticket = scene.join().await;
    scene.guest.spawn_game(GUEST_INSTANCE, Some(&ticket.join_id));

    tokio::time::sleep(Duration::from_secs(2)).await;
    let _game = enter_world(&ticket.address).await;
    tokio::time::sleep(Duration::from_secs(2)).await;

    assert!(scene.guest.events.join_ends().is_empty());
}

#[tokio::test]
async fn after_the_spawn_no_connection_within_three_seconds_ends_the_join() {
    let scene = Scene::shared_with(SHORT, Duration::from_secs(15)).await;
    let ticket = scene.join().await;
    let spawned = Instant::now();
    scene.guest.spawn_game(GUEST_INSTANCE, Some(&ticket.join_id));

    scene.guest.wait_join_end(SessionEnd::Error).await;
    let waited = spawned.elapsed();
    tokio::time::sleep(Duration::from_secs(4).saturating_sub(spawned.elapsed())).await;

    assert!(waited >= Duration::from_millis(2800) && waited < Duration::from_millis(4000), "{waited:?}");
    assert!(refuses_connections(&ticket.address).await);
}

#[tokio::test]
async fn a_failed_launch_ends_the_join_at_once_and_closes_the_address() {
    let scene = Scene::shared_with(SHORT, Duration::from_secs(15)).await;
    let ticket = scene.join().await;
    let failed = Instant::now();

    scene.guest.fail_launch(&ticket);

    scene.guest.wait_join_end(SessionEnd::Error).await;
    assert!(failed.elapsed() < Duration::from_millis(100), "{:?}", failed.elapsed());
    assert!(refuses_connections(&ticket.address).await);
    assert_eq!(scene.host.guest_state(&scene.guest.id()).await, Some((GuestState::Invited, false)));
}

#[tokio::test]
async fn a_new_join_ends_the_previous_one_with_left() {
    let scene = Scene::shared().await;
    let first = scene.join().await;

    let second = scene.join().await;

    assert_eq!(scene.guest.events.join_ends(), [SessionEnd::Left]);
    assert!(refuses_connections(&first.address).await);
    assert_ne!(first.join_id, second.join_id);
}

#[tokio::test]
async fn a_join_started_while_another_runs_ends_that_one_exactly_once() {
    let scene = Scene::shared().await;
    let shared = &scene.guest.sessions.shared;
    let received = shared.invites.open_invite(&scene.invite.id).unwrap();
    let mut addresses = Vec::new();

    for _ in 0..2 {
        let listener = LocalListener::bind(IpAddr::V4(Ipv4Addr::LOCALHOST)).await.unwrap();
        let address = listener.addr.to_string();
        let ticket = JoinTicket {
            join_id: new_id(),
            invite_id: scene.invite.id.clone(),
            instance_id: GUEST_INSTANCE.into(),
            address: address.clone(),
        };
        joining::start_join(shared, &received, ticket, listener);
        addresses.push(address);
    }

    until("the first listener closed", || async { listening_count(&addresses).await == 1 }).await;
    assert_eq!(scene.guest.events.join_ends(), [SessionEnd::Left]);
}

/// Wie viele der Adressen noch Verbindungen annehmen.
async fn listening_count(addresses: &[String]) -> usize {
    let mut count = 0;
    for address in addresses {
        count += usize::from(TcpStream::connect(address).await.is_ok());
    }
    count
}

// ---- Jede Zeile von SPEC 6.5 ----

#[tokio::test]
async fn row_host_stops() {
    let scene = Scene::shared().await;
    let (_ticket, mut game) = scene.playing().await;

    scene.host.sessions.host_stop(&scene.session.id).await.unwrap();

    scene.host.wait_host_end(SessionEnd::Stopped).await;
    scene.guest.wait_revoked(RevokeReason::Stopped).await;
    scene.guest.wait_join_end(SessionEnd::Stopped).await;
    assert!(is_closed_within(&mut game, LIMIT).await);
}

#[tokio::test]
async fn row_host_quits_to_title() {
    let scene = Scene::shared().await;
    let (_ticket, mut game) = scene.playing().await;

    scene.host.signals.send(GameSignal::LanClosed { instance_id: HOST_INSTANCE.into() });

    scene.host.wait_host_end(SessionEnd::LanClosed).await;
    scene.guest.wait_revoked(RevokeReason::Stopped).await;
    scene.guest.wait_join_end(SessionEnd::Stopped).await;
    assert!(is_closed_within(&mut game, LIMIT).await);
}

#[tokio::test]
async fn row_host_game_exits() {
    let scene = Scene::shared().await;
    let (_ticket, mut game) = scene.playing().await;

    scene.host.signals.send(GameSignal::Exited { instance_id: HOST_INSTANCE.into() });

    scene.host.wait_host_end(SessionEnd::GameExited).await;
    scene.guest.wait_join_end(SessionEnd::Stopped).await;
    assert!(is_closed_within(&mut game, LIMIT).await);
}

#[tokio::test]
async fn row_host_launcher_exits_normally() {
    let scene = Scene::shared().await;
    let (_ticket, mut game) = scene.playing().await;
    let exited = Instant::now();

    scene.host.friends.shutdown().await;

    scene.guest.wait_revoked(RevokeReason::Stopped).await;
    scene.guest.wait_join_end(SessionEnd::Stopped).await;
    assert!(exited.elapsed() <= PROMPT, "{:?}", exited.elapsed());
    assert!(is_closed_within(&mut game, LIMIT).await);
}

#[tokio::test]
async fn row_host_disables_friends() {
    let scene = Scene::shared().await;
    let (_ticket, mut game) = scene.playing().await;
    let disabled = Instant::now();

    scene.host.friends.disable().await.unwrap();

    scene.host.wait_host_end(SessionEnd::Disabled).await;
    scene.guest.wait_revoked(RevokeReason::Stopped).await;
    scene.guest.wait_join_end(SessionEnd::Stopped).await;
    assert!(disabled.elapsed() <= PROMPT, "{:?}", disabled.elapsed());
    assert!(is_closed_within(&mut game, LIMIT).await);
}

#[tokio::test]
async fn row_host_changes_always_relay() {
    let scene = Scene::shared().await;
    let (_ticket, mut game) = scene.playing().await;
    let changed = Instant::now();

    let settings = FriendsSettings { display_name: "Anna".into(), always_relay: true };
    scene.host.friends.update_settings(settings).await.unwrap();

    scene.host.wait_host_end(SessionEnd::Stopped).await;
    scene.guest.wait_join_end(SessionEnd::Stopped).await;
    assert!(changed.elapsed() <= PROMPT, "{:?}", changed.elapsed());
    assert!(is_closed_within(&mut game, LIMIT).await);
}

#[tokio::test]
async fn row_host_rotates_its_identity() {
    let scene = Scene::shared().await;
    let (_ticket, mut game) = scene.playing().await;
    let rotated = Instant::now();

    scene.host.friends.rotate_identity().await.unwrap();

    scene.host.wait_host_end(SessionEnd::Stopped).await;
    scene.guest.wait_revoked(RevokeReason::Stopped).await;
    scene.guest.wait_join_end(SessionEnd::Stopped).await;
    assert!(rotated.elapsed() <= PROMPT, "{:?}", rotated.elapsed());
    assert!(is_closed_within(&mut game, LIMIT).await);
}

#[tokio::test]
async fn row_guest_leaves() {
    let scene = Scene::shared().await;
    let (ticket, mut game) = scene.playing().await;

    scene.guest.sessions.join_leave(&ticket.join_id).await.unwrap();

    scene.guest.wait_join_end(SessionEnd::Left).await;
    scene.host.wait_guest(&scene.guest.id(), (GuestState::Left, false)).await;
    assert!(is_closed_within(&mut game, LIMIT).await);
}

#[tokio::test]
async fn row_guest_game_exits() {
    let scene = Scene::shared().await;
    let (_ticket, _game) = scene.playing().await;

    scene.guest.signals.send(GameSignal::Exited { instance_id: GUEST_INSTANCE.into() });

    scene.guest.wait_join_end(SessionEnd::GameExited).await;
    scene.host.wait_guest(&scene.guest.id(), (GuestState::Left, false)).await;
}

#[tokio::test]
async fn row_guest_launcher_exits() {
    let scene = Scene::shared().await;
    let (_ticket, mut game) = scene.playing().await;

    scene.guest.friends.shutdown().await;

    scene.host.wait_guest(&scene.guest.id(), (GuestState::Left, false)).await;
    assert!(scene.guest.events.join_ends().is_empty(), "the app is gone, nobody is told");
    assert!(is_closed_within(&mut game, LIMIT).await);
}

#[tokio::test]
async fn row_guest_launch_fails_before_spawn() {
    let scene = Scene::shared().await;
    let ticket = scene.join().await;

    scene.guest.fail_launch(&ticket);

    scene.guest.wait_join_end(SessionEnd::Error).await;
    assert_eq!(scene.host.guest_state(&scene.guest.id()).await, Some((GuestState::Invited, false)));
}

#[tokio::test]
async fn row_guest_disables_friends() {
    let scene = Scene::shared().await;
    let (_ticket, mut game) = scene.playing().await;
    let disabled = Instant::now();

    scene.guest.friends.disable().await.unwrap();

    scene.guest.wait_join_end(SessionEnd::Disabled).await;
    scene.host.wait_guest(&scene.guest.id(), (GuestState::Left, false)).await;
    assert!(disabled.elapsed() <= PROMPT, "{:?}", disabled.elapsed());
    assert!(is_closed_within(&mut game, LIMIT).await);
}

#[tokio::test]
async fn a_guest_rebind_ends_the_join_with_left() {
    let scene = Scene::shared().await;
    let (_ticket, _game) = scene.playing().await;

    let settings = FriendsSettings { display_name: "Bert".into(), always_relay: true };
    scene.guest.friends.update_settings(settings).await.unwrap();

    scene.guest.wait_join_end(SessionEnd::Left).await;
}

#[tokio::test]
async fn a_new_guest_identity_ends_the_join_with_left_and_drops_the_invites() {
    let scene = Scene::shared().await;
    let (_ticket, _game) = scene.playing().await;

    scene.guest.friends.rotate_identity().await.unwrap();

    scene.guest.wait_join_end(SessionEnd::Left).await;
    assert!(scene.guest.sessions.invites().await.unwrap().is_empty());
}

#[tokio::test]
async fn row_host_kicks_the_guest() {
    let scene = Scene::shared().await;
    let (_ticket, _game) = scene.playing().await;

    scene.host.sessions.host_kick(&scene.session.id, &scene.guest.id().to_string()).await.unwrap();

    scene.guest.wait_join_end(SessionEnd::Kicked).await;
    scene.host.wait_guest(&scene.guest.id(), (GuestState::Left, true)).await;
}

/// Ein Gastgeber in eigener Laufzeit, die der Test einfrieren kann: kein Paket mehr, wie nach einem Absturz.
struct CrashingHost {
    freeze: Arc<Notify>,
    thaw: std::sync::mpsc::Sender<()>,
    finish: Arc<Notify>,
    thread: std::thread::JoinHandle<()>,
}

/// Worker-Threads der Laufzeit des Gastgebers; alle werden eingefroren.
const FROZEN_WORKERS: usize = 2;

impl CrashingHost {
    /// Startet „Anna“ mit kurzer Leerlaufzeit, befreundet sie mit `guest`, teilt und lädt ein.
    async fn share_with(guest: &Node, relay: &RelayEntry) -> Self {
        let (code_tx, code_rx) = oneshot::channel::<String>();
        let (guest_tx, guest_rx) = oneshot::channel::<PeerId>();
        let (freeze, finish) = (Arc::new(Notify::new()), Arc::new(Notify::new()));
        let (frozen, finished) = (freeze.clone(), finish.clone());
        let (thaw, thawed) = std::sync::mpsc::channel::<()>();
        let options = NetOptions { idle_timeout: CRASH_IDLE_TIMEOUT, ..options(relay) };
        let thread = std::thread::spawn(move || {
            let mut runtime = tokio::runtime::Builder::new_multi_thread();
            runtime.worker_threads(FROZEN_WORKERS).enable_all().build().unwrap().block_on(async move {
                let host = Node::online(options, "Anna", RELAXED).await;
                code_tx.send(host.friends.code_create().await.unwrap().code.unwrap()).unwrap();
                let request = incoming_request_id(&host).await;
                host.friends.answer_request(&request, true).await.unwrap();
                let guest_id = guest_rx.await.unwrap();
                until("guest online", || async { host.presence_of(&guest_id).await == Presence::Online }).await;
                let server = FakeServer::start().await;
                host.spawn_game(HOST_INSTANCE, None);
                host.open_lan(server.port, PortSource::Log);
                host.wait_lan(HOST_INSTANCE).await;
                let session = host.sessions.host_start(HOST_INSTANCE, None, false).await.unwrap();
                host.sessions.host_invite(&session.id, vec![guest_id.to_string()]).await.unwrap();
                frozen.notified().await;
                freeze_workers(thawed);
                finished.notified().await;
            });
        });
        guest.friends.add(&code_rx.await.unwrap()).await.unwrap();
        guest_tx.send(guest.id()).unwrap();
        Self { freeze, thaw, finish, thread }
    }

    async fn finish(self) {
        for _ in 0..FROZEN_WORKERS {
            self.thaw.send(()).unwrap();
        }
        self.finish.notify_one();
        tokio::task::spawn_blocking(move || self.thread.join()).await.unwrap().unwrap();
    }
}

/// Blockiert jeden Worker-Thread der aktuellen Laufzeit, bis je ein Auftauen kommt: kein Timer, kein Socket läuft mehr.
fn freeze_workers(thawed: std::sync::mpsc::Receiver<()>) {
    let thawed = Arc::new(Mutex::new(thawed));
    for _ in 0..FROZEN_WORKERS {
        let thawed = thawed.clone();
        tokio::spawn(async move {
            let _ = lock(&thawed).recv();
        });
    }
}

#[tokio::test]
async fn row_host_launcher_crashes() {
    let (relay, _server) = test_relay().await;
    let crash_options = NetOptions { idle_timeout: CRASH_IDLE_TIMEOUT, ..options(&relay) };
    let guest = Node::online(crash_options, "Bert", RELAXED).await;
    let host = CrashingHost::share_with(&guest, &relay).await;
    let invite = guest.open_invite().await;
    let ticket = guest.sessions.invite_join(&invite.id, GUEST_INSTANCE).await.unwrap();
    guest.spawn_game(GUEST_INSTANCE, Some(&ticket.join_id));
    let mut game = enter_world(&ticket.address).await;
    let crashed = Instant::now();

    host.freeze.notify_one();

    guest.wait_join_end(SessionEnd::HostOffline).await;
    let waited = crashed.elapsed();
    host.finish().await;
    assert!(waited <= CRASH_IDLE_TIMEOUT + RELAXED.host_offline_grace + Duration::from_secs(3), "{waited:?}");
    assert!(is_closed_within(&mut game, LIMIT).await);
}

// ---- Mod: Teilen aus dem Spiel (SPEC 7.4) ----

/// Spielt die Mod: verbindet sich mit dem Token des Starts und liest JSON-Zeilen.
struct FakeMod {
    lines: tokio::io::Lines<BufReader<tokio::net::tcp::OwnedReadHalf>>,
    write: tokio::net::tcp::OwnedWriteHalf,
}

impl FakeMod {
    async fn connect(env: &[(String, String)]) -> Self {
        let value = |name: &str| env.iter().find(|(key, _)| key == name).unwrap().1.clone();
        let tcp = TcpStream::connect(("127.0.0.1", value(ENV_PORT).parse::<u16>().unwrap())).await.unwrap();
        let (read, write) = tcp.into_split();
        let mut client = Self { lines: BufReader::new(read).lines(), write };
        let token = value(ENV_TOKEN);
        client.send(json!({ "type": "hello", "protocols": [1], "token": token, "mod": "0.1.0", "minecraft": "26.3" })).await;
        client
    }

    async fn send(&mut self, message: Value) {
        self.write.write_all(format!("{message}\n").as_bytes()).await.unwrap();
    }

    /// Die nächste Zeile, auf die `matches` zutrifft.
    async fn next_where(&mut self, matches: impl Fn(&Value) -> bool) -> Value {
        let deadline = tokio::time::Instant::now() + LIMIT;
        loop {
            let line = tokio::time::timeout_at(deadline, self.lines.next_line()).await.unwrap().unwrap();
            let message: Value = serde_json::from_str(&line.unwrap()).unwrap();
            if matches(&message) {
                return message;
            }
        }
    }

    /// Wartet auf einen Stand mit einem Freund, der online ist, und liefert dessen Alias.
    async fn online_friend_alias(&mut self) -> String {
        let online = |friends: &Vec<Value>| friends.iter().any(|friend| friend["presence"] == "online");
        let snapshot = self
            .next_where(|message| message["type"] == "snapshot" && message["friends"].as_array().is_some_and(online))
            .await;
        snapshot["friends"][0]["id"].as_str().unwrap().to_owned()
    }
}

#[tokio::test]
async fn sharing_from_the_mod_needs_one_confirmation_per_launch() {
    let (relay, _server) = test_relay().await;
    let host = Node::online(options(&relay), "Anna", RELAXED).await;
    let guest = Node::online(options(&relay), "Bert", RELAXED).await;
    befriend(&host, &guest).await;
    let server = FakeServer::start().await;
    let env = host.bridge.launch_env(HOST_INSTANCE, ModLoader::Fabric);
    host.spawn_game(HOST_INSTANCE, None);
    host.open_lan(server.port, PortSource::Mod);
    host.wait_lan(HOST_INSTANCE).await;
    let mut game_mod = FakeMod::connect(&env).await;
    let alias = game_mod.online_friend_alias().await;

    game_mod.send(json!({ "type": "share", "friendIds": [alias] })).await;
    until_true("confirmation asked", || host.events.mod_confirm_requests().len() == 1).await;
    game_mod.next_where(|message| message["type"] == "notify" && message["event"] == "confirmInLauncher").await;
    let request_id = host.events.mod_confirm_requests()[0].clone();
    host.sessions.mod_confirm(&request_id, true).await.unwrap();
    let invite = guest.open_invite().await;
    game_mod.send(json!({ "type": "share", "friendIds": [alias] })).await;
    tokio::time::sleep(Duration::from_millis(500)).await;

    assert_eq!(host.events.mod_confirm_requests().len(), 1, "the launch keeps its allow");
    assert_eq!(invite.from_name, "Anna");
    assert_eq!(host.session().await.unwrap().guests.len(), 1);
}

#[tokio::test]
async fn a_denied_share_reaches_the_mod_as_denied() {
    let (relay, _server) = test_relay().await;
    let host = Node::online(options(&relay), "Anna", RELAXED).await;
    let guest = Node::online(options(&relay), "Bert", RELAXED).await;
    befriend(&host, &guest).await;
    let env = host.bridge.launch_env(HOST_INSTANCE, ModLoader::Fabric);
    host.spawn_game(HOST_INSTANCE, None);
    let mut game_mod = FakeMod::connect(&env).await;
    let alias = game_mod.online_friend_alias().await;

    game_mod.send(json!({ "type": "share", "friendIds": [alias] })).await;
    until_true("confirmation asked", || host.events.mod_confirm_requests().len() == 1).await;
    host.sessions.mod_confirm(&host.events.mod_confirm_requests()[0], false).await.unwrap();
    let error = game_mod.next_where(|message| message["type"] == "error").await;

    assert_eq!(error["code"], "denied");
    assert!(host.session().await.is_none());
    assert!(guest.sessions.invites().await.unwrap().is_empty());
}

#[tokio::test]
async fn stop_sharing_from_the_mod_ends_the_session() {
    let scene = Scene::shared().await;
    let env = scene.host.bridge.launch_env(HOST_INSTANCE, ModLoader::Fabric);
    let mut game_mod = FakeMod::connect(&env).await;
    game_mod.next_where(|message| message["type"] == "snapshot" && message["session"].is_object()).await;

    game_mod.send(json!({ "type": "stopSharing" })).await;

    scene.host.wait_host_end(SessionEnd::Stopped).await;
    scene.guest.wait_revoked(RevokeReason::Stopped).await;
}
