//! Die Themen für die Mod (INGAME 5.3): `me`, `friends`, `session`, `invites` und `game`, mit echten Peer-IDs (die
//! Verbindung ersetzt sie durch Aliasse). Alle Namen sind bei ihrer Herkunft schon bereinigt (SPEC 12.3); hier gelten nur
//! die Obergrenzen der Einträge, mit denen jedes Thema in eine Zeile des Launchers passt (siehe `modbridge::topics`).
use std::sync::Arc;

use super::ops::mod_error;
use super::{Shared, FriendSessions};
use crate::services::friends::contract::{Availability, Friend, FriendsState, NetworkStatus, Presence, MAX_GUESTS, MIN_MC_LABEL};
use crate::services::friends::sessions::shown_name;
use crate::services::modbridge::ops::{ErrorCode, OpError};
use crate::services::modbridge::protocol::{ModFriend, ModPresence, ModSession};
use crate::services::modbridge::topics::{
    GameLan, GameView, HostableReason, MeAvailability, MeView, NetworkLine, TopicValue, MAX_FRIENDS, MAX_INVITES,
};

/// Baut die Themen der Instanz neu und gibt sie an die Brücke; die schickt nur, was sich geändert hat.
pub(super) async fn publish(shared: &Arc<Shared>, instance_id: &str, friends: &[Friend]) {
    let bridge = &shared.bridge;
    bridge.set_topic(instance_id, me(&shared.friends.state()));
    bridge.set_topic(instance_id, friends_of(friends));
    bridge.set_topic(instance_id, session(shared, instance_id));
    bridge.set_topic(instance_id, invites(shared));
    bridge.set_topic(instance_id, game(shared, instance_id).await);
}

fn me(state: &FriendsState) -> TopicValue {
    let availability = match state.availability {
        Availability::Available => MeAvailability::Available,
        Availability::NoSecretStore => MeAvailability::NoSecretStore,
        Availability::IdentityLost => MeAvailability::IdentityLost,
    };
    let network = match state.network {
        NetworkStatus::Off => NetworkLine::Off,
        NetworkStatus::Starting => NetworkLine::Starting,
        NetworkStatus::Online { .. } => NetworkLine::Online,
        NetworkStatus::Degraded { .. } => NetworkLine::Degraded,
    };
    let fingerprint = state.me.as_ref().map(|me| me.fingerprint.clone());
    TopicValue::Me(MeView { enabled: state.enabled, availability, network, fingerprint })
}

/// Die bestätigten, nicht vom Freund entfernten Freunde, benannt mit `alias ?? displayName`.
fn friends_of(friends: &[Friend]) -> TopicValue {
    let confirmed = friends.iter().filter(|friend| friend.confirmed && !friend.removed_by_peer);
    TopicValue::Friends(confirmed.take(MAX_FRIENDS).map(mod_friend).collect())
}

fn mod_friend(friend: &Friend) -> ModFriend {
    let presence = match friend.presence {
        Presence::Offline => ModPresence::Offline,
        Presence::Online => ModPresence::Online,
        Presence::Playing => ModPresence::Playing,
    };
    ModFriend { id: friend.id.clone(), name: shown_name(friend), mc_uuid: friend.mc_uuid.clone(), presence }
}

/// Die Gäste der Sitzung dieser Instanz; `None`, wenn in diesem Spiel nichts geteilt wird.
fn session(shared: &Shared, instance_id: &str) -> TopicValue {
    let guests = shared.hosting.guests_for_mod(instance_id);
    TopicValue::Session(guests.map(|guests| ModSession { guests: guests.into_iter().take(MAX_GUESTS).collect() }))
}

fn invites(shared: &Shared) -> TopicValue {
    TopicValue::Invites(shared.invites.for_mod().into_iter().take(MAX_INVITES).collect())
}

async fn game(shared: &Arc<Shared>, instance_id: &str) -> TopicValue {
    let sessions = FriendSessions { shared: shared.clone() };
    let (hostable, reason) = hostability(sessions.ensure_hostable(instance_id).await);
    let lan = sessions.lan_status(instance_id).await.ok().flatten().map(|lan| GameLan { port: lan.port });
    TopicValue::Game(GameView { hostable, reason, lan })
}

/// Ob das Spiel eine Welt teilen kann. Ein noch nicht geöffneter LAN-Port steht dem nicht im Weg: die Mod öffnet ihn
/// selbst, wenn der Spieler teilen will.
fn hostability(check: crate::error::AppResult<()>) -> (bool, Option<HostableReason>) {
    let Err(err) = check else { return (true, None) };
    let error = mod_error(err);
    match error.code {
        ErrorCode::LanPortUnknown => (true, None),
        ErrorCode::VersionUnsupported => (false, Some(HostableReason::VersionUnsupported { min: min_version(&error) })),
        ErrorCode::MsAccountRequired => (false, Some(HostableReason::MsAccountRequired)),
        _ => (false, Some(HostableReason::NotReady)),
    }
}

fn min_version(error: &OpError) -> String {
    error.params.get("min").and_then(|min| min.as_str()).unwrap_or(MIN_MC_LABEL).to_owned()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::coded;
    use crate::error::AppError;
    use crate::services::friends::contract::Me;

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
        let TopicValue::Friends(friends) = topic else { panic!("{topic:?}") };
        friends.into_iter().map(|friend| friend.id).collect()
    }

    #[test]
    fn only_confirmed_friends_the_peer_has_not_removed_are_shown() {
        let removed = Friend { removed_by_peer: true, ..friend("c", true) };
        let all = [friend("a", true), friend("b", false), removed];

        assert_eq!(names(friends_of(&all)), ["a"]);
    }

    #[test]
    fn at_most_fifty_friends_are_shown_and_the_head_of_the_list_stays() {
        let many: Vec<Friend> = (0..MAX_FRIENDS + 10).map(|index| friend(&index.to_string(), true)).collect();

        let shown = names(friends_of(&many));

        assert_eq!(shown.len(), MAX_FRIENDS);
        assert_eq!(shown[0], "0");
    }

    #[test]
    fn presence_maps_one_to_one_and_the_alias_is_the_shown_name() {
        let mut playing = Friend { presence: Presence::Playing, ..friend("a", true) };
        playing.alias = Some("Kumpel".into());

        let shown = mod_friend(&playing);

        assert_eq!((shown.name.as_str(), shown.presence), ("Kumpel", ModPresence::Playing));
        assert_eq!(mod_friend(&Friend { presence: Presence::Offline, ..friend("b", true) }).presence, ModPresence::Offline);
    }

    #[test]
    fn a_game_is_hostable_unless_the_launcher_names_a_reason() {
        assert_eq!(hostability(Ok(())), (true, None));
        let no_port = AppError::invalid(coded!("errors.friends.lanPortUnknown"));
        assert_eq!(hostability(Err(no_port)), (true, None), "der Port wird erst beim Teilen geöffnet");
        let old = AppError::invalid(coded!("errors.friends.versionUnsupported", min = "1.20"));
        assert_eq!(hostability(Err(old)), (false, Some(HostableReason::VersionUnsupported { min: "1.20".into() })));
        let offline = AppError::invalid(coded!("errors.friends.msAccountRequired"));
        assert_eq!(hostability(Err(offline)), (false, Some(HostableReason::MsAccountRequired)));
        let unknown = AppError::invalid(coded!("errors.friends.gameNotRunning"));
        assert_eq!(hostability(Err(unknown)), (false, Some(HostableReason::NotReady)));
    }

    #[test]
    fn me_names_the_state_of_the_feature_and_the_fingerprint() {
        let state = FriendsState {
            availability: Availability::IdentityLost,
            enabled: false,
            me: Some(Me { peer_id: "peer".into(), fingerprint: "ab cd".into(), display_name: "Anna".into() }),
            settings: crate::services::friends::contract::FriendsSettings {
                display_name: "Anna".into(),
                always_relay: false,
                findable_by_name: false,
            },
            network: NetworkStatus::Starting,
            relays: Vec::new(),
            third_party_relays_accepted: false,
            directory: crate::services::friends::contract::DirectoryStatus {
                state: crate::services::friends::contract::DirectoryState::Off,
                host: None,
            },
        };

        let TopicValue::Me(view) = me(&state) else { panic!("kein Thema me") };

        assert_eq!(
            (view.enabled, view.availability, view.network, view.fingerprint.as_deref()),
            (false, MeAvailability::IdentityLost, NetworkLine::Starting, Some("ab cd"))
        );
    }
}
