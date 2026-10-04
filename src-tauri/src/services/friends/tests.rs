//! Freunde-Dienste mit echten Sockets (SPEC 13.1, Zeile R4): Endpunkte nur auf Loopback, Peers finden sich über
//! iroh's In-Process-Relay (SPEC 3.7). Echte Zeit mit kurzen Werten, kein Netz nötig.
use std::borrow::Cow;
use std::future::Future;
use std::str::FromStr;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use futures::future::BoxFuture;
use iroh::test_utils::run_relay_server;
use serde_json::{json, Value};
use tokio::sync::{oneshot, Notify};

use super::code;
use super::config::{friends_dir, FriendsConfig};
use super::contract::{
    Availability, Friend, FriendNotice, FriendRequest, FriendsEnableInput, FriendsSettings, IngameActions, InstanceSummary,
    NetworkStatus, Presence, RequestDirection, RequestRefusal, RequestState, RequestVia, RevokeReason, MAX_FRIENDS,
};
use super::control::{open_control, ControlMessage, OpenFrame, SessionControl, WireInvite, WireProfile, PEER_ALPN};
use super::events::{EventSink, FriendsEvent};
use super::hello::HELLO_ALPN;
use super::identity::{self, fingerprint, Identity};
use super::records::{FriendRecord, RecordStores, RequestRecord};
use super::service::Core;
use super::status;
use super::test_support::{error_key, TempDir};
use super::{AccountProfile, Friends, Lifecycle, NetOptions, PeerStreamHandler};
use crate::models::new_id;
use crate::services::gamesignal::{GameSignal, GameSignals};
use crate::services::modbridge::{Expectations, ModBridge};
use crate::services::p2p::{
    frame, Admission, BiStream, CloseCode, CloseReason, Gate, NetConfig, PeerConn, PeerId, PeerNet, RelayEntry,
    RelayOperator, RelaySelection, RelayTls, DIAL_TIMEOUT,
};
use crate::services::secrets::MemorySecretStore;
use crate::services::shared_types::ModLoader;
use crate::services::{lock, Dirs};

const LIMIT: Duration = Duration::from_secs(20);
const IDLE_TIMEOUT: Duration = Duration::from_secs(40);
/// Kurze Leerlaufzeit für den Absturz-Test (SPEC Anhang E, E1).
const CRASH_IDLE_TIMEOUT: Duration = Duration::from_secs(2);
/// So lange hält der Lebenszyklus-Abonnent der Tests sein `done` zurück.
const HOLD: Duration = Duration::from_millis(200);
const ACCOUNT_UUID: &str = "069a79f4-44e9-4726-a5be-fca90e38aaf5";
const INVITE_ID: &str = "0f8d2c1e-6a4b-4f7e-9c3d-2b1a0e9f8d7c";
const SESSION_ID: &str = "7c6b5a49-3827-4615-a0b9-c8d7e6f5a4b3";
const DAY_SECS: u64 = 24 * 3600;

/// Startet ein Relay im Test-Prozess; es läuft, solange der zweite Wert lebt.
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

/// Ohne Relay; nur für Tests, die nie zwei Endpunkte verbinden.
fn offline_options() -> NetOptions {
    NetOptions {
        relay_map: Vec::new(),
        hello_relay_only: false,
        relay_tls: RelayTls::InsecureForTests,
        idle_timeout: IDLE_TIMEOUT,
    }
}

fn account(name: &str) -> AccountProfile {
    AccountProfile::new(name, ACCOUNT_UUID)
}

fn enable_input(name: &str) -> FriendsEnableInput {
    FriendsEnableInput {
        display_name: name.to_owned(),
        always_relay: false,
        accept_third_party_relays: false,
        findable_by_name: false,
    }
}

#[derive(Default)]
struct RecordingEvents {
    events: Mutex<Vec<FriendsEvent>>,
}

impl EventSink for RecordingEvents {
    fn emit(&self, event: FriendsEvent) {
        lock(&self.events).push(event);
    }
}

impl RecordingEvents {
    fn any(&self, matches: impl Fn(&FriendsEvent) -> bool) -> bool {
        lock(&self.events).iter().any(matches)
    }

    fn presences_of(&self, peer: &PeerId) -> Vec<Presence> {
        let id = peer.to_string();
        lock(&self.events)
            .iter()
            .filter_map(|event| match event {
                FriendsEvent::Presence(presence) if presence.friend_id == id => Some(presence.presence),
                _ => None,
            })
            .collect()
    }
}

/// Ein Freunde-Dienst mit eigenem Ordner und Schlüsselbund im Speicher.
struct Node {
    friends: Friends,
    secrets: Arc<MemorySecretStore>,
    events: Arc<RecordingEvents>,
    signals: GameSignals,
    bridge: ModBridge,
    _dir: TempDir,
}

impl Node {
    /// Aktiviert und online am Test-Relay.
    async fn online(options: NetOptions, name: &str) -> Self {
        let node = Self::started(options, Arc::new(MemorySecretStore::new()), TempDir::new()).await;
        node.friends.enable(enable_input(name), Some(account(name))).await.unwrap();
        node.wait_online().await;
        node
    }

    /// Gestartet wie beim App-Start, ohne zu aktivieren.
    async fn started(options: NetOptions, secrets: Arc<MemorySecretStore>, dir: TempDir) -> Self {
        let signals = GameSignals::default();
        let bridge = ModBridge::new(signals.clone());
        let dirs = Dirs::new(dir.path());
        let friends = Friends::new(&dirs, secrets.clone(), signals.clone(), bridge.clone(), options).unwrap();
        let events = Arc::new(RecordingEvents::default());
        friends.start(events.clone(), Some(account("Alex"))).await;
        Self { friends, secrets, events, signals, bridge, _dir: dir }
    }

    fn id(&self) -> PeerId {
        PeerId::from_str(&self.friends.state().me.unwrap().peer_id).unwrap()
    }

    fn core(&self) -> &Core {
        &self.friends.core
    }

    async fn wait_online(&self) {
        until("network online", || async move { matches!(self.friends.state().network, NetworkStatus::Online { .. }) })
            .await;
    }

    async fn friend(&self, peer: &PeerId) -> Option<Friend> {
        let id = peer.to_string();
        self.friends.list().await.unwrap().into_iter().find(|friend| friend.id == id)
    }

    async fn presence_of(&self, peer: &PeerId) -> Presence {
        self.friend(peer).await.map_or(Presence::Offline, |friend| friend.presence)
    }

    async fn wait_friend(&self, peer: &PeerId, what: &str, matches: impl Fn(&Friend) -> bool) {
        let matches = &matches;
        until(what, || async move { self.friend(peer).await.is_some_and(|friend| matches(&friend)) }).await;
    }

    async fn wait_presence(&self, peer: &PeerId, presence: Presence) {
        until(&format!("{presence:?}"), || async move { self.presence_of(peer).await == presence }).await;
    }

    async fn wait_request_state(&self, state: RequestState) {
        let reached = || async move { self.requests().await.first().is_some_and(|request| request.state == state) };
        until("request state", reached).await;
    }

    async fn requests(&self) -> Vec<FriendRequest> {
        self.friends.requests().await.unwrap()
    }

    fn main_endpoint(&self) -> Arc<PeerNet> {
        self.core().runtime().unwrap().main.clone()
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

async fn incoming_request(node: &Node) -> FriendRequest {
    until("incoming request", || async move { !node.requests().await.is_empty() }).await;
    node.requests().await.remove(0)
}

async fn befriend(a: &Node, b: &Node) {
    let code = a.friends.code_create().await.unwrap().code.unwrap();
    b.friends.add(&code).await.unwrap();
    let request = incoming_request(a).await;
    a.friends.answer_request(&request.id, true).await.unwrap();
    let (a_id, b_id) = (a.id(), b.id());
    until("both confirmed", || async move {
        let confirmed = |friend: Option<Friend>| friend.is_some_and(|friend| friend.confirmed);
        confirmed(a.friend(&b_id).await) && confirmed(b.friend(&a_id).await)
    })
    .await;
    until("both online", || async move {
        a.presence_of(&b_id).await == Presence::Online && b.presence_of(&a_id).await == Presence::Online
    })
    .await;
}

async fn two_friends(relay: &RelayEntry) -> (Node, Node) {
    let (a, b) = (Node::online(options(relay), "Anna").await, Node::online(options(relay), "Bert").await);
    befriend(&a, &b).await;
    (a, b)
}

/// Wartet im Hintergrund auf das Ende der Verbindung und merkt sich Grund und Zeitpunkt.
fn watch_close(conn: PeerConn) -> tokio::task::JoinHandle<(CloseReason, Instant)> {
    tokio::spawn(async move {
        let reason = conn.closed().await;
        (reason, Instant::now())
    })
}

struct AcceptAll;

impl Gate for AcceptAll {
    fn admit(&self, _peer: &PeerId, _alpn: &[u8]) -> Admission {
        Admission::Accept
    }
}

/// Ein nackter Endpunkt am Test-Relay, etwa für einen Dieb mit altem Schlüssel.
async fn raw_endpoint(relay: &RelayEntry, secret: [u8; 32]) -> PeerNet {
    let config = NetConfig {
        secret,
        alpns: vec![PEER_ALPN],
        relay_map: vec![relay.clone()],
        relays: RelaySelection::All,
        relay_only: false,
        relay_tls: RelayTls::InsecureForTests,
        idle_timeout: IDLE_TIMEOUT,
    };
    PeerNet::bind(config, Arc::new(AcceptAll)).await.unwrap()
}

fn outgoing_request(state: RequestState, peer_id: Option<String>) -> RequestRecord {
    RequestRecord {
        id: new_id(),
        direction: RequestDirection::Outgoing,
        state,
        peer_id,
        hello_id: Some("00".repeat(32)),
        relay_index: Some(0),
        secret: None,
        display_name: None,
        mc_name: None,
        mc_uuid: None,
        code_tail: Some("abcd".into()),
        created_at: super::service::now_secs(),
        expires_at: super::service::now_secs() + 14 * DAY_SECS,
        via: RequestVia::Code,
        mail_id: None,
    }
}

fn incoming_record(peer_id: &str, expires_at: u64) -> RequestRecord {
    RequestRecord {
        direction: RequestDirection::Incoming,
        state: RequestState::Pending,
        peer_id: Some(peer_id.to_owned()),
        hello_id: None,
        expires_at,
        ..outgoing_request(RequestState::Pending, None)
    }
}

fn friend_record(peer_id: &str, confirmed: bool, added_at: u64) -> FriendRecord {
    FriendRecord {
        id: peer_id.to_owned(),
        display_name: "Fremd".into(),
        alias: None,
        mc_name: None,
        mc_uuid: None,
        home_relay: None,
        added_at,
        last_seen: None,
        confirmed,
        removed_by_peer: false,
        notice: None,
    }
}

fn random_peer_id() -> String {
    Identity::generate().peer_id()
}

#[tokio::test]
async fn code_through_the_relay_and_acceptance_make_both_confirmed_friends() {
    let (relay, _server) = test_relay().await;

    let (a, b) = two_friends(&relay).await;

    let anna = b.friend(&a.id()).await.unwrap();
    assert_eq!((anna.display_name.as_str(), anna.mc_name.as_deref()), ("Anna", Some("Anna")));
    assert!(a.requests().await.is_empty() && b.requests().await.is_empty());
    assert!(a.events.any(|event| matches!(event, FriendsEvent::Request(_))), "friend-request on the inviter");
    assert!(a.events.any(|event| matches!(event, FriendsEvent::Network(NetworkStatus::Online { .. }))));
    assert!(b.events.presences_of(&a.id()).contains(&Presence::Online), "friend-presence");
}

#[tokio::test]
async fn request_to_an_offline_inviter_is_delivered_by_retry_now_once_it_is_online() {
    let (relay, _server) = test_relay().await;
    let a = Node::online(options(&relay), "Anna").await;
    let code = a.friends.code_create().await.unwrap().code.unwrap();
    a.friends.disable().await.unwrap();
    let b = Node::online(options(&relay), "Bert").await;
    b.friends.add(&code).await.unwrap();
    // Erst wenn der erste Versuch über 10 s her ist, wählt `friends_retry_now` sofort neu an.
    tokio::time::sleep(DIAL_TIMEOUT + Duration::from_secs(3)).await;
    assert_eq!(b.requests().await[0].state, RequestState::Delivering, "first attempt failed, now in backoff");

    a.friends.enable(enable_input("Anna"), Some(account("Anna"))).await.unwrap();
    a.wait_online().await;
    let pressed = Instant::now();
    b.friends.retry_now().await.unwrap();
    incoming_request(&a).await;

    assert!(pressed.elapsed() <= Duration::from_secs(5), "delivered after {:?}", pressed.elapsed());
}

#[tokio::test]
async fn declining_sends_nothing() {
    let (relay, _server) = test_relay().await;
    let (a, b) = (Node::online(options(&relay), "Anna").await, Node::online(options(&relay), "Bert").await);
    b.friends.add(&a.friends.code_create().await.unwrap().code.unwrap()).await.unwrap();
    let request = incoming_request(&a).await;
    b.wait_request_state(RequestState::AwaitingAnswer).await;

    a.friends.answer_request(&request.id, false).await.unwrap();
    tokio::time::sleep(Duration::from_secs(1)).await;

    assert_eq!(b.requests().await[0].state, RequestState::AwaitingAnswer);
    assert!(a.requests().await.is_empty());
    assert!(a.friend(&b.id()).await.is_none() && b.friend(&a.id()).await.is_none());
}

#[tokio::test]
async fn cancelled_request_shows_the_inviter_a_removed_friend_after_accepting() {
    let (relay, _server) = test_relay().await;
    let (a, b) = (Node::online(options(&relay), "Anna").await, Node::online(options(&relay), "Bert").await);
    b.friends.add(&a.friends.code_create().await.unwrap().code.unwrap()).await.unwrap();
    let request = incoming_request(&a).await;
    b.wait_request_state(RequestState::AwaitingAnswer).await;

    b.friends.cancel_request(&b.requests().await[0].id).await.unwrap();
    a.friends.answer_request(&request.id, true).await.unwrap();

    let b_id = b.id();
    a.wait_friend(&b_id, "removed by peer", |friend| friend.removed_by_peer).await;
}

#[tokio::test]
async fn removing_a_friend_tells_them_with_unfriend() {
    let (relay, _server) = test_relay().await;
    let (a, b) = two_friends(&relay).await;

    a.friends.remove(&b.id().to_string()).await.unwrap();

    let a_id = a.id();
    b.wait_friend(&a_id, "removed by peer", |friend| friend.removed_by_peer).await;
    assert!(a.friend(&b.id()).await.is_none());
}

#[tokio::test]
async fn blocking_looks_like_removal_to_the_blocked_friend() {
    let (relay, _server) = test_relay().await;
    let (a, b) = two_friends(&relay).await;
    let (a_id, b_id) = (a.id(), b.id());

    a.friends.block(&b_id.to_string()).await.unwrap();
    b.wait_presence(&a_id, Presence::Offline).await;
    b.friends.retry_now().await.unwrap();

    b.wait_friend(&a_id, "removed by peer", |friend| friend.removed_by_peer).await;
    assert!(a.friend(&b_id).await.is_none());
    let blocked = a.friends.blocked().await.unwrap();
    assert_eq!((blocked.len(), blocked[0].peer_id.as_str()), (1, b_id.to_string().as_str()));
}

#[tokio::test]
async fn rotation_moves_the_friend_to_the_new_id_and_drops_codes_and_bound_requests() {
    let (relay, _server) = test_relay().await;
    let (a, b) = two_friends(&relay).await;
    let old_code = a.friends.code_create().await.unwrap().code.unwrap();
    let old_secret = identity::load(&*a.secrets).unwrap().unwrap().secret_bytes();
    let old_id = a.id();
    let requests = &a.core().stores.requests;
    requests.insert(incoming_record(&random_peer_id(), super::service::now_secs() + DAY_SECS)).unwrap();
    requests.insert(outgoing_request(RequestState::AwaitingAnswer, Some(random_peer_id()))).unwrap();
    let delivering = requests.insert(outgoing_request(RequestState::Delivering, None)).unwrap();

    a.friends.rotate_identity().await.unwrap();

    let new_id = a.id();
    assert_ne!(new_id, old_id);
    assert!(a.friends.codes().await.unwrap().is_empty(), "codes are revoked");
    let left: Vec<String> = a.requests().await.into_iter().map(|request| request.id).collect();
    assert_eq!(left, [delivering.id], "only the delivering request stays");
    b.wait_friend(&new_id, "new id learned", |_| true).await;
    let moved = b.friend(&new_id).await.unwrap();
    assert_eq!(
        moved.notice,
        Some(FriendNotice::IdentityChanged { previous_fingerprint: fingerprint(&old_id.to_string()) })
    );
    assert!(b.friend(&old_id).await.is_none());
    b.wait_presence(&new_id, Presence::Online).await;

    let thief = raw_endpoint(&relay, old_secret).await;
    let stolen = thief.dial(&b.id(), PEER_ALPN).await.unwrap();
    assert_eq!(tokio::time::timeout(LIMIT, stolen.closed()).await.unwrap(), CloseReason::Peer(CloseCode::NOT_FRIEND));

    let c = Node::online(options(&relay), "Carl").await;
    c.friends.add(&old_code).await.unwrap();
    tokio::time::sleep(DIAL_TIMEOUT + Duration::from_secs(1)).await;
    assert_eq!(c.requests().await[0].state, RequestState::Delivering, "the old code got no answer");
}

#[tokio::test]
async fn reset_delivers_unfriend_through_the_outbox_and_drops_the_retired_key() {
    let (relay, _server) = test_relay().await;
    let (a, b) = two_friends(&relay).await;
    let old_id = a.id();

    let state = a.friends.reset().await.unwrap();

    assert!(state.enabled && a.friends.list().await.unwrap().is_empty());
    assert_ne!(a.id(), old_id);
    b.wait_friend(&old_id, "unfriend delivered", |friend| friend.removed_by_peer).await;
    until_true("retired key gone", || identity::load_retired(&*a.secrets).unwrap().is_none()).await;
}

/// Merkt sich, was der Dienst an die Sitzungen weiterreicht.
#[derive(Default)]
struct FakeHandler {
    seen: Mutex<Vec<Seen>>,
}

#[derive(Debug, Clone, PartialEq)]
enum Seen {
    Request(PeerId),
    Tunnel(PeerId, String),
    Control(PeerId, SessionControl),
}

impl PeerStreamHandler for FakeHandler {
    fn on_request_stream<'a>(&'a self, peer: &'a PeerId, _stream: BiStream) -> BoxFuture<'a, ()> {
        Box::pin(async move { lock(&self.seen).push(Seen::Request(*peer)) })
    }

    fn on_tunnel_stream<'a>(&'a self, peer: &'a PeerId, session_id: String, _stream: BiStream) -> BoxFuture<'a, ()> {
        Box::pin(async move { lock(&self.seen).push(Seen::Tunnel(*peer, session_id)) })
    }

    fn on_control_message<'a>(&'a self, peer: &'a PeerId, message: SessionControl) -> BoxFuture<'a, ()> {
        Box::pin(async move { lock(&self.seen).push(Seen::Control(*peer, message)) })
    }
}

fn invite() -> SessionControl {
    SessionControl::Invite(WireInvite {
        id: INVITE_ID.into(),
        session_id: SESSION_ID.into(),
        world_name: Some("Inselwelt".into()),
        instance: InstanceSummary {
            name: "Fabric 26.3".into(),
            minecraft_version: "26.3".into(),
            loader: ModLoader::Fabric,
            loader_version: Some("0.19.5".into()),
            mod_count: 42,
        },
        expires_at: 1_790_000_000,
    })
}

async fn open_stream(conn: &PeerConn, open: &OpenFrame) -> BiStream {
    let mut stream = conn.open_bi().await.unwrap();
    frame::write(&mut stream, open, 1024).await.unwrap();
    stream
}

async fn reply_to(conn: &PeerConn, open: &OpenFrame) -> Value {
    let mut stream = open_stream(conn, open).await;
    tokio::time::timeout(LIMIT, stream.read_frame::<Value>(1024)).await.unwrap().unwrap()
}

#[tokio::test]
async fn registered_handler_gets_request_and_tunnel_streams_and_session_messages() {
    let (relay, _server) = test_relay().await;
    let (a, b) = two_friends(&relay).await;
    let handler = Arc::new(FakeHandler::default());
    a.friends.register_stream_handler(handler.clone()).unwrap();
    let to_a = b.friends.connection(&a.id()).unwrap();
    let b_id = b.id();

    let _request = open_stream(&to_a, &OpenFrame::Request).await;
    let _tunnel = open_stream(&to_a, &OpenFrame::Tunnel { session_id: SESSION_ID.into() }).await;
    let revoke = SessionControl::InviteRevoke { invite_id: INVITE_ID.into(), reason: RevokeReason::Stopped };
    let decline = SessionControl::InviteDecline { invite_id: INVITE_ID.into() };
    for message in [invite(), revoke.clone(), decline.clone()] {
        b.friends.send_control(&a.id(), message).unwrap();
    }

    until_true("all delivered", || lock(&handler.seen).len() == 5).await;
    let seen = lock(&handler.seen).clone();
    for expected in [
        Seen::Request(b_id),
        Seen::Tunnel(b_id, SESSION_ID.into()),
        Seen::Control(b_id, invite()),
        Seen::Control(b_id, revoke),
        Seen::Control(b_id, decline),
    ] {
        assert!(seen.contains(&expected), "{expected:?} missing in {seen:?}");
    }
    assert!(a.friends.register_stream_handler(Arc::new(FakeHandler::default())).is_err(), "only once");
}

#[tokio::test]
async fn without_a_handler_streams_get_the_default_errors_and_invites_are_ignored() {
    let (relay, _server) = test_relay().await;
    let (a, b) = two_friends(&relay).await;
    let to_b = a.friends.connection(&b.id()).unwrap();

    let request = reply_to(&to_b, &OpenFrame::Request).await;
    let tunnel = reply_to(&to_b, &OpenFrame::Tunnel { session_id: SESSION_ID.into() }).await;
    a.friends.send_control(&b.id(), invite()).unwrap();
    tokio::time::sleep(Duration::from_millis(300)).await;

    assert_eq!(request, json!({ "type": "error", "code": "unsupported" }));
    assert_eq!(tunnel, json!({ "type": "error", "code": "sessionNotFound" }));
    assert!(b.friends.connection(&a.id()).is_some(), "an ignored invite keeps the connection");
}

/// Ein Abonnent, der jedes Ereignis mit Zeitpunkt notiert und `done` so lange hält (`None`: für immer).
fn subscribe(friends: &Friends, hold: Option<Duration>) -> Arc<Mutex<Vec<(Lifecycle, Instant)>>> {
    let seen = Arc::new(Mutex::new(Vec::new()));
    let (record, mut events) = (seen.clone(), friends.subscribe_lifecycle());
    tokio::spawn(async move {
        let mut kept = Vec::new();
        while let Some(event) = events.recv().await {
            lock(&record).push((event.kind, Instant::now()));
            match hold {
                Some(hold) => {
                    tokio::time::sleep(hold).await;
                    drop(event.done);
                }
                None => kept.push(event.done),
            }
        }
    });
    seen
}

#[derive(Debug, Clone, Copy)]
enum Trigger {
    Disable,
    AlwaysRelay,
    Rotate,
    Reset,
    Shutdown,
}

async fn trigger(node: &Node, action: Trigger) {
    match action {
        Trigger::Disable => drop(node.friends.disable().await.unwrap()),
        Trigger::AlwaysRelay => {
            let settings = FriendsSettings { display_name: "Anna".into(), always_relay: true, findable_by_name: false, ..FriendsSettings::default() };
            drop(node.friends.update_settings(settings).await.unwrap());
        }
        Trigger::Rotate => drop(node.friends.rotate_identity().await.unwrap()),
        Trigger::Reset => drop(node.friends.reset().await.unwrap()),
        Trigger::Shutdown => node.friends.shutdown().await,
    }
}

/// Der Abonnent hört zuerst davon; die Gegenseite sieht `SHUTDOWN` erst, nachdem er `done` freigab.
async fn subscriber_runs_before_the_remote_sees_shutdown(action: Trigger, expected: Lifecycle) {
    let (relay, _server) = test_relay().await;
    let (a, b) = two_friends(&relay).await;
    let seen = subscribe(&a.friends, Some(HOLD));
    let closed = watch_close(b.friends.connection(&a.id()).unwrap());

    trigger(&a, action).await;

    let (reason, closed_at) = tokio::time::timeout(LIMIT, closed).await.unwrap().unwrap();
    let (kind, received_at) = lock(&seen)[0];
    assert_eq!(kind, expected);
    assert_eq!(reason, CloseReason::Peer(CloseCode::SHUTDOWN));
    assert!(closed_at >= received_at + HOLD, "the remote saw the close before the subscriber was done");
}

#[tokio::test]
async fn disabling_delivers_disabled_before_the_endpoint_closes() {
    subscriber_runs_before_the_remote_sees_shutdown(Trigger::Disable, Lifecycle::Disabled).await;
}

#[tokio::test]
async fn changing_always_relay_delivers_rebind_before_the_endpoint_closes() {
    subscriber_runs_before_the_remote_sees_shutdown(Trigger::AlwaysRelay, Lifecycle::Rebind).await;
}

#[tokio::test]
async fn rotating_delivers_identity_changed_before_the_endpoint_closes() {
    subscriber_runs_before_the_remote_sees_shutdown(Trigger::Rotate, Lifecycle::IdentityChanged).await;
}

#[tokio::test]
async fn resetting_delivers_identity_changed_before_the_endpoint_closes() {
    subscriber_runs_before_the_remote_sees_shutdown(Trigger::Reset, Lifecycle::IdentityChanged).await;
}

#[tokio::test]
async fn shutdown_delivers_shutdown_before_the_endpoint_closes() {
    subscriber_runs_before_the_remote_sees_shutdown(Trigger::Shutdown, Lifecycle::Shutdown).await;
}

#[tokio::test]
async fn subscriber_that_never_answers_delays_the_close_by_at_most_half_a_second() {
    let (relay, _server) = test_relay().await;
    let (a, b) = two_friends(&relay).await;
    let _seen = subscribe(&a.friends, None);
    let closed = watch_close(b.friends.connection(&a.id()).unwrap());
    let started = Instant::now();

    a.friends.disable().await.unwrap();

    let (_, closed_at) = tokio::time::timeout(LIMIT, closed).await.unwrap().unwrap();
    let delay = closed_at - started;
    assert!(delay >= Duration::from_millis(500), "closed after {delay:?}, before the wait ended");
    assert!(delay <= Duration::from_millis(1500), "closed after {delay:?}");
}

#[tokio::test]
async fn lost_identity_refuses_everything_but_state_and_reset() {
    let dir = TempDir::new();
    let config = FriendsConfig { enabled: true, ..FriendsConfig::default() };
    config.save(&friends_dir(&Dirs::new(dir.path()))).unwrap();
    let node = Node::started(offline_options(), Arc::new(MemorySecretStore::new()), dir).await;
    assert_eq!(node.friends.state().availability, Availability::IdentityLost);

    let refusals = [
        node.friends.list().await.err(),
        node.friends.code_create().await.err(),
        node.friends.add("pumpkin-x").await.err(),
        node.friends.retry_now().await.err(),
        node.friends.rotate_identity().await.err(),
        node.friends.disable().await.err(),
        node.friends.enable(enable_input("Anna"), Some(account("Anna"))).await.err(),
    ];

    for refusal in refusals {
        assert_eq!(error_key(&refusal.expect("refused")), "errors.friends.identityLost");
    }
    let state = node.friends.reset().await.unwrap();
    assert_eq!(state.availability, Availability::Available);
    assert!(state.me.is_some());
}

#[tokio::test]
async fn without_a_keyring_even_reset_is_unavailable() {
    let node = Node::started(offline_options(), Arc::new(MemorySecretStore::unreachable()), TempDir::new()).await;

    assert_eq!(node.friends.state().availability, Availability::NoSecretStore);
    let enable = node.friends.enable(enable_input("Anna"), Some(account("Anna"))).await;
    assert_eq!(error_key(&enable.unwrap_err()), "errors.friends.unavailable");
    assert_eq!(error_key(&node.friends.reset().await.unwrap_err()), "errors.friends.unavailable");
    assert_eq!(error_key(&node.friends.list().await.unwrap_err()), "errors.friends.unavailable");
}

#[tokio::test]
async fn enabling_needs_a_microsoft_account_and_starts_the_mod_bridge_until_disabled() {
    let node = Node::started(offline_options(), Arc::new(MemorySecretStore::new()), TempDir::new()).await;
    let refused = node.friends.enable(enable_input("Anna"), None).await;
    assert_eq!(error_key(&refused.unwrap_err()), "errors.friends.msAccountRequired");
    assert!(node.bridge.register_launch("i1", Expectations::unconstrained()).is_empty());

    node.friends.enable(enable_input("Anna"), Some(account("Anna"))).await.unwrap();
    assert!(!node.bridge.register_launch("i1", Expectations::unconstrained()).is_empty(), "bridge runs with the feature");

    node.friends.disable().await.unwrap();
    assert!(node.bridge.register_launch("i1", Expectations::unconstrained()).is_empty(), "bridge stops with the feature");
}

#[tokio::test]
async fn the_ingame_settings_start_on_and_asking_and_survive_a_restart() {
    let node = Node::started(offline_options(), Arc::new(MemorySecretStore::new()), TempDir::new()).await;
    node.friends.enable(enable_input("Anna"), Some(account("Anna"))).await.unwrap();
    let defaults = node.friends.state().settings;
    assert!(defaults.ingame_menu);
    assert_eq!(defaults.ingame_actions, IngameActions::Ask);

    let changed = FriendsSettings { ingame_menu: false, ingame_actions: IngameActions::Allow, ..defaults };
    node.friends.update_settings(changed.clone()).await.unwrap();
    let Node { secrets, _dir: dir, .. } = node;
    let restarted = Node::started(offline_options(), secrets, dir).await;

    assert_eq!(restarted.friends.state().settings, changed);
}

#[tokio::test]
async fn turning_friends_off_and_on_again_keeps_the_ingame_settings() {
    let node = Node::started(offline_options(), Arc::new(MemorySecretStore::new()), TempDir::new()).await;
    node.friends.enable(enable_input("Anna"), Some(account("Anna"))).await.unwrap();
    let state = node.friends.state();
    let changed = FriendsSettings { ingame_menu: false, ingame_actions: IngameActions::Allow, ..state.settings };
    node.friends.update_settings(changed).await.unwrap();

    node.friends.disable().await.unwrap();
    let state = node.friends.enable(enable_input("Anna"), Some(account("Anna"))).await.unwrap();

    assert!(!state.settings.ingame_menu);
    assert_eq!(state.settings.ingame_actions, IngameActions::Allow);
}

#[tokio::test]
async fn expired_incoming_requests_and_stale_unconfirmed_friends_are_pruned_at_start() {
    let dir = TempDir::new();
    let now = super::service::now_secs();
    let fresh = incoming_record(&random_peer_id(), now + DAY_SECS);
    {
        let stores = RecordStores::open(&friends_dir(&Dirs::new(dir.path()))).unwrap();
        stores.requests.insert(incoming_record(&random_peer_id(), now - 1)).unwrap();
        stores.requests.insert(fresh.clone()).unwrap();
        stores.friends.insert(friend_record(&random_peer_id(), false, now - 15 * DAY_SECS)).unwrap();
        stores.friends.insert(friend_record(&random_peer_id(), true, now - 15 * DAY_SECS)).unwrap();
    }

    let node = Node::started(offline_options(), Arc::new(MemorySecretStore::new()), dir).await;

    assert_eq!(node.core().stores.requests.list(), [fresh]);
    let friends = node.core().stores.friends.list();
    assert_eq!((friends.len(), friends[0].confirmed), (1, true));
}

/// Fragt den Hello-Endpunkt eines Codes direkt; `None`, wenn kein Rahmen kam, dazu der Schließgrund.
async fn ask_hello(main: &PeerNet, code: &str, secret: &str) -> (Option<Value>, Option<CloseReason>) {
    let hello = PeerId::from_bytes(&code::parse(code).unwrap().hello_id).unwrap();
    let conn = main.dial(&hello, HELLO_ALPN).await.unwrap();
    let request = json!({ "type": "friendRequest", "protocol": 1, "secret": secret,
                          "profile": { "displayName": "Bert", "mcName": null, "mcUuid": null } });
    let exchange = async {
        let mut stream = conn.open_bi().await.ok()?;
        frame::write(&mut stream, &request, 4096).await.ok()?;
        stream.read_frame::<Value>(4096).await.ok()
    };
    let answer = tokio::time::timeout(LIMIT, exchange).await.unwrap();
    if answer.is_some() {
        conn.close(CloseCode::NORMAL);
        return (answer, None);
    }
    (None, Some(tokio::time::timeout(LIMIT, conn.closed()).await.unwrap()))
}

#[tokio::test]
async fn wrong_secret_gets_no_frame_and_a_close_like_a_normal_end() {
    let (relay, _server) = test_relay().await;
    let (a, b) = (Node::online(options(&relay), "Anna").await, Node::online(options(&relay), "Bert").await);
    let code = a.friends.code_create().await.unwrap().code.unwrap();

    let (answer, closed) = ask_hello(&b.main_endpoint(), &code, &"00".repeat(9)).await;

    assert_eq!((answer, closed), (None, Some(CloseReason::Peer(CloseCode::NORMAL))));
    assert!(a.requests().await.is_empty());
}

#[tokio::test]
async fn fourth_hello_from_the_same_peer_within_ten_minutes_is_dropped_silently() {
    let (relay, _server) = test_relay().await;
    let (a, b) = (Node::online(options(&relay), "Anna").await, Node::online(options(&relay), "Bert").await);
    let code = a.friends.code_create().await.unwrap().code.unwrap();
    let secret = code::parse(&code).unwrap().secret_hex();
    let main = b.main_endpoint();

    for attempt in 0..3 {
        let (answer, _) = ask_hello(&main, &code, &secret).await;
        assert_eq!(answer.expect("answered")["type"], "received", "attempt {attempt} is repeated idempotently");
    }
    let (answer, closed) = ask_hello(&main, &code, &secret).await;

    assert_eq!((answer, closed), (None, Some(CloseReason::Peer(CloseCode::NORMAL))));
    assert_eq!(a.requests().await.len(), 1);
}

#[tokio::test]
async fn home_relay_index_outside_the_map_is_never_stored() {
    let (relay, _server) = test_relay().await;
    let a = Node::online(options(&relay), "Anna").await;
    let stranger = Identity::generate();
    a.core().stores.friends.insert(friend_record(&stranger.peer_id(), true, 0)).unwrap();
    let raw = raw_endpoint(&relay, stranger.secret_bytes()).await;
    let profile = WireProfile { display_name: "Fremd".into(), mc_name: None, mc_uuid: None };

    let foreign = raw.dial(&a.id(), PEER_ALPN).await.unwrap();
    open_control(&foreign, &ControlMessage::hello(profile.clone(), Some(77))).await.unwrap();
    tokio::time::sleep(Duration::from_millis(300)).await;
    let ignored = status::friend(a.core(), &stranger.peer_id()).unwrap().home_relay;
    let known = raw.dial(&a.id(), PEER_ALPN).await.unwrap();
    open_control(&known, &ControlMessage::hello(profile, Some(0))).await.unwrap();
    tokio::time::sleep(Duration::from_millis(300)).await;

    assert_eq!(ignored, None);
    assert_eq!(status::friend(a.core(), &stranger.peer_id()).unwrap().home_relay, Some(0));
}

#[tokio::test]
async fn presence_follows_playing_and_shutdown_ends_it_at_once() {
    let (relay, _server) = test_relay().await;
    let (a, b) = two_friends(&relay).await;
    let a_id = a.id();
    let spawned = GameSignal::Spawned { instance_id: "i1".into(), pid: 1, online_account: true, friend_join: None };

    a.signals.send(spawned);
    b.wait_presence(&a_id, Presence::Playing).await;
    a.signals.send(GameSignal::Exited { instance_id: "i1".into() });
    b.wait_presence(&a_id, Presence::Online).await;
    let disabled = Instant::now();
    a.friends.disable().await.unwrap();
    b.wait_presence(&a_id, Presence::Offline).await;

    assert!(disabled.elapsed() <= Duration::from_secs(3), "offline after {:?}", disabled.elapsed());
    assert!(b.friend(&a_id).await.unwrap().last_seen.is_some());
    let presences = b.events.presences_of(&a_id);
    assert!([Presence::Playing, Presence::Online, Presence::Offline].iter().all(|p| presences.contains(p)));
}

/// Worker-Threads der Laufzeit des Absturz-Freundes; alle werden eingefroren.
const FROZEN_WORKERS: usize = 2;

/// Ein Dienst in eigener Laufzeit, die der Test einfrieren kann: kein Paket mehr, wie nach einem Absturz.
struct Freezable {
    id: PeerId,
    freeze: Arc<Notify>,
    thaw: std::sync::mpsc::Sender<()>,
    finish: Arc<Notify>,
    thread: std::thread::JoinHandle<()>,
}

impl Freezable {
    fn freeze(&self) {
        self.freeze.notify_one();
    }

    /// Taut auf und beendet den Dienst regulär, damit nichts über den Test hinaus läuft.
    async fn finish(self) {
        for _ in 0..FROZEN_WORKERS {
            self.thaw.send(()).unwrap();
        }
        self.finish.notify_one();
        tokio::task::spawn_blocking(move || self.thread.join()).await.unwrap().unwrap();
    }
}

/// Startet „Anna“ in eigener Laufzeit und befreundet sie mit `b`.
async fn freezable_friend_of(b: &Node, relay: &RelayEntry) -> Freezable {
    let (code_tx, code_rx) = oneshot::channel();
    let (befriended_tx, befriended_rx) = oneshot::channel::<PeerId>();
    let (freeze, finish) = (Arc::new(Notify::new()), Arc::new(Notify::new()));
    let (frozen, finished) = (freeze.clone(), finish.clone());
    let (thaw, thawed) = std::sync::mpsc::channel::<()>();
    let options = NetOptions { idle_timeout: CRASH_IDLE_TIMEOUT, ..options(relay) };
    let thread = std::thread::spawn(move || {
        let builder = tokio::runtime::Builder::new_multi_thread().worker_threads(FROZEN_WORKERS).enable_all().build();
        builder.unwrap().block_on(async move {
            let a = Node::online(options, "Anna").await;
            code_tx.send((a.id(), a.friends.code_create().await.unwrap().code.unwrap())).unwrap();
            let request = incoming_request(&a).await;
            a.friends.answer_request(&request.id, true).await.unwrap();
            let b_id = befriended_rx.await.unwrap();
            a.wait_friend(&b_id, "confirmed", |friend| friend.confirmed).await;
            frozen.notified().await;
            freeze_workers(thawed);
            finished.notified().await;
        });
    });
    let (id, code) = code_rx.await.unwrap();
    b.friends.add(&code).await.unwrap();
    befriended_tx.send(b.id()).unwrap();
    b.wait_presence(&id, Presence::Online).await;
    Freezable { id, freeze, thaw, finish, thread }
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
async fn crashed_friend_goes_offline_after_the_idle_timeout() {
    let (relay, _server) = test_relay().await;
    let b = Node::online(NetOptions { idle_timeout: CRASH_IDLE_TIMEOUT, ..options(&relay) }, "Bert").await;
    let friend = freezable_friend_of(&b, &relay).await;
    let id = friend.id;
    let closed = watch_close(b.friends.connection(&id).unwrap());
    let crashed = Instant::now();

    friend.freeze();

    let (reason, closed_at) = tokio::time::timeout(LIMIT, closed).await.unwrap().unwrap();
    b.wait_presence(&id, Presence::Offline).await;
    friend.finish().await;
    assert_eq!(reason, CloseReason::TimedOut);
    assert!(closed_at - crashed <= CRASH_IDLE_TIMEOUT + Duration::from_secs(3), "after {:?}", closed_at - crashed);
}

#[tokio::test]
async fn fiftieth_friend_or_request_is_the_limit() {
    let (relay, _server) = test_relay().await;
    let (a, b) = (Node::online(options(&relay), "Anna").await, Node::online(options(&relay), "Bert").await);
    for _ in 0..MAX_FRIENDS - 1 {
        b.core().stores.friends.insert(friend_record(&random_peer_id(), true, 0)).unwrap();
    }
    b.core().stores.requests.insert(outgoing_request(RequestState::Delivering, None)).unwrap();
    for _ in 0..MAX_FRIENDS {
        a.core().stores.friends.insert(friend_record(&random_peer_id(), true, 0)).unwrap();
    }
    let incoming = a.core().stores.requests.insert(incoming_record(&random_peer_id(), u64::MAX)).unwrap();

    let code = a.friends.code_create().await.unwrap().code.unwrap();
    let added = b.friends.add(&code).await;
    let accepted = a.friends.answer_request(&incoming.id, true).await;

    assert_eq!(error_key(&added.unwrap_err()), "errors.friends.friendLimit");
    assert_eq!(error_key(&accepted.unwrap_err()), "errors.friends.friendLimit");
}

async fn request_reply(conn: &PeerConn) -> Value {
    reply_to(conn, &OpenFrame::Request).await["code"].clone()
}

#[tokio::test]
async fn reconnecting_does_not_reset_the_request_stream_limit() {
    let (relay, _server) = test_relay().await;
    let (a, b) = two_friends(&relay).await;
    let a_id = a.id();
    let first = b.friends.connection(&a_id).unwrap();
    for _ in 0..5 {
        assert_eq!(request_reply(&first).await, "unsupported");
    }

    b.friends.disable().await.unwrap();
    b.friends.enable(enable_input("Bert"), Some(account("Bert"))).await.unwrap();
    let b_ref = &b;
    let a_ref = &a;
    until("reconnected", || async move {
        b_ref.friends.connection(&a_id).is_some() && a_ref.presence_of(&b_ref.id()).await == Presence::Online
    })
    .await;
    let second = b.friends.connection(&a_id).unwrap();

    assert_eq!(request_reply(&second).await, "rateLimited");
}

#[tokio::test]
async fn a_peer_replacing_its_connection_too_often_keeps_the_old_one() {
    let (relay, _server) = test_relay().await;
    let (dialer, listener) = (raw_endpoint(&relay, [5; 32]).await, raw_endpoint(&relay, [6; 32]).await);
    let links = status::Links::default();
    let mut outcomes = Vec::new();

    for _ in 0..7 {
        let conn = dialer.dial(&listener.id(), PEER_ALPN).await.unwrap();
        let link = links.new_link(conn, tokio::sync::mpsc::channel(1).0);
        outcomes.push(match links.register(&dialer.id(), link) {
            status::Registration::Kept { replaced: None } => "new",
            status::Registration::Kept { replaced: Some(_) } => "replaced",
            status::Registration::Duplicate => "duplicate",
            status::Registration::TooFrequent => "tooFrequent",
        });
    }

    assert_eq!(outcomes, ["new", "replaced", "replaced", "replaced", "replaced", "replaced", "tooFrequent"]);
}

#[tokio::test]
async fn a_refused_request_tells_the_ui_why_it_disappeared() {
    let (relay, _server) = test_relay().await;
    let (a, b) = two_friends(&relay).await;
    let code = a.friends.code_create().await.unwrap().code.unwrap();

    let request = b.friends.add(&code).await.unwrap();

    let refused = || {
        b.events.any(|event| {
            matches!(event, FriendsEvent::RequestRefused(refused)
                if refused.request.id == request.id && refused.reason == RequestRefusal::AlreadyFriends)
        })
    };
    until_true("friend-request-refused", refused).await;
    assert!(b.requests().await.is_empty());
}

#[tokio::test]
async fn a_changed_microsoft_account_reaches_connected_friends() {
    let (relay, _server) = test_relay().await;
    let (a, b) = two_friends(&relay).await;
    let a_id = a.id();

    a.friends.update_account(Some(account("Neo")));
    b.wait_friend(&a_id, "new account name", |friend| friend.mc_name.as_deref() == Some("Neo")).await;
    a.friends.update_account(None);

    b.wait_friend(&a_id, "account removed", |friend| friend.mc_name.is_none() && friend.mc_uuid.is_none()).await;
}
