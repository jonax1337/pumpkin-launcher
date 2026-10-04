//! Die Vorgänge der Mod gegen die Freunde-Funktion mit echten Sockets (INGAME 5.4 bis 5.7): jeder Vorgang hat eine Antwort,
//! die Zustimmung läuft über die Rückfrage im Launcher, der Spielstart hält Zähler und Zustimmungen, und jeder Vorgang eines
//! Bereichs landet in der Aktivitätsliste. Die Szene hier und die Bausteine aus `tests_session` tragen auch
//! `tests_mod_link_social` und `tests_mod_link_join`.
use std::sync::atomic::AtomicUsize;

use super::*;
use crate::services::friends::contract::{ModActivityEntry, ModOpenEvent, ModScope};
use crate::services::friends::mod_link::ModAppEvents;
use crate::services::modbridge::ops::{Scope, OP_NAMES};

/// Nimmt auf, was die App sonst als Tauri-Events bekäme.
#[derive(Default)]
pub(super) struct RecordingApp {
    activity: Mutex<Vec<ModActivityEntry>>,
    opens: Mutex<Vec<ModOpenEvent>>,
}

impl ModAppEvents for RecordingApp {
    fn activity(&self, entry: ModActivityEntry) {
        lock(&self.activity).push(entry);
    }

    fn open_launcher(&self, event: ModOpenEvent) {
        lock(&self.opens).push(event);
    }
}

impl RecordingApp {
    pub(super) fn entries(&self) -> Vec<ModActivityEntry> {
        lock(&self.activity).clone()
    }

    pub(super) fn opened(&self) -> Vec<ModOpenEvent> {
        lock(&self.opens).clone()
    }
}

/// Die Rückfrage im Launcher, so wie die Oberfläche sie liest.
pub(super) struct Prompt {
    pub(super) scope: ModScope,
    pub(super) op: String,
    pub(super) target: Option<String>,
    pub(super) friend_names: Vec<String>,
    pub(super) instance_id: String,
}

/// Wartet auf die `index`-te Rückfrage im Launcher von `node` (Ereignis `friends-mod-confirm`) und beantwortet sie.
pub(super) async fn answer_prompt_of(node: &Node, index: usize, allow: bool) -> Prompt {
    until_true("confirmation asked", || node.events.mod_confirms().len() > index).await;
    let event = node.events.mod_confirms().remove(index);
    node.sessions.mod_confirm(&event.request_id, allow).await.unwrap();
    let summary = event.summary.expect("der Launcher nennt immer, was die Mod tun will");
    Prompt {
        scope: event.scope.expect("der Launcher nennt immer den Bereich"),
        op: summary.op,
        target: summary.target_name,
        friend_names: event.friends.into_iter().map(|friend| friend.display_name).collect(),
        instance_id: event.instance_id,
    }
}

/// Anna und Bert sind befreundet und online; Annas Spiel läuft mit einer verbundenen Mod, der Annas Launcher alle Fragen
/// stellt, die er Mods stellt.
pub(super) struct ModScene {
    pub(super) host: Node,
    pub(super) guest: Node,
    pub(super) game_mod: FakeMod,
    pub(super) app: Arc<RecordingApp>,
    /// Berts Alias in der Mod.
    pub(super) guest_alias: String,
    pub(super) server: FakeServer,
    relay: RelayEntry,
    env: Vec<(String, String)>,
    prompts_answered: AtomicUsize,
    _relay: Box<dyn Send>,
}

impl ModScene {
    pub(super) async fn new() -> Self {
        Self::build(&[], false).await
    }

    /// Wie `new`, mit Bereichen, die der Nutzer schon vor dem Spielstart erlaubt hat.
    pub(super) async fn allowing(scopes: &[Scope]) -> Self {
        Self::build(scopes, false).await
    }

    /// Wie `allowing`, und Annas Spiel hat eine geprüfte LAN-Welt, so dass sie teilen kann.
    pub(super) async fn ready_to_share(scopes: &[Scope]) -> Self {
        Self::build(scopes, true).await
    }

    async fn build(scopes: &[Scope], lan: bool) -> Self {
        let (relay, relay_guard) = test_relay().await;
        let host = Node::online(options(&relay), "Anna", RELAXED).await;
        let guest = Node::online(options(&relay), "Bert", RELAXED).await;
        befriend(&host, &guest).await;
        let app = Arc::new(RecordingApp::default());
        host.sessions.attach_app_events(app.clone());
        let server = FakeServer::start().await;
        let env = mod_env(&host, HOST_INSTANCE);
        for scope in scopes {
            host.bridge.allow_scope_for_test(HOST_INSTANCE, *scope);
        }
        host.spawn_game(HOST_INSTANCE, None);
        if lan {
            host.open_lan(server.port, PortSource::Mod);
            host.wait_lan(HOST_INSTANCE).await;
        }
        let mut game_mod = FakeMod::connect(&env).await;
        let guest_alias = game_mod.online_friend_alias().await;
        Self {
            host,
            guest,
            game_mod,
            app,
            guest_alias,
            server,
            relay,
            env,
            prompts_answered: AtomicUsize::new(0),
            _relay: Box::new(relay_guard),
        }
    }

    /// Ein dritter Dienst am selben Relay, mit dem Anna noch nicht befreundet ist.
    pub(super) async fn stranger(&self, name: &str) -> Node {
        Node::online(options(&self.relay), name, RELAXED).await
    }

    /// Die Mod verbindet sich mit demselben Start noch einmal (Zähler und Zustimmungen gehören dem Start, nicht der
    /// Verbindung).
    pub(super) async fn reconnect(&mut self) {
        self.game_mod.reconnect_to(&self.host, &self.env).await;
    }

    /// Wartet auf die nächste Rückfrage im Launcher (Ereignis `friends-mod-confirm`) und beantwortet sie.
    pub(super) async fn answer_prompt(&self, allow: bool) -> Prompt {
        let index = self.prompts_answered.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
        answer_prompt_of(&self.host, index, allow).await
    }

    pub(super) fn activity(&self) -> Vec<ModActivityEntry> {
        self.host.sessions.mod_activity()
    }
}

impl FakeMod {
    /// Beendet die Verbindung und verbindet sich mit `env` neu, sobald der Launcher die vorige los ist.
    async fn reconnect_to(&mut self, host: &Node, env: &[(String, String)]) {
        self.write.shutdown().await.unwrap();
        until_true("link closed", || !host.bridge.is_connected(HOST_INSTANCE)).await;
        *self = Self::connect(env).await;
    }

    /// Liest weiter, bis `count` Hinweise der Art `kind` angekommen sind.
    pub(super) async fn wait_for_toasts(&mut self, kind: &str, count: usize) {
        let is_toast = |message: &Value| message["type"] == "event" && message["kind"] == kind;
        while self.seen.iter().filter(|message| is_toast(message)).count() < count {
            self.next_where(is_toast).await;
        }
    }

    /// Die Antwort auf die Anfrage `id`, auch wenn sie schon vor dem Aufruf angekommen ist.
    pub(super) async fn answer_of(&mut self, id: &str) -> Value {
        self.eventually(|message| message["type"] == "res" && message["id"] == id).await
    }
}

fn error_code(answer: &Value) -> Option<&str> {
    answer["error"]["code"].as_str()
}

// ---- Themen ----

#[tokio::test]
async fn the_mod_receives_all_nine_topics_and_empty_ones_are_empty() {
    let mut scene = ModScene::new().await;
    scene.game_mod.call("s1", "state.sync", json!({})).await;

    let topics = scene
        .game_mod
        .topics_until(|seen| ["me", "friends", "requests", "invites", "session", "join", "game", "codes", "blocked"].iter().all(|t| seen.contains_key(*t)))
        .await;

    assert_eq!(topics["requests"], json!({ "incoming": [], "outgoing": [] }));
    assert_eq!(topics["codes"].as_array().unwrap().len(), 1, "nur der Code, mit dem Anna und Bert sich befreundet haben");
    assert_eq!(topics["codes"][0]["used"], true);
    assert_eq!((&topics["blocked"], &topics["invites"]), (&json!([]), &json!([])));
    assert_eq!((&topics["session"], &topics["join"]), (&Value::Null, &Value::Null));
}

#[tokio::test]
async fn a_game_without_an_open_port_can_still_start_sharing_and_one_with_a_port_names_it() {
    let mut scene = ModScene::ready_to_share(&[]).await;
    let port = scene.server.port;
    scene.game_mod.call("s1", "state.sync", json!({})).await;

    let game = scene.game_mod.topic_where("game", |_| true).await;

    assert_eq!(game["value"], json!({ "hostable": true, "reason": null, "lan": { "port": port } }));
}

#[tokio::test]
async fn a_version_below_1_20_makes_the_game_unhostable_with_the_minimum() {
    let mut scene = ModScene::new().await;
    scene.host.instances.modify(HOST_INSTANCE, |instance| instance.minecraft_version = "1.19.4".into()).unwrap();

    let game = scene.game_mod.topic_where("game", |value| value["hostable"] == false).await;

    assert_eq!(game["value"]["reason"], json!({ "type": "versionUnsupported", "min": "1.20" }));
}

#[tokio::test]
async fn a_manifest_the_guests_would_reject_makes_the_game_unhostable() {
    let mut scene = ModScene::new().await;
    scene.host.instances.modify(HOST_INSTANCE, |instance| instance.loader_version = Some("kein gültiger Wert".into())).unwrap();

    let game = scene.game_mod.topic_where("game", |value| value["hostable"] == false).await;
    let share = scene.game_mod.call("s1", "host.invite", json!({ "friends": [scene.guest_alias] })).await;

    assert_eq!(game["value"]["reason"], json!({ "type": "manifestInvalid" }));
    assert_eq!((error_code(&share), share["error"]["params"]["reason"].as_str()), (Some("badRequest"), Some("manifestInvalid")));
    assert!(scene.host.events.mod_confirm_requests().is_empty(), "niemand bestätigt ein Teilen, das scheitern würde");
}

// ---- Jeder Vorgang hat eine Antwort ----

#[tokio::test]
async fn no_op_of_the_table_is_answered_as_unsupported() {
    let mut scene = ModScene::allowing(&[Scope::Social, Scope::Share]).await;
    let alias = scene.guest_alias.clone();
    let args = json!({ "target": "friends", "id": alias, "accept": true, "name": "Notch", "friends": [alias], "friend": alias, "code": "pumpkin-x", "alias": null });

    for (number, name) in OP_NAMES.iter().enumerate() {
        let answer = scene.game_mod.call(&format!("u{number}"), name, args.clone()).await;

        assert!(answer["ok"].is_boolean(), "{name}: {answer}");
        assert_ne!(error_code(&answer), Some("unsupportedOp"), "{name}");
    }
}

// ---- Zustimmung ----

#[tokio::test]
async fn the_first_social_op_pends_while_the_user_is_asked_and_the_launch_keeps_the_allow() {
    let mut scene = ModScene::new().await;

    scene.game_mod.request("c1", "code.create", json!({})).await;
    let pending = scene.game_mod.next_of_type("pending").await;
    scene.answer_prompt(true).await;
    let first = scene.game_mod.answer_of("c1").await;
    let second = scene.game_mod.call("c2", "code.create", json!({})).await;

    assert_eq!(pending, json!({ "type": "pending", "id": "c1", "prompt": "scope", "scope": "social" }));
    assert_eq!((first["ok"].as_bool(), second["ok"].as_bool()), (Some(true), Some(true)));
    assert_eq!(scene.host.events.mod_confirm_requests().len(), 1, "die zweite Anfrage fragt nicht noch einmal");
    assert_eq!(scene.host.friends.codes().await.unwrap().len(), 3, "der Code vom Befreunden und die beiden neuen");
}

#[tokio::test]
async fn a_denied_prompt_answers_denied_toasts_scope_denied_and_changes_nothing() {
    let mut scene = ModScene::new().await;

    scene.game_mod.request("c1", "code.create", json!({})).await;
    scene.answer_prompt(false).await;
    let answer = scene.game_mod.answer_of("c1").await;
    let toast = scene.game_mod.eventually(|m| m["type"] == "event" && m["kind"] == "scopeDenied").await;

    assert_eq!(error_code(&answer), Some("denied"));
    assert_eq!(toast["event"], "notify");
    assert_eq!(scene.host.friends.codes().await.unwrap().len(), 1, "nur der Code vom Befreunden, kein neuer");
    let entries = scene.activity();
    assert_eq!((entries.len(), entries[0].op.as_str(), entries[0].ok), (1, "code.create", false), "auch ein Versuch gehört in die Liste");
}

#[tokio::test]
async fn a_scope_the_user_allowed_before_the_start_is_never_asked_for() {
    let mut scene = ModScene::allowing(&[Scope::Social]).await;

    let answer = scene.game_mod.call("c1", "code.create", json!({})).await;

    let welcome = scene.game_mod.seen[0].clone();
    assert_eq!(welcome["scopes"], json!({ "share": "ask", "social": "allow" }));
    assert_eq!(answer["ok"], true);
    assert!(scene.host.events.mod_confirm_requests().is_empty());
    assert!(!scene.game_mod.seen.iter().any(|message| message["type"] == "pending"));
}

#[tokio::test]
async fn the_prompt_names_the_scope_and_a_sanitized_summary_of_the_op() {
    let mut scene = ModScene::new().await;

    scene.game_mod.request("n1", "friend.addByName", json!({ "name": "  Notch  " })).await;
    let confirm = scene.answer_prompt(false).await;

    assert_eq!(confirm.scope, ModScope::Social);
    assert_eq!((confirm.op.as_str(), confirm.target.as_deref()), ("friend.addByName", Some("Notch")));
    assert!(confirm.friend_names.is_empty());
    assert_eq!(confirm.instance_id, HOST_INSTANCE);
}

#[tokio::test]
async fn a_name_that_is_no_minecraft_name_is_refused_before_anybody_is_asked() {
    let mut scene = ModScene::new().await;

    let answer = scene.game_mod.call("n1", "friend.addByName", json!({ "name": "No\u{202e}tch" })).await;

    assert_eq!((error_code(&answer), answer["error"]["params"]["reason"].as_str()), (Some("badRequest"), Some("nameInvalid")));
    assert!(scene.host.events.mod_confirm_requests().is_empty());
}

#[tokio::test]
async fn a_share_prompt_lists_the_friends_and_the_op_lands_in_the_activity_list() {
    let mut scene = ModScene::ready_to_share(&[]).await;
    let alias = scene.guest_alias.clone();

    scene.game_mod.request("s1", "host.invite", json!({ "friends": [alias], "showWorld": false })).await;
    let confirm = scene.answer_prompt(true).await;
    let answer = scene.game_mod.answer_of("s1").await;

    assert_eq!(confirm.scope, ModScope::Share);
    assert_eq!(confirm.friend_names, ["Bert"]);
    assert_eq!(confirm.target.as_deref(), Some("Bert"));
    assert_eq!(answer["ok"], true);
    let entries = scene.activity();
    assert_eq!((entries[0].scope, entries[0].op.as_str(), entries[0].target_name.as_deref(), entries[0].ok), (ModScope::Share, "host.invite", Some("Bert"), true));
}

#[tokio::test]
async fn the_fourth_prompt_in_ten_minutes_is_denied_without_a_question_but_with_the_toast() {
    let mut scene = ModScene::new().await;
    for number in 0..3 {
        let id = format!("c{number}");
        scene.game_mod.request(&id, "code.create", json!({})).await;
        scene.answer_prompt(false).await;
        assert_eq!(error_code(&scene.game_mod.answer_of(&id).await), Some("denied"));
        tokio::time::sleep(Duration::from_millis(60)).await;
    }

    let fourth = scene.game_mod.call("c3", "code.create", json!({})).await;
    scene.game_mod.wait_for_toasts("scopeDenied", 4).await;

    assert_eq!(error_code(&fourth), Some("denied"));
    assert_eq!(scene.host.events.mod_confirm_requests().len(), 3, "keine vierte Frage, aber der Toast kommt");
}

#[tokio::test]
async fn a_second_prompt_while_one_is_open_is_busy_and_the_toast_stays_away() {
    let mut scene = ModScene::new().await;
    scene.game_mod.request("c1", "code.create", json!({})).await;
    scene.game_mod.next_of_type("pending").await;

    let busy = scene.game_mod.call("c2", "friend.addByName", json!({ "name": "Notch" })).await;
    scene.answer_prompt(true).await;

    assert_eq!(error_code(&busy), Some("busy"));
    assert_eq!(scene.game_mod.answer_of("c1").await["ok"], true);
    assert!(!scene.game_mod.seen.iter().any(|message| message["kind"] == "scopeDenied"));
}

#[tokio::test]
async fn the_prompt_counter_and_the_allow_survive_a_reconnect_of_the_mod() {
    let mut scene = ModScene::new().await;
    for number in 0..2 {
        let id = format!("c{number}");
        scene.game_mod.request(&id, "code.create", json!({})).await;
        scene.answer_prompt(false).await;
        scene.game_mod.answer_of(&id).await;
    }

    scene.reconnect().await;
    scene.game_mod.request("c2", "code.create", json!({})).await;
    scene.answer_prompt(true).await;
    scene.game_mod.answer_of("c2").await;
    scene.reconnect().await;
    let answer = scene.game_mod.call("c3", "code.create", json!({})).await;

    assert_eq!(scene.game_mod.seen[0]["scopes"]["social"], "allow", "die Zustimmung gehört dem Start");
    assert_eq!(answer["ok"], true);
    assert_eq!(scene.host.events.mod_confirm_requests().len(), 3, "der dritte Dialog zählt, die Wiederverbindung setzt nichts zurück");
}

// ---- Aktivitätsliste ----

#[tokio::test]
async fn every_social_op_is_listed_newest_first_with_time_scope_and_outcome() {
    let mut scene = ModScene::allowing(&[Scope::Social]).await;

    scene.game_mod.call("c1", "code.create", json!({})).await;
    scene.game_mod.call("c2", "code.revoke", json!({ "id": "unbekannt" })).await;
    scene.game_mod.call("c3", "friend.rename", json!({ "friend": scene.guest_alias, "alias": "Kumpel" })).await;

    let entries = scene.activity();
    let shape: Vec<(&str, bool)> = entries.iter().map(|entry| (entry.op.as_str(), entry.ok)).collect();
    assert_eq!(shape, [("friend.rename", true), ("code.create", true)], "code.revoke scheitert vor der Ausführung und steht nicht darin");
    assert_eq!(entries[0].instance_id, HOST_INSTANCE);
    assert_eq!(entries[0].scope, ModScope::Social);
    let at = &entries[0].at;
    assert!(at.len() == 20 && at.ends_with('Z') && at.as_bytes()[10] == b'T', "{at}");
}

#[tokio::test]
async fn the_app_hears_about_each_entry_as_it_is_recorded() {
    let mut scene = ModScene::allowing(&[Scope::Social]).await;

    scene.game_mod.call("c1", "code.create", json!({})).await;

    assert_eq!(scene.app.entries(), scene.activity());
    assert_eq!(scene.app.entries().len(), 1);
}

#[tokio::test]
async fn ops_without_a_scope_leave_no_entry() {
    let mut scene = ModScene::allowing(&[]).await;

    scene.game_mod.call("c1", "friends.retry", json!({})).await;
    scene.game_mod.call("c2", "join.leave", json!({})).await;
    scene.game_mod.call("c3", "host.stop", json!({})).await;

    assert!(scene.activity().is_empty());
}

// ---- launcher.open ----

#[tokio::test]
async fn launcher_open_brings_the_window_to_the_named_page() {
    let mut scene = ModScene::new().await;

    let answer = scene.game_mod.call("o1", "launcher.open", json!({ "target": "requests" })).await;

    assert_eq!(answer["ok"], true);
    let opened = scene.app.opened();
    assert_eq!(opened.len(), 1);
    assert_eq!((opened[0].instance_id.as_str(), serde_json::to_value(opened[0].target).unwrap()), (HOST_INSTANCE, json!("requests")));
}

#[tokio::test]
async fn launcher_open_is_limited_to_one_in_ten_seconds() {
    let mut scene = ModScene::new().await;

    let first = scene.game_mod.call("o1", "launcher.open", json!({ "target": "friends" })).await;
    let second = scene.game_mod.call("o2", "launcher.open", json!({ "target": "settings" })).await;

    assert_eq!((first["ok"].as_bool(), error_code(&second)), (Some(true), Some("rateLimited")));
    assert_eq!(scene.app.opened().len(), 1);
}

#[tokio::test]
async fn launcher_open_never_opens_the_window_while_a_dialog_waits_for_the_user() {
    let mut scene = ModScene::new().await;
    scene.game_mod.request("c1", "code.create", json!({})).await;
    scene.game_mod.next_of_type("pending").await;
    until_true("question open", || scene.host.events.mod_confirm_requests().len() == 1).await;

    let refused = scene.game_mod.call("o1", "launcher.open", json!({ "target": "friends" })).await;

    assert_eq!(error_code(&refused), Some("busy"));
    assert!(scene.app.opened().is_empty());
    scene.answer_prompt(false).await;
}
