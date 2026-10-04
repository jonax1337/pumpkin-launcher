//! Freunde per Minecraft-Namen aus dem Spiel (INGAME 5.4, BYNAME-ATTEST O-5): solange irgendein Spiel mit der Mod
//! verbunden ist, meldet sich der Launcher am Verzeichnis nur mit dem gemerkten Zertifikat an. Ein neues holt er dann
//! nicht, auch wenn Mojang eine Erneuerung will; ohne brauchbares gemerktes Zertifikat bleibt es bei `directoryUnavailable`.
//! Der Zähler für ausgestellte Zertifikate sitzt im falschen Mojang des Tests.
use serde_json::{json, Value};

use super::super::session_events::NoSessionEvents;
use super::super::sessions::{FriendSessions, SessionContext};
use super::super::tests_session::{FakeMod, FixedVersions, UnknownMods};
use super::super::JoinTimers;
use super::*;
use crate::services::modbridge::Expectations;
use crate::services::modbridge::ops::Scope;
use crate::services::store::JsonStore;

const GAME: &str = "inst-game";

/// Ein Knoten, dessen Spiel mit der Mod verbunden ist; der Nutzer hat soziale Vorgänge für diesen Start schon erlaubt.
struct GameNode {
    node: Node,
    _sessions: FriendSessions,
    game_mod: FakeMod,
}

/// Hängt Sitzungen und ein Spiel mit verbundener Mod an einen laufenden Knoten.
async fn start_game(node: Node) -> GameNode {
    let instances = Arc::new(JsonStore::open(node.dir.path().join("instances.json")).unwrap());
    let sessions = FriendSessions::new(SessionContext {
        friends: node.friends.clone(),
        signals: node.signals.clone(),
        bridge: node.bridge.clone(),
        instances,
        dirs: Dirs::new(node.dir.path()),
        lookup: Arc::new(UnknownMods),
        versions: Arc::new(FixedVersions),
        timers: JoinTimers::production(),
        liveness: Duration::from_secs(15),
    });
    sessions.start(Arc::new(NoSessionEvents)).unwrap();
    let env = node.bridge.register_launch(GAME, Expectations::unconstrained());
    node.bridge.bind_pid(GAME, std::process::id());
    node.bridge.allow_scope_for_test(GAME, Scope::Social);
    let mut game_mod = FakeMod::connect(&env).await;
    until_true("link up", || node.bridge.has_active_link()).await;
    wait_until_ops_are_handled(&mut game_mod).await;
    GameNode { node, _sessions: sessions, game_mod }
}

/// Die Sitzungen setzen ihren Bearbeiter in einer eigenen Aufgabe ein; bis dahin antwortet die Brücke mit `unsupportedOp`.
async fn wait_until_ops_are_handled(game_mod: &mut FakeMod) {
    for attempt in 0..100 {
        let answer = game_mod.call(&format!("w{attempt}"), "friends.retry", json!({})).await;
        if error_code(&answer) != Some("unsupportedOp") {
            return;
        }
        tokio::time::sleep(Duration::from_millis(50)).await;
    }
    panic!("der Bearbeiter der Vorgänge wurde nicht eingesetzt");
}

fn error_code(answer: &Value) -> Option<&str> {
    answer["error"]["code"].as_str()
}

async fn add_by_name_from_the_game(game: &mut GameNode, name: &str) -> Value {
    game.game_mod.call("n1", "friend.addByName", json!({ "name": name })).await
}

#[tokio::test]
async fn a_cached_certificate_that_mojang_wants_refreshed_still_serves_while_a_game_is_linked() {
    let world = World::new().await;
    world.listed_account("Zwei").await;
    world.listed_account("Drei").await;
    let alex = online_with_a_certificate_due_for_refresh(&world, "Alex", "Zwei").await;
    let mut game = start_game(alex).await;

    let answer = add_by_name_from_the_game(&mut game, "Drei").await;

    assert_eq!(answer["ok"], true, "{answer}");
    assert_eq!(world.certificates_of(&game.node), 1, "kein neues Zertifikat bei Mojang");
    assert_eq!(game.node.requests().await.len(), 2, "beide Briefe sind unterwegs");
}

#[tokio::test]
async fn the_plain_api_obeys_the_same_rule_as_long_as_any_game_is_linked() {
    let world = World::new().await;
    world.listed_account("Zwei").await;
    world.listed_account("Drei").await;
    let alex = online_with_a_certificate_due_for_refresh(&world, "Alex", "Zwei").await;
    let game = start_game(alex).await;

    game.node.friends.add_by_name("Drei").await.unwrap();

    assert_eq!(world.certificates_of(&game.node), 1);
}

#[tokio::test]
async fn without_any_usable_cached_certificate_the_answer_is_directory_unavailable_and_nothing_is_fetched() {
    let world = World::new().await;
    world.listed_account("Zwei").await;
    let alex = world.online("Alex", false).await;
    let mut game = start_game(alex).await;

    let answer = add_by_name_from_the_game(&mut game, "Zwei").await;

    assert_eq!(error_code(&answer), Some("directoryUnavailable"), "{answer}");
    assert_eq!(world.certificates_of(&game.node), 0, "nichts wurde geholt");
    assert!(game.node.requests().await.is_empty());
    assert!(game.node.friends.codes().await.unwrap().is_empty(), "der Code für den Brief ist wieder weg");
}

#[tokio::test]
async fn once_the_game_is_gone_the_launcher_fetches_a_fresh_certificate_again() {
    let world = World::new().await;
    world.listed_account("Zwei").await;
    let alex = world.online("Alex", false).await;
    let game = start_game(alex).await;
    let GameNode { node, _sessions, game_mod } = game;
    node.bridge.forget(GAME);
    drop(game_mod);
    until_true("link gone", || !node.bridge.has_active_link()).await;

    node.friends.add_by_name("Zwei").await.unwrap();

    assert_eq!(world.certificates_of(&node), 1);
}

#[tokio::test]
async fn the_directory_loop_fetches_no_certificate_while_a_game_is_linked_and_registers_once_the_last_one_is_gone() {
    let world = World::new().await;
    let alex = world.online("Alex", false).await;
    let game = start_game(alex).await;
    let GameNode { node, _sessions, game_mod } = game;

    node.friends.update_settings(findable_settings("Alex")).await.unwrap();
    until_true("the loop waits", || node.friends.directory_awaits_games()).await;

    assert_eq!(world.certificates_of(&node), 0, "nothing was fetched while the game is linked");
    assert!(!world.directory.is_registered(&node.account.uuid));
    assert_ne!(node.directory_state(), DirectoryState::Unreachable, "waiting is no failure");
    node.bridge.forget(GAME);
    drop(game_mod);
    until_true("link gone", || !node.bridge.has_active_link()).await;
    node.wait_registered(&world).await;

    assert_eq!(world.certificates_of(&node), 1, "the certificate is fetched once the last link has ended");
    until_true("active", || node.directory_state() == DirectoryState::Active).await;
}

/// Nach dem Entwenden des Tokens meldet sich der Dienst mit dem gemerkten Zertifikat neu an, solange das Spiel verbunden
/// ist: `friends.retry` antwortet, und die Anmeldung, die eine Auslieferung sicher auslöst, holt kein zweites Zertifikat.
/// Wie oft `friends.retry` das Abholen vorziehen darf, drosselt die Schleife selbst (BYNAME 7.2); der Test verlässt sich
/// darum nicht auf ihren Takt.
#[tokio::test]
async fn the_directory_loop_and_friends_retry_serve_from_the_cached_certificate_while_a_game_is_linked() {
    let world = World::new().await;
    world.listed_account("Zwei").await;
    world.listed_account("Drei").await;
    let alex = online_with_a_certificate_due_for_refresh(&world, "Alex", "Zwei").await;
    let mut game = start_game(alex).await;

    game.node.friends.update_settings(findable_settings("Alex")).await.unwrap();
    game.node.wait_registered(&world).await;
    world.directory.revoke_tokens();
    let answer = game.game_mod.call("rt", "friends.retry", json!({})).await;
    assert_eq!(answer["ok"], true, "{answer}");
    let delivery = add_by_name_from_the_game(&mut game, "Drei").await;
    assert_eq!(delivery["ok"], true, "{delivery}");

    assert_eq!(world.certificates_of(&game.node), 1, "the certificate Mojang wants refreshed served, no new one was fetched");
    assert_eq!(game.node.directory_state(), DirectoryState::Active);
}

#[tokio::test]
async fn an_unknown_minecraft_name_from_the_game_is_name_unknown() {
    let world = World::new().await;
    let alex = world.online("Alex", false).await;
    let mut game = start_game(alex).await;

    let answer = add_by_name_from_the_game(&mut game, "Niemand").await;

    assert_eq!(error_code(&answer), Some("nameUnknown"), "{answer}");
}

#[tokio::test]
async fn the_players_own_name_is_refused_with_its_reason() {
    let world = World::new().await;
    let alex = world.online("Alex", false).await;
    let mut game = start_game(alex).await;

    let own = add_by_name_from_the_game(&mut game, "Alex").await;

    assert_eq!((error_code(&own), own["error"]["params"]["reason"].as_str()), (Some("badRequest"), Some("nameOwn")));
}

#[tokio::test]
async fn the_sixth_name_in_a_minute_is_rate_limited_and_the_directory_never_hears_of_it() {
    let world = World::new().await;
    let alex = world.online("Alex", false).await;
    let mut game = start_game(alex).await;
    let mut codes = Vec::new();

    for number in 0..6 {
        let answer = game.game_mod.call(&format!("n{number}"), "friend.addByName", json!({ "name": "Niemand" })).await;
        codes.push(error_code(&answer).map(str::to_owned));
    }

    let expected: Vec<Option<String>> = vec![Some("nameUnknown".into()); 5].into_iter().chain([Some("rateLimited".into())]).collect();
    assert_eq!(codes, expected);
}
