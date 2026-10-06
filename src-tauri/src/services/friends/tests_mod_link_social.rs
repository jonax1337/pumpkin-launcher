//! Freunde, Anfragen, Codes und Sperren aus dem Spiel (docs/bridge/README.md, "Operations and consent"): zu jedem Vorgang der Erfolg, seine wichtigsten
//! Fehlercodes und was die Zustimmung bewirkt. Anna spielt mit der Mod, Bert ist ihr Freund, Cleo ein Fremder.
use super::mod_ops::ModScene;
use super::*;
use crate::services::friends::contract::{
    Friend, FriendNotice, ModScope, Presence, RequestDirection,
};
use crate::services::modbridge::ops::{Op, Scope, OP_NAMES};

fn error_code(answer: &Value) -> Option<&str> {
    answer["error"]["code"].as_str()
}

fn reason(answer: &Value) -> Option<&str> {
    answer["error"]["params"]["reason"].as_str()
}

/// Cleo schickt Anna eine Anfrage per Code; wartet, bis Annas Mod sie im Thema `requests` sieht. Liefert Cleo und die
/// Kennung der Anfrage.
async fn request_from_cleo(scene: &mut ModScene) -> (Node, String) {
    let cleo = scene.stranger("Cleo").await;
    let code = scene
        .host
        .friends
        .code_create()
        .await
        .unwrap()
        .code
        .unwrap();
    cleo.friends.add(&code).await.unwrap();
    let request_id = incoming_request_id(&scene.host).await;
    scene
        .game_mod
        .topic_where("requests", |value| {
            !value["incoming"].as_array().unwrap().is_empty()
        })
        .await;
    (cleo, request_id)
}

async fn friend_of(node: &Node, peer: &PeerId) -> Option<Friend> {
    let id = peer.to_string();
    node.friends
        .list()
        .await
        .unwrap()
        .into_iter()
        .find(|friend| friend.id == id)
}

// ---- request.answer ----

#[tokio::test]
async fn accepting_a_request_makes_the_sender_a_friend_and_lists_the_op() {
    let mut scene = ModScene::allowing(&[Scope::Social]).await;
    let (cleo, request_id) = request_from_cleo(&mut scene).await;

    let answer = scene
        .game_mod
        .call(
            "r1",
            "request.answer",
            json!({ "id": request_id, "accept": true }),
        )
        .await;

    assert_eq!(answer["ok"], true);
    assert!(friend_of(&scene.host, &cleo.id()).await.is_some());
    assert!(scene
        .host
        .friends
        .requests()
        .await
        .unwrap()
        .iter()
        .all(|request| request.direction != RequestDirection::Incoming));
    let entry = &scene.activity()[0];
    assert_eq!(
        (entry.op.as_str(), entry.target_name.as_deref(), entry.ok),
        ("request.answer", Some("Cleo"), true)
    );
}

#[tokio::test]
async fn declining_a_request_removes_it_without_making_a_friend() {
    let mut scene = ModScene::allowing(&[Scope::Social]).await;
    let (cleo, request_id) = request_from_cleo(&mut scene).await;

    let answer = scene
        .game_mod
        .call(
            "r1",
            "request.answer",
            json!({ "id": request_id, "accept": false }),
        )
        .await;

    assert_eq!(answer["ok"], true);
    assert!(friend_of(&scene.host, &cleo.id()).await.is_none());
    assert!(scene.host.friends.requests().await.unwrap().is_empty());
}

#[tokio::test]
async fn an_unknown_request_is_not_found_and_nobody_is_asked() {
    let mut scene = ModScene::new().await;

    let answer = scene
        .game_mod
        .call(
            "r1",
            "request.answer",
            json!({ "id": "gibt-es-nicht", "accept": true }),
        )
        .await;

    assert_eq!(error_code(&answer), Some("notFound"));
    assert!(scene.host.events.mod_confirm_requests().is_empty());
}

#[tokio::test]
async fn answering_a_request_asks_first_and_a_refusal_leaves_the_request_open() {
    let mut scene = ModScene::new().await;
    let (_cleo, request_id) = request_from_cleo(&mut scene).await;

    scene
        .game_mod
        .request(
            "r1",
            "request.answer",
            json!({ "id": request_id, "accept": true }),
        )
        .await;
    let confirm = scene.answer_prompt(false).await;
    let answer = scene.game_mod.answer_of("r1").await;

    assert_eq!(
        (
            confirm.scope,
            confirm.op.as_str(),
            confirm.target.as_deref()
        ),
        (ModScope::Social, "request.answer", Some("Cleo"))
    );
    assert_eq!(error_code(&answer), Some("denied"));
    assert_eq!(
        scene.host.friends.requests().await.unwrap().len(),
        1,
        "die Anfrage wartet weiter auf den Nutzer"
    );
}

// ---- request.cancel und friends.retry (ohne Bereich) ----

#[tokio::test]
async fn an_own_request_is_withdrawn_without_asking() {
    let mut scene = ModScene::new().await;
    let cleo = scene.stranger("Cleo").await;
    let code = cleo.friends.code_create().await.unwrap().code.unwrap();
    let outgoing = scene.host.friends.add(&code).await.unwrap();

    let answer = scene
        .game_mod
        .call("r1", "request.cancel", json!({ "id": outgoing.id }))
        .await;

    assert_eq!(answer["ok"], true);
    assert!(scene.host.friends.requests().await.unwrap().is_empty());
    assert!(scene.host.events.mod_confirm_requests().is_empty());
}

#[tokio::test]
async fn cancel_refuses_unknown_requests_and_incoming_ones() {
    let mut scene = ModScene::new().await;
    let (_cleo, incoming) = request_from_cleo(&mut scene).await;

    let unknown = scene
        .game_mod
        .call("r1", "request.cancel", json!({ "id": "gibt-es-nicht" }))
        .await;
    let not_ours = scene
        .game_mod
        .call("r2", "request.cancel", json!({ "id": incoming }))
        .await;

    assert_eq!(
        (error_code(&unknown), error_code(&not_ours)),
        (Some("notFound"), Some("notFound"))
    );
    assert_eq!(
        scene.host.friends.requests().await.unwrap().len(),
        1,
        "die eingehende Anfrage bleibt"
    );
}

#[tokio::test]
async fn retrying_delivery_needs_no_consent() {
    let mut scene = ModScene::new().await;

    let answer = scene.game_mod.call("r1", "friends.retry", json!({})).await;

    assert_eq!(answer["ok"], true);
    assert!(scene.host.events.mod_confirm_requests().is_empty() && scene.activity().is_empty());
}

// ---- friend.addByCode ----

#[tokio::test]
async fn a_code_of_another_player_sends_a_request() {
    let mut scene = ModScene::allowing(&[Scope::Social]).await;
    let cleo = scene.stranger("Cleo").await;
    let code = cleo.friends.code_create().await.unwrap().code.unwrap();

    let answer = scene
        .game_mod
        .call("c1", "friend.addByCode", json!({ "code": code }))
        .await;

    assert_eq!(answer["ok"], true);
    let requests = scene.host.friends.requests().await.unwrap();
    assert_eq!(
        requests
            .iter()
            .filter(|request| request.direction == RequestDirection::Outgoing)
            .count(),
        1
    );
    let entry = &scene.activity()[0];
    assert_eq!(
        (entry.op.as_str(), entry.target_name.as_deref()),
        ("friend.addByCode", None),
        "der Code ist ein Geheimnis und steht nirgends"
    );
}

#[tokio::test]
async fn a_code_that_is_no_code_is_refused_before_anybody_is_asked() {
    let mut scene = ModScene::new().await;

    let garbage = scene
        .game_mod
        .call(
            "c1",
            "friend.addByCode",
            json!({ "code": "pumpkin-kaputt" }),
        )
        .await;

    assert_eq!(
        (error_code(&garbage), reason(&garbage)),
        (Some("badRequest"), Some("codeInvalid"))
    );
    assert!(scene.host.events.mod_confirm_requests().is_empty());
}

#[tokio::test]
async fn the_own_code_is_refused_with_its_reason() {
    let mut scene = ModScene::allowing(&[Scope::Social]).await;
    let own = scene
        .host
        .friends
        .code_create()
        .await
        .unwrap()
        .code
        .unwrap();

    let mine = scene
        .game_mod
        .call("c1", "friend.addByCode", json!({ "code": own }))
        .await;

    assert_eq!(
        (error_code(&mine), reason(&mine)),
        (Some("badRequest"), Some("codeOwn"))
    );
}

#[tokio::test]
async fn the_same_code_twice_is_refused_as_already_requested_and_the_attempt_is_listed() {
    let mut scene = ModScene::allowing(&[Scope::Social]).await;
    let cleo = scene.stranger("Cleo").await;
    let code = cleo.friends.code_create().await.unwrap().code.unwrap();
    scene
        .game_mod
        .call("c1", "friend.addByCode", json!({ "code": code }))
        .await;

    let again = scene
        .game_mod
        .call("c2", "friend.addByCode", json!({ "code": code }))
        .await;

    assert_eq!(
        (error_code(&again), reason(&again)),
        (Some("badRequest"), Some("alreadyRequested"))
    );
    let entries = scene.activity();
    assert_eq!(
        (entries[0].ok, entries[1].ok),
        (false, true),
        "der gescheiterte Versuch steht in der Liste"
    );
}

// ---- code.create und code.revoke ----

#[tokio::test]
async fn a_new_code_comes_back_once_and_the_topic_shows_only_its_tail() {
    let mut scene = ModScene::allowing(&[Scope::Social]).await;

    let answer = scene.game_mod.call("c1", "code.create", json!({})).await;

    let (id, code) = (
        answer["result"]["id"].as_str().unwrap(),
        answer["result"]["code"].as_str().unwrap(),
    );
    assert!(code.starts_with("pumpkin-") && code.len() == 80, "{code}");
    let codes = scene
        .game_mod
        .topic_where("codes", |value| value.as_array().unwrap().len() == 2)
        .await;
    assert!(
        codes["value"]
            .as_array()
            .unwrap()
            .iter()
            .any(|entry| entry["id"] == id),
        "{codes}"
    );
    assert!(
        !codes.to_string().contains(code),
        "der ganze Code geht nur in die Antwort"
    );
}

#[tokio::test]
async fn the_third_new_code_is_busy_because_the_befriending_code_counts_too() {
    let mut scene = ModScene::allowing(&[Scope::Social]).await;
    for number in 0..2 {
        assert_eq!(
            scene
                .game_mod
                .call(&format!("c{number}"), "code.create", json!({}))
                .await["ok"],
            true
        );
    }

    let refused = scene.game_mod.call("c3", "code.create", json!({})).await;

    assert_eq!(
        (error_code(&refused), reason(&refused)),
        (Some("busy"), Some("tooManyCodes"))
    );
    assert_eq!(refused["error"]["params"]["max"], 3);
}

#[tokio::test]
async fn a_code_can_be_revoked_and_an_unknown_one_is_not_found_without_asking() {
    let mut scene = ModScene::allowing(&[Scope::Social]).await;
    let created = scene.game_mod.call("c1", "code.create", json!({})).await;
    let id = created["result"]["id"].as_str().unwrap().to_owned();

    let revoked = scene
        .game_mod
        .call("c2", "code.revoke", json!({ "id": id }))
        .await;
    let unknown = scene
        .game_mod
        .call("c3", "code.revoke", json!({ "id": id }))
        .await;

    assert_eq!(revoked["ok"], true);
    assert_eq!(error_code(&unknown), Some("notFound"));
    assert_eq!(
        scene.host.friends.codes().await.unwrap().len(),
        1,
        "nur der Code vom Befreunden bleibt"
    );
}

// ---- friend.rename, remove, block, unblock, acknowledge ----

#[tokio::test]
async fn renaming_sets_and_clears_the_alias_and_the_list_keeps_the_previous_name() {
    let mut scene = ModScene::allowing(&[Scope::Social]).await;
    let guest = scene.guest.id();
    let alias = scene.guest_alias.clone();

    let set = scene
        .game_mod
        .call(
            "n1",
            "friend.rename",
            json!({ "friend": alias, "alias": "Kumpel" }),
        )
        .await;
    let alias_after_set = friend_of(&scene.host, &guest).await.unwrap().alias;
    let cleared = scene
        .game_mod
        .call(
            "n2",
            "friend.rename",
            json!({ "friend": alias, "alias": null }),
        )
        .await;
    let alias_after_clear = friend_of(&scene.host, &guest).await.unwrap().alias;

    assert_eq!(
        (set["ok"].as_bool(), alias_after_set.as_deref()),
        (Some(true), Some("Kumpel"))
    );
    assert_eq!(
        (cleared["ok"].as_bool(), alias_after_clear),
        (Some(true), None)
    );
    let names: Vec<_> = scene
        .activity()
        .iter()
        .map(|entry| entry.target_name.clone().unwrap())
        .collect();
    assert_eq!(
        names,
        ["Kumpel", "Bert"],
        "jeder Eintrag nennt den Namen vor der Änderung"
    );
}

#[tokio::test]
async fn removing_a_friend_ends_the_friendship_on_both_sides() {
    let mut scene = ModScene::allowing(&[Scope::Social]).await;
    let (host_id, guest_id) = (scene.host.id(), scene.guest.id());
    let alias = scene.guest_alias.clone();

    let answer = scene
        .game_mod
        .call("d1", "friend.remove", json!({ "friend": alias }))
        .await;

    assert_eq!(answer["ok"], true);
    assert!(friend_of(&scene.host, &guest_id).await.is_none());
    let removed_by_peer = || async {
        friend_of(&scene.guest, &host_id)
            .await
            .is_none_or(|friend| friend.removed_by_peer)
    };
    until("the friend hears about it", removed_by_peer).await;
    assert_eq!(scene.activity()[0].target_name.as_deref(), Some("Bert"));
}

#[tokio::test]
async fn blocking_a_friend_puts_them_on_the_blocked_list_the_mod_can_see() {
    let mut scene = ModScene::allowing(&[Scope::Social]).await;
    let alias = scene.guest_alias.clone();

    let answer = scene
        .game_mod
        .call("b1", "friend.block", json!({ "friend": alias }))
        .await;
    let blocked = scene
        .game_mod
        .topic_where("blocked", |value| !value.as_array().unwrap().is_empty())
        .await;

    assert_eq!(answer["ok"], true);
    assert_eq!(blocked["value"][0]["name"], "Bert");
    assert_eq!(scene.host.friends.blocked().await.unwrap().len(), 1);
    assert!(friend_of(&scene.host, &scene.guest.id()).await.is_none());
}

#[tokio::test]
async fn unblocking_takes_a_person_off_the_list_and_a_friend_who_is_not_blocked_is_not_found() {
    let mut scene = ModScene::allowing(&[Scope::Social]).await;
    let alias = scene.guest_alias.clone();
    let not_blocked = scene
        .game_mod
        .call("u0", "blocked.unblock", json!({ "id": alias }))
        .await;
    scene
        .host
        .friends
        .block(&scene.guest.id().to_string())
        .await
        .unwrap();
    let blocked = scene
        .game_mod
        .topic_where("blocked", |value| !value.as_array().unwrap().is_empty())
        .await;
    let blocked_alias = blocked["value"][0]["id"].as_str().unwrap().to_owned();

    let answer = scene
        .game_mod
        .call("u1", "blocked.unblock", json!({ "id": blocked_alias }))
        .await;

    assert_eq!(error_code(&not_blocked), Some("notFound"));
    assert_eq!(answer["ok"], true);
    assert!(scene.host.friends.blocked().await.unwrap().is_empty());
    assert_eq!(scene.activity()[0].target_name.as_deref(), Some("Bert"));
}

fn set_notice(scene: &ModScene, notice: Option<FriendNotice>) {
    let guest = scene.guest.id().to_string();
    scene
        .host
        .friends
        .core
        .stores
        .friends
        .modify(&guest, |record| record.notice = notice)
        .unwrap();
}

async fn notice_of_guest(scene: &ModScene) -> Option<FriendNotice> {
    friend_of(&scene.host, &scene.guest.id())
        .await
        .unwrap()
        .notice
}

#[tokio::test]
async fn a_renamed_notice_can_be_acknowledged_from_the_game() {
    let mut scene = ModScene::allowing(&[Scope::Social]).await;
    set_notice(
        &scene,
        Some(FriendNotice::Renamed {
            previous_name: "Alt".into(),
        }),
    );
    let alias = scene.guest_alias.clone();

    let answer = scene
        .game_mod
        .call("a1", "friend.acknowledge", json!({ "id": alias }))
        .await;

    assert_eq!(answer["ok"], true);
    assert_eq!(notice_of_guest(&scene).await, None);
    assert_eq!(scene.activity()[0].op, "friend.acknowledge");
}

#[tokio::test]
async fn an_identity_change_is_never_acknowledged_from_the_game() {
    let mut scene = ModScene::allowing(&[Scope::Social]).await;
    let changed = FriendNotice::IdentityChanged {
        previous_fingerprint: "ab cd".into(),
    };
    set_notice(&scene, Some(changed.clone()));
    let alias = scene.guest_alias.clone();

    let answer = scene
        .game_mod
        .call("a1", "friend.acknowledge", json!({ "id": alias }))
        .await;

    assert_eq!(error_code(&answer), Some("forbidden"));
    assert_eq!(
        notice_of_guest(&scene).await,
        Some(changed),
        "der Hinweis bleibt für den Nutzer im Launcher"
    );
    assert!(scene.activity().is_empty(), "nichts wurde ausgeführt");
}

#[tokio::test]
async fn a_friend_without_a_notice_has_nothing_to_acknowledge() {
    let mut scene = ModScene::allowing(&[Scope::Social]).await;
    let alias = scene.guest_alias.clone();

    let answer = scene
        .game_mod
        .call("a1", "friend.acknowledge", json!({ "id": alias }))
        .await;

    assert_eq!(
        (error_code(&answer), reason(&answer)),
        (Some("notFound"), Some("notRenamed"))
    );
}

#[tokio::test]
async fn the_mod_sees_which_friends_carry_a_notice() {
    let mut scene = ModScene::allowing(&[Scope::Social]).await;
    set_notice(
        &scene,
        Some(FriendNotice::Renamed {
            previous_name: "Alt".into(),
        }),
    );

    let friends = scene
        .game_mod
        .topic_where("friends", |value| value[0]["notice"].is_object())
        .await;

    assert_eq!(
        friends["value"][0]["notice"],
        json!({ "type": "renamed", "previousName": "Alt" })
    );
}

// ---- Jeder Vorgang eines Bereichs fragt vor dem Handeln ----

#[tokio::test]
async fn friend_graph_ops_ask_first_and_do_nothing_when_refused() {
    let mut scene = ModScene::new().await;
    let guest = scene.guest.id();
    let alias = scene.guest_alias.clone();
    let ops = [
        (
            "friend.rename",
            json!({ "friend": alias, "alias": "Kumpel" }),
        ),
        ("friend.block", json!({ "friend": alias })),
        ("friend.remove", json!({ "friend": alias })),
    ];

    for (number, (op, args)) in ops.into_iter().enumerate() {
        let id = format!("g{number}");
        scene.game_mod.request(&id, op, args).await;
        let confirm = scene.answer_prompt(false).await;
        assert_eq!(
            (
                confirm.scope,
                confirm.op.as_str(),
                confirm.target.as_deref()
            ),
            (ModScope::Social, op, Some("Bert"))
        );
        assert_eq!(
            error_code(&scene.game_mod.answer_of(&id).await),
            Some("denied"),
            "{op}"
        );
        tokio::time::sleep(Duration::from_millis(60)).await;
    }

    let friend = friend_of(&scene.host, &guest).await.unwrap();
    assert_eq!(friend.alias, None, "nichts davon ist geschehen");
    assert!(scene.host.friends.blocked().await.unwrap().is_empty());
}

#[tokio::test]
async fn acknowledging_a_notice_asks_first_too() {
    let mut scene = ModScene::new().await;
    let alias = scene.guest_alias.clone();
    set_notice(
        &scene,
        Some(FriendNotice::Renamed {
            previous_name: "Alt".into(),
        }),
    );

    scene
        .game_mod
        .request("k1", "friend.acknowledge", json!({ "id": alias }))
        .await;
    let confirm = scene.answer_prompt(false).await;

    assert_eq!(confirm.op, "friend.acknowledge");
    assert_eq!(
        error_code(&scene.game_mod.answer_of("k1").await),
        Some("denied")
    );
    assert!(notice_of_guest(&scene).await.is_some());
}

// ---- Jeder Vorgang mit Bereich fragt nach genau diesem Bereich und ändert bei Ablehnung nichts ----

/// Was ein Vorgang in der Welt vorfinden muss, damit er bis zur Rückfrage kommt, und was die Rückfrage dann nennt.
struct ScopedOp {
    args: Value,
    target: Option<&'static str>,
    /// Hält Gegenstellen am Leben, solange der Vorgang läuft.
    _peers: Vec<Box<dyn Send>>,
}

impl ScopedOp {
    fn new(args: Value, target: Option<&'static str>) -> Self {
        Self {
            args,
            target,
            _peers: Vec::new(),
        }
    }

    fn with_peer(mut self, peer: impl Send + 'static) -> Self {
        self._peers.push(Box::new(peer));
        self
    }
}

/// Ein Vorgang ohne Vorbereitung in dieser Tabelle fällt hier auf: wer einen Vorgang mit Bereich anlegt, ergänzt ihn.
async fn prepare_scoped_op(scene: &mut ModScene, name: &str) -> ScopedOp {
    let alias = scene.guest_alias.clone();
    match name {
        "request.answer" => {
            let (cleo, request_id) = request_from_cleo(scene).await;
            ScopedOp::new(json!({ "id": request_id, "accept": true }), Some("Cleo")).with_peer(cleo)
        }
        "friend.addByName" => ScopedOp::new(json!({ "name": "Notch" }), Some("Notch")),
        "friend.addByCode" => {
            let cleo = scene.stranger("Cleo").await;
            let code = cleo.friends.code_create().await.unwrap().code.unwrap();
            ScopedOp::new(json!({ "code": code }), None).with_peer(cleo)
        }
        "invite.joinHere" => {
            let (invite_id, world) = scene.invite_from_guest().await;
            ScopedOp::new(json!({ "id": invite_id }), Some("Bert")).with_peer(world)
        }
        "host.invite" => ScopedOp::new(
            json!({ "friends": [alias], "showWorld": false }),
            Some("Bert"),
        ),
        "code.create" => ScopedOp::new(json!({}), None),
        "code.revoke" => {
            let created = scene.host.friends.code_create().await.unwrap();
            ScopedOp::new(json!({ "id": created.id }), None)
        }
        "friend.rename" => {
            ScopedOp::new(json!({ "friend": alias, "alias": "Kumpel" }), Some("Bert"))
        }
        "friend.remove" | "friend.block" => ScopedOp::new(json!({ "friend": alias }), Some("Bert")),
        "blocked.unblock" => {
            scene
                .host
                .friends
                .block(&scene.guest.id().to_string())
                .await
                .unwrap();
            let blocked = scene
                .game_mod
                .topic_where("blocked", |value| !value.as_array().unwrap().is_empty())
                .await;
            ScopedOp::new(json!({ "id": blocked["value"][0]["id"] }), Some("Bert"))
        }
        "friend.acknowledge" => {
            set_notice(
                scene,
                Some(FriendNotice::Renamed {
                    previous_name: "Alt".into(),
                }),
            );
            ScopedOp::new(json!({ "id": alias }), Some("Bert"))
        }
        _ => panic!("{name} hat einen Bereich, aber keine Vorbereitung in prepare_scoped_op"),
    }
}

fn scope_of(name: &str) -> Option<Scope> {
    let args = json!({ "target": "friends", "id": "x", "accept": true, "name": "x", "friends": ["x"], "friend": "x", "code": "x", "alias": null });
    Op::from_request(name, args).unwrap().scope()
}

/// Was eine Ablehnung nicht anrühren darf: Freunde samt Alias und Hinweis, Anfragen, Codes, Sperren, die geteilte Welt
/// und Beitritte.
#[derive(Debug, PartialEq)]
struct World {
    friends: Vec<Friend>,
    requests: usize,
    codes: Vec<String>,
    blocked: usize,
    shares_world: bool,
    joins: usize,
}

/// Anwesenheit, Pfad und letzte Sichtung ändern sich von selbst und gehören nicht zu dem, was eine Ablehnung bewahrt.
fn without_connection_state(friend: Friend) -> Friend {
    Friend {
        presence: Presence::Offline,
        path: None,
        last_seen: None,
        ..friend
    }
}

async fn world_of(scene: &ModScene) -> World {
    let host = &scene.host;
    let friends = host.friends.list().await.unwrap();
    World {
        friends: friends.into_iter().map(without_connection_state).collect(),
        requests: host.friends.requests().await.unwrap().len(),
        codes: host
            .friends
            .codes()
            .await
            .unwrap()
            .into_iter()
            .map(|code| code.id)
            .collect(),
        blocked: host.friends.blocked().await.unwrap().len(),
        shares_world: host.session().await.is_some(),
        joins: host.events.join_states().len(),
    }
}

#[tokio::test]
async fn every_op_with_a_scope_asks_for_exactly_that_scope_and_a_refusal_changes_nothing() {
    let scoped: Vec<&str> = OP_NAMES
        .into_iter()
        .filter(|name| scope_of(name).is_some())
        .collect();
    assert!(
        scoped.len() >= 12,
        "die Tabelle der Vorgänge mit Bereich ist nicht leer geworden: {scoped:?}"
    );

    for name in scoped {
        let mut scene = ModScene::ready_to_share(&[]).await;
        let prepared = prepare_scoped_op(&mut scene, name).await;
        let before = world_of(&scene).await;

        scene
            .game_mod
            .request("s1", name, prepared.args.clone())
            .await;
        let confirm = scene.answer_prompt(false).await;
        let answer = scene.game_mod.answer_of("s1").await;

        let asked = (
            Some(confirm.scope),
            confirm.op.as_str(),
            confirm.target.as_deref(),
        );
        assert_eq!(asked, (scope_of(name), name, prepared.target), "{name}");
        assert_eq!(error_code(&answer), Some("denied"), "{name}: {answer}");
        assert_eq!(
            world_of(&scene).await,
            before,
            "{name} hat trotz Ablehnung etwas geändert"
        );
        let entries = scene.activity();
        assert_eq!(
            (entries[0].op.as_str(), entries[0].ok),
            (name, false),
            "{name}: auch der abgelehnte Versuch steht in der Liste"
        );
    }
}
