//! Die Vorgänge von INGAME 5.4 gegen die laufende Brücke mit einem Bearbeiter, der alles mit `{}` beantwortet: jeder Vorgang
//! wird in dem Fenster seiner Klasse gezählt (5.6), `join.failed` ist ein Vorgang, die Rückfrage meldet Ablehnungen mit
//! einem Toast (5.5), und die Brücke prüft den Besitzer der Verbindung auf Verlangen noch einmal (7).
use std::io;
use std::sync::atomic::{AtomicU8, AtomicUsize, Ordering};
use std::sync::Mutex;
use std::time::Duration;

use futures::future::join_all;
use serde_json::{json, Value};

use super::ops::{windows_of, ErrorCode, Op, OpError, OpResult, RateClass, Scope, OP_NAMES};
use super::protocol::{ModFriend, ModPresence};
use super::tests::{fixed_owner, ops_from, Fixture};
use super::topics::TopicValue;
use super::*;

/// Platzhalter-Argumente, die jede Form von Argumenten erfüllen; `f1` ist der Alias des einzigen Freundes.
fn args() -> Value {
    json!({"target": "friends", "id": "f1", "accept": true, "name": "x", "friends": ["f1"], "friend": "f1", "code": "x", "alias": null})
}

fn answers_empty() -> Arc<dyn OpHandler> {
    ops_from(|_, _| async { Ok(OpResult::empty()) })
}

/// Eine Brücke mit einem Freund (Alias `f1`) und einer angemeldeten Mod, die dem Alias schon begegnet ist.
async fn login_with_a_friend(fixture: &Fixture) -> super::tests::ModClient {
    let friend = ModFriend { id: "peer-a".into(), name: "Alex".into(), mc_uuid: None, presence: ModPresence::Online, notice: None };
    fixture.bridge.set_topic("i1", TopicValue::Friends(vec![friend]));
    let (mut client, _) = fixture.login().await;
    client.read_type("state").await;
    client
}

/// Schickt den Vorgang so oft, bis `tries` Antworten da sind (mit Abstand, damit die 20 Nachrichten je Sekunde reichen), und
/// nennt für jede den Fehlercode, falls sie einen hatte.
async fn error_codes_of_repeated(op: &str, tries: usize) -> Vec<Option<String>> {
    let fixture = Fixture::start().await;
    fixture.bridge.set_handler(answers_empty());
    let mut client = login_with_a_friend(&fixture).await;
    let mut codes = Vec::new();
    for number in 0..tries {
        client.request(&format!("a{number}"), op, args()).await;
        codes.push(client.read_type("res").await["error"]["code"].as_str().map(str::to_owned));
        tokio::time::sleep(Duration::from_millis(55)).await;
    }
    codes
}

// --- Ratenfenster ------------------------------------------------------------------------------------------------------

#[tokio::test]
async fn every_op_is_counted_in_the_first_window_of_its_class_and_the_next_one_is_rate_limited() {
    let counted: Vec<&str> = OP_NAMES
        .iter()
        .copied()
        .filter(|name| *name != "state.sync")
        .filter(|name| Op::from_request(name, args()).unwrap().rate_class().counted_before_handling())
        .collect();

    let runs = counted.iter().map(|name| async move {
        let class = Op::from_request(name, args()).unwrap().rate_class();
        let allowed = windows_of(class)[0].0;
        (*name, allowed, error_codes_of_repeated(name, allowed + 1).await)
    });

    for (name, allowed, codes) in join_all(runs).await {
        let limited = Some("rateLimited".to_owned());
        assert!(codes[..allowed].iter().all(|code| *code != limited), "{name}: die ersten {allowed} gehen durch: {codes:?}");
        assert_eq!(codes[allowed], limited, "{name}: der nächste ist zu viel");
    }
}

#[tokio::test]
async fn host_invite_is_not_counted_before_the_handler_because_the_handler_charges_after_the_prompt() {
    let codes = error_codes_of_repeated("host.invite", 4).await;

    assert_eq!(codes, [None, None, None, None]);
    assert!(!RateClass::HostInvite.counted_before_handling());
}

#[tokio::test]
async fn the_classes_follow_the_table_of_the_design() {
    let minute = Duration::from_secs(60);
    assert_eq!(windows_of(RateClass::AddByName), [(5, minute), (20, Duration::from_secs(3600))]);
    assert_eq!(windows_of(RateClass::Answer), [(20, minute)]);
    assert_eq!(windows_of(RateClass::HostInvite), [(3, minute)]);
    assert_eq!(windows_of(RateClass::LauncherOpen), [(1, Duration::from_secs(10))]);
    assert_eq!(windows_of(RateClass::Other), [(30, minute)]);
}

// --- join.failed ---------------------------------------------------------------------------------------------------------

#[tokio::test]
async fn join_failed_reaches_the_handler_as_an_op_without_a_scope() {
    let fixture = Fixture::start().await;
    let seen = Arc::new(Mutex::new(Vec::new()));
    let log = seen.clone();
    fixture.bridge.set_handler(ops_from(move |_, op| {
        log.lock().unwrap().push((op.name(), op.scope()));
        async { Ok(OpResult::empty()) }
    }));
    let (mut client, _) = fixture.login().await;

    client.request("a1", "join.failed", json!({})).await;

    assert_eq!(client.read_type("res").await, json!({"type": "res", "id": "a1", "ok": true, "result": {}}));
    assert_eq!(*seen.lock().unwrap(), [("join.failed", None)]);
}

// --- Rückfrage: Toast bei Ablehnung ----------------------------------------------------------------------------------------

fn asking(answer: bool) -> Arc<dyn OpHandler> {
    ops_from(move |ctx, _| async move { ctx.require_scope(Scope::Social, async move { answer }).await.map(|()| OpResult::empty()) })
}

fn is_toast(message: &Value) -> bool {
    message["type"] == "event" && message["event"] == "notify" && message["kind"] == "scopeDenied"
}

fn answers_in(messages: &[Value]) -> Vec<&Value> {
    messages.iter().filter(|message| message["type"] == "res").collect()
}

/// Liest, bis `done` auf alles bisher Gelesene zutrifft; Antwort und Toast kommen in keiner festen Reihenfolge.
async fn read_until(client: &mut super::tests::ModClient, done: impl Fn(&[Value]) -> bool) -> Vec<Value> {
    let mut seen = Vec::new();
    while !done(&seen) {
        seen.push(client.read().await.expect("Verbindung vor dem erwarteten Ende geschlossen"));
    }
    seen
}

#[tokio::test]
async fn a_refused_prompt_ends_with_the_denied_answer_and_the_scope_denied_toast() {
    let fixture = Fixture::start().await;
    fixture.bridge.set_handler(asking(false));
    let (mut client, _) = fixture.login().await;

    client.request("a1", "friend.addByName", json!({"name": "x"})).await;
    let seen = read_until(&mut client, |seen| !answers_in(seen).is_empty() && seen.iter().any(is_toast)).await;

    assert_eq!(answers_in(&seen)[0]["error"]["code"], "denied");
    assert!(seen.iter().any(|message| message["type"] == "pending"));
}

#[tokio::test]
async fn an_allowed_prompt_sends_no_toast() {
    let fixture = Fixture::start().await;
    fixture.bridge.set_handler(asking(true));
    let (mut client, _) = fixture.login().await;

    client.request("a1", "friend.addByName", json!({"name": "x"})).await;
    client.read_type("res").await;

    client.expect_silence(Duration::from_millis(300)).await;
}

#[tokio::test]
async fn a_prompt_that_is_busy_sends_no_toast() {
    let fixture = Fixture::start().await;
    let release = Arc::new(tokio::sync::Notify::new());
    let gate = release.clone();
    fixture.bridge.set_handler(ops_from(move |ctx, _| {
        let gate = gate.clone();
        async move {
            let ask = async move {
                gate.notified().await;
                true
            };
            ctx.require_scope(Scope::Social, ask).await.map(|()| OpResult::empty())
        }
    }));
    let (mut client, _) = fixture.login().await;
    client.request("a1", "friend.addByName", json!({"name": "x"})).await;
    client.read_type("pending").await;

    client.request("a2", "friend.addByName", json!({"name": "x"})).await;
    let busy = client.read_type("res").await;
    release.notify_one();
    let rest = read_until(&mut client, |seen| !answers_in(seen).is_empty()).await;

    assert_eq!(busy["error"]["code"], "busy");
    assert!(!rest.iter().any(is_toast));
}

#[tokio::test]
async fn the_fourth_prompt_in_ten_minutes_is_denied_without_asking_and_still_toasts() {
    let fixture = Fixture::start().await;
    let asked = Arc::new(AtomicUsize::new(0));
    let counter = asked.clone();
    fixture.bridge.set_handler(ops_from(move |ctx, _| {
        let counter = counter.clone();
        async move {
            let ask = async move {
                counter.fetch_add(1, Ordering::SeqCst);
                false
            };
            ctx.require_scope(Scope::Social, ask).await.map(|()| OpResult::empty())
        }
    }));
    let (mut client, _) = fixture.login().await;

    for number in 0..4 {
        client.request(&format!("a{number}"), "friend.addByName", json!({"name": "x"})).await;
        tokio::time::sleep(Duration::from_millis(60)).await;
    }
    let seen = read_until(&mut client, |seen| answers_in(seen).len() == 4 && seen.iter().filter(|m| is_toast(m)).count() == 4).await;

    assert!(answers_in(&seen).iter().all(|answer| answer["error"]["code"] == "denied"));
    assert_eq!(asked.load(Ordering::SeqCst), 3, "die vierte Rückfrage entfällt, ihr Toast nicht");
}

// --- Vorab erlaubt ----------------------------------------------------------------------------------------------------------

#[tokio::test]
async fn a_scope_allowed_before_the_mod_connects_shows_in_welcome_and_is_never_asked() {
    let fixture = Fixture::start().await;
    let asked = Arc::new(AtomicUsize::new(0));
    let counter = asked.clone();
    fixture.bridge.allow_scope_for_test("i1", Scope::Social);
    fixture.bridge.set_handler(ops_from(move |ctx, _| {
        let counter = counter.clone();
        async move {
            let ask = async move {
                counter.fetch_add(1, Ordering::SeqCst);
                true
            };
            ctx.require_scope(Scope::Social, ask).await.map(|()| OpResult::empty())
        }
    }));
    let (mut client, welcome) = fixture.login().await;

    client.request("a1", "friend.addByName", json!({"name": "x"})).await;

    assert_eq!(welcome["scopes"], json!({"share": "ask", "social": "allow"}));
    assert_eq!(client.read_type("res").await["ok"], true);
    assert_eq!(asked.load(Ordering::SeqCst), 0);
}

// --- Fakten des Starts und Besitzer --------------------------------------------------------------------------------------------

async fn answer_of_facts(fixture: &Fixture) -> Value {
    fixture.bridge.set_handler(ops_from(|ctx, _| async move {
        let verified = ctx.verify_owner().await;
        let facts = json!({"online": ctx.online_account(), "pid": ctx.game_pid()});
        Err::<OpResult, OpError>(OpError::new(if verified.is_ok() { ErrorCode::Busy } else { ErrorCode::Denied }).with_param("facts", facts))
    }));
    let (mut client, _) = fixture.login().await;
    client.request("a1", "host.stop", json!({})).await;
    client.read_type("res").await
}

#[tokio::test]
async fn the_handler_learns_the_account_the_process_and_that_the_owner_still_holds() {
    let fixture = Fixture::start_with(Timing::PRODUCTION, Arc::new(super::owner::SocketOwner), Expectations::unconstrained()).await;

    let answer = answer_of_facts(&fixture).await;

    assert_eq!(answer["error"]["code"], "busy", "der Besitzer wurde bestätigt");
    assert_eq!(answer["error"]["params"]["facts"], json!({"online": true, "pid": std::process::id()}));
}

/// Was das Betriebssystem über den Besitzer sagt: 0 gehört, 1 gehört nicht, 2 nicht lesbar.
static OWNER_VERDICT: AtomicU8 = AtomicU8::new(0);

fn owner_verdict() -> io::Result<bool> {
    match OWNER_VERDICT.load(Ordering::SeqCst) {
        0 => Ok(true),
        1 => Ok(false),
        _ => Err(io::Error::other("Tabelle der Verbindungen nicht lesbar")),
    }
}

#[tokio::test]
async fn an_owner_who_no_longer_holds_or_cannot_be_looked_up_fails_closed_after_a_good_login() {
    for verdict_after_login in [1, 2] {
        OWNER_VERDICT.store(0, Ordering::SeqCst);
        let fixture = Fixture::start_with(Timing::PRODUCTION, fixed_owner(owner_verdict), Expectations::unconstrained()).await;
        fixture.bridge.set_handler(ops_from(|ctx, _| async move { ctx.verify_owner().await.map(|()| OpResult::empty()) }));
        let (mut client, _) = fixture.login().await;
        OWNER_VERDICT.store(verdict_after_login, Ordering::SeqCst);

        client.request("a1", "host.stop", json!({})).await;

        let answer = client.read_type("res").await;
        assert_eq!(answer["error"], json!({"code": "denied", "params": {"reason": "owner"}}), "Urteil {verdict_after_login}");
    }
}

#[tokio::test]
async fn the_launch_record_can_say_that_there_is_no_microsoft_account() {
    let fixture = Fixture::start().await;
    fixture.bridge.mark_offline_for_test("i1");
    fixture.bridge.set_handler(ops_from(|ctx, _| async move {
        if ctx.online_account() { Ok(OpResult::empty()) } else { Err(OpError::new(ErrorCode::MsAccountRequired)) }
    }));
    let (mut client, _) = fixture.login().await;

    client.request("a1", "host.stop", json!({})).await;

    assert_eq!(client.read_type("res").await["error"]["code"], "msAccountRequired");
}
