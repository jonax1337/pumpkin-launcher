//! Transport mit echten Sockets (SPEC 13.1, Zeile R1): Endpunkte nur auf Loopback, Peers finden sich über iroh's
//! In-Process-Relay (SPEC 3.7). Echte Zeit, kein Netz nötig.
use std::{
    borrow::Cow,
    future::{self, Future},
    net::{IpAddr, Ipv4Addr, SocketAddr},
    sync::{
        atomic::{AtomicUsize, Ordering},
        Arc, Mutex,
    },
    time::{Duration, Instant},
};

use bytes::Bytes;
use iroh::{
    endpoint::{ReadError, VarInt},
    test_utils::run_relay_server,
};
use tokio::{
    io::{AsyncReadExt, AsyncWriteExt},
    net::{TcpListener, TcpStream},
};
use tokio_util::sync::CancellationToken;

use super::{
    tunnel::{bridge, ListenerLimits, LocalListener, TunnelError},
    *,
};
use crate::services::{lock, shared_types::PathKind};

const ALPN: &[u8] = b"pumpkin/test/1";
const LIMIT: Duration = Duration::from_secs(10);
const LOOPBACK: IpAddr = IpAddr::V4(Ipv4Addr::LOCALHOST);
const GUEST_LIMITS: ListenerLimits = ListenerLimits { before_first_valid: 1, after_first_valid: 4 };

/// Startet ein Relay im Test-Prozess; es läuft, solange der zweite Wert lebt.
async fn test_relay() -> (RelayEntry, impl Send) {
    let (map, url, server) = run_relay_server().await.unwrap();
    let quic_port = map.get(&url).unwrap().quic.as_ref().map(|quic| quic.port);
    let entry = RelayEntry { index: 0, url: Cow::Owned(url.to_string()), operator: RelayOperator::Pumpkin, quic_port };
    (entry, server)
}

fn config(seed: u8, relay_map: Vec<RelayEntry>) -> NetConfig {
    NetConfig {
        secret: [seed; 32],
        alpns: vec![ALPN],
        relay_map,
        relays: RelaySelection::All,
        relay_only: false,
        relay_tls: RelayTls::InsecureForTests,
    }
}

struct AcceptAll;

impl Gate for AcceptAll {
    fn admit(&self, _peer: &PeerId, _alpn: &[u8]) -> Admission {
        Admission::Accept
    }
}

/// Antwortet immer gleich und merkt sich, wen und welches ALPN es gesehen hat.
struct FixedGate {
    answer: Admission,
    seen: Mutex<Vec<(PeerId, Vec<u8>)>>,
}

impl FixedGate {
    fn new(answer: Admission) -> Arc<Self> {
        Arc::new(Self { answer, seen: Mutex::new(Vec::new()) })
    }
}

impl Gate for FixedGate {
    fn admit(&self, peer: &PeerId, alpn: &[u8]) -> Admission {
        lock(&self.seen).push((*peer, alpn.to_vec()));
        self.answer
    }
}

async fn bind(config: NetConfig, gate: Arc<dyn Gate>) -> PeerNet {
    PeerNet::bind(config, gate).await.unwrap()
}

async fn online(net: &PeerNet) {
    let mut status = net.status();
    let reached = status.wait_for(|state| matches!(state, NetState::Online { .. }));
    tokio::time::timeout(LIMIT, reached).await.expect("relay not reached").unwrap();
}

/// Zwei Endpunkte am selben Relay; der zweite hat den ersten angewählt.
struct Pair {
    _dialer: PeerNet,
    listener: PeerNet,
    dialed: PeerConn,
    accepted: PeerConn,
}

async fn connected_pair(relay: &RelayEntry) -> Pair {
    let listener = bind(config(1, vec![relay.clone()]), Arc::new(AcceptAll)).await;
    let dialer = bind(config(2, vec![relay.clone()]), Arc::new(AcceptAll)).await;
    online(&listener).await;
    let dialed = dialer.dial(&listener.id(), ALPN).await.unwrap();
    let (_, accepted) = tokio::time::timeout(LIMIT, listener.accept()).await.unwrap().unwrap();
    Pair { _dialer: dialer, listener, dialed, accepted }
}

/// Ein Echo-Server wie ein LAN-Spiel: gibt jedes Byte zurück.
async fn echo_server() -> SocketAddr {
    let server = TcpListener::bind((LOOPBACK, 0)).await.unwrap();
    let addr = server.local_addr().unwrap();
    tokio::spawn(async move {
        while let Ok((mut socket, _)) = server.accept().await {
            tokio::spawn(async move {
                let (mut read, mut write) = socket.split();
                let _ = tokio::io::copy(&mut read, &mut write).await;
            });
        }
    });
    addr
}

/// Host-Seite: jeder Stream geht per `bridge` an `target`.
fn serve_tunnels(conn: PeerConn, target: SocketAddr) {
    tokio::spawn(async move {
        while let Ok(stream) = conn.accept_bi().await {
            tokio::spawn(async move {
                let local = TcpStream::connect(target).await.unwrap();
                let _ = bridge(stream, local, Bytes::new(), CancellationToken::new()).await;
            });
        }
    });
}

/// Gast-Seite: ein Zuhörer, der jede Verbindung annimmt und über `conn` tunnelt.
async fn guest_listener(conn: PeerConn) -> SocketAddr {
    let listener = LocalListener::bind(LOOPBACK).await.unwrap();
    let addr = listener.addr;
    let admit = |local: TcpStream, _client: SocketAddr| future::ready(Some((local, Bytes::new())));
    let open = move || {
        let conn = conn.clone();
        async move { conn.open_bi().await.map_err(TunnelError::from) }
    };
    listener.serve(admit, open, GUEST_LIMITS, CancellationToken::new());
    addr
}

/// Ein zweiter Griff auf denselben Socket, um seine Optionen zu lesen, nachdem `bridge` ihn übernommen hat.
fn with_spy(socket: TcpStream) -> (TcpStream, std::net::TcpStream) {
    let std = socket.into_std().unwrap();
    let spy = std.try_clone().unwrap();
    (TcpStream::from_std(std).unwrap(), spy)
}

async fn round_trip(client: &mut TcpStream, byte: u8) -> Duration {
    let started = Instant::now();
    client.write_all(&[byte]).await.unwrap();
    assert_eq!(client.read_u8().await.unwrap(), byte);
    started.elapsed()
}

#[tokio::test]
async fn echo_runs_through_local_listener_and_bridge_with_the_prefix_first() {
    let (relay, _server) = test_relay().await;
    let pair = connected_pair(&relay).await;
    serve_tunnels(pair.accepted.clone(), echo_server().await);
    let listener = LocalListener::bind(LOOPBACK).await.unwrap();
    let addr = listener.addr;
    let admit = |mut local: TcpStream, _client: SocketAddr| async move {
        let mut peeked = [0u8; 2];
        local.read_exact(&mut peeked).await.ok()?;
        Some((local, Bytes::copy_from_slice(&peeked)))
    };
    let dialed = pair.dialed.clone();
    let open = move || {
        let conn = dialed.clone();
        async move { conn.open_bi().await.map_err(TunnelError::from) }
    };
    listener.serve(admit, open, GUEST_LIMITS, CancellationToken::new());

    let mut client = TcpStream::connect(addr).await.unwrap();
    client.write_all(b"hello").await.unwrap();
    let mut answer = [0u8; 5];
    tokio::time::timeout(LIMIT, client.read_exact(&mut answer)).await.unwrap().unwrap();

    assert_eq!(&answer, b"hello");
}

#[tokio::test]
async fn one_byte_ping_pong_through_the_tunnel_stays_fast() {
    let (relay, _server) = test_relay().await;
    let pair = connected_pair(&relay).await;
    serve_tunnels(pair.accepted.clone(), echo_server().await);
    let mut client = TcpStream::connect(guest_listener(pair.dialed.clone()).await).await.unwrap();
    client.set_nodelay(true).unwrap();
    round_trip(&mut client, 0).await;

    let mut samples = Vec::with_capacity(1000);
    for round in 0..1000 {
        samples.push(round_trip(&mut client, round as u8).await);
    }

    samples.sort();
    let (p50, p99) = (samples[499], samples[989]);
    eprintln!("tunnel ping-pong p50 {p50:?}, p99 {p99:?}, path {:?}", pair.dialed.path());
    assert!(p99 <= Duration::from_millis(20), "p99 {p99:?}");
}

#[tokio::test]
async fn both_local_sockets_get_tcp_nodelay() {
    let (relay, _server) = test_relay().await;
    let pair = connected_pair(&relay).await;
    let echo = echo_server().await;
    let host_side = TcpStream::connect(echo).await.unwrap();
    host_side.set_nodelay(false).unwrap();
    let (host_side, host_spy) = with_spy(host_side);
    let accepted = pair.accepted.clone();
    tokio::spawn(async move {
        let stream = accepted.accept_bi().await.unwrap();
        let _ = bridge(stream, host_side, Bytes::new(), CancellationToken::new()).await;
    });
    let listener = LocalListener::bind(LOOPBACK).await.unwrap();
    let addr = listener.addr;
    let guest_nodelay = Arc::new(Mutex::new(None));
    let seen = guest_nodelay.clone();
    let admit = move |local: TcpStream, _client: SocketAddr| {
        *lock(&seen) = Some(local.nodelay().unwrap());
        future::ready(Some((local, Bytes::new())))
    };
    let dialed = pair.dialed.clone();
    let open = move || {
        let conn = dialed.clone();
        async move { conn.open_bi().await.map_err(TunnelError::from) }
    };
    listener.serve(admit, open, GUEST_LIMITS, CancellationToken::new());

    let mut client = TcpStream::connect(addr).await.unwrap();
    tokio::time::timeout(LIMIT, round_trip(&mut client, 7)).await.unwrap();

    assert_eq!(*lock(&guest_nodelay), Some(true), "guest socket");
    assert!(host_spy.nodelay().unwrap(), "host socket");
}

#[tokio::test]
async fn bridge_stop_resets_the_stream_and_closes_the_local_socket() {
    let (relay, _server) = test_relay().await;
    let pair = connected_pair(&relay).await;
    let local_server = TcpListener::bind((LOOPBACK, 0)).await.unwrap();
    let mut game = TcpStream::connect(local_server.local_addr().unwrap()).await.unwrap();
    let (local, _) = local_server.accept().await.unwrap();
    let mut stream = pair.dialed.open_bi().await.unwrap();
    stream.write_all(b"x").await.unwrap();
    let far_end = tokio::time::timeout(LIMIT, pair.accepted.accept_bi()).await.unwrap().unwrap();
    let stop = CancellationToken::new();
    let bridged = tokio::spawn(bridge(far_end, local, Bytes::new(), stop.clone()));
    assert_eq!(tokio::time::timeout(LIMIT, game.read_u8()).await.unwrap().unwrap(), b'x');

    stop.cancel();

    assert!(bridged.await.unwrap().is_ok());
    assert_eq!(tokio::time::timeout(LIMIT, game.read(&mut [0u8; 1])).await.unwrap().unwrap(), 0, "game sees EOF");
    let mut rest = Vec::new();
    let read = tokio::time::timeout(LIMIT, stream.read_to_end(&mut rest)).await.unwrap();
    assert_eq!(reset_code(read.unwrap_err()), Some(CloseCode::NORMAL.to_varint()));
}

#[tokio::test]
async fn accepting_gate_hands_the_connection_to_accept() {
    let (relay, _server) = test_relay().await;
    let gate = FixedGate::new(Admission::Accept);
    let listener = bind(config(1, vec![relay.clone()]), gate.clone()).await;
    let dialer = bind(config(2, vec![relay.clone()]), Arc::new(AcceptAll)).await;
    online(&listener).await;

    let dialed = dialer.dial(&listener.id(), ALPN).await.unwrap();
    let (alpn, accepted) = tokio::time::timeout(LIMIT, listener.accept()).await.unwrap().unwrap();

    assert_eq!((alpn.as_slice(), accepted.remote()), (ALPN, dialer.id()));
    assert_eq!(*lock(&gate.seen), [(dialer.id(), ALPN.to_vec())]);
    assert_eq!((dialed.direction(), accepted.direction()), (Direction::Outgoing, Direction::Incoming));
}

/// Wie der Anwählende eine Verbindung enden sieht, die das Gate des Gegenübers mit `answer` beantwortet.
async fn close_seen_by_dialer(answer: Admission) -> (CloseReason, PeerNet) {
    let (relay, _server) = test_relay().await;
    let listener = bind(config(1, vec![relay.clone()]), FixedGate::new(answer)).await;
    let dialer = bind(config(2, vec![relay.clone()]), Arc::new(AcceptAll)).await;
    online(&listener).await;

    let dialed = dialer.dial(&listener.id(), ALPN).await.unwrap();
    let seen = tokio::time::timeout(LIMIT, dialed.closed()).await.unwrap();

    (seen, listener)
}

#[tokio::test]
async fn rejecting_gate_closes_with_its_code_and_accept_never_sees_it() {
    let (seen, listener) = close_seen_by_dialer(Admission::Reject(CloseCode::NOT_FRIEND)).await;

    assert_eq!(seen, CloseReason::Peer(CloseCode::NOT_FRIEND));
    assert!(tokio::time::timeout(Duration::from_millis(300), listener.accept()).await.is_err());
}

#[tokio::test]
async fn dropping_gate_closes_with_code_zero_like_a_normal_end() {
    let (seen, listener) = close_seen_by_dialer(Admission::Drop).await;

    assert_eq!(seen, CloseReason::Peer(CloseCode::NORMAL));
    assert!(tokio::time::timeout(Duration::from_millis(300), listener.accept()).await.is_err());
}

#[tokio::test]
async fn frame_over_the_limit_resets_the_stream_with_protocol() {
    let (relay, _server) = test_relay().await;
    let pair = connected_pair(&relay).await;
    let mut sender = pair.dialed.open_bi().await.unwrap();
    sender.write_all(&(1024 * 1024u32).to_be_bytes()).await.unwrap();
    let mut receiver = tokio::time::timeout(LIMIT, pair.accepted.accept_bi()).await.unwrap().unwrap();

    let refused = receiver.read_frame::<serde_json::Value>(16 * 1024).await;

    assert!(matches!(refused, Err(FrameError::TooLarge { len: 1_048_576, limit: 16_384 })));
    let mut rest = Vec::new();
    let read = tokio::time::timeout(LIMIT, sender.read_to_end(&mut rest)).await.unwrap();
    assert_eq!(reset_code(read.unwrap_err()), Some(CloseCode::PROTOCOL.to_varint()));
}

#[tokio::test]
async fn frames_cross_the_connection() {
    let (relay, _server) = test_relay().await;
    let pair = connected_pair(&relay).await;
    let mut sender = pair.dialed.open_bi().await.unwrap();
    let hello = serde_json::json!({ "type": "control" });

    frame::write(&mut sender, &hello, 1024).await.unwrap();
    let mut receiver = tokio::time::timeout(LIMIT, pair.accepted.accept_bi()).await.unwrap().unwrap();

    assert_eq!(receiver.read_frame::<serde_json::Value>(1024).await.unwrap(), hello);
}

#[tokio::test]
async fn closing_the_endpoint_sends_its_code_to_every_peer() {
    let (relay, _server) = test_relay().await;
    let pair = connected_pair(&relay).await;

    pair.listener.close(CloseCode::SHUTDOWN).await;

    let seen = tokio::time::timeout(LIMIT, pair.dialed.closed()).await.unwrap();
    assert_eq!(seen, CloseReason::Peer(CloseCode::SHUTDOWN));
    assert!(pair.listener.accept().await.is_none(), "accept ends with the endpoint");
}

#[tokio::test]
async fn seventeenth_stream_waits_for_a_free_slot() {
    let (relay, _server) = test_relay().await;
    let pair = connected_pair(&relay).await;
    let mut open = Vec::new();
    for _ in 0..16 {
        open.push(pair.dialed.open_bi().await.unwrap());
    }

    let seventeenth = tokio::time::timeout(Duration::from_secs(1), pair.dialed.open_bi()).await;

    assert!(seventeenth.is_err(), "max_concurrent_bidi_streams = 16");
}

#[tokio::test]
async fn unknown_relay_index_binds_nothing() {
    let (relay, _server) = test_relay().await;
    let hello = NetConfig { relays: RelaySelection::Only(9), relay_only: true, ..config(1, vec![relay]) };

    let bound = PeerNet::bind(hello, Arc::new(AcceptAll)).await;

    assert!(matches!(bound, Err(NetError::UnknownRelay(9))));
}

#[tokio::test]
async fn relay_only_endpoint_is_reachable_only_through_the_relay() {
    let (relay, _server) = test_relay().await;
    let hello = NetConfig { relays: RelaySelection::Only(0), relay_only: true, ..config(1, vec![relay.clone()]) };
    let hello = bind(hello, Arc::new(AcceptAll)).await;
    online(&hello).await;
    assert_eq!(hello.direct_addrs(), [], "no direct (IP) address");
    assert_eq!(hello.home_relay(), Some(0));

    let without_relay = bind(config(2, Vec::new()), Arc::new(AcceptAll)).await;
    let started = Instant::now();
    let refused = without_relay.dial(&hello.id(), ALPN).await;
    assert!(matches!(refused, Err(NetError::Unreachable | NetError::Timeout)));
    assert!(started.elapsed() <= DIAL_TIMEOUT + Duration::from_secs(1));

    let through_relay = bind(config(3, vec![relay]), Arc::new(AcceptAll)).await;
    let dialed = through_relay.dial(&hello.id(), ALPN).await.unwrap();
    let (_, accepted) = tokio::time::timeout(LIMIT, hello.accept()).await.unwrap().unwrap();
    serve_tunnels(accepted, echo_server().await);
    let mut client = TcpStream::connect(guest_listener(dialed.clone()).await).await.unwrap();
    tokio::time::timeout(LIMIT, round_trip(&mut client, 1)).await.unwrap();
    assert_eq!(dialed.path(), Some(PathKind::Relay));
}

#[tokio::test]
async fn config_from_the_built_in_relay_map_binds() {
    let built_in = NetConfig { relay_tls: RelayTls::Verify, ..config(1, RELAY_MAP.to_vec()) };

    let net = bind(built_in, Arc::new(AcceptAll)).await;

    net.close(CloseCode::SHUTDOWN).await;
}

#[tokio::test]
async fn unreachable_relay_reports_relay_unreachable_after_the_wait() {
    let dead = RelayEntry {
        index: 0,
        url: Cow::Borrowed("https://127.0.0.1:9/"),
        operator: RelayOperator::Pumpkin,
        quic_port: None,
    };
    let net = bind(config(1, vec![dead]), Arc::new(AcceptAll)).await;
    let mut status = net.status();
    assert_eq!(*status.borrow(), NetState::Starting);

    let reported = tokio::time::timeout(LIMIT, status.wait_for(|state| *state != NetState::Starting)).await;

    assert_eq!(*reported.unwrap().unwrap(), NetState::RelayUnreachable);
    assert_eq!(net.home_relay(), None);
}

#[tokio::test]
async fn listener_closes_a_refused_connection_without_opening_a_stream() {
    let opened = Arc::new(AtomicUsize::new(0));
    let addr = serve_without_peer(|_local, _client| future::ready(None), opened.clone()).await;

    let mut client = TcpStream::connect(addr).await.unwrap();

    assert_closed(&mut client).await;
    assert_eq!(opened.load(Ordering::SeqCst), 0);
}

#[tokio::test]
async fn before_the_first_valid_connection_only_one_is_checked_at_a_time() {
    let admitted = Arc::new(AtomicUsize::new(0));
    let calls = admitted.clone();
    let addr = serve_without_peer(
        move |local, _client| {
            calls.fetch_add(1, Ordering::SeqCst);
            hold(local)
        },
        Arc::new(AtomicUsize::new(0)),
    )
    .await;
    let _checking = TcpStream::connect(addr).await.unwrap();
    eventually(|| admitted.load(Ordering::SeqCst) == 1).await;

    let mut second = TcpStream::connect(addr).await.unwrap();

    assert_closed(&mut second).await;
    assert_eq!(admitted.load(Ordering::SeqCst), 1);
}

#[tokio::test]
async fn after_the_first_valid_connection_four_run_at_once() {
    let admitted = Arc::new(AtomicUsize::new(0));
    let opened = Arc::new(AtomicUsize::new(0));
    let calls = admitted.clone();
    let addr = serve_without_peer(
        move |local, _client| {
            let first = calls.fetch_add(1, Ordering::SeqCst) == 0;
            async move {
                if first {
                    Some((local, Bytes::new()))
                } else {
                    hold(local).await
                }
            }
        },
        opened.clone(),
    )
    .await;
    let mut valid = TcpStream::connect(addr).await.unwrap();
    assert_closed(&mut valid).await;
    assert_eq!(opened.load(Ordering::SeqCst), 1, "the valid one asked for a stream");
    let mut held = Vec::new();
    for _ in 0..4 {
        held.push(TcpStream::connect(addr).await.unwrap());
    }
    eventually(|| admitted.load(Ordering::SeqCst) == 5).await;

    let mut fifth = TcpStream::connect(addr).await.unwrap();

    assert_closed(&mut fifth).await;
    assert_eq!(admitted.load(Ordering::SeqCst), 5);
}

#[tokio::test]
async fn stopped_listener_refuses_connections() {
    let listener = LocalListener::bind(LOOPBACK).await.unwrap();
    let addr = listener.addr;
    let stop = CancellationToken::new();
    let admit = |local: TcpStream, _client: SocketAddr| future::ready(Some((local, Bytes::new())));
    let open = || future::ready(Err::<BiStream, _>(TunnelError::Timeout));
    let serving = listener.serve(admit, open, GUEST_LIMITS, stop.clone());

    stop.cancel();
    serving.await.unwrap();

    let attempt = tokio::time::timeout(LIMIT, TcpStream::connect(addr)).await.unwrap();
    assert!(attempt.is_err());
}

/// Zuhörer ohne Peer: `open` zählt nur mit und scheitert, damit Grenzen ohne QUIC prüfbar sind.
async fn serve_without_peer<A, AF>(admit: A, opened: Arc<AtomicUsize>) -> SocketAddr
where
    A: Fn(TcpStream, SocketAddr) -> AF + Send + Sync + 'static,
    AF: Future<Output = Option<(TcpStream, Bytes)>> + Send + 'static,
{
    let listener = LocalListener::bind(LOOPBACK).await.unwrap();
    let addr = listener.addr;
    let open = move || {
        opened.fetch_add(1, Ordering::SeqCst);
        future::ready(Err::<BiStream, _>(TunnelError::Timeout))
    };
    listener.serve(admit, open, GUEST_LIMITS, CancellationToken::new());
    addr
}

/// Hält die Verbindung offen, als dauerte die Prüfung ewig.
async fn hold(local: TcpStream) -> Option<(TcpStream, Bytes)> {
    let _open = local;
    future::pending().await
}

async fn assert_closed(client: &mut TcpStream) {
    let read = tokio::time::timeout(LIMIT, client.read(&mut [0u8; 1])).await.expect("still open");
    assert!(matches!(read, Ok(0) | Err(_)), "{read:?}");
}

async fn eventually(condition: impl Fn() -> bool) {
    let deadline = Instant::now() + LIMIT;
    while !condition() {
        assert!(Instant::now() < deadline, "condition not reached");
        tokio::time::sleep(Duration::from_millis(10)).await;
    }
}

/// Code, mit dem die Gegenseite einen Stream zurückgesetzt hat.
fn reset_code(error: std::io::Error) -> Option<VarInt> {
    match error.get_ref()?.downcast_ref::<ReadError>()? {
        ReadError::Reset(code) => Some(*code),
        _ => None,
    }
}
