//! Einladungen und Beitreten aus dem Spiel (INGAME 5.4, 7): Bert spielt mit der Mod, Anna teilt ihre Welt und hat ihn
//! eingeladen. `invite.joinHere` hält die Schritte von INGAME 7 ein, einer nach dem anderen.
use std::sync::atomic::AtomicBool;

use super::mod_ops::{answer_prompt_of, Prompt, RecordingApp};
use super::*;
use crate::services::friends::contract::{ModScope, SessionEnd};
use crate::services::modbridge::ops::Scope;

fn error_code(answer: &Value) -> Option<&str> {
    answer["error"]["code"].as_str()
}

fn param<'a>(answer: &'a Value, name: &str) -> Option<&'a str> {
    answer["error"]["params"][name].as_str()
}

/// Annas Welt ist geteilt, Bert hat die Einladung, und sein Spiel (`GUEST_INSTANCE`) läuft mit einer verbundenen Mod.
struct JoinScene {
    scene: Scene,
    game_mod: FakeMod,
    app: Arc<RecordingApp>,
    prompts_answered: AtomicUsize,
}

impl JoinScene {
    /// Bert muss beim ersten Beitreten gefragt werden.
    async fn asking() -> Self {
        Self::build(&[], ModBridge::new).await
    }

    async fn allowing_social() -> Self {
        Self::build(&[Scope::Social], ModBridge::new).await
    }

    /// Berts Brücke glaubt der Verbindung nur, solange `owned` wahr ist (die Anmeldung läuft bei wahr durch).
    async fn with_owner(owned: Arc<AtomicBool>) -> Self {
        let owns = Arc::new(move |_pid: u32, _peer: SocketAddr, _local: SocketAddr| -> std::io::Result<bool> { Ok(owned.load(Ordering::SeqCst)) });
        Self::build(&[Scope::Social], move |signals| ModBridge::with_owner_for_test(signals, owns)).await
    }

    async fn build(scopes: &[Scope], make_bridge: impl FnOnce(GameSignals) -> ModBridge) -> Self {
        let scene = Scene::shared_with_guest_bridge(RELAXED, Duration::from_secs(15), make_bridge).await;
        let app = Arc::new(RecordingApp::default());
        scene.guest.sessions.attach_app_events(app.clone());
        let env = mod_env(&scene.guest, GUEST_INSTANCE);
        for scope in scopes {
            scene.guest.bridge.allow_scope_for_test(GUEST_INSTANCE, *scope);
        }
        scene.guest.spawn_game(GUEST_INSTANCE, None);
        let game_mod = FakeMod::connect(&env).await;
        Self { scene, game_mod, app, prompts_answered: AtomicUsize::new(0) }
    }

    fn invite_id(&self) -> String {
        self.scene.invite.id.clone()
    }

    async fn join_here(&mut self, id: &str) -> Value {
        let invite = self.invite_id();
        self.game_mod.call(id, "invite.joinHere", json!({ "id": invite })).await
    }

    /// Wartet auf die nächste Rückfrage in Berts Launcher und beantwortet sie.
    async fn answer_prompt(&self, allow: bool) -> Prompt {
        answer_prompt_of(&self.scene.guest, self.prompts_answered.fetch_add(1, Ordering::SeqCst), allow).await
    }

    fn activity(&self) -> Vec<crate::services::friends::contract::ModActivityEntry> {
        self.scene.guest.sessions.mod_activity()
    }

    fn address_of(answer: &Value) -> String {
        format!("{}:{}", answer["result"]["host"].as_str().unwrap(), answer["result"]["port"])
    }

    fn no_join_was_started(&self) -> bool {
        self.scene.guest.events.join_states().is_empty()
    }
}

/// Eine Mod-Datei in der Instanz, die den Loader unverändert lässt: der Abgleich vergleicht dann Dateien statt Loader.
fn add_local_mod(node: &Node, instance_id: &str, file_name: &str) {
    with_mod(node, instance_id, file_name, b"anderer Inhalt");
    node.instances.modify(instance_id, |instance| instance.loader = ModLoader::Vanilla).unwrap();
}

// ---- invite.plan ----

#[tokio::test]
async fn a_running_game_that_matches_is_ready_and_the_other_instances_are_alternatives() {
    let mut scene = JoinScene::asking().await;
    let invite = scene.invite_id();

    let answer = scene.game_mod.call("p1", "invite.plan", json!({ "id": invite })).await;

    assert_eq!(answer["ok"], true, "{answer}");
    assert_eq!(answer["result"], json!({ "verdict": "ready", "missing": 0, "extra": 0, "alternatives": [{ "name": "Welt inst-host", "matches": true }] }));
    assert!(scene.scene.guest.events.mod_confirm_requests().is_empty(), "der Abgleich braucht keine Zustimmung");
}

#[tokio::test]
async fn a_running_game_with_other_mods_than_the_host_misses_content_even_if_another_instance_fits() {
    let mut scene = JoinScene::asking().await;
    add_local_mod(&scene.scene.guest, GUEST_INSTANCE, "extra.jar");
    let invite = scene.invite_id();

    let answer = scene.game_mod.call("p1", "invite.plan", json!({ "id": invite })).await;

    assert_eq!(answer["result"]["verdict"], "missingContent");
    assert_eq!((answer["result"]["missing"].as_u64(), answer["result"]["extra"].as_u64()), (Some(0), Some(1)));
    assert_eq!(answer["result"]["alternatives"][0], json!({ "name": "Welt inst-host", "matches": true }));
}

#[tokio::test]
async fn a_running_game_of_another_version_has_no_instance_for_this_world() {
    let mut scene = JoinScene::asking().await;
    scene.scene.guest.instances.modify(GUEST_INSTANCE, |instance| instance.minecraft_version = "1.19.4".into()).unwrap();
    let invite = scene.invite_id();

    let answer = scene.game_mod.call("p1", "invite.plan", json!({ "id": invite })).await;

    assert_eq!(answer["result"]["verdict"], "noInstance");
    assert_eq!(answer["result"]["alternatives"], json!([{ "name": "Welt inst-host", "matches": true }]));
}

#[tokio::test]
async fn planning_an_unknown_invite_is_not_found() {
    let mut scene = JoinScene::asking().await;

    let unknown = scene.game_mod.call("p1", "invite.plan", json!({ "id": "gibt-es-nicht" })).await;

    assert_eq!(error_code(&unknown), Some("notFound"));
}

/// Annas Launcher ist abgestürzt (kein Paket mehr, die Einladung bleibt bei Bert); Berts Spiel läuft mit verbundener Mod.
struct CrashedHost {
    guest: Node,
    game_mod: FakeMod,
    invite_id: String,
    host: CrashingHost,
    _relay: Box<dyn Send>,
}

impl CrashedHost {
    async fn after_the_crash() -> Self {
        let (relay, relay_guard) = test_relay().await;
        let crash_options = NetOptions { idle_timeout: CRASH_IDLE_TIMEOUT, ..options(&relay) };
        let guest = Node::online(crash_options, "Bert", RELAXED).await;
        let host = CrashingHost::share_with(&guest, &relay).await;
        let invite_id = guest.open_invite().await.id;
        let env = mod_env(&guest, GUEST_INSTANCE);
        guest.bridge.allow_scope_for_test(GUEST_INSTANCE, Scope::Social);
        guest.spawn_game(GUEST_INSTANCE, None);
        let game_mod = FakeMod::connect(&env).await;
        host.freeze.notify_one();
        let host_peer = guest.friends.list().await.unwrap().remove(0).id.parse::<PeerId>().unwrap();
        until("host offline", || async { guest.presence_of(&host_peer).await == Presence::Offline }).await;
        Self { guest, game_mod, invite_id, host, _relay: Box::new(relay_guard) }
    }

    async fn end(self) {
        self.host.finish().await;
    }
}

#[tokio::test]
async fn a_host_that_crashed_is_peer_offline_for_the_plan_and_for_joining_and_no_join_starts() {
    let mut scene = CrashedHost::after_the_crash().await;
    let invite = scene.invite_id.clone();

    let plan = scene.game_mod.call("p1", "invite.plan", json!({ "id": invite })).await;
    let join = scene.game_mod.call("j1", "invite.joinHere", json!({ "id": invite })).await;

    assert_eq!((error_code(&plan), error_code(&join)), (Some("peerOffline"), Some("peerOffline")));
    assert!(scene.guest.events.join_states().is_empty(), "kein Zuhörer, kein Beitritt");
    scene.end().await;
}

// ---- invite.decline ----

#[tokio::test]
async fn declining_from_the_game_tells_the_host_and_needs_no_consent() {
    let mut scene = JoinScene::asking().await;
    let invite = scene.invite_id();

    let answer = scene.game_mod.call("d1", "invite.decline", json!({ "id": invite })).await;

    assert_eq!(answer["ok"], true);
    scene.scene.host.wait_guest(&scene.scene.guest.id(), (GuestState::Declined, false)).await;
    assert!(scene.scene.guest.sessions.invites().await.unwrap().is_empty());
    assert!(scene.scene.guest.events.mod_confirm_requests().is_empty());
    assert!(scene.activity().is_empty());
}

#[tokio::test]
async fn declining_an_unknown_invite_is_not_found() {
    let mut scene = JoinScene::asking().await;

    let answer = scene.game_mod.call("d1", "invite.decline", json!({ "id": "gibt-es-nicht" })).await;

    assert_eq!(error_code(&answer), Some("notFound"));
}

// ---- invite.joinHere ----

#[tokio::test]
async fn joining_here_hands_the_mod_a_loopback_address_that_leads_into_the_world() {
    let mut scene = JoinScene::allowing_social().await;

    let answer = scene.join_here("j1").await;

    assert_eq!(answer["ok"], true, "{answer}");
    let address = JoinScene::address_of(&answer);
    let socket: SocketAddr = address.parse().unwrap();
    // macOS kennt auf lo0 nur 127.0.0.1 (joining::join_ip); überall sonst muss die Adresse gerade nicht 127.0.0.1
    // sein, damit sie niemand errät.
    #[cfg(target_os = "macos")]
    assert!(socket.ip().is_loopback(), "{address}");
    #[cfg(not(target_os = "macos"))]
    assert!(socket.ip().is_loopback() && socket.ip() != IpAddr::V4(Ipv4Addr::LOCALHOST), "{address}");
    let _game = enter_world(&address).await;
    scene.scene.host.wait_guest(&scene.scene.guest.id(), (GuestState::Connected, false)).await;
    let join = scene.game_mod.topic_where("join", |value| value["state"] == "connected").await;
    assert_eq!(join["value"]["hostName"], "Anna");
    assert_eq!(join["value"]["inviteId"], scene.invite_id());
    let entry = &scene.activity()[0];
    assert_eq!((entry.scope, entry.op.as_str(), entry.target_name.as_deref(), entry.ok), (ModScope::Social, "invite.joinHere", Some("Anna"), true));
    assert_eq!(scene.app.entries(), scene.activity(), "die Oberfläche hört denselben Eintrag");
}

#[tokio::test]
async fn joining_here_asks_first_and_goes_ahead_when_the_user_allows() {
    let mut scene = JoinScene::asking().await;
    let invite = scene.invite_id();

    scene.game_mod.request("j1", "invite.joinHere", json!({ "id": invite })).await;
    let pending = scene.game_mod.next_of_type("pending").await;
    let confirm = scene.answer_prompt(true).await;
    let answer = scene.game_mod.answer_of("j1").await;

    assert_eq!(pending["scope"], "social");
    assert_eq!((confirm.scope, confirm.op.as_str(), confirm.target.as_deref()), (ModScope::Social, "invite.joinHere", Some("Anna")));
    assert_eq!(answer["ok"], true, "{answer}");
}

#[tokio::test]
async fn a_refused_prompt_starts_no_join() {
    let mut scene = JoinScene::asking().await;
    let invite = scene.invite_id();

    scene.game_mod.request("j1", "invite.joinHere", json!({ "id": invite })).await;
    scene.answer_prompt(false).await;
    let answer = scene.game_mod.answer_of("j1").await;

    assert_eq!(error_code(&answer), Some("denied"));
    assert!(scene.no_join_was_started());
    assert!(!scene.activity()[0].ok);
}

#[tokio::test]
async fn a_launch_without_a_microsoft_account_is_refused_before_anything_else() {
    let mut scene = JoinScene::asking().await;
    scene.scene.guest.bridge.mark_offline_for_test(GUEST_INSTANCE);

    let answer = scene.join_here("j1").await;

    assert_eq!(error_code(&answer), Some("msAccountRequired"));
    assert!(scene.scene.guest.events.mod_confirm_requests().is_empty(), "niemand wird gefragt");
    assert!(scene.no_join_was_started());
}

#[tokio::test]
async fn a_running_game_that_does_not_match_is_refused_with_the_verdict_of_the_plan() {
    let mut scene = JoinScene::allowing_social().await;
    add_local_mod(&scene.scene.guest, GUEST_INSTANCE, "extra.jar");

    let answer = scene.join_here("j1").await;

    assert_eq!((error_code(&answer), param(&answer, "verdict")), (Some("instanceMismatch"), Some("missingContent")));
    assert_eq!(answer["error"]["params"]["extra"], 1);
    assert!(scene.no_join_was_started(), "kein Zuhörer, kein Beitritt");
}

#[tokio::test]
async fn a_running_game_of_another_version_is_refused_as_no_instance() {
    let mut scene = JoinScene::allowing_social().await;
    scene.scene.guest.instances.modify(GUEST_INSTANCE, |instance| instance.minecraft_version = "1.19.4".into()).unwrap();

    let answer = scene.join_here("j1").await;

    assert_eq!((error_code(&answer), param(&answer, "verdict")), (Some("instanceMismatch"), Some("noInstance")));
    assert!(scene.no_join_was_started());
}

#[tokio::test]
async fn an_unknown_or_expired_invite_is_not_found_before_anybody_is_asked() {
    let mut scene = JoinScene::asking().await;

    let answer = scene.game_mod.call("j1", "invite.joinHere", json!({ "id": "gibt-es-nicht" })).await;

    assert_eq!(error_code(&answer), Some("notFound"));
    assert!(scene.scene.guest.events.mod_confirm_requests().is_empty());
}

#[tokio::test]
async fn a_second_join_while_one_runs_is_busy_and_the_first_stays() {
    let mut scene = JoinScene::allowing_social().await;
    let first = scene.join_here("j1").await;

    let second = scene.join_here("j2").await;

    assert_eq!(first["ok"], true, "{first}");
    assert_eq!(error_code(&second), Some("busy"));
    assert!(scene.scene.guest.events.join_ends().is_empty(), "der erste Beitritt wurde nicht verdrängt");
    assert!(!refuses_connections(&JoinScene::address_of(&first)).await);
}

#[tokio::test]
async fn two_joins_at_once_let_only_one_through() {
    let mut scene = JoinScene::allowing_social().await;
    let invite = scene.invite_id();

    scene.game_mod.request("j1", "invite.joinHere", json!({ "id": invite })).await;
    scene.game_mod.request("j2", "invite.joinHere", json!({ "id": invite })).await;
    let (first, second) = (scene.game_mod.answer_of("j1").await, scene.game_mod.answer_of("j2").await);

    let outcomes = [first["ok"].as_bool().unwrap(), second["ok"].as_bool().unwrap()];
    assert_eq!(outcomes.iter().filter(|ok| **ok).count(), 1, "{first} {second}");
    let refused = if first["ok"] == true { &second } else { &first };
    assert_eq!(error_code(refused), Some("busy"));
}

#[tokio::test]
async fn an_owner_the_launcher_can_no_longer_prove_fails_closed() {
    let owned = Arc::new(AtomicBool::new(true));
    let mut scene = JoinScene::with_owner(owned.clone()).await;
    owned.store(false, Ordering::SeqCst);

    let answer = scene.join_here("j1").await;

    assert_eq!((error_code(&answer), param(&answer, "reason")), (Some("denied"), Some("owner")));
    assert!(scene.no_join_was_started(), "es wurde nicht einmal ein Zuhörer gebunden");
    assert!(!scene.activity()[0].ok);
}

// ---- join.leave und join.failed ----

#[tokio::test]
async fn leaving_ends_the_join_closes_the_address_and_needs_no_toast() {
    let mut scene = JoinScene::allowing_social().await;
    let address = JoinScene::address_of(&scene.join_here("j1").await);

    scene.game_mod.topic_where("join", Value::is_object).await;

    let left = scene.game_mod.call("l1", "join.leave", json!({})).await;
    scene.game_mod.topic_where("join", Value::is_null).await;

    assert_eq!(left["ok"], true);
    scene.scene.guest.wait_join_end(SessionEnd::Left).await;
    assert!(refuses_connections(&address).await);
    assert!(!scene.game_mod.seen.iter().any(|message| message["kind"] == "joinEnded"), "wer selbst geht, bekommt keinen Toast");
}

#[tokio::test]
async fn leaving_without_a_join_changes_nothing() {
    let mut scene = JoinScene::asking().await;

    let answer = scene.game_mod.call("l1", "join.leave", json!({})).await;

    assert_eq!(answer["ok"], true);
    assert!(scene.no_join_was_started());
}

#[tokio::test]
async fn a_failed_connect_ends_the_join_with_an_error_and_the_mod_gets_the_toast() {
    let mut scene = JoinScene::allowing_social().await;
    let address = JoinScene::address_of(&scene.join_here("j1").await);

    let answer = scene.game_mod.call("f1", "join.failed", json!({})).await;

    assert_eq!(answer["ok"], true);
    scene.scene.guest.wait_join_end(SessionEnd::Error).await;
    assert!(refuses_connections(&address).await);
    scene.game_mod.next_notify("joinEnded").await;
}

#[tokio::test]
async fn a_failure_report_cannot_end_a_join_that_already_has_a_valid_connection() {
    let mut scene = JoinScene::allowing_social().await;
    let address = JoinScene::address_of(&scene.join_here("j1").await);
    let _game = enter_world(&address).await;
    scene.game_mod.topic_where("join", |value| value["state"] == "connected").await;

    let answer = scene.game_mod.call("f1", "join.failed", json!({})).await;

    assert_eq!(answer["ok"], true);
    assert!(scene.scene.guest.events.join_ends().is_empty());
}

#[tokio::test]
async fn when_the_host_stops_sharing_the_joined_game_gets_the_ended_toast() {
    let mut scene = JoinScene::allowing_social().await;
    let address = JoinScene::address_of(&scene.join_here("j1").await);
    let _game = enter_world(&address).await;

    scene.scene.host.sessions.host_stop(&scene.scene.session.id).await.unwrap();

    scene.game_mod.next_notify("joinEnded").await;
    scene.scene.guest.wait_join_end(SessionEnd::Stopped).await;
}

#[tokio::test]
async fn the_join_topic_follows_the_join_from_waiting_to_gone() {
    let mut scene = JoinScene::allowing_social().await;

    let address = JoinScene::address_of(&scene.join_here("j1").await);
    let started = scene.game_mod.topic_where("join", Value::is_object).await;
    scene.game_mod.call("l1", "join.leave", json!({})).await;
    scene.game_mod.topic_where("join", Value::is_null).await;

    assert_eq!(started["value"]["hostName"], "Anna");
    assert!(["connecting", "waitingForGame"].contains(&started["value"]["state"].as_str().unwrap()));
    assert!(refuses_connections(&address).await);
}
