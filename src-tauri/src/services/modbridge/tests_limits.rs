//! Jede Grenze aus INGAME 5.3 gegen die laufende Brücke: Zeilenlängen, Zeitlimits, Zahl der Verbindungen, Nachrichten und
//! offenen Anfragen, Stillstand und Stille. (Die Warteschlange von 64 und die 32 Hinweise prüft `queue`, die
//! Uhr für Ping und Stille `framing`.)
use std::sync::Arc;
use std::time::Duration;

use serde_json::{json, Value};
use tokio::sync::Semaphore;

use super::limits::{LAUNCHER_LINE_BYTES, MAX_IN_FLIGHT, MOD_LINE_BYTES, PRE_WELCOME_LINE_BYTES};
use super::ops::{JoinHere, OpResult};
use super::protocol::ModFriend;
use super::tests::{fixed_owner, hello, ops_from, wait_until, Fixture};
use super::*;

/// Ein gültiges `hello`, dessen Zeile samt Zeilenende genau `bytes` lang ist.
fn hello_of_length(token: &str, bytes: usize) -> Vec<u8> {
    let plain = format!("{}\n", hello(token));
    let padding = bytes - plain.len();
    let mut message = hello(token);
    message["mod"]["version"] = Value::String("v".repeat("2.1.0".len() + padding));
    let line = format!("{message}\n");
    assert_eq!(line.len(), bytes);
    line.into_bytes()
}

// --- Zeilenlängen -------------------------------------------------------------------------------------------------

#[tokio::test]
async fn before_welcome_a_line_may_be_one_kib_and_not_a_byte_more() {
    let fixture = Fixture::start().await;
    let mut at_limit = fixture.connect().await;
    at_limit.send_raw(&hello_of_length(&fixture.token, PRE_WELCOME_LINE_BYTES)).await;
    assert_eq!(at_limit.read().await.unwrap()["type"], "welcome");
}

#[tokio::test]
async fn a_hello_over_one_kib_gets_no_answer() {
    let fixture = Fixture::start().await;
    let mut client = fixture.connect().await;
    client.send_raw(&hello_of_length(&fixture.token, PRE_WELCOME_LINE_BYTES + 1)).await;
    assert_eq!(client.expect_closed().await, Vec::<Value>::new());
    assert!(!fixture.bridge.is_connected("i1"));
}

#[tokio::test]
async fn after_welcome_a_line_may_be_16_kib_and_not_a_byte_more() {
    let fixture = Fixture::start().await;
    let (mut client, _) = fixture.login().await;
    client.send_raw(&[vec![b'a'; MOD_LINE_BYTES - 1], vec![b'\n']].concat()).await;
    client.ping_pong().await;
    client.send_raw(&[vec![b'a'; MOD_LINE_BYTES], vec![b'\n']].concat()).await;
    client.expect_closed().await;
    fixture.wait_until_disconnected().await;
}

#[tokio::test]
async fn an_answer_over_64_kib_becomes_an_internal_error_instead() {
    let fixture = Fixture::start().await;
    let huge = ops_from(|_, _| async {
        Ok(OpResult::JoinHere(JoinHere { host: "h".repeat(LAUNCHER_LINE_BYTES), port: 1 }))
    });
    fixture.bridge.set_handler(huge);
    let (mut client, _) = fixture.login().await;
    client.request("a1", "invite.joinHere", json!({"id": "i1"})).await;
    let answer = client.read_type("res").await;
    assert_eq!(answer, json!({"type": "res", "id": "a1", "ok": false, "error": {"code": "internal", "params": {}}}));
    client.ping_pong().await;
}

// --- Anmeldefrist und Zahl der Verbindungen -------------------------------------------------------------------------

#[tokio::test]
async fn silence_after_connecting_closes_after_two_seconds() {
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
async fn the_fifth_unauthenticated_connection_is_refused_at_once() {
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
    wait_until("Plätze frei", || fixture.bridge.inner.unauthenticated.load(std::sync::atomic::Ordering::SeqCst) == 0).await;
    let (mut client, _) = fixture.login().await;
    client.ping_pong().await;
}

#[tokio::test]
async fn a_slow_owner_check_keeps_its_place_among_the_unauthenticated() {
    let owner = fixed_owner(|| {
        std::thread::sleep(Duration::from_millis(800));
        Ok(true)
    });
    let fixture = Fixture::start_with(Timing::PRODUCTION, owner, Expectations::unconstrained()).await;
    let mut checking = fixture.connect().await;
    checking.send(hello(&fixture.token)).await;
    wait_until("Prüfung läuft", || fixture.bridge.inner.unauthenticated.load(std::sync::atomic::Ordering::SeqCst) == 1).await;
    assert_eq!(checking.read().await.unwrap()["type"], "welcome");
}

// --- Nachrichten und offene Anfragen ------------------------------------------------------------------------------

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
async fn the_ninth_open_request_is_busy_and_a_finished_one_makes_room() {
    let fixture = Fixture::start().await;
    let released = Arc::new(Semaphore::new(0));
    let gate = released.clone();
    fixture.bridge.set_handler(ops_from(move |_, _| {
        let gate = gate.clone();
        async move {
            gate.acquire().await.unwrap().forget();
            Ok(OpResult::empty())
        }
    }));
    let (mut client, _) = fixture.login().await;
    for index in 0..=MAX_IN_FLIGHT {
        client.request(&format!("a{index}"), "host.stop", json!({})).await;
    }

    let refused = client.read_type("res").await;
    assert_eq!((refused["id"].as_str(), refused["error"]["code"].as_str()), (Some("a8"), Some("busy")));
    released.add_permits(MAX_IN_FLIGHT);
    let mut answered = Vec::new();
    for _ in 0..MAX_IN_FLIGHT {
        answered.push(client.read_type("res").await["ok"].as_bool());
    }
    assert_eq!(answered, vec![Some(true); MAX_IN_FLIGHT]);
    released.add_permits(1);
    client.request("a9", "host.stop", json!({})).await;
    assert_eq!(client.read_type("res").await["ok"], true);
}

#[tokio::test]
async fn a_second_request_with_an_open_id_is_dropped_without_an_answer() {
    let fixture = Fixture::start().await;
    let released = Arc::new(Semaphore::new(0));
    let gate = released.clone();
    fixture.bridge.set_handler(ops_from(move |_, _| {
        let gate = gate.clone();
        async move {
            gate.acquire().await.unwrap().forget();
            Ok(OpResult::empty())
        }
    }));
    let (mut client, _) = fixture.login().await;
    client.request("a1", "host.stop", json!({})).await;
    client.request("a1", "host.stop", json!({})).await;
    client.ping_pong().await;
    released.add_permits(2);
    assert_eq!(client.read_type("res").await["id"], "a1");
    client.expect_silence(Duration::from_millis(200)).await;
}

// --- Stillstand und Stille ----------------------------------------------------------------------------------------

fn ms(milliseconds: u64) -> Duration {
    Duration::from_millis(milliseconds)
}

fn wide_friends(round: usize) -> TopicValue {
    let name = |index: usize| format!("{}{round:04}{index:02}", "\u{1F383}".repeat(24));
    TopicValue::Friends(
        (0..50)
            .map(|index| ModFriend { id: format!("{index:064x}"), name: name(index), mc_uuid: None, presence: protocol::ModPresence::Online, notice: None })
            .collect(),
    )
}

#[tokio::test]
async fn a_mod_that_does_not_read_is_disconnected_when_a_write_stalls() {
    let timing = Timing { write_stall: ms(300), topic_coalesce: Duration::ZERO, ..Timing::PRODUCTION };
    let fixture = Fixture::start_with(timing, Arc::new(super::owner::SocketOwner), Expectations::unconstrained()).await;
    let (_unread, _) = fixture.login().await;
    for round in 0..4000 {
        if !fixture.bridge.is_connected("i1") {
            break;
        }
        fixture.bridge.set_topic("i1", wide_friends(round));
        tokio::time::sleep(ms(2)).await;
    }
    fixture.wait_until_disconnected().await;
}

#[tokio::test]
async fn the_launcher_pings_and_drops_a_mod_that_stays_silent() {
    let timing = Timing { ping_interval: ms(100), silence: ms(600), ..Timing::PRODUCTION };
    let fixture = Fixture::start_with(timing, Arc::new(super::owner::SocketOwner), Expectations::unconstrained()).await;
    let (mut client, _) = fixture.login().await;
    let started = std::time::Instant::now();

    let rest = client.expect_closed().await;

    let pings = rest.iter().filter(|message| message["type"] == "ping").count();
    assert!(pings >= 3, "{pings} Pings");
    assert!((ms(500)..Duration::from_secs(3)).contains(&started.elapsed()), "{:?}", started.elapsed());
}

#[tokio::test]
async fn a_mod_that_answers_pings_stays_connected() {
    let timing = Timing { ping_interval: ms(100), silence: ms(600), ..Timing::PRODUCTION };
    let fixture = Fixture::start_with(timing, Arc::new(super::owner::SocketOwner), Expectations::unconstrained()).await;
    let (mut client, _) = fixture.login().await;
    let until = std::time::Instant::now() + Duration::from_millis(1500);
    while std::time::Instant::now() < until {
        if client.read_type("ping").await["type"] == "ping" {
            client.send(json!({"type": "pong"})).await;
        }
    }
    client.ping_pong().await;
    assert!(fixture.bridge.is_connected("i1"));
}

