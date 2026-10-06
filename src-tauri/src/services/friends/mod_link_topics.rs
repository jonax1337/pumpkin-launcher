//! Die Themen für die Mod (docs/bridge/README.md, "Protocol 2"): `me`, `friends`, `requests`, `invites`, `session`, `join`, `game`, `codes` und
//! `blocked`, mit echten Peer-IDs (die Verbindung ersetzt sie durch Aliasse). Alle Namen sind bei ihrer Herkunft schon
//! bereinigt (SPEC 12.3); hier gelten nur die Obergrenzen der Einträge, mit denen jedes Thema in eine Zeile des Launchers
//! passt (siehe `modbridge::topics`).
use std::sync::Arc;

use super::errors::mod_error;
use super::{FriendSessions, Shared};
use crate::services::friends::contract::{
    Availability, BlockedPeer, DirectoryState, Friend, FriendCode, FriendNotice, FriendRequest,
    FriendsState, NetworkStatus, Presence, RequestDirection, RequestState, MAX_GUESTS,
    MIN_MC_LABEL,
};
use crate::services::friends::sessions::shown_name;
use crate::services::modbridge::ops::{ErrorCode, OpError};
use crate::services::modbridge::protocol::{ModFriend, ModFriendNotice, ModPresence, ModSession};
use crate::services::modbridge::topics::{
    BlockedView, CodeView, DirectoryLine, GameLan, GameView, HostableReason, IncomingRequest,
    MeAvailability, MeView, NetworkLine, OutgoingRequest, OutgoingState, RequestsView, TopicValue,
    MAX_BLOCKED, MAX_CODES, MAX_FRIENDS, MAX_INVITES, MAX_REQUESTS,
};

/// Baut die Themen der Instanz neu und gibt sie an die Brücke; die schickt nur, was sich geändert hat.
pub(super) async fn publish(
    shared: &Arc<Shared>,
    bridge: &crate::services::modbridge::FriendsPublication<'_>,
    instance_id: &str,
    friends: &[Friend],
    requests: &[FriendRequest],
) {
    let state = shared.friends.state();
    bridge.set_topic(instance_id, me(&state));
    if !state.enabled || state.availability != Availability::Available {
        publish_unavailable(shared, instance_id);
        return;
    }
    bridge.set_topic(instance_id, friends_of(friends));
    bridge.set_topic(
        instance_id,
        requests_of(requests, shared.friends.retry_cooldown_ms()),
    );
    bridge.set_topic(instance_id, session(shared, instance_id));
    bridge.set_topic(instance_id, invites(shared));
    bridge.set_topic(
        instance_id,
        TopicValue::Join(shared.joins.view_for_mod(instance_id)),
    );
    bridge.set_topic(instance_id, game(shared, instance_id).await);
    bridge.set_topic(
        instance_id,
        codes_of(&shared.friends.codes().await.unwrap_or_default()),
    );
    bridge.set_topic(
        instance_id,
        blocked_of(&shared.friends.blocked().await.unwrap_or_default()),
    );
}

pub(super) fn publish_unavailable(shared: &Shared, instance_id: &str) {
    let bridge = &shared.bridge;
    bridge.set_topic(instance_id, me(&shared.friends.state()));
    bridge.set_topic(instance_id, TopicValue::Friends(Vec::new()));
    bridge.set_topic(instance_id, TopicValue::Requests(RequestsView {
        incoming: Vec::new(), outgoing: Vec::new(), retry_cooldown_ms: 0,
    }));
    bridge.set_topic(instance_id, TopicValue::Invites(Vec::new()));
    bridge.set_topic(instance_id, TopicValue::Session(None));
    bridge.set_topic(instance_id, TopicValue::Join(None));
    bridge.set_topic(instance_id, TopicValue::Game(GameView {
        hostable: false, reason: None, lan: None, shared_elsewhere: false,
    }));
    bridge.set_topic(instance_id, TopicValue::Codes(Vec::new()));
    bridge.set_topic(instance_id, TopicValue::Blocked(Vec::new()));
}

fn me(state: &FriendsState) -> TopicValue {
    let fingerprint = state.me.as_ref().map(|me| me.fingerprint.clone());
    TopicValue::Me(MeView {
        enabled: state.enabled,
        availability: availability_line(state.availability),
        network: network_line(&state.network),
        fingerprint,
        directory: directory_line(state.directory.state),
        display_name: state
            .me
            .as_ref()
            .map(|me| me.display_name.clone())
            .unwrap_or_default(),
        findable_by_name: state.settings.findable_by_name,
        relay_host: relay_host_of(&state.network),
    })
}

/// Der Host des Relays, über den das Freunde-Netzwerk verbunden ist; nur `Online` kennt ihn (der Optionen-Reiter zeigt
/// „Verbunden über {host}“).
fn relay_host_of(network: &NetworkStatus) -> Option<String> {
    match network {
        NetworkStatus::Online { relay_host } => Some(relay_host.clone()),
        _ => None,
    }
}

fn availability_line(availability: Availability) -> MeAvailability {
    match availability {
        Availability::Available => MeAvailability::Available,
        Availability::NoSecretStore => MeAvailability::NoSecretStore,
        Availability::IdentityLost => MeAvailability::IdentityLost,
    }
}

fn network_line(network: &NetworkStatus) -> NetworkLine {
    match network {
        NetworkStatus::Off => NetworkLine::Off,
        NetworkStatus::Starting => NetworkLine::Starting,
        NetworkStatus::Online { .. } => NetworkLine::Online,
        NetworkStatus::Degraded { .. } => NetworkLine::Degraded,
    }
}

fn directory_line(directory: DirectoryState) -> DirectoryLine {
    match directory {
        DirectoryState::Active => DirectoryLine::Active,
        DirectoryState::Off => DirectoryLine::Off,
        DirectoryState::Unreachable => DirectoryLine::Unreachable,
        DirectoryState::NotAllowed => DirectoryLine::NotAllowed,
        DirectoryState::Unavailable => DirectoryLine::Unavailable,
    }
}

/// Die bestätigten, nicht vom Freund entfernten Freunde mit ihrem persönlichen oder Minecraft-Namen.
fn friends_of(friends: &[Friend]) -> TopicValue {
    let confirmed = friends
        .iter()
        .filter(|friend| friend.confirmed && !friend.removed_by_peer);
    TopicValue::Friends(confirmed.take(MAX_FRIENDS).map(mod_friend).collect())
}

fn mod_friend(friend: &Friend) -> ModFriend {
    let presence = match friend.presence {
        Presence::Offline => ModPresence::Offline,
        Presence::Online => ModPresence::Online,
        Presence::Playing => ModPresence::Playing,
    };
    let notice = friend.notice.as_ref().map(|notice| match notice {
        FriendNotice::Renamed { previous_name } => ModFriendNotice::Renamed {
            previous_name: previous_name.clone(),
        },
        FriendNotice::IdentityChanged { .. } => ModFriendNotice::IdentityChanged,
    });
    ModFriend {
        id: friend.id.clone(),
        name: shown_name(friend),
        mc_uuid: friend.mc_uuid.clone(),
        presence,
        notice,
    }
}

/// Eingehende Anfragen, die auf den Nutzer warten, und die eigenen, die unterwegs oder unbeantwortet sind. Die Restzeit
/// der Sperre von „Jetzt zustellen“ kommt aus dem Verzeichnis-Dienst, das sie durchsetzt.
fn requests_of(requests: &[FriendRequest], retry_cooldown_ms: u64) -> TopicValue {
    let incoming = requests
        .iter()
        .filter(|request| {
            request.direction == RequestDirection::Incoming
                && request.state == RequestState::Pending
        })
        .take(MAX_REQUESTS)
        .map(incoming_request);
    let outgoing = requests
        .iter()
        .filter(|request| request.direction == RequestDirection::Outgoing)
        .filter_map(outgoing_request);
    TopicValue::Requests(RequestsView {
        incoming: incoming.collect(),
        outgoing: outgoing.take(MAX_REQUESTS).collect(),
        retry_cooldown_ms,
    })
}

fn incoming_request(request: &FriendRequest) -> IncomingRequest {
    IncomingRequest {
        id: request.id.clone(),
        name: request
            .mc_name
            .clone()
            .or_else(|| request.display_name.clone())
            .unwrap_or_default(),
        mc_name: request.mc_name.clone(),
        fingerprint: request.fingerprint.clone().unwrap_or_default(),
    }
}

fn outgoing_request(request: &FriendRequest) -> Option<OutgoingRequest> {
    let state = match request.state {
        RequestState::Delivering => OutgoingState::Delivering,
        RequestState::AwaitingAnswer => OutgoingState::AwaitingAnswer,
        RequestState::Pending => return None,
    };
    Some(OutgoingRequest {
        id: request.id.clone(),
        name: request
            .mc_name
            .clone()
            .or_else(|| request.display_name.clone()),
        state,
    })
}

/// Die Gäste der Sitzung dieser Instanz; `None`, wenn in diesem Spiel nichts geteilt wird.
fn session(shared: &Shared, instance_id: &str) -> TopicValue {
    let guests = shared.hosting.guests_for_mod(instance_id);
    TopicValue::Session(guests.map(|guests| ModSession {
        guests: guests.into_iter().take(MAX_GUESTS).collect(),
    }))
}

fn invites(shared: &Shared) -> TopicValue {
    TopicValue::Invites(
        shared
            .invites
            .for_mod()
            .into_iter()
            .take(MAX_INVITES)
            .collect(),
    )
}

fn codes_of(codes: &[FriendCode]) -> TopicValue {
    let view = |code: &FriendCode| CodeView {
        id: code.id.clone(),
        tail: code.tail.clone(),
        expires_at: code.expires_at,
        used: code.used,
    };
    TopicValue::Codes(codes.iter().take(MAX_CODES).map(view).collect())
}

fn blocked_of(blocked: &[BlockedPeer]) -> TopicValue {
    let view = |peer: &BlockedPeer| BlockedView {
        id: peer.peer_id.clone(),
        name: peer.display_name.clone(),
    };
    TopicValue::Blocked(blocked.iter().take(MAX_BLOCKED).map(view).collect())
}

async fn game(shared: &Arc<Shared>, instance_id: &str) -> TopicValue {
    let sessions = FriendSessions {
        shared: shared.clone(),
    };
    let (hostable, reason) = hostability(sessions.ensure_hostable(instance_id).await);
    let lan = sessions
        .lan_status(instance_id)
        .await
        .ok()
        .flatten()
        .map(|lan| GameLan { port: lan.port });
    TopicValue::Game(GameView {
        hostable,
        reason,
        lan,
        shared_elsewhere: shared.hosting.shares_another(instance_id),
    })
}

/// Ob das Spiel eine Welt teilen kann. Ein noch nicht geöffneter LAN-Port steht dem nicht im Weg: die Mod öffnet ihn
/// selbst, wenn der Spieler teilen will.
fn hostability(check: crate::error::AppResult<()>) -> (bool, Option<HostableReason>) {
    let Err(err) = check else { return (true, None) };
    let error = mod_error(err);
    match error.code {
        ErrorCode::LanPortUnknown => (true, None),
        ErrorCode::VersionUnsupported => (
            false,
            Some(HostableReason::VersionUnsupported {
                min: min_version(&error),
            }),
        ),
        ErrorCode::MsAccountRequired => (false, Some(HostableReason::MsAccountRequired)),
        ErrorCode::BadRequest
            if error
                .params
                .get("reason")
                .is_some_and(|reason| reason == "manifestInvalid") =>
        {
            (false, Some(HostableReason::ManifestInvalid))
        }
        _ => (false, Some(HostableReason::NotReady)),
    }
}

fn min_version(error: &OpError) -> String {
    error
        .params
        .get("min")
        .and_then(|min| min.as_str())
        .unwrap_or(MIN_MC_LABEL)
        .to_owned()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::coded;
    use crate::error::AppError;
    use crate::services::friends::contract::{Me, RequestVia};

    fn friend(id: &str, confirmed: bool) -> Friend {
        Friend {
            id: id.into(),
            display_name: format!("Name {id}"),
            alias: None,
            mc_name: None,
            mc_uuid: None,
            fingerprint: String::new(),
            added_at: 0,
            last_seen: None,
            confirmed,
            removed_by_peer: false,
            notice: None,
            presence: Presence::Online,
            path: None,
        }
    }

    fn names(topic: TopicValue) -> Vec<String> {
        let TopicValue::Friends(friends) = topic else {
            panic!("{topic:?}")
        };
        friends.into_iter().map(|friend| friend.id).collect()
    }

    fn request(id: &str, direction: RequestDirection, state: RequestState) -> FriendRequest {
        FriendRequest {
            id: id.into(),
            direction,
            state,
            peer_id: Some(format!("peer-{id}")),
            fingerprint: Some("ab12 cd34".into()),
            display_name: Some(format!("Name {id}")),
            mc_name: Some(format!("Mc{id}")),
            code_tail: None,
            created_at: 0,
            expires_at: 0,
            via: RequestVia::Code,
        }
    }

    #[test]
    fn only_confirmed_friends_the_peer_has_not_removed_are_shown() {
        let removed = Friend {
            removed_by_peer: true,
            ..friend("c", true)
        };
        let all = [friend("a", true), friend("b", false), removed];

        assert_eq!(names(friends_of(&all)), ["a"]);
    }

    #[test]
    fn at_most_fifty_friends_are_shown_and_the_head_of_the_list_stays() {
        let many: Vec<Friend> = (0..MAX_FRIENDS + 10)
            .map(|index| friend(&index.to_string(), true))
            .collect();

        let shown = names(friends_of(&many));

        assert_eq!(shown.len(), MAX_FRIENDS);
        assert_eq!(shown[0], "0");
    }

    #[test]
    fn presence_maps_one_to_one_and_the_alias_is_the_shown_name() {
        let mut playing = Friend {
            presence: Presence::Playing,
            ..friend("a", true)
        };
        playing.mc_name = Some("MinecraftName".into());
        playing.alias = Some("Kumpel".into());

        let shown = mod_friend(&playing);

        assert_eq!(
            (shown.name.as_str(), shown.presence),
            ("Kumpel", ModPresence::Playing)
        );
        playing.alias = None;
        assert_eq!(mod_friend(&playing).name, "MinecraftName");
        assert_eq!(
            mod_friend(&Friend {
                presence: Presence::Offline,
                ..friend("b", true)
            })
            .presence,
            ModPresence::Offline
        );
    }

    #[test]
    fn a_notice_reaches_the_mod_without_the_old_fingerprint() {
        let renamed = Friend {
            notice: Some(FriendNotice::Renamed {
                previous_name: "Alt".into(),
            }),
            ..friend("a", true)
        };
        let changed = Friend {
            notice: Some(FriendNotice::IdentityChanged {
                previous_fingerprint: "ab cd".into(),
            }),
            ..friend("b", true)
        };

        assert_eq!(
            mod_friend(&renamed).notice,
            Some(ModFriendNotice::Renamed {
                previous_name: "Alt".into()
            })
        );
        assert_eq!(
            mod_friend(&changed).notice,
            Some(ModFriendNotice::IdentityChanged)
        );
        assert_eq!(mod_friend(&friend("c", true)).notice, None);
    }

    #[test]
    fn incoming_requests_wait_for_the_user_and_outgoing_ones_show_how_far_they_are() {
        let all = [
            request("in1", RequestDirection::Incoming, RequestState::Pending),
            request("in2", RequestDirection::Incoming, RequestState::Delivering),
            request("out1", RequestDirection::Outgoing, RequestState::Delivering),
            request(
                "out2",
                RequestDirection::Outgoing,
                RequestState::AwaitingAnswer,
            ),
            request("out3", RequestDirection::Outgoing, RequestState::Pending),
        ];

        let TopicValue::Requests(view) = requests_of(&all, 0) else {
            panic!("kein Thema requests")
        };

        let incoming: Vec<(&str, &str, Option<&str>)> = view
            .incoming
            .iter()
            .map(|request| {
                (
                    request.id.as_str(),
                    request.name.as_str(),
                    request.mc_name.as_deref(),
                )
            })
            .collect();
        assert_eq!(incoming, [("in1", "Mcin1", Some("Mcin1"))]);
        assert_eq!(view.incoming[0].fingerprint, "ab12 cd34");
        let outgoing: Vec<(&str, OutgoingState)> = view
            .outgoing
            .iter()
            .map(|request| (request.id.as_str(), request.state))
            .collect();
        assert_eq!(
            outgoing,
            [
                ("out1", OutgoingState::Delivering),
                ("out2", OutgoingState::AwaitingAnswer)
            ]
        );
    }

    #[test]
    fn a_request_without_a_display_name_shows_its_minecraft_name() {
        let letter = FriendRequest {
            display_name: None,
            ..request("in1", RequestDirection::Incoming, RequestState::Pending)
        };

        assert_eq!(incoming_request(&letter).name, "Mcin1");
        assert_eq!(
            incoming_request(&FriendRequest {
                mc_name: None,
                ..letter
            })
            .name,
            ""
        );
    }

    #[test]
    fn each_direction_of_requests_is_capped() {
        let many = |direction, state| {
            (0..MAX_REQUESTS + 5).map(move |n| request(&n.to_string(), direction, state))
        };
        let all: Vec<FriendRequest> = many(RequestDirection::Incoming, RequestState::Pending)
            .chain(many(RequestDirection::Outgoing, RequestState::Delivering))
            .collect();

        let TopicValue::Requests(view) = requests_of(&all, 0) else {
            panic!("kein Thema requests")
        };

        assert_eq!(
            (view.incoming.len(), view.outgoing.len()),
            (MAX_REQUESTS, MAX_REQUESTS)
        );
    }

    #[test]
    fn the_requests_topic_carries_the_remaining_cooldown_of_deliver_now() {
        let TopicValue::Requests(view) = requests_of(&[], 42_000) else {
            panic!("kein Thema requests")
        };

        assert_eq!(view.retry_cooldown_ms, 42_000);
        assert_eq!(
            requests_of(&[], 0).to_json()["retryCooldownMs"],
            serde_json::json!(0)
        );
    }

    #[test]
    fn codes_show_only_their_tail_and_blocked_people_their_name() {
        let code = FriendCode {
            id: "c1".into(),
            code: Some("pumpkin-GEHEIM".into()),
            tail: "x7q2".into(),
            created_at: 1,
            expires_at: 9,
            used: true,
        };
        let blocked = BlockedPeer {
            peer_id: "peer-t".into(),
            display_name: "Troll".into(),
            blocked_at: 3,
        };

        let codes = codes_of(&[code]).to_json().to_string();
        let blocked = blocked_of(&[blocked]);

        assert!(
            codes.contains("x7q2") && !codes.contains("GEHEIM"),
            "{codes}"
        );
        assert_eq!(
            blocked,
            TopicValue::Blocked(vec![BlockedView {
                id: "peer-t".into(),
                name: "Troll".into()
            }])
        );
    }

    #[test]
    fn codes_and_blocked_people_are_capped() {
        let code = |n: usize| FriendCode {
            id: n.to_string(),
            code: None,
            tail: "t".into(),
            created_at: 0,
            expires_at: 0,
            used: false,
        };
        let peer = |n: usize| BlockedPeer {
            peer_id: n.to_string(),
            display_name: "x".into(),
            blocked_at: 0,
        };
        let codes: Vec<FriendCode> = (0..MAX_CODES + 3).map(code).collect();
        let people: Vec<BlockedPeer> = (0..MAX_BLOCKED + 3).map(peer).collect();

        let (TopicValue::Codes(codes), TopicValue::Blocked(people)) =
            (codes_of(&codes), blocked_of(&people))
        else {
            panic!()
        };

        assert_eq!((codes.len(), people.len()), (MAX_CODES, MAX_BLOCKED));
    }

    #[test]
    fn a_game_is_hostable_unless_the_launcher_names_a_reason() {
        assert_eq!(hostability(Ok(())), (true, None));
        let no_port = AppError::invalid(coded!("errors.friends.lanPortUnknown"));
        assert_eq!(
            hostability(Err(no_port)),
            (true, None),
            "der Port wird erst beim Teilen geöffnet"
        );
        let old = AppError::invalid(coded!("errors.friends.versionUnsupported", min = "1.16.5"));
        assert_eq!(
            hostability(Err(old)),
            (
                false,
                Some(HostableReason::VersionUnsupported { min: "1.16.5".into() })
            )
        );
        let offline = AppError::invalid(coded!("errors.friends.msAccountRequired"));
        assert_eq!(
            hostability(Err(offline)),
            (false, Some(HostableReason::MsAccountRequired))
        );
        let broken = AppError::invalid(coded!("errors.friends.manifestInvalid"));
        assert_eq!(
            hostability(Err(broken)),
            (false, Some(HostableReason::ManifestInvalid))
        );
        let unknown = AppError::invalid(coded!("errors.friends.gameNotRunning"));
        assert_eq!(
            hostability(Err(unknown)),
            (false, Some(HostableReason::NotReady))
        );
        let other_bad_request = AppError::invalid(coded!("errors.friends.nameInvalid"));
        assert_eq!(
            hostability(Err(other_bad_request)),
            (false, Some(HostableReason::NotReady))
        );
    }

    #[test]
    fn me_names_the_state_of_the_feature_and_the_fingerprint() {
        let state = FriendsState {
            availability: Availability::IdentityLost,
            enabled: false,
            me: Some(Me {
                peer_id: "peer".into(),
                fingerprint: "ab cd".into(),
                display_name: "Anna".into(),
            }),
            settings: crate::services::friends::contract::FriendsSettings {
                always_relay: false,
                findable_by_name: false,
                ..Default::default()
            },
            network: NetworkStatus::Starting,
            relays: Vec::new(),
            third_party_relays_accepted: false,
            directory: crate::services::friends::contract::DirectoryStatus {
                state: crate::services::friends::contract::DirectoryState::Off,
                host: None,
            },
        };

        let TopicValue::Me(view) = me(&state) else {
            panic!("kein Thema me")
        };

        assert_eq!(
            (
                view.enabled,
                view.availability,
                view.network,
                view.fingerprint.as_deref(),
                view.directory
            ),
            (
                false,
                MeAvailability::IdentityLost,
                NetworkLine::Starting,
                Some("ab cd"),
                DirectoryLine::Off
            )
        );
        assert_eq!(
            (view.display_name.as_str(), view.findable_by_name),
            ("Anna", false)
        );
        assert_eq!(
            view.relay_host, None,
            "„startet“ kennt noch keinen Relay-Host"
        );
    }

    #[test]
    fn me_names_the_relay_host_only_while_the_network_is_online() {
        let state = |network| FriendsState {
            network,
            ..empty_state()
        };

        let online = NetworkStatus::Online {
            relay_host: "relay-eu1.example.org".into(),
        };
        assert_eq!(
            me(&state(online.clone())).to_json()["relayHost"],
            serde_json::json!("relay-eu1.example.org")
        );
        assert_eq!(
            me(&state(NetworkStatus::Degraded {
                reason: crate::services::friends::contract::DegradedReason::RelayUnreachable
            }))
            .to_json()["relayHost"],
            serde_json::json!(null)
        );
        assert_eq!(
            me(&state(NetworkStatus::Off)).to_json()["relayHost"],
            serde_json::json!(null)
        );
    }

    /// [`FriendsState`] mit den Werten, die kein Test hier interessiert.
    fn empty_state() -> FriendsState {
        FriendsState {
            availability: Availability::Available,
            enabled: true,
            me: None,
            settings: crate::services::friends::contract::FriendsSettings::default(),
            network: NetworkStatus::Off,
            relays: Vec::new(),
            third_party_relays_accepted: false,
            directory: crate::services::friends::contract::DirectoryStatus {
                state: crate::services::friends::contract::DirectoryState::Unavailable,
                host: None,
            },
        }
    }

    #[test]
    fn me_mirrors_every_state_of_the_directory() {
        let states = [
            (DirectoryState::Active, DirectoryLine::Active),
            (DirectoryState::Off, DirectoryLine::Off),
            (DirectoryState::Unreachable, DirectoryLine::Unreachable),
            (DirectoryState::NotAllowed, DirectoryLine::NotAllowed),
            (DirectoryState::Unavailable, DirectoryLine::Unavailable),
        ];

        for (state, line) in states {
            assert_eq!(directory_line(state), line, "{state:?}");
        }
    }
}
