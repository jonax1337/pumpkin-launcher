//! Die Brücke gegen echte Loopback-Verbindungen, mit einer Mod, die das Protokoll 2 von Hand spricht: Anmeldung,
//! Ablehnungen, Besitzerprüfung, Spielstarts, Vorgänge, Zustimmungen, Themen und Hinweise.
use std::future::Future;
use std::io;
use std::net::SocketAddr;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Mutex;
use std::time::Duration;

use futures::future::BoxFuture;
use serde_json::{json, Value};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::net::tcp::{OwnedReadHalf, OwnedWriteHalf};
use tokio::net::TcpStream;
use tokio::sync::broadcast::Receiver;
use tokio::sync::Notify;

use super::ops::{ErrorCode, Op, OpError, OpOutcome, OpResult, RateClass, Scope};
use super::protocol::{ModFriend, ModGuest, ModGuestState, ModInvite, ModPresence, ModSession};
use super::topics::TopicValue;
use super::*;
use crate::services::gamesignal::GameSignal;
use crate::services::shared_types::PortSource;

pub(super) const WAIT: Duration = Duration::from_secs(5);
/// Der SHA-256, den der Launcher von der eingebauten Mod erwartet, und der Anfang, den die Mod meldet.
const BUILD_SHA256: &str = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
const BUILD_PREFIX: &str = "0123456789abcdef";

/// Die Mod, wie sie sich von außen darstellt.
pub(super) struct ModClient {
    reader: BufReader<OwnedReadHalf>,
    writer: OwnedWriteHalf,
}

impl ModClient {
    pub(super) async fn connect(port: u16) -> Self {
        let (reader, writer) = TcpStream::connect(("127.0.0.1", port)).await.unwrap().into_split();
        Self { reader: BufReader::new(reader), writer }
    }

    pub(super) async fn send_raw(&mut self, bytes: &[u8]) {
        self.writer.write_all(bytes).await.unwrap();
    }

    pub(super) async fn send(&mut self, message: Value) {
        self.send_raw(format!("{message}\n").as_bytes()).await;
    }

    pub(super) async fn request(&mut self, id: &str, op: &str, args: Value) {
        self.send(json!({"type": "req", "id": id, "op": op, "args": args})).await;
    }

    /// Die nächste Nachricht; `None`, wenn der Launcher die Verbindung geschlossen hat.
    pub(super) async fn read(&mut self) -> Option<Value> {
        let mut line = String::new();
        let read = tokio::time::timeout(WAIT, self.reader.read_line(&mut line)).await.expect("keine Antwort der Brücke");
        match read {
            Ok(0) | Err(_) => None,
            Ok(_) => Some(serde_json::from_str(&line).unwrap()),
        }
    }

    /// Die nächste Nachricht, auf die `matches` zutrifft; was davor kommt, wird übergangen.
    pub(super) async fn read_where(&mut self, matches: impl Fn(&Value) -> bool) -> Value {
        loop {
            let message = self.read().await.expect("Verbindung vor der erwarteten Nachricht geschlossen");
            if matches(&message) {
                return message;
            }
        }
    }

    pub(super) async fn read_type(&mut self, kind: &str) -> Value {
        self.read_where(|message| message["type"] == kind).await
    }

    /// Alles bis zum Ende der Verbindung; der Launcher darf vorher noch `closing` melden.
    pub(super) async fn expect_closed(&mut self) -> Vec<Value> {
        let mut rest = Vec::new();
        while let Some(message) = self.read().await {
            rest.push(message);
        }
        rest
    }

    pub(super) async fn expect_silence(&mut self, duration: Duration) {
        let mut line = String::new();
        assert!(tokio::time::timeout(duration, self.reader.read_line(&mut line)).await.is_err(), "unerwartet: {line}");
    }

    pub(super) async fn ping_pong(&mut self) {
        self.send(json!({"type": "ping"})).await;
        self.read_type("pong").await;
    }
}

pub(super) fn hello_with(token: &str, build: &str) -> Value {
    json!({
        "type": "hello",
        "protocol": 2,
        "token": token,
        "mod": {"version": "2.1.0", "build": build},
        "game": {"minecraft": "1.21.1", "loader": "neoforge", "loaderVersion": "21.1.172", "java": 21},
    })
}

pub(super) fn hello(token: &str) -> Value {
    hello_with(token, BUILD_PREFIX)
}

/// Ein Besitzer-Urteil, fest vorgegeben.
struct FixedOwner(fn() -> io::Result<bool>);

impl OwnerCheck for FixedOwner {
    fn owns(&self, _pid: u32, _peer: SocketAddr, _local: SocketAddr) -> io::Result<bool> {
        (self.0)()
    }
}

pub(super) fn fixed_owner(answer: fn() -> io::Result<bool>) -> Arc<dyn OwnerCheck> {
    Arc::new(FixedOwner(answer))
}

pub(super) struct Fixture {
    pub bridge: ModBridge,
    pub signals: Receiver<GameSignal>,
    pub port: u16,
    pub token: String,
}

impl Fixture {
    /// Eine laufende Brücke mit dem echten Besitzer-Urteil des Betriebssystems und einem Spiel, dessen Prozess dieser
    /// Test selbst ist (seine Sockets gehören ihm).
    pub(super) async fn start() -> Self {
        Self::start_with(Timing::PRODUCTION, Arc::new(SocketOwner), Expectations::unconstrained()).await
    }

    pub(super) async fn start_with(timing: Timing, owner: Arc<dyn OwnerCheck>, expectations: Expectations) -> Self {
        let fixture = Self::start_unbound(timing, owner, expectations).await;
        fixture.bridge.bind_pid("i1", std::process::id());
        fixture
    }

    /// Wie `start_with`, aber der Spielprozess ist dem Launcher noch nicht bekannt.
    pub(super) async fn start_unbound(timing: Timing, owner: Arc<dyn OwnerCheck>, expectations: Expectations) -> Self {
        let game_signals = GameSignals::default();
        let signals = game_signals.subscribe();
        let bridge = ModBridge::with_parts(game_signals, timing, owner);
        bridge.start().await.unwrap();
        let env = bridge.register_launch("i1", expectations);
        let value = |name: &str| env.iter().find(|(key, _)| key == name).map(|(_, value)| value.clone()).unwrap();
        Self { bridge, signals, port: value(ENV_PORT).parse().unwrap(), token: value(ENV_TOKEN) }
    }

    pub(super) async fn connect(&self) -> ModClient {
        ModClient::connect(self.port).await
    }

    /// Meldet eine Mod an und liest `welcome`.
    pub(super) async fn login(&self) -> (ModClient, Value) {
        let mut client = self.connect().await;
        client.send(hello(&self.token)).await;
        let welcome = client.read().await.expect("keine Antwort auf hello");
        assert_eq!(welcome["type"], "welcome", "{welcome}");
        (client, welcome)
    }

    /// Schickt `hello` und liefert die Antwort des Launchers.
    pub(super) async fn answer_to(&self, hello: Value) -> Value {
        let mut client = self.connect().await;
        client.send(hello).await;
        client.read().await.expect("keine Antwort auf hello")
    }

    /// Wartet, bis `expected` gesendet wird; was davor kommt, wird übergangen.
    pub(super) async fn expect_signal(&mut self, expected: &GameSignal) {
        let found = async {
            while self.signals.recv().await.unwrap() != *expected {}
        };
        tokio::time::timeout(WAIT, found).await.unwrap_or_else(|_| panic!("Signal blieb aus: {expected:?}"));
    }

    pub(super) async fn wait_until_disconnected(&self) {
        wait_until("Verbindung getrennt", || !self.bridge.is_connected("i1")).await;
    }
}

pub(super) async fn wait_until(what: &str, condition: impl Fn() -> bool) {
    let deadline = tokio::time::Instant::now() + WAIT;
    while !condition() {
        assert!(tokio::time::Instant::now() < deadline, "Zeit abgelaufen: {what}");
        tokio::time::sleep(Duration::from_millis(10)).await;
    }
}

fn friend(id: &str, name: &str) -> ModFriend {
    ModFriend { id: id.into(), name: name.into(), mc_uuid: None, presence: ModPresence::Online, notice: None }
}

fn friends(names: &[(&str, &str)]) -> TopicValue {
    TopicValue::Friends(names.iter().map(|(id, name)| friend(id, name)).collect())
}

/// Ein Bearbeiter aus einer Funktion.
struct FnOps<F>(F);

impl<F> OpHandler for FnOps<F>
where
    F: Fn(OpContext, Op) -> BoxFuture<'static, OpOutcome> + Send + Sync,
{
    fn handle<'a>(&'a self, ctx: OpContext, op: Op) -> BoxFuture<'a, OpOutcome> {
        (self.0)(ctx, op)
    }
}

pub(super) fn ops_from<F, Fut>(behave: F) -> Arc<dyn OpHandler>
where
    F: Fn(OpContext, Op) -> Fut + Send + Sync + 'static,
    Fut: Future<Output = OpOutcome> + Send + 'static,
{
    Arc::new(FnOps(move |ctx, op| -> BoxFuture<'static, OpOutcome> { Box::pin(behave(ctx, op)) }))
}

/// Ein Bearbeiter, der jeden Vorgang notiert und mit `{}` beantwortet.
fn recording_ops() -> (Arc<dyn OpHandler>, Arc<Mutex<Vec<Op>>>) {
    let seen = Arc::new(Mutex::new(Vec::new()));
    let log = seen.clone();
    let handler = ops_from(move |_ctx, op| {
        log.lock().unwrap().push(op);
        async { Ok(OpResult::empty()) }
    });
    (handler, seen)
}

// --- Spielstarts und Umgebung ---------------------------------------------------------------------------------------

fn register_unconstrained(bridge: &ModBridge, instance_id: &str) -> Vec<(String, String)> {
    bridge.register_launch(instance_id, Expectations::unconstrained())
}

#[tokio::test]
async fn a_launch_is_registered_only_while_the_bridge_listens() {
    let bridge = ModBridge::new(GameSignals::default());
    assert!(register_unconstrained(&bridge, "i1").is_empty(), "gestoppt");
    bridge.start().await.unwrap();
    assert_eq!(register_unconstrained(&bridge, "i1").len(), 3);
    bridge.stop().await;
    assert!(register_unconstrained(&bridge, "i1").is_empty(), "wieder gestoppt");
}

#[tokio::test]
async fn a_registered_launch_names_port_token_and_protocol_two_and_every_launch_gets_a_new_token() {
    let bridge = ModBridge::new(GameSignals::default());
    bridge.start().await.unwrap();
    let env = register_unconstrained(&bridge, "i1");
    let names: Vec<&str> = env.iter().map(|(name, _)| name.as_str()).collect();
    assert_eq!(names, [ENV_PORT, ENV_TOKEN, ENV_PROTOCOL]);
    assert!(env[0].1.parse::<u16>().is_ok());
    assert!(env[1].1.len() == 64 && env[1].1.bytes().all(|b| b.is_ascii_hexdigit()), "{}", env[1].1);
    assert_eq!(env[2].1, "2");
    assert_ne!(register_unconstrained(&bridge, "i1")[1].1, env[1].1);
}

#[tokio::test]
async fn a_launch_without_a_microsoft_account_gets_no_access_and_leaves_no_record() {
    let bridge = ModBridge::new(GameSignals::default());
    bridge.start().await.unwrap();
    let offline = Expectations { online_account: false, ..Expectations::unconstrained() };
    assert!(bridge.register_launch("i1", offline).is_empty());
    bridge.bind_pid("i1", 1);
    assert!(!bridge.is_connected("i1"));
}

#[tokio::test]
async fn starting_twice_keeps_one_listener() {
    let bridge = ModBridge::new(GameSignals::default());
    bridge.start().await.unwrap();
    let port = |env: Vec<(String, String)>| env[0].1.clone();
    let first = port(register_unconstrained(&bridge, "i1"));
    bridge.start().await.unwrap();
    assert_eq!(port(register_unconstrained(&bridge, "i1")), first);
}

// --- Anmeldung -------------------------------------------------------------------------------------------------------

#[tokio::test]
async fn a_valid_hello_gets_welcome_with_the_scopes_of_the_launch() {
    let fixture = Fixture::start().await;
    let (_client, welcome) = fixture.login().await;
    assert_eq!(
        welcome,
        json!({"type": "welcome", "protocol": 2, "launcher": env!("CARGO_PKG_VERSION"), "scopes": {"share": "ask", "social": "ask"}})
    );
    assert!(fixture.bridge.is_connected("i1"));
}

#[tokio::test]
async fn a_wrong_token_is_rejected() {
    let fixture = Fixture::start().await;
    let mut client = fixture.connect().await;
    client.send(hello(&"0".repeat(64))).await;
    assert_eq!(client.read().await, Some(json!({"type": "reject", "reason": "token"})));
    client.expect_closed().await;
    assert!(!fixture.bridge.is_connected("i1"));
}

#[tokio::test]
async fn another_protocol_is_rejected_even_in_the_shape_of_protocol_one() {
    let fixture = Fixture::start().await;
    let mut newer = hello(&fixture.token);
    newer["protocol"] = json!(3);
    assert_eq!(fixture.answer_to(newer).await, json!({"type": "reject", "reason": "protocol"}));

    let old = json!({"type": "hello", "protocols": [1], "token": fixture.token, "mod": "0.1.0", "minecraft": "26.3"});
    assert_eq!(fixture.answer_to(old).await, json!({"type": "reject", "reason": "protocol"}));
    assert!(!fixture.bridge.is_connected("i1"));
}

#[tokio::test]
async fn a_pid_that_is_not_bound_yet_gets_retry_and_the_next_try_after_binding_passes() {
    let fixture = Fixture::start_unbound(Timing::PRODUCTION, Arc::new(SocketOwner), Expectations::unconstrained()).await;
    assert_eq!(fixture.answer_to(hello(&fixture.token)).await, json!({"type": "reject", "reason": "retry"}));
    fixture.bridge.bind_pid("i1", std::process::id());
    let (mut client, _) = fixture.login().await;
    client.ping_pong().await;
}

#[tokio::test]
async fn a_connection_from_another_process_is_rejected_as_owner() {
    let fixture = Fixture::start_unbound(Timing::PRODUCTION, Arc::new(SocketOwner), Expectations::unconstrained()).await;
    fixture.bridge.bind_pid("i1", crate::services::sockowner::ended_process_id());
    assert_eq!(fixture.answer_to(hello(&fixture.token)).await, json!({"type": "reject", "reason": "owner"}));
    assert!(!fixture.bridge.is_connected("i1"));
}

#[tokio::test]
async fn a_lookup_that_fails_is_rejected_as_owner_not_let_through() {
    let owner = fixed_owner(|| Err(io::Error::other("Tabelle nicht lesbar")));
    let fixture = Fixture::start_with(Timing::PRODUCTION, owner, Expectations::unconstrained()).await;
    assert_eq!(fixture.answer_to(hello(&fixture.token)).await, json!({"type": "reject", "reason": "owner"}));
}

#[tokio::test]
async fn the_owner_is_asked_after_the_token_so_a_stranger_learns_nothing_about_processes() {
    let asked = Arc::new(AtomicUsize::new(0));
    let counter = asked.clone();
    struct Counting(Arc<AtomicUsize>);
    impl OwnerCheck for Counting {
        fn owns(&self, _: u32, _: SocketAddr, _: SocketAddr) -> io::Result<bool> {
            self.0.fetch_add(1, Ordering::SeqCst);
            Ok(true)
        }
    }
    let fixture = Fixture::start_with(Timing::PRODUCTION, Arc::new(Counting(counter)), Expectations::unconstrained()).await;
    let reject = fixture.answer_to(hello(&"0".repeat(64))).await;
    assert_eq!(reject["reason"], "token");
    assert_eq!(asked.load(Ordering::SeqCst), 0);
}

#[tokio::test]
async fn a_mod_with_another_build_than_the_embedded_one_is_rejected() {
    let expectations = Expectations { build_id: Some(BUILD_SHA256.into()), ..Expectations::unconstrained() };
    let fixture = Fixture::start_with(Timing::PRODUCTION, Arc::new(SocketOwner), expectations).await;
    for build in ["ffffffffffffffff", "0123456", ""] {
        let answer = fixture.answer_to(hello_with(&fixture.token, build)).await;
        assert_eq!(answer, json!({"type": "reject", "reason": "build"}), "{build:?}");
    }
    let (mut client, _) = fixture.login().await;
    client.ping_pong().await;
}

#[tokio::test]
async fn a_second_connection_with_the_same_token_is_rejected_and_the_first_stays() {
    let fixture = Fixture::start().await;
    let (mut first, _) = fixture.login().await;
    let mut second = fixture.connect().await;
    second.send(hello(&fixture.token)).await;
    assert_eq!(second.read().await, Some(json!({"type": "reject", "reason": "duplicate"})));
    second.expect_closed().await;
    first.ping_pong().await;
    assert!(fixture.bridge.is_connected("i1"));
}

#[tokio::test]
async fn the_process_of_a_spawned_game_is_bound_from_the_game_signal() {
    let fixture = Fixture::start_unbound(Timing::PRODUCTION, Arc::new(SocketOwner), Expectations::unconstrained()).await;
    let spawned = GameSignal::Spawned { instance_id: "i1".into(), pid: std::process::id(), online_account: true, friend_join: None };
    fixture.bridge.inner.signals.send(spawned);
    let mut accepted = None;
    for _ in 0..100 {
        let answer = fixture.answer_to(hello(&fixture.token)).await;
        if answer["type"] == "welcome" {
            accepted = Some(answer);
            break;
        }
        assert_eq!(answer["reason"], "retry");
        tokio::time::sleep(Duration::from_millis(20)).await;
    }
    assert!(accepted.is_some(), "die Brücke bindet den Prozess aus dem Signal");
}

#[tokio::test]
async fn a_second_pid_for_a_bound_launch_is_ignored() {
    let fixture = Fixture::start().await;
    fixture.bridge.bind_pid("i1", crate::services::sockowner::ended_process_id());
    let (mut client, _) = fixture.login().await;
    client.ping_pong().await;
}

#[tokio::test]
async fn connecting_and_disconnecting_are_signalled() {
    let mut fixture = Fixture::start().await;
    let (client, _) = fixture.login().await;
    let connected = GameSignal::ModConnected { instance_id: "i1".into() };
    fixture.expect_signal(&connected).await;
    assert!(fixture.bridge.is_connected("i1"));
    drop(client);
    let disconnected = GameSignal::ModDisconnected { instance_id: "i1".into() };
    fixture.expect_signal(&disconnected).await;
    assert!(!fixture.bridge.is_connected("i1"));
}

// --- Ende eines Spielstarts -------------------------------------------------------------------------------------------

#[tokio::test]
async fn forgetting_a_launch_says_why_disconnects_the_mod_and_voids_the_token() {
    let fixture = Fixture::start().await;
    let (mut client, _) = fixture.login().await;
    fixture.bridge.forget("i1");
    let rest = client.expect_closed().await;
    assert_eq!(rest, [json!({"type": "event", "event": "closing", "reason": "launchEnded"})]);
    assert!(!fixture.bridge.is_connected("i1"));
    let mut again = fixture.connect().await;
    again.send(hello(&fixture.token)).await;
    assert_eq!(again.read().await, Some(json!({"type": "reject", "reason": "token"})));
}

#[tokio::test]
async fn a_new_launch_of_the_same_instance_voids_the_old_token() {
    let fixture = Fixture::start().await;
    let (mut old, _) = fixture.login().await;
    register_unconstrained(&fixture.bridge, "i1");
    let rest = old.expect_closed().await;
    assert_eq!(rest, [json!({"type": "event", "event": "closing", "reason": "replaced"})]);
    let mut late = fixture.connect().await;
    late.send(hello(&fixture.token)).await;
    assert_eq!(late.read().await, Some(json!({"type": "reject", "reason": "token"})));
}

#[tokio::test]
async fn stopping_the_bridge_disconnects_everyone_and_frees_the_port() {
    let fixture = Fixture::start().await;
    let (mut client, _) = fixture.login().await;
    fixture.bridge.stop().await;
    let rest = client.expect_closed().await;
    assert_eq!(rest, [json!({"type": "event", "event": "closing", "reason": "bridgeStopped"})]);
    assert!(TcpStream::connect(("127.0.0.1", fixture.port)).await.is_err());
    assert!(register_unconstrained(&fixture.bridge, "i1").is_empty());
}

// --- Nachrichten der Mod, die keine Vorgänge sind ----------------------------------------------------------------------

#[tokio::test]
async fn ping_is_answered_and_unknown_or_malformed_lines_are_ignored() {
    let fixture = Fixture::start().await;
    let (mut client, _) = fixture.login().await;
    for line in ["not json", "{\"type\":\"format\"}", "{\"type\":\"lanOpened\"}", "", "[1,2]", "{\"type\":\"hello\"}"] {
        client.send_raw(format!("{line}\n").as_bytes()).await;
    }
    client.ping_pong().await;
}

#[tokio::test]
async fn lan_hints_and_ready_reach_the_launcher() {
    let mut fixture = Fixture::start().await;
    let (mut client, _) = fixture.login().await;
    client.send(json!({"type": "lanOpened", "port": 50123})).await;
    let opened = GameSignal::LanOpened { instance_id: "i1".into(), port: 50123, source: PortSource::Mod };
    fixture.expect_signal(&opened).await;
    client.send(json!({"type": "lanClosed"})).await;
    fixture.expect_signal(&GameSignal::LanClosed { instance_id: "i1".into() }).await;
    assert_eq!(fixture.bridge.ready_screens("i1"), None);
    client.send(json!({"type": "ready", "screens": ["hub", "share"]})).await;
    wait_until("ready gemerkt", || fixture.bridge.ready_screens("i1").is_some()).await;
    assert_eq!(fixture.bridge.ready_screens("i1"), Some(vec!["hub".to_owned(), "share".to_owned()]));
}

// --- Vorgänge ---------------------------------------------------------------------------------------------------------

#[tokio::test]
async fn without_a_handler_every_op_is_answered_with_unsupported_op() {
    let fixture = Fixture::start().await;
    let (mut client, _) = fixture.login().await;
    client.request("a1", "friend.addByName", json!({"name": "Notch"})).await;
    let answer = client.read_type("res").await;
    assert_eq!(answer, json!({"type": "res", "id": "a1", "ok": false, "error": {"code": "unsupportedOp", "params": {}}}));
}

#[tokio::test]
async fn an_op_reaches_the_handler_and_its_result_comes_back_with_the_id() {
    let fixture = Fixture::start().await;
    let (handler, seen) = recording_ops();
    fixture.bridge.set_handler(handler);
    let (mut client, _) = fixture.login().await;
    client.request("a1", "host.stop", Value::Null).await;
    assert_eq!(client.read_type("res").await, json!({"type": "res", "id": "a1", "ok": true, "result": {}}));
    assert_eq!(*seen.lock().unwrap(), [Op::HostStop {}]);
}

#[tokio::test]
async fn an_error_of_the_handler_comes_back_with_its_params() {
    let fixture = Fixture::start().await;
    fixture.bridge.set_handler(ops_from(|_, _| async { Err(OpError::new(ErrorCode::VersionUnsupported).with_param("min", "1.20")) }));
    let (mut client, _) = fixture.login().await;
    client.request("a1", "host.stop", json!({})).await;
    let answer = client.read_type("res").await;
    assert_eq!(answer["error"], json!({"code": "versionUnsupported", "params": {"min": "1.20"}}));
}

#[tokio::test]
async fn aliases_in_the_args_become_peer_ids_before_the_handler_sees_them() {
    let fixture = Fixture::start().await;
    let (handler, seen) = recording_ops();
    fixture.bridge.set_handler(handler);
    fixture.bridge.set_topic("i1", friends(&[("peer-a", "Alex"), ("peer-b", "Bea")]));
    let (mut client, _) = fixture.login().await;
    let state = client.read_type("state").await;
    let wire = state.to_string();
    assert!(!wire.contains("peer-a") && !wire.contains("peer-b"), "Peer-IDs gehören nicht auf den Draht: {wire}");
    assert_eq!(state["value"][0]["id"], "f1");
    assert_eq!(state["value"][1]["id"], "f2");

    client.request("a1", "host.invite", json!({"friends": ["f2", "f1"], "showWorld": true})).await;
    client.read_type("res").await;
    client.request("a2", "host.kick", json!({"friend": "f1"})).await;
    client.read_type("res").await;

    let expected = [Op::HostInvite { friends: vec!["peer-b".into(), "peer-a".into()], show_world: true }, Op::HostKick { friend: "peer-a".into() }];
    assert_eq!(*seen.lock().unwrap(), expected);
}

#[tokio::test]
async fn bad_requests_are_answered_with_an_error_and_never_reach_the_handler() {
    let fixture = Fixture::start().await;
    let (handler, seen) = recording_ops();
    fixture.bridge.set_handler(handler);
    fixture.bridge.set_topic("i1", friends(&[("peer-a", "Alex")]));
    let (mut client, _) = fixture.login().await;
    client.read_type("state").await;
    let cases = [
        ("b1", "host.explode", json!({}), ErrorCode::BadRequest),
        ("b2", "host.kick", json!({}), ErrorCode::BadRequest),
        ("b3", "host.kick", json!({"friend": "peer-a"}), ErrorCode::UnknownFriend),
        ("b4", "host.kick", json!({"friend": "f7"}), ErrorCode::UnknownFriend),
        ("b5", "launcher.open", json!({"target": "nowhere"}), ErrorCode::BadRequest),
    ];
    for (id, op, args, code) in cases {
        client.request(id, op, args).await;
        let answer = client.read_type("res").await;
        assert_eq!((answer["id"].as_str(), answer["error"]["code"].as_str()), (Some(id), serde_json::to_value(code).unwrap().as_str()), "{op}");
    }
    assert!(seen.lock().unwrap().is_empty());
}

#[tokio::test]
async fn a_request_with_an_invalid_id_gets_no_answer() {
    let fixture = Fixture::start().await;
    let (handler, seen) = recording_ops();
    fixture.bridge.set_handler(handler);
    let (mut client, _) = fixture.login().await;
    for id in ["", "A1", "a-1", "abcdefghij123"] {
        client.request(id, "host.stop", json!({})).await;
    }
    client.ping_pong().await;
    assert!(seen.lock().unwrap().is_empty());
}

#[tokio::test]
async fn state_sync_resends_every_topic_and_answers_ok() {
    let fixture = Fixture::start().await;
    fixture.bridge.set_topic("i1", TopicValue::Invites(vec![ModInvite { id: "i9".into(), from_name: "Sam".into(), title: "Insel".into() }]));
    let (mut client, _) = fixture.login().await;
    assert_eq!(client.read_type("state").await["topic"], "invites");

    client.request("s1", "state.sync", json!({})).await;

    assert_eq!(client.read_type("res").await, json!({"type": "res", "id": "s1", "ok": true, "result": {}}));
    let again = client.read_type("state").await;
    assert_eq!((again["topic"].as_str(), again["rev"].as_u64()), (Some("invites"), Some(1)), "dieselbe Revision, noch einmal");
}

// --- Zustimmungen und Zähler überleben die Verbindung -----------------------------------------------------------------

fn consenting_ops(asked: Arc<AtomicUsize>) -> Arc<dyn OpHandler> {
    ops_from(move |ctx, op| {
        let asked = asked.clone();
        async move {
            let ask = async {
                asked.fetch_add(1, Ordering::SeqCst);
                true
            };
            match op {
                Op::HostInvite { .. } => ctx.require_scope(Scope::Share, ask).await.map(|()| OpResult::empty()),
                _ => Ok(OpResult::empty()),
            }
        }
    })
}

#[tokio::test]
async fn the_first_scoped_op_pends_while_the_user_is_asked_and_later_ones_pass_without_a_question() {
    let fixture = Fixture::start().await;
    let asked = Arc::new(AtomicUsize::new(0));
    fixture.bridge.set_handler(consenting_ops(asked.clone()));
    let (mut client, _) = fixture.login().await;

    client.request("a1", "host.invite", json!({"friends": []})).await;
    assert_eq!(client.read_type("pending").await, json!({"type": "pending", "id": "a1", "prompt": "scope", "scope": "share"}));
    assert_eq!(client.read_type("res").await["ok"], true);
    client.request("a2", "host.invite", json!({"friends": []})).await;
    let second = client.read_where(|message| message["type"] == "res" || message["type"] == "pending").await;

    assert_eq!((second["type"].as_str(), second["id"].as_str()), (Some("res"), Some("a2")), "keine zweite Rückfrage");
    assert_eq!(asked.load(Ordering::SeqCst), 1);
}

#[tokio::test]
async fn a_denied_prompt_answers_denied_and_asks_again_next_time() {
    let fixture = Fixture::start().await;
    fixture.bridge.set_handler(ops_from(|ctx, _| async move { ctx.require_scope(Scope::Share, async { false }).await.map(|()| OpResult::empty()) }));
    let (mut client, _) = fixture.login().await;
    for id in ["a1", "a2"] {
        client.request(id, "host.invite", json!({"friends": []})).await;
        assert_eq!(client.read_type("pending").await["id"], id);
        assert_eq!(client.read_type("res").await["error"]["code"], "denied");
    }
}

#[tokio::test]
async fn after_three_prompts_in_ten_minutes_the_fourth_is_denied_without_a_question() {
    let fixture = Fixture::start().await;
    let asked = Arc::new(AtomicUsize::new(0));
    let counter = asked.clone();
    fixture.bridge.set_handler(ops_from(move |ctx, _| {
        let counter = counter.clone();
        async move {
            let ask = async {
                counter.fetch_add(1, Ordering::SeqCst);
                false
            };
            ctx.require_scope(Scope::Social, ask).await.map(|()| OpResult::empty())
        }
    }));
    let (mut client, _) = fixture.login().await;
    for index in 0..4 {
        client.request(&format!("a{index}"), "friend.addByName", json!({"name": "x"})).await;
        assert_eq!(client.read_type("res").await["error"]["code"], "denied");
    }
    assert_eq!(asked.load(Ordering::SeqCst), 3, "die vierte und alle weiteren Rückfragen entfallen");
}

#[tokio::test]
async fn a_second_prompt_while_one_is_open_is_busy() {
    let fixture = Fixture::start().await;
    let release = Arc::new(Notify::new());
    let gate = release.clone();
    fixture.bridge.set_handler(ops_from(move |ctx, _| {
        let gate = gate.clone();
        async move {
            let ask = async move {
                gate.notified().await;
                true
            };
            ctx.require_scope(Scope::Share, ask).await.map(|()| OpResult::empty())
        }
    }));
    let (mut client, _) = fixture.login().await;
    client.request("a1", "host.invite", json!({"friends": []})).await;
    client.read_type("pending").await;
    client.request("a2", "host.invite", json!({"friends": []})).await;
    let busy = client.read_type("res").await;
    assert_eq!((busy["id"].as_str(), busy["error"]["code"].as_str()), (Some("a2"), Some("busy")));
    release.notify_one();
    assert_eq!(client.read_type("res").await["id"], "a1");
}

#[tokio::test]
async fn grants_and_counters_survive_a_disconnect_and_a_reconnect_of_the_link() {
    let fixture = Fixture::start().await;
    let asked = Arc::new(AtomicUsize::new(0));
    fixture.bridge.set_handler(consenting_ops(asked.clone()));
    let (mut first, welcome) = fixture.login().await;
    assert_eq!(welcome["scopes"]["share"], "ask");
    first.request("a1", "host.invite", json!({"friends": []})).await;
    assert_eq!(first.read_type("res").await["ok"], true);
    first.request("o1", "launcher.open", json!({"target": "friends"})).await;
    assert_eq!(first.read_type("res").await["ok"], true);
    first.request("o2", "launcher.open", json!({"target": "friends"})).await;
    assert_eq!(first.read_type("res").await["error"]["code"], "rateLimited", "1 je 10 Sekunden");
    drop(first);
    fixture.wait_until_disconnected().await;

    let (mut again, welcome) = fixture.login().await;

    assert_eq!(welcome["scopes"]["share"], "allow", "die Zustimmung gehört dem Spielstart");
    again.request("a2", "host.invite", json!({"friends": []})).await;
    assert_eq!(again.read_type("res").await["ok"], true);
    assert_eq!(asked.load(Ordering::SeqCst), 1, "keine neue Rückfrage nach dem Wiederverbinden");
    again.request("o3", "launcher.open", json!({"target": "friends"})).await;
    assert_eq!(again.read_type("res").await["error"]["code"], "rateLimited", "der Zähler wurde nicht zurückgesetzt");
}

#[tokio::test]
async fn a_new_launch_of_the_instance_starts_without_the_consent_and_counters_of_the_old_one() {
    let fixture = Fixture::start().await;
    fixture.bridge.set_handler(consenting_ops(Arc::new(AtomicUsize::new(0))));
    let (mut old, _) = fixture.login().await;
    old.request("a1", "host.invite", json!({"friends": []})).await;
    old.read_type("res").await;

    let env = register_unconstrained(&fixture.bridge, "i1");
    fixture.bridge.bind_pid("i1", std::process::id());
    let token = env.iter().find(|(name, _)| name == ENV_TOKEN).unwrap().1.clone();
    let mut fresh = fixture.connect().await;
    fresh.send(hello(&token)).await;

    let welcome = fresh.read().await.unwrap();

    assert_eq!(welcome["scopes"], json!({"share": "ask", "social": "ask"}));
}

#[tokio::test]
async fn a_prompt_left_open_by_a_link_that_ends_is_closed_with_it() {
    let fixture = Fixture::start().await;
    fixture.bridge.set_handler(ops_from(|ctx, _| async move {
        ctx.require_scope(Scope::Share, std::future::pending()).await.map(|()| OpResult::empty())
    }));
    let (mut first, _) = fixture.login().await;
    first.request("a1", "host.invite", json!({"friends": []})).await;
    first.read_type("pending").await;
    drop(first);
    fixture.wait_until_disconnected().await;

    let (mut again, _) = fixture.login().await;
    again.request("a2", "host.invite", json!({"friends": []})).await;
    let answer = again.read_where(|message| message["type"] == "pending" || message["type"] == "res").await;

    assert_eq!(answer["type"], "pending", "die abgebrochene Rückfrage blockiert die nächste nicht");
}

#[tokio::test]
async fn the_bridge_counts_ops_before_the_handler_sees_them() {
    let fixture = Fixture::start().await;
    let (handler, seen) = recording_ops();
    fixture.bridge.set_handler(handler);
    let (mut client, _) = fixture.login().await;
    let mut codes = Vec::new();
    for index in 0..6 {
        client.request(&format!("a{index}"), "friend.addByName", json!({"name": "Notch"})).await;
        codes.push(client.read_type("res").await["error"]["code"].as_str().map(str::to_owned));
    }
    assert_eq!(codes, [None, None, None, None, None, Some("rateLimited".to_owned())], "5 je Minute");
    assert_eq!(seen.lock().unwrap().len(), 5);
}

#[tokio::test]
async fn charging_after_the_prompt_counts_host_invite_three_times_a_minute() {
    let fixture = Fixture::start().await;
    fixture.bridge.set_handler(ops_from(|ctx, _| async move { ctx.charge(RateClass::HostInvite).map(|()| OpResult::empty()) }));
    let (mut client, _) = fixture.login().await;
    let mut answers = Vec::new();
    for index in 0..4 {
        client.request(&format!("a{index}"), "host.invite", json!({"friends": []})).await;
        answers.push(client.read_type("res").await["ok"].as_bool());
    }
    assert_eq!(answers, [Some(true), Some(true), Some(true), Some(false)]);
}

#[tokio::test(start_paused = true)]
async fn an_op_that_does_not_finish_is_answered_with_timeout_at_the_deadline() {
    let fixture = Fixture::start().await;
    fixture.bridge.set_handler(ops_from(|_, _| std::future::pending::<OpOutcome>()));
    let ctx = OpContext::new(
        fixture.bridge.inner.clone(),
        "i1".into(),
        "a1".into(),
        super::launch::Link {
            id: 1,
            queue: Arc::new(super::queue::LinkQueue::new(Duration::ZERO)),
            abort: Default::default(),
            peer: "127.0.0.1:50000".parse().unwrap(),
            local: "127.0.0.1:50001".parse().unwrap(),
        },
    );
    let started = tokio::time::Instant::now();

    let outcome = super::connection::answer(fixture.bridge.inner.handler().as_ref(), ctx, Op::HostStop {}, limits::REQUEST_DEADLINE).await;

    assert_eq!(outcome, Err(OpError::new(ErrorCode::Timeout)));
    assert_eq!(started.elapsed(), limits::REQUEST_DEADLINE);
}

// --- Themen und Hinweise ----------------------------------------------------------------------------------------------

#[tokio::test]
async fn a_mod_that_connects_late_gets_the_last_value_of_every_topic_first() {
    let fixture = Fixture::start().await;
    fixture.bridge.set_topic("i1", friends(&[("peer-a", "Alex")]));
    fixture.bridge.set_topic("i1", TopicValue::Session(None));
    let (mut client, _) = fixture.login().await;
    let mut topics = [client.read_type("state").await, client.read_type("state").await];
    topics.sort_by_key(|state| state["topic"].to_string());
    assert_eq!(topics[0], json!({"type": "state", "topic": "friends", "rev": 1, "value": [{"id": "f1", "name": "Alex", "mcUuid": null, "presence": "online"}]}));
    assert_eq!(topics[1], json!({"type": "state", "topic": "session", "rev": 1, "value": null}));
}

#[tokio::test]
async fn a_changed_topic_goes_out_with_the_next_revision_and_an_equal_value_does_not() {
    let fixture = Fixture::start_with(Timing { topic_coalesce: Duration::ZERO, ..Timing::PRODUCTION }, Arc::new(SocketOwner), Expectations::unconstrained()).await;
    let (mut client, _) = fixture.login().await;
    fixture.bridge.set_topic("i1", friends(&[("peer-a", "Alex")]));
    assert_eq!(client.read_type("state").await["rev"], 1);
    fixture.bridge.set_topic("i1", friends(&[("peer-a", "Alex")]));
    client.expect_silence(Duration::from_millis(300)).await;
    fixture.bridge.set_topic("i1", friends(&[("peer-a", "Alexander")]));
    let second = client.read_type("state").await;
    assert_eq!((second["rev"].as_u64(), second["value"][0]["name"].as_str()), (Some(2), Some("Alexander")));
}

#[tokio::test]
async fn quick_changes_of_a_topic_are_merged_into_the_last_one() {
    let fixture = Fixture::start().await;
    let (mut client, _) = fixture.login().await;
    fixture.bridge.set_topic("i1", friends(&[("peer-a", "start")]));
    assert_eq!(client.read_type("state").await["value"][0]["name"], "start");
    let pushed = std::time::Instant::now();
    for name in ["eins", "zwei", "drei"] {
        fixture.bridge.set_topic("i1", friends(&[("peer-a", name)]));
    }
    let merged = client.read_type("state").await;
    assert_eq!(merged["value"][0]["name"], "drei");
    assert_eq!(merged["rev"], 4, "Zwischenstände werden übersprungen, die Revision zählt weiter");
    assert!(pushed.elapsed() >= Duration::from_millis(100), "{:?}", pushed.elapsed());
    client.expect_silence(Duration::from_millis(500)).await;
}

#[tokio::test]
async fn topics_wait_for_their_own_interval_only() {
    let fixture = Fixture::start().await;
    let (mut client, _) = fixture.login().await;
    fixture.bridge.set_topic("i1", friends(&[("peer-a", "Alex")]));
    client.read_type("state").await;
    fixture.bridge.set_topic("i1", friends(&[("peer-a", "Alexa")]));
    fixture.bridge.set_topic("i1", TopicValue::Session(None));
    let first = client.read_type("state").await;
    assert_eq!(first["topic"], "session", "ein anderes Thema muss nicht warten");
}

#[tokio::test]
async fn guests_in_a_session_get_the_alias_of_their_friend() {
    let fixture = Fixture::start().await;
    let guests = vec![ModGuest { id: "peer-a".into(), name: "Alex".into(), state: ModGuestState::Connected }];
    fixture.bridge.set_topic("i1", friends(&[("peer-a", "Alex")]));
    fixture.bridge.set_topic("i1", TopicValue::Session(Some(ModSession { guests })));
    let (mut client, _) = fixture.login().await;
    let states = [client.read_type("state").await, client.read_type("state").await];
    let find = |topic: &str| states.iter().find(|state| state["topic"] == topic).unwrap().clone();
    assert_eq!(find("session")["value"]["guests"][0]["id"], find("friends")["value"][0]["id"]);
}

#[tokio::test]
async fn a_notification_reaches_the_connected_mod_and_is_dropped_without_one() {
    let fixture = Fixture::start().await;
    fixture.bridge.notify("i1", ModNotify::FriendOnline, Some("Nobody".into()));
    let (mut client, _) = fixture.login().await;
    client.expect_silence(Duration::from_millis(200)).await;
    fixture.bridge.notify("i1", ModNotify::GuestJoined, Some("Alex".into()));
    fixture.bridge.notify("i1", ModNotify::SessionEnded, None);
    assert_eq!(client.read_type("event").await, json!({"type": "event", "event": "notify", "kind": "guestJoined", "name": "Alex"}));
    assert_eq!(client.read_type("event").await, json!({"type": "event", "event": "notify", "kind": "sessionEnded"}));
}
