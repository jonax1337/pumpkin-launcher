//! Lern-Tests ohne Relay (SPEC 13.1, Zeile R0b): zwei Endpunkte im selben Prozess über Loopback.

mod common;

use std::sync::{
    atomic::{AtomicUsize, Ordering},
    Arc,
};

use common::{bind_loopback, echo_works, loopback, serve_one, without_relays, LIMIT};
use iroh::{
    endpoint::{
        AfterHandshakeOutcome, ApplicationClose, Connection, ConnectionError, EndpointHooks,
        ReadError, ReadToEndError, Side, VarInt,
    },
    Endpoint,
};
use p2p_spike::{
    net::{SpikeNet, ALPN},
    observe::{self, PathKind},
    protocol,
};
use tokio::{
    io::{AsyncReadExt, AsyncWriteExt},
    net::{TcpListener, TcpStream},
};

const NORMAL: u32 = 0;
const NOT_FRIEND: u32 = 2;
const SHUTDOWN: u32 = 6;

async fn connected_protocol_pair(forward: Option<std::net::SocketAddr>) -> (Endpoint, Endpoint, Connection) {
    let net = without_relays();
    let (listener, dialer) = (bind_loopback(&net).await, bind_loopback(&net).await);
    serve_one(listener.clone(), forward);
    let conn = dialer.connect(listener.addr(), ALPN).await.unwrap();
    (listener, dialer, conn)
}

#[tokio::test]
async fn echo_runs_over_a_direct_loopback_path() {
    let (_listener, _dialer, conn) = connected_protocol_pair(None).await;

    echo_works(&conn).await;
    assert_eq!(
        observe::selected_path(&conn).unwrap().kind,
        PathKind::Direct
    );
}

#[tokio::test]
async fn relay_only_without_relays_cannot_bind() {
    let net = SpikeNet {
        relay_only: true,
        ..without_relays()
    };

    let bound = net.builder().unwrap().bind().await;

    assert!(bound.is_err(), "an endpoint needs at least one transport");
}

#[tokio::test]
async fn unknown_stream_mode_is_reset_with_its_code() {
    let (_listener, _dialer, conn) = connected_protocol_pair(None).await;
    let (mut send, mut recv) = conn.open_bi().await.unwrap();

    send.write_all(b"x").await.unwrap();
    let answer = recv.read_to_end(16).await;

    assert_eq!(
        answer,
        Err(ReadToEndError::Read(ReadError::Reset(VarInt::from_u32(1))))
    );
}

#[tokio::test]
async fn endpoint_without_alpns_can_dial() {
    let net = without_relays();
    let listener = bind_loopback(&net).await;
    serve_one(listener.clone(), None);
    let dial_only = loopback(net.builder().unwrap().alpns(Vec::new())).await;

    let outgoing = dial_only.connect(listener.addr(), ALPN).await;

    assert!(outgoing.is_ok(), "dialing needs no own ALPN");
}

#[tokio::test]
async fn dialing_an_endpoint_that_never_calls_accept_hangs() {
    let net = without_relays();
    let (silent, dialer) = (bind_loopback(&net).await, bind_loopback(&net).await);

    let attempt = tokio::time::timeout(LIMIT / 3, dialer.connect(silent.addr(), ALPN)).await;

    assert!(
        attempt.is_err(),
        "pending until the idle timeout, no refusal"
    );
}

#[tokio::test]
async fn accepting_on_an_endpoint_without_alpns_fails_the_handshake() {
    let net = without_relays();
    let dial_only = loopback(net.builder().unwrap().alpns(Vec::new())).await;
    let accepting = dial_only.clone();
    tokio::spawn(async move {
        while let Some(incoming) = accepting.accept().await {
            let _ = incoming.await;
        }
    });
    let dialer = bind_loopback(&net).await;

    let attempt = tokio::time::timeout(LIMIT / 3, dialer.connect(dial_only.addr(), ALPN)).await;

    assert!(matches!(attempt, Ok(Err(_))), "refused at once");
}

#[tokio::test]
async fn upload_is_confirmed_byte_for_byte() {
    let (_listener, _dialer, conn) = connected_protocol_pair(None).await;

    let upload = protocol::upload(&conn, 3 * 1024 * 1024).await.unwrap();

    assert_eq!(upload.bytes, 3 * 1024 * 1024);
}

#[tokio::test]
async fn tunnel_reaches_a_local_tcp_server() {
    let game = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let game_addr = game.local_addr().unwrap();
    tokio::spawn(answer_hello_with_world(game));
    let (_listener, _dialer, conn) = connected_protocol_pair(Some(game_addr)).await;
    let local = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let local_addr = local.local_addr().unwrap();
    tokio::spawn(protocol::forward_local(local, conn));

    let mut client = TcpStream::connect(local_addr).await.unwrap();
    client.write_all(b"hello").await.unwrap();
    let mut answer = [0u8; 5];
    client.read_exact(&mut answer).await.unwrap();

    assert_eq!(&answer, b"world");
}

async fn answer_hello_with_world(game: TcpListener) {
    let (mut socket, _) = game.accept().await.unwrap();
    let mut hello = [0u8; 5];
    socket.read_exact(&mut hello).await.unwrap();
    assert_eq!(&hello, b"hello");
    socket.write_all(b"world").await.unwrap();
}

/// Weist jede eingehende Verbindung nach dem Handshake ab; ausgehende nicht.
#[derive(Debug, Clone, Copy)]
struct RejectIncoming {
    code: u32,
    reason: &'static [u8],
}

impl EndpointHooks for RejectIncoming {
    async fn after_handshake<'a>(&'a self, conn: &'a Connection) -> AfterHandshakeOutcome {
        match conn.side() {
            Side::Server => AfterHandshakeOutcome::Reject {
                error_code: VarInt::from_u32(self.code),
                reason: self.reason.to_vec(),
            },
            Side::Client => AfterHandshakeOutcome::Accept,
        }
    }
}

/// Wählt einen Zuhörer mit `hook` an und liefert, wie der Wählende das Ende der Verbindung sieht.
async fn close_seen_by_dialer(hook: RejectIncoming) -> ConnectionError {
    let net = without_relays();
    let listener = loopback(net.builder().unwrap().hooks(hook)).await;
    let dialer = bind_loopback(&net).await;
    let accepting = listener.clone();
    let listener_side = tokio::spawn(async move { accepting.accept().await.unwrap().await });

    let conn = dialer.connect(listener.addr(), ALPN).await.unwrap();
    let seen = conn.closed().await;

    assert!(
        listener_side.await.unwrap().is_err(),
        "the listener never gets the connection"
    );
    seen
}

fn application_close(code: u32, reason: &[u8]) -> ConnectionError {
    ConnectionError::ApplicationClosed(ApplicationClose {
        error_code: VarInt::from_u32(code),
        reason: reason.to_vec().into(),
    })
}

#[tokio::test]
async fn after_handshake_reject_reaches_the_dialer_as_application_close() {
    let hook = RejectIncoming {
        code: NOT_FRIEND,
        reason: b"not a friend",
    };

    let seen = close_seen_by_dialer(hook).await;

    assert_eq!(seen, application_close(NOT_FRIEND, b"not a friend"));
}

#[tokio::test]
async fn silent_drop_still_sends_a_close_with_code_zero() {
    let hook = RejectIncoming {
        code: NORMAL,
        reason: b"",
    };

    let seen = close_seen_by_dialer(hook).await;

    assert_eq!(seen, application_close(NORMAL, b""));
}

#[tokio::test]
async fn hook_on_the_dialer_also_sees_outgoing_connections() {
    let net = without_relays();
    let listener = bind_loopback(&net).await;
    serve_one(listener.clone(), None);
    let dialer = loopback(net.builder().unwrap().hooks(RejectEverything)).await;

    let outgoing = dialer.connect(listener.addr(), ALPN).await;

    assert!(
        outgoing.is_err(),
        "after_handshake also runs for outgoing connections"
    );
}

#[derive(Debug)]
struct RejectEverything;

impl EndpointHooks for RejectEverything {
    async fn after_handshake<'a>(&'a self, _conn: &'a Connection) -> AfterHandshakeOutcome {
        AfterHandshakeOutcome::Reject {
            error_code: VarInt::from_u32(NOT_FRIEND),
            reason: Vec::new(),
        }
    }
}

/// Zwei verbundene Endpunkte; die Endpunkte müssen leben, sonst schließt iroh die Verbindung lokal.
struct Pair {
    dialer: Endpoint,
    listener: Endpoint,
    dialed: Connection,
    accepted: Connection,
}

async fn connected_pair() -> Pair {
    let net = without_relays();
    let (listener, dialer) = (bind_loopback(&net).await, bind_loopback(&net).await);
    let accepting = listener.clone();
    let accepted = tokio::spawn(async move { accepting.accept().await.unwrap().await.unwrap() });
    let dialed = dialer.connect(listener.addr(), ALPN).await.unwrap();
    Pair {
        dialer,
        listener,
        dialed,
        accepted: accepted.await.unwrap(),
    }
}

#[tokio::test]
async fn accepted_connection_knows_the_remote_id_and_alpn() {
    let pair = connected_pair().await;

    assert_eq!(pair.accepted.remote_id(), pair.dialer.id());
    assert_eq!(pair.accepted.alpn(), ALPN);
}

#[tokio::test]
async fn dropping_the_endpoint_closes_its_connections_locally() {
    let Pair { dialer, dialed, .. } = connected_pair().await;

    drop(dialer);

    assert_eq!(dialed.closed().await, ConnectionError::LocallyClosed);
}

#[tokio::test]
async fn endpoint_close_alone_ends_open_connections_with_code_zero() {
    let pair = connected_pair().await;

    pair.listener.close().await;

    assert_eq!(pair.dialed.closed().await, application_close(NORMAL, b""));
}

#[tokio::test]
async fn closing_the_connection_before_the_endpoint_keeps_its_code() {
    let pair = connected_pair().await;

    pair.accepted.close(VarInt::from_u32(SHUTDOWN), b"");
    pair.listener.close().await;

    assert_eq!(pair.dialed.closed().await, application_close(SHUTDOWN, b""));
}

#[tokio::test]
async fn seventeenth_bidi_stream_waits_for_a_free_slot() {
    let pair = connected_pair().await;
    let mut open = Vec::new();
    for _ in 0..16 {
        open.push(pair.dialed.open_bi().await.unwrap());
    }

    let seventeenth = tokio::time::timeout(LIMIT / 10, pair.dialed.open_bi()).await;

    assert!(
        seventeenth.is_err(),
        "max_concurrent_bidi_streams = 16 blocks the 17th open_bi"
    );
}

#[tokio::test]
async fn ignored_incoming_leaves_the_dialer_without_any_answer() {
    let net = without_relays();
    let (listener, dialer) = (bind_loopback(&net).await, bind_loopback(&net).await);
    let ignored = Arc::new(AtomicUsize::new(0));
    let counter = ignored.clone();
    let ignoring = listener.clone();
    tokio::spawn(async move {
        while let Some(incoming) = ignoring.accept().await {
            counter.fetch_add(1, Ordering::SeqCst);
            incoming.ignore();
        }
    });

    let attempt = tokio::time::timeout(LIMIT / 3, dialer.connect(listener.addr(), ALPN)).await;

    assert!(
        attempt.is_err(),
        "connect must still be pending when the time limit hits"
    );
    assert!(
        ignored.load(Ordering::SeqCst) >= 1,
        "the attempt reached the listener"
    );
}
