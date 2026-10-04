//! Vertragstest (SPEC 8.3): liest `src/lib/friends-fixtures.ts`, das `tsc` gegen `friends-types.ts` prüft, und schickt
//! jeden Fixture-Schlüssel durch seinen Rust-Typ. So fällt jede Abweichung zwischen beiden Seiten in einem der beiden Builds auf.
use std::collections::BTreeSet;

use serde::de::DeserializeOwned;
use serde::Serialize;
use serde_json::{json, Map, Value};

use super::code;
use super::contract::*;

const FIXTURE_SOURCE: &str = include_str!("../../../../src/lib/friends-fixtures.ts");

type RoundTrip = fn(&Value) -> serde_json::Result<Value>;

fn fixtures() -> Map<String, Value> {
    let json = FIXTURE_SOURCE
        .split_once("/*JSON-BEGIN*/")
        .and_then(|(_, rest)| rest.split_once("/*JSON-END*/"))
        .map(|(json, _)| json)
        .expect("Fixture-Datei ohne JSON-BEGIN/JSON-END-Marker");
    serde_json::from_str(json).expect("Fixtures zwischen den Markern sind kein striktes JSON")
}

fn through<T: DeserializeOwned + Serialize>(fixture: &Value) -> serde_json::Result<Value> {
    serde_json::to_value(serde_json::from_value::<T>(fixture.clone())?)
}

fn row<T: DeserializeOwned + Serialize>(key: &'static str) -> (&'static str, RoundTrip) {
    (key, through::<T>)
}

/// Die Zeilen der Schlüsseltabelle aus SPEC 8.3, ohne `constants`.
fn rows() -> Vec<(&'static str, RoundTrip)> {
    vec![
        row::<FriendsState>("friendsState.available"),
        row::<FriendsState>("friendsState.noSecretStore"),
        row::<FriendsState>("friendsState.identityLost"),
        row::<NetworkStatus>("networkStatus.off"),
        row::<NetworkStatus>("networkStatus.starting"),
        row::<NetworkStatus>("networkStatus.online"),
        row::<NetworkStatus>("networkStatus.degraded"),
        row::<Friend>("friend.online"),
        row::<Friend>("friend.relayRenamed"),
        row::<Friend>("friend.identityChanged"),
        row::<Friend>("friend.unconfirmed"),
        row::<FriendRequest>("request.incoming"),
        row::<FriendRequest>("request.delivering"),
        row::<FriendRequest>("request.awaitingAnswer"),
        row::<FriendRequest>("request.nameIncoming"),
        row::<FriendRequest>("request.nameOutgoing"),
        row::<FriendRequest>("request.nameDelivering"),
        row::<FriendCode>("code.created"),
        row::<FriendCode>("code.listed"),
        row::<BlockedPeer>("blocked"),
        row::<HostSession>("hostSession"),
        row::<Invite>("invite"),
        row::<JoinPlan>("joinPlan.ready"),
        row::<JoinPlan>("joinPlan.missing"),
        row::<JoinPlan>("joinPlan.vanilla"),
        row::<JoinTicket>("joinTicket"),
        row::<LanStatus>("lanStatus"),
        row::<IngameStatus>("ingameStatus.active"),
        row::<IngameStatus>("ingameStatus.connected"),
        row::<IngameStatus>("ingameStatus.off"),
        row::<IngameStatus>("ingameStatus.autoOff"),
        row::<IngameStatus>("ingameStatus.unavailable"),
        row::<IngameStatus>("ingameStatus.loaderTooOld"),
        row::<IngameEvent>("event.ingame"),
        row::<IngameFailedEvent>("event.ingameFailed"),
        row::<FriendPresenceEvent>("event.friendPresence"),
        row::<FriendRequestEvent>("event.friendRequest"),
        row::<FriendRequestRefusedEvent>("event.requestRefused"),
        row::<InviteEvent>("event.invite"),
        row::<InviteRevokedEvent>("event.inviteRevoked"),
        row::<HostSessionEvent>("event.hostSession"),
        row::<HostSessionEndedEvent>("event.hostSessionEnded"),
        row::<JoinSessionEvent>("event.joinSession.waitingForGame"),
        row::<JoinSessionEvent>("event.joinSession.connecting"),
        row::<JoinSessionEvent>("event.joinSession.connected"),
        row::<JoinSessionEvent>("event.joinSession.ended"),
        row::<LanEvent>("event.lan"),
        row::<ModConnectionEvent>("event.modConnection"),
        row::<ModConfirmEvent>("event.modConfirm"),
        row::<ModActivityEntry>("modActivityEntry"),
        row::<ModOpenEvent>("event.modOpen"),
    ]
}

#[test]
fn fixture_keys_are_exactly_the_rows_of_the_key_table() {
    let in_file: BTreeSet<String> = fixtures().keys().cloned().collect();
    let in_table: BTreeSet<String> =
        rows().iter().map(|(key, _)| key.to_string()).chain(["constants".to_owned()]).collect();
    assert_eq!(in_file, in_table);
}

#[test]
fn every_fixture_survives_the_rust_type_unchanged() {
    let fixtures = fixtures();
    for (key, trip) in rows() {
        let fixture = &fixtures[key];
        let back = trip(fixture).unwrap_or_else(|err| panic!("{key}: {err}"));
        assert_eq!(&back, fixture, "{key}");
    }
}

#[test]
fn constants_equal_the_rust_constants() {
    let expected = json!({
        "codePrefix": FRIEND_CODE_PREFIX,
        "codeBodyLength": FRIEND_CODE_BODY_LENGTH,
        "codeLength": FRIEND_CODE_LENGTH,
        "displayNameMin": DISPLAY_NAME_MIN,
        "displayNameMax": DISPLAY_NAME_MAX,
        "aliasMax": ALIAS_MAX,
        "maxFriends": MAX_FRIENDS,
        "maxActiveCodes": MAX_ACTIVE_CODES,
        "maxGuests": MAX_GUESTS,
        "codeTtlSecs": CODE_TTL_SECS,
        "requestTtlSecs": REQUEST_TTL_SECS,
        "inviteTtlSecs": INVITE_TTL_SECS,
        "minMcReleaseTime": MIN_MC_RELEASE_TIME,
        "minMcLabel": MIN_MC_LABEL,
        "portMin": PORT_MIN,
        "portMax": PORT_MAX,
        "maxNameRequests": MAX_NAME_REQUESTS,
        "mcNameMax": MC_NAME_MAX,
        "nameCooldownDays": NAME_COOLDOWN_DAYS,
    });
    assert_eq!(fixtures()["constants"], expected);
}

#[test]
fn created_code_is_the_appendix_b_golden_code_and_parses() {
    let fixtures = fixtures();
    let created = &fixtures["code.created"];
    let text = created["code"].as_str().unwrap();
    assert!(text.ends_with("rvw3"));
    let parts = code::parse(text).unwrap();
    assert_eq!(parts.encode(), text);
    assert_eq!(created["tail"], parts.tail());
    assert_eq!(created["expiresAt"].as_u64().unwrap() - created["createdAt"].as_u64().unwrap(), CODE_TTL_SECS);
}

#[test]
fn fixtures_meet_the_content_requirements_of_the_key_table() {
    let fixtures = fixtures();
    let requirements = [
        ("friendsState.available", "/availability", json!("available")),
        ("friendsState.available", "/network/type", json!("online")),
        ("friendsState.noSecretStore", "/availability", json!("noSecretStore")),
        ("friendsState.identityLost", "/availability", json!("identityLost")),
        ("friendsState.available", "/settings/findableByName", json!(true)),
        ("friendsState.available", "/settings/ingameActions", json!("ask")),
        ("friendsState.noSecretStore", "/settings/ingameActions", json!("allow")),
        ("friendsState.noSecretStore", "/settings/ingameMenu", json!(false)),
        ("ingameStatus.active", "/state", json!("active")),
        ("ingameStatus.connected", "/state", json!("connected")),
        ("ingameStatus.off", "/state", json!("off")),
        ("ingameStatus.autoOff", "/state", json!("autoOff")),
        ("ingameStatus.autoOff", "/reason/type", json!("breaker")),
        ("ingameStatus.unavailable", "/state", json!("unavailable")),
        ("ingameStatus.unavailable", "/reason/need", json!(21)),
        ("ingameStatus.unavailable", "/node", Value::Null),
        ("event.ingameFailed", "/reason", json!("fabricIncompatibleModSet")),
        ("friendsState.available", "/directory/state", json!("active")),
        ("friendsState.noSecretStore", "/directory/state", json!("off")),
        ("friendsState.identityLost", "/directory/state", json!("unavailable")),
        ("friendsState.identityLost", "/directory/host", Value::Null),
        ("friend.relayRenamed", "/path", json!("relay")),
        ("friend.relayRenamed", "/notice/type", json!("renamed")),
        ("friend.identityChanged", "/notice/type", json!("identityChanged")),
        ("request.incoming", "/state", json!("pending")),
        ("request.delivering", "/state", json!("delivering")),
        ("request.awaitingAnswer", "/state", json!("awaitingAnswer")),
        ("request.incoming", "/via", json!("code")),
        ("request.delivering", "/via", json!("code")),
        ("request.awaitingAnswer", "/via", json!("code")),
        ("request.nameIncoming", "/via", json!("name")),
        ("request.nameIncoming", "/state", json!("pending")),
        ("request.nameIncoming", "/codeTail", Value::Null),
        ("request.nameOutgoing", "/via", json!("name")),
        ("request.nameOutgoing", "/state", json!("awaitingAnswer")),
        ("request.nameOutgoing", "/peerId", Value::Null),
        ("request.nameDelivering", "/via", json!("name")),
        ("request.nameDelivering", "/state", json!("delivering")),
        ("event.requestRefused", "/reason", json!("codeUsed")),
        ("code.listed", "/code", Value::Null),
        ("joinPlan.vanilla", "/createVanilla", json!(true)),
        ("event.joinSession.waitingForGame", "/state/type", json!("waitingForGame")),
        ("event.joinSession.connecting", "/state/type", json!("connecting")),
        ("event.joinSession.connected", "/state/type", json!("connected")),
        ("event.joinSession.ended", "/state/type", json!("ended")),
    ];
    for (key, pointer, expected) in requirements {
        assert_eq!(fixtures[key].pointer(pointer), Some(&expected), "{key} {pointer}");
    }
    assert!(fixtures["code.created"]["code"].is_string());
    assert!(!fixtures["joinPlan.missing"]["candidates"][0]["missing"].as_array().unwrap().is_empty());
    assert!(!fixtures["joinPlan.missing"]["candidates"][0]["extra"].as_array().unwrap().is_empty());
}

#[test]
fn directory_states_and_request_ways_use_camel_case_strings() {
    use DirectoryState::*;
    let states = [Unavailable, Off, Active, Unreachable, NotAllowed];
    assert_eq!(
        serde_json::to_value(states).unwrap(),
        json!(["unavailable", "off", "active", "unreachable", "notAllowed"])
    );
    assert_eq!(serde_json::to_value([RequestVia::Code, RequestVia::Name]).unwrap(), json!(["code", "name"]));
    assert_eq!(RequestVia::default(), RequestVia::Code);
}

#[test]
fn ingame_reasons_are_tagged_and_the_settings_use_camel_case_strings() {
    use IngameReason::*;
    let reasons = [NotInBuild, Vanilla, Quilt, NoNode, Unverified, LoaderVersionUnknown, JavaUnknown, IdCollision, OfflineAccount, FriendsOff, BridgeNotRunning, InstanceOff, GloballyOff];
    let types: Vec<Value> = reasons.iter().map(|reason| serde_json::to_value(reason).unwrap()["type"].clone()).collect();
    assert_eq!(
        Value::Array(types),
        json!(["notInBuild", "vanilla", "quilt", "noNode", "unverified", "loaderVersionUnknown", "javaUnknown", "idCollision", "offlineAccount", "friendsOff", "bridgeNotRunning", "instanceOff", "globallyOff"])
    );
    assert_eq!(serde_json::to_value(JavaTooOld { need: 21 }).unwrap(), json!({ "type": "javaTooOld", "need": 21 }));
    assert_eq!(serde_json::to_value([IngameActions::Ask, IngameActions::Allow]).unwrap(), json!(["ask", "allow"]));
    assert_eq!(FriendsSettings::default().ingame_actions, IngameActions::Ask);
    assert!(FriendsSettings::default().ingame_menu);
}

#[test]
fn host_session_fixture_has_one_guest_per_state_and_a_kicked_one() {
    let session: HostSession = serde_json::from_value(fixtures()["hostSession"].clone()).unwrap();
    let states: BTreeSet<String> = session.guests.iter().map(|g| format!("{:?}", g.state)).collect();
    assert_eq!(states.len(), 4);
    assert!(session.guests.iter().any(|g| g.state == GuestState::Left && g.kicked));
}
