//! Die Brücke gegen echte Loopback-Verbindungen, mit einer Mod, die das Protokoll von Hand spricht.
use std::time::Duration;

use serde_json::{json, Value};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::net::tcp::{OwnedReadHalf, OwnedWriteHalf};
use tokio::net::TcpStream;
use tokio::sync::broadcast::Receiver;
use tokio::sync::mpsc;
use tokio_util::sync::CancellationToken;

use super::protocol::{LauncherToMod, ModErrorCode, ModFriend, ModGuest, ModGuestState, ModPresence, ModSession};
use super::*;
use crate::services::gamesignal::{GameSignal, ModRequest};
use crate::services::shared_types::PortSource;

const WAIT: Duration = Duration::from_secs(5);

/// Die Mod, wie sie sich von außen darstellt.
struct ModClient {
    reader: BufReader<OwnedReadHalf>,
    writer: OwnedWriteHalf,
}

impl ModClient {
    async fn connect(port: u16) -> Self {
        let (reader, writer) = TcpStream::connect(("127.0.0.1", port)).await.unwrap().into_split();
        Self { reader: BufReader::new(reader), writer }
    }

    async fn send_raw(&mut self, bytes: &[u8]) {
        self.writer.write_all(bytes).await.unwrap();
    }

    async fn send(&mut self, message: Value) {
        self.send_raw(format!("{message}\n").as_bytes()).await;
    }

    /// Die nächste Nachricht; `None`, wenn der Launcher die Verbindung geschlossen hat.
    async fn read(&mut self) -> Option<Value> {
        let mut line = String::new();
        let read = tokio::time::timeout(WAIT, self.reader.read_line(&mut line)).await.expect("keine Antwort der Brücke");
        match read {
            Ok(0) | Err(_) => None,
            Ok(_) => Some(serde_json::from_str(&line).unwrap()),
        }
    }

    async fn expect_closed(&mut self) {
        while self.read().await.is_some() {}
    }

    async fn expect_silence(&mut self, duration: Duration) {
        let mut line = String::new();
        assert!(tokio::time::timeout(duration, self.reader.read_line(&mut line)).await.is_err(), "unerwartet: {line}");
    }

    async fn ping_pong(&mut self) {
        self.send(json!({"type": "ping"})).await;
        assert_eq!(self.read().await, Some(json!({"type": "pong"})));
    }
}

fn hello(token: &str) -> Value {
    json!({"type": "hello", "protocols": [1], "token": token, "mod": "0.1.0", "minecraft": "26.3"})
}

struct Fixture {
    bridge: ModBridge,
    signals: Receiver<GameSignal>,
    port: u16,
    token: String,
}

impl Fixture {
    async fn start() -> Self {
        let game_signals = GameSignals::default();
        let signals = game_signals.subscribe();
        let bridge = ModBridge::new(game_signals);
        bridge.start().await.unwrap();
        let env = bridge.launch_env("i1", ModLoader::Fabric);
        let value = |name: &str| env.iter().find(|(key, _)| key == name).map(|(_, value)| value.clone()).unwrap();
        Self { bridge, signals, port: value(ENV_PORT).parse().unwrap(), token: value(ENV_TOKEN) }
    }

    async fn connect(&self) -> ModClient {
        ModClient::connect(self.port).await
    }

    /// Meldet eine Mod an und liest `welcome` und den ersten Stand.
    async fn login(&self) -> (ModClient, Value) {
        let mut client = self.connect().await;
        client.send(hello(&self.token)).await;
        assert_eq!(client.read().await, Some(json!({"type": "welcome", "protocol": 1, "launcher": env!("CARGO_PKG_VERSION")})));
        let snapshot = client.read().await.unwrap();
        (client, snapshot)
    }

    /// Wartet, bis `expected` gesendet wird; was davor kommt, wird übergangen.
    async fn expect_signal(&mut self, expected: &GameSignal) {
        let found = async {
            while self.signals.recv().await.unwrap() != *expected {}
        };
        tokio::time::timeout(WAIT, found).await.unwrap_or_else(|_| panic!("Signal blieb aus: {expected:?}"));
    }

    fn drain_signals(&mut self) -> Vec<GameSignal> {
        std::iter::from_fn(|| self.signals.try_recv().ok()).collect()
    }
}

fn friend(id: &str, name: &str) -> ModFriend {
    ModFriend { id: id.into(), name: name.into(), mc_uuid: None, presence: ModPresence::Online }
}

fn snapshot_with(friends: Vec<ModFriend>) -> LauncherToMod {
    LauncherToMod::Snapshot { friends, session: None, invites: Vec::new() }
}

#[tokio::test]
async fn launch_env_is_empty_when_stopped_or_not_fabric() {
    let bridge = ModBridge::new(GameSignals::default());
    assert!(bridge.launch_env("i1", ModLoader::Fabric).is_empty(), "gestoppt");
    bridge.start().await.unwrap();
    for loader in [ModLoader::Vanilla, ModLoader::Quilt, ModLoader::Forge, ModLoader::NeoForge] {
        assert!(bridge.launch_env("i1", loader).is_empty(), "{loader:?}");
    }
    bridge.stop().await;
    assert!(bridge.launch_env("i1", ModLoader::Fabric).is_empty(), "wieder gestoppt");
}

#[tokio::test]
async fn launch_env_names_port_token_and_protocol_and_every_launch_gets_a_new_token() {
    let bridge = ModBridge::new(GameSignals::default());
    bridge.start().await.unwrap();
    let env = bridge.launch_env("i1", ModLoader::Fabric);
    let names: Vec<&str> = env.iter().map(|(name, _)| name.as_str()).collect();
    assert_eq!(names, [ENV_PORT, ENV_TOKEN, ENV_PROTOCOL]);
    assert!(env[0].1.parse::<u16>().is_ok());
    assert!(env[1].1.len() == 64 && env[1].1.bytes().all(|b| b.is_ascii_hexdigit()), "{}", env[1].1);
    assert_eq!(env[2].1, "1");
    assert_ne!(bridge.launch_env("i1", ModLoader::Fabric)[1].1, env[1].1);
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
async fn the_protocol_version_is_negotiated() {
    let fixture = Fixture::start().await;
    let mut client = fixture.connect().await;
    client.send(json!({"type": "hello", "protocols": [2, 3], "token": fixture.token, "mod": "9", "minecraft": "26.3"})).await;
    assert_eq!(client.read().await, Some(json!({"type": "reject", "reason": "protocol"})));
    client.expect_closed().await;

    let mut newer = fixture.connect().await;
    newer.send(json!({"type": "hello", "protocols": [2, 1], "token": fixture.token, "mod": "9", "minecraft": "26.3"})).await;
    assert_eq!(newer.read().await.unwrap()["protocol"], 1);
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
async fn a_line_over_16_kib_closes_the_connection() {
    let fixture = Fixture::start().await;
    let (mut client, _) = fixture.login().await;
    client.send_raw(&vec![b'a'; 17 * 1024]).await;
    client.expect_closed().await;
}

#[tokio::test]
async fn a_hello_over_16_kib_gets_no_answer() {
    let fixture = Fixture::start().await;
    let mut client = fixture.connect().await;
    client.send_raw(&vec![b'a'; 17 * 1024]).await;
    client.expect_closed().await;
}

#[tokio::test]
async fn silence_after_connecting_closes_after_the_hello_timeout() {
    let fixture = Fixture::start().await;
    let mut client = fixture.connect().await;
    let started = std::time::Instant::now();
    client.expect_closed().await;
    let waited = started.elapsed();
    assert!((Duration::from_millis(1500)..Duration::from_secs(4)).contains(&waited), "{waited:?}");
}

#[tokio::test]
async fn a_message_that_is_not_hello_first_closes_the_connection() {
    let fixture = Fixture::start().await;
    let mut client = fixture.connect().await;
    client.send(json!({"type": "ping"})).await;
    client.expect_closed().await;
}

#[tokio::test]
async fn the_fifth_unauthenticated_connection_is_refused() {
    let fixture = Fixture::start().await;
    let mut waiting = Vec::new();
    for _ in 0..4 {
        waiting.push(fixture.connect().await);
    }
    let mut fifth = fixture.connect().await;
    let started = std::time::Instant::now();
    fifth.expect_closed().await;
    assert!(started.elapsed() < Duration::from_millis(1500), "sofort abgewiesen, nicht erst nach dem Zeitlimit");

    drop(waiting);
    tokio::time::sleep(Duration::from_millis(200)).await;
    let (mut mod_client, _) = fixture.login().await;
    mod_client.ping_pong().await;
}

#[tokio::test]
async fn more_than_20_messages_per_second_close_the_connection() {
    let fixture = Fixture::start().await;
    let (mut client, _) = fixture.login().await;
    client.send_raw("{\"type\":\"ping\"}\n".repeat(30).as_bytes()).await;
    let mut pongs = 0;
    while client.read().await.is_some() {
        pongs += 1;
    }
    assert_eq!(pongs, 20);
}

#[tokio::test]
async fn malformed_and_unknown_lines_are_ignored() {
    let fixture = Fixture::start().await;
    let (mut client, _) = fixture.login().await;
    for line in ["not json", "{\"type\":\"format\"}", "{\"type\":\"lanOpened\"}", "", "[1,2]"] {
        client.send_raw(format!("{line}\n").as_bytes()).await;
    }
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

#[tokio::test]
async fn the_mod_can_reconnect_with_its_token_after_a_disconnect() {
    let fixture = Fixture::start().await;
    let (first, _) = fixture.login().await;
    drop(first);
    for _ in 0..50 {
        if !fixture.bridge.is_connected("i1") {
            break;
        }
        tokio::time::sleep(Duration::from_millis(20)).await;
    }
    let (mut again, _) = fixture.login().await;
    again.ping_pong().await;
}

#[tokio::test]
async fn mod_messages_become_game_signals() {
    let mut fixture = Fixture::start().await;
    let (mut client, _) = fixture.login().await;
    client.send(json!({"type": "lanOpened", "port": 50123})).await;
    let opened = GameSignal::LanOpened { instance_id: "i1".into(), port: 50123, source: PortSource::Mod };
    fixture.expect_signal(&opened).await;
    client.send(json!({"type": "lanClosed"})).await;
    let closed = GameSignal::LanClosed { instance_id: "i1".into() };
    fixture.expect_signal(&closed).await;
    client.send(json!({"type": "stopSharing"})).await;
    let stop = GameSignal::ModRequest { instance_id: "i1".into(), request: ModRequest::StopSharing };
    fixture.expect_signal(&stop).await;
}

#[tokio::test]
async fn share_and_kick_use_aliases_that_map_back_to_peer_ids() {
    let mut fixture = Fixture::start().await;
    let (mut client, _) = fixture.login().await;
    fixture.bridge.push("i1", snapshot_with(vec![friend("peer-a", "Alex"), friend("peer-b", "Bea")]));
    let snapshot = client.read().await.unwrap();
    let wire = snapshot.to_string();
    assert!(!wire.contains("peer-a") && !wire.contains("peer-b"), "Peer-IDs gehören nicht auf den Draht: {wire}");
    assert_eq!(snapshot["friends"][0]["id"], "f1");
    assert_eq!(snapshot["friends"][1]["id"], "f2");

    client.send(json!({"type": "share", "friendIds": ["f2", "f1"]})).await;
    let share = GameSignal::ModRequest { instance_id: "i1".into(), request: ModRequest::Share { friend_ids: vec!["peer-b".into(), "peer-a".into()] } };
    fixture.expect_signal(&share).await;
    client.send(json!({"type": "kick", "friendId": "f1"})).await;
    let kick = GameSignal::ModRequest { instance_id: "i1".into(), request: ModRequest::Kick { friend_id: "peer-a".into() } };
    fixture.expect_signal(&kick).await;
}

#[tokio::test]
async fn requests_with_unknown_aliases_or_a_bad_number_of_friends_are_ignored() {
    let mut fixture = Fixture::start().await;
    let (mut client, _) = fixture.login().await;
    fixture.bridge.push("i1", snapshot_with(vec![friend("peer-a", "Alex")]));
    client.read().await.unwrap();
    let eight: Vec<String> = (0..8).map(|_| "f1".to_owned()).collect();
    for request in [
        json!({"type": "share", "friendIds": ["f1", "peer-a"]}),
        json!({"type": "share", "friendIds": []}),
        json!({"type": "share", "friendIds": eight}),
        json!({"type": "kick", "friendId": "peer-a"}),
        json!({"type": "kick", "friendId": "f7"}),
    ] {
        client.send(request).await;
    }
    client.ping_pong().await;
    let requests: Vec<GameSignal> = fixture.drain_signals().into_iter().filter(|s| matches!(s, GameSignal::ModRequest { .. })).collect();
    assert_eq!(requests, []);
}

#[tokio::test]
async fn a_late_connecting_mod_gets_the_last_snapshot_and_a_fresh_one_gets_an_empty_state() {
    let fixture = Fixture::start().await;
    fixture.bridge.push("i1", snapshot_with(vec![friend("peer-a", "Alex")]));
    let (_client, snapshot) = fixture.login().await;
    assert_eq!(snapshot["friends"][0]["name"], "Alex");

    let other = fixture.bridge.launch_env("i2", ModLoader::Fabric);
    let token = &other.iter().find(|(name, _)| name == ENV_TOKEN).unwrap().1;
    let mut fresh = fixture.connect().await;
    fresh.send(hello(token)).await;
    fresh.read().await.unwrap();
    assert_eq!(fresh.read().await, Some(json!({"type": "snapshot", "friends": [], "session": null, "invites": []})));
}

#[tokio::test]
async fn quick_snapshots_are_merged_into_the_last_one() {
    let fixture = Fixture::start().await;
    let (mut client, _) = fixture.login().await;
    let pushed = std::time::Instant::now();
    for name in ["eins", "zwei", "drei"] {
        fixture.bridge.push("i1", snapshot_with(vec![friend("peer-a", name)]));
    }
    let snapshot = client.read().await.unwrap();
    assert_eq!(snapshot["friends"][0]["name"], "drei");
    assert!(pushed.elapsed() >= Duration::from_millis(100), "{:?}", pushed.elapsed());
    client.expect_silence(Duration::from_millis(500)).await;
}

#[tokio::test]
async fn other_messages_are_not_delayed_and_carry_their_fields() {
    let fixture = Fixture::start().await;
    let (mut client, _) = fixture.login().await;
    let error = LauncherToMod::Error { code: ModErrorCode::Denied, r#ref: Some("r1".into()) };
    fixture.bridge.push("i1", error);
    assert_eq!(client.read().await, Some(json!({"type": "error", "code": "denied", "ref": "r1"})));
}

#[tokio::test]
async fn guests_in_a_snapshot_get_the_alias_of_their_friend() {
    let fixture = Fixture::start().await;
    let (mut client, _) = fixture.login().await;
    let session = ModSession { guests: vec![ModGuest { id: "peer-a".into(), name: "Alex".into(), state: ModGuestState::Connected }] };
    fixture.bridge.push("i1", LauncherToMod::Snapshot { friends: vec![friend("peer-a", "Alex")], session: Some(session), invites: Vec::new() });
    let snapshot = client.read().await.unwrap();
    assert_eq!(snapshot["session"]["guests"][0]["id"], snapshot["friends"][0]["id"]);
}

#[tokio::test]
async fn forgetting_a_launch_disconnects_the_mod_and_voids_the_token() {
    let fixture = Fixture::start().await;
    let (mut client, _) = fixture.login().await;
    fixture.bridge.forget("i1");
    client.expect_closed().await;
    assert!(!fixture.bridge.is_connected("i1"));
    let mut again = fixture.connect().await;
    again.send(hello(&fixture.token)).await;
    assert_eq!(again.read().await, Some(json!({"type": "reject", "reason": "token"})));
}

#[tokio::test]
async fn a_new_launch_of_the_same_instance_voids_the_old_token() {
    let fixture = Fixture::start().await;
    let (mut old, _) = fixture.login().await;
    fixture.bridge.launch_env("i1", ModLoader::Fabric);
    old.expect_closed().await;
    let mut late = fixture.connect().await;
    late.send(hello(&fixture.token)).await;
    assert_eq!(late.read().await, Some(json!({"type": "reject", "reason": "token"})));
}

#[tokio::test]
async fn stopping_the_bridge_disconnects_everyone_and_frees_the_port() {
    let fixture = Fixture::start().await;
    let (mut client, _) = fixture.login().await;
    fixture.bridge.stop().await;
    client.expect_closed().await;
    assert!(TcpStream::connect(("127.0.0.1", fixture.port)).await.is_err());
    assert!(fixture.bridge.launch_env("i1", ModLoader::Fabric).is_empty());
}

#[tokio::test]
async fn a_mod_that_falls_behind_by_more_than_64_messages_is_disconnected() {
    let bridge = ModBridge::new(GameSignals::default());
    bridge.start().await.unwrap();
    bridge.launch_env("i1", ModLoader::Fabric);
    let (outbox, _unread) = mpsc::channel(OUTBOX_CAPACITY);
    let close = CancellationToken::new();
    lock(&bridge.inner.state).launches.get_mut("i1").unwrap().link = Some(Link { id: 99, outbox, close: close.clone() });
    for _ in 0..OUTBOX_CAPACITY {
        bridge.push("i1", LauncherToMod::Pong);
    }
    assert!(!close.is_cancelled());
    bridge.push("i1", LauncherToMod::Pong);
    assert!(close.is_cancelled());
}

#[tokio::test]
async fn starting_twice_keeps_one_listener() {
    let bridge = ModBridge::new(GameSignals::default());
    bridge.start().await.unwrap();
    let port = |env: Vec<(String, String)>| env[0].1.clone();
    let first = port(bridge.launch_env("i1", ModLoader::Fabric));
    bridge.start().await.unwrap();
    assert_eq!(port(bridge.launch_env("i1", ModLoader::Fabric)), first);
}
