//! Zustandsthemen (docs/friends/INGAME.md, 5.3): der Launcher schickt den ganzen Wert eines Themas mit einer
//! Revision, die Mod ersetzt ihre Kopie und patcht nie. Jedes Thema hat eine harte Obergrenze für seine Einträge; der
//! Test am Ende rechnet nach, dass der schlimmste Fall in `TOPIC_BUDGET_BYTES` passt.
use std::collections::HashMap;

use serde::{Deserialize, Serialize};
use serde_json::Value;

use super::protocol::{ModFriend, ModInvite, ModSession};
use crate::services::shared_types::PathKind;

pub const MAX_FRIENDS: usize = 50;
pub const MAX_INVITES: usize = 20;
/// Je Richtung.
pub const MAX_REQUESTS: usize = 25;
pub const MAX_CODES: usize = 10;
pub const MAX_BLOCKED: usize = 100;
/// Zeichen eines Namens, eines Titels, eines Minecraft-Namens und eines Fingerabdrucks, wie die Quellen sie begrenzen.
pub const NAME_CHARS: usize = 32;
pub const TITLE_CHARS: usize = 64;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Topic {
    Me,
    Friends,
    Requests,
    Invites,
    Session,
    Join,
    Game,
    Codes,
    Blocked,
}

/// Der Wert eines Themas. Peer-IDs stehen darin im Launcher als echte IDs; erst [`TopicValue::masked`] macht daraus
/// die Aliasse der Verbindung.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum TopicValue {
    Me(MeView),
    Friends(Vec<ModFriend>),
    Requests(RequestsView),
    Invites(Vec<ModInvite>),
    /// `None`: in diesem Spiel wird nichts geteilt.
    Session(Option<ModSession>),
    /// `None`: das Spiel ist keiner fremden Welt beigetreten.
    Join(Option<JoinView>),
    Game(GameView),
    Codes(Vec<CodeView>),
    Blocked(Vec<BlockedView>),
}

impl TopicValue {
    pub fn topic(&self) -> Topic {
        match self {
            Self::Me(_) => Topic::Me,
            Self::Friends(_) => Topic::Friends,
            Self::Requests(_) => Topic::Requests,
            Self::Invites(_) => Topic::Invites,
            Self::Session(_) => Topic::Session,
            Self::Join(_) => Topic::Join,
            Self::Game(_) => Topic::Game,
            Self::Codes(_) => Topic::Codes,
            Self::Blocked(_) => Topic::Blocked,
        }
    }

    pub fn to_json(&self) -> Value {
        let value = match self {
            Self::Me(view) => serde_json::to_value(view),
            Self::Friends(view) => serde_json::to_value(view),
            Self::Requests(view) => serde_json::to_value(view),
            Self::Invites(view) => serde_json::to_value(view),
            Self::Session(view) => serde_json::to_value(view),
            Self::Join(view) => serde_json::to_value(view),
            Self::Game(view) => serde_json::to_value(view),
            Self::Codes(view) => serde_json::to_value(view),
            Self::Blocked(view) => serde_json::to_value(view),
        };
        value.unwrap_or(Value::Null)
    }

    /// Liest den Wert eines Themas aus seiner JSON-Form (für Tests und Fixtures).
    pub fn parse(topic: Topic, value: Value) -> serde_json::Result<Self> {
        Ok(match topic {
            Topic::Me => Self::Me(serde_json::from_value(value)?),
            Topic::Friends => Self::Friends(serde_json::from_value(value)?),
            Topic::Requests => Self::Requests(serde_json::from_value(value)?),
            Topic::Invites => Self::Invites(serde_json::from_value(value)?),
            Topic::Session => Self::Session(serde_json::from_value(value)?),
            Topic::Join => Self::Join(serde_json::from_value(value)?),
            Topic::Game => Self::Game(serde_json::from_value(value)?),
            Topic::Codes => Self::Codes(serde_json::from_value(value)?),
            Topic::Blocked => Self::Blocked(serde_json::from_value(value)?),
        })
    }

    /// Ersetzt jede Peer-ID durch den Alias dieser Verbindung.
    pub fn masked(self, aliases: &mut Aliases) -> Self {
        match self {
            Self::Friends(mut friends) => {
                friends.iter_mut().for_each(|friend| friend.id = aliases.alias_for(&friend.id));
                Self::Friends(friends)
            }
            Self::Session(Some(mut session)) => {
                session.guests.iter_mut().for_each(|guest| guest.id = aliases.alias_for(&guest.id));
                Self::Session(Some(session))
            }
            Self::Blocked(mut blocked) => {
                blocked.iter_mut().for_each(|entry| entry.id = aliases.alias_for(&entry.id));
                Self::Blocked(blocked)
            }
            other => other,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MeView {
    pub enabled: bool,
    pub availability: MeAvailability,
    pub network: NetworkLine,
    pub fingerprint: Option<String>,
    /// Ob der Nutzer per Minecraft-Namen auffindbar ist und das Verzeichnis antwortet (BYNAME 9.3).
    pub directory: DirectoryLine,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum MeAvailability {
    Available,
    NoSecretStore,
    IdentityLost,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum NetworkLine {
    Off,
    Starting,
    Online,
    Degraded,
}

/// Der Zustand des Verzeichnisses für Namen, wie `DirectoryState` im Launcher; die Mod zeigt im Reiter „Per Name“ dessen
/// Texte.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum DirectoryLine {
    Active,
    Off,
    Unreachable,
    NotAllowed,
    Unavailable,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RequestsView {
    pub incoming: Vec<IncomingRequest>,
    pub outgoing: Vec<OutgoingRequest>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IncomingRequest {
    pub id: String,
    pub name: String,
    pub mc_name: Option<String>,
    pub fingerprint: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OutgoingRequest {
    pub id: String,
    pub name: Option<String>,
    pub state: OutgoingState,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum OutgoingState {
    Delivering,
    AwaitingAnswer,
}

/// Die Welt, der dieses Spiel beigetreten ist (INGAME 7).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct JoinView {
    pub invite_id: String,
    pub host_name: String,
    pub state: JoinPhase,
    pub path: Option<PathKind>,
    pub rtt_ms: Option<u32>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum JoinPhase {
    WaitingForGame,
    Connecting,
    Connected,
}

/// Ob dieses Spiel seine Welt teilen kann, und der geprüfte LAN-Port, falls sie schon geöffnet ist.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GameView {
    pub hostable: bool,
    pub reason: Option<HostableReason>,
    /// Nur ein geprüfter Port; der Eintrag ist da, sobald der Launcher den Port dem Spielprozess zugeordnet hat.
    pub lan: Option<GameLan>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase", rename_all_fields = "camelCase")]
pub enum HostableReason {
    VersionUnsupported { min: String },
    MsAccountRequired,
    ManifestInvalid,
    /// Der Launcher kennt das laufende Spiel noch nicht.
    NotReady,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GameLan {
    pub port: u16,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CodeView {
    pub id: String,
    /// Die letzten Zeichen des Codes; der ganze Code steht nur in der Antwort auf `code.create`.
    pub tail: String,
    pub expires_at: u64,
    pub used: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BlockedView {
    pub id: String,
    pub name: String,
}

/// Die Namen (`f1`, `f2`, …), unter denen die Mod Freunde sieht: Peer-IDs verlassen den Launcher nicht. Gilt je
/// Verbindung; eine neue Verbindung beginnt wieder bei `f1`.
#[derive(Default)]
pub struct Aliases {
    by_id: HashMap<String, String>,
    by_alias: HashMap<String, String>,
}

impl Aliases {
    pub fn alias_for(&mut self, id: &str) -> String {
        if let Some(alias) = self.by_id.get(id) {
            return alias.clone();
        }
        let alias = format!("f{}", self.by_id.len() + 1);
        self.by_id.insert(id.to_owned(), alias.clone());
        self.by_alias.insert(alias.clone(), id.to_owned());
        alias
    }

    /// Die Peer-ID hinter einem Alias, der der Mod schon gezeigt wurde.
    pub fn real(&self, alias: &str) -> Option<String> {
        self.by_alias.get(alias).cloned()
    }
}

/// Der letzte Wert jedes Themas mit seiner Revision. Lebt so lange wie der Spielstart, nicht die Verbindung: eine
/// Mod, die sich neu verbindet, bekommt sofort den vollen Stand.
#[derive(Default)]
pub struct TopicStore {
    entries: HashMap<Topic, (u64, TopicValue)>,
}

impl TopicStore {
    /// Setzt den Wert; ein gleicher Wert ändert weder ihn noch die Revision. Liefert das Thema, wenn sich etwas
    /// geändert hat.
    pub fn set(&mut self, value: TopicValue) -> Option<Topic> {
        let topic = value.topic();
        let revision = match self.entries.get(&topic) {
            Some((_, current)) if *current == value => return None,
            Some((revision, _)) => revision + 1,
            None => 1,
        };
        self.entries.insert(topic, (revision, value));
        Some(topic)
    }

    pub fn current(&self, topic: Topic) -> Option<(u64, TopicValue)> {
        self.entries.get(&topic).cloned()
    }

    /// Die Themen, die schon einen Wert haben.
    pub fn valued(&self) -> Vec<Topic> {
        self.entries.keys().copied().collect()
    }
}

#[cfg(test)]
mod tests {
    use super::super::limits::{LAUNCHER_LINE_BYTES, TOPIC_BUDGET_BYTES};
    use super::super::protocol::{LauncherFrame, ModFriendNotice, ModGuest, ModGuestState, ModPresence};
    use super::*;

    const WIDEST_CHAR: &str = "\u{1F383}";

    fn text(chars: usize) -> String {
        WIDEST_CHAR.repeat(chars)
    }

    fn peer_id(index: usize) -> String {
        format!("{index:064x}")
    }

    /// Das Thema mit allen Einträgen an der Obergrenze, jeder Text so breit wie erlaubt.
    fn worst_case(topic: Topic) -> TopicValue {
        match topic {
            Topic::Me => TopicValue::Me(MeView {
                enabled: true,
                availability: MeAvailability::IdentityLost,
                network: NetworkLine::Degraded,
                fingerprint: Some(text(64)),
                directory: DirectoryLine::Unreachable,
            }),
            Topic::Friends => TopicValue::Friends(
                (0..MAX_FRIENDS)
                    .map(|index| ModFriend {
                        id: peer_id(index),
                        name: text(NAME_CHARS),
                        mc_uuid: Some("0".repeat(32)),
                        presence: ModPresence::Playing,
                        notice: Some(ModFriendNotice::Renamed { previous_name: text(NAME_CHARS) }),
                    })
                    .collect(),
            ),
            Topic::Requests => TopicValue::Requests(RequestsView {
                incoming: (0..MAX_REQUESTS)
                    .map(|index| IncomingRequest { id: format!("{index:036}"), name: text(NAME_CHARS), mc_name: Some(text(16)), fingerprint: text(64) })
                    .collect(),
                outgoing: (0..MAX_REQUESTS)
                    .map(|index| OutgoingRequest { id: format!("{index:036}"), name: Some(text(NAME_CHARS)), state: OutgoingState::AwaitingAnswer })
                    .collect(),
            }),
            Topic::Invites => TopicValue::Invites(
                (0..MAX_INVITES).map(|index| ModInvite { id: format!("{index:036}"), from_name: text(NAME_CHARS), title: text(TITLE_CHARS) }).collect(),
            ),
            Topic::Session => TopicValue::Session(Some(ModSession {
                guests: (0..7).map(|index| ModGuest { id: peer_id(index), name: text(NAME_CHARS), state: ModGuestState::Connected }).collect(),
            })),
            Topic::Join => TopicValue::Join(Some(JoinView {
                invite_id: format!("{:036}", 0),
                host_name: text(NAME_CHARS),
                state: JoinPhase::Connected,
                path: Some(PathKind::Relay),
                rtt_ms: Some(u32::MAX),
            })),
            Topic::Game => TopicValue::Game(GameView {
                hostable: false,
                reason: Some(HostableReason::VersionUnsupported { min: text(16) }),
                lan: Some(GameLan { port: u16::MAX }),
            }),
            Topic::Codes => TopicValue::Codes(
                (0..MAX_CODES).map(|index| CodeView { id: format!("{index:036}"), tail: text(8), expires_at: u64::MAX, used: true }).collect(),
            ),
            Topic::Blocked => {
                TopicValue::Blocked((0..MAX_BLOCKED).map(|index| BlockedView { id: peer_id(index), name: text(NAME_CHARS) }).collect())
            }
        }
    }

    const ALL_TOPICS: [Topic; 9] =
        [Topic::Me, Topic::Friends, Topic::Requests, Topic::Invites, Topic::Session, Topic::Join, Topic::Game, Topic::Codes, Topic::Blocked];

    /// Die Zeile, wie sie auf den Draht ginge, samt Zeilenende.
    fn wire_bytes(value: TopicValue) -> usize {
        let masked = value.masked(&mut Aliases::default());
        let frame = LauncherFrame::state(masked.topic(), u64::MAX, &masked);
        serde_json::to_vec(&frame).unwrap().len() + 1
    }

    #[test]
    fn the_worst_case_of_every_topic_fits_the_budget() {
        for topic in ALL_TOPICS {
            let bytes = wire_bytes(worst_case(topic));
            assert!(bytes <= TOPIC_BUDGET_BYTES, "{topic:?} braucht {bytes} Byte");
        }
    }

    #[test]
    fn the_budget_leaves_room_below_the_line_limit_of_the_launcher() {
        const { assert!(TOPIC_BUDGET_BYTES < LAUNCHER_LINE_BYTES) };
    }

    #[test]
    fn the_worst_case_has_every_topic_filled_to_its_cap() {
        let counts: Vec<usize> = [Topic::Friends, Topic::Invites, Topic::Codes, Topic::Blocked]
            .into_iter()
            .map(|topic| worst_case(topic).to_json().as_array().unwrap().len())
            .collect();
        assert_eq!(counts, [MAX_FRIENDS, MAX_INVITES, MAX_CODES, MAX_BLOCKED]);
    }

    #[test]
    fn every_topic_value_reads_back_from_its_json() {
        for topic in ALL_TOPICS {
            let value = worst_case(topic);
            assert_eq!(TopicValue::parse(topic, value.to_json()).unwrap(), value, "{topic:?}");
            assert_eq!(value.topic(), topic);
        }
        assert!(TopicValue::parse(Topic::Friends, serde_json::json!({"not": "a list"})).is_err());
        let empty = TopicValue::Session(None);
        assert_eq!(TopicValue::parse(Topic::Session, empty.to_json()).unwrap(), empty, "kein Teilen ist null");
    }

    #[test]
    fn peer_ids_are_replaced_by_stable_aliases_and_map_back() {
        let mut aliases = Aliases::default();
        let friend = |id: &str| ModFriend { id: id.into(), name: "x".into(), mc_uuid: None, presence: ModPresence::Online, notice: None };
        let guest = |id: &str| ModGuest { id: id.into(), name: "x".into(), state: ModGuestState::Invited };
        let friends = TopicValue::Friends(vec![friend("peer-a"), friend("peer-b")]).masked(&mut aliases);
        let session = TopicValue::Session(Some(ModSession { guests: vec![guest("peer-b"), guest("peer-c")] })).masked(&mut aliases);
        let blocked = TopicValue::Blocked(vec![BlockedView { id: "peer-d".into(), name: "x".into() }]).masked(&mut aliases);

        let ids = |value: &TopicValue| value.to_json().to_string();
        assert!(ids(&friends).contains(r#""id":"f1""#) && ids(&friends).contains(r#""id":"f2""#));
        assert!(ids(&session).contains(r#""id":"f2""#) && ids(&session).contains(r#""id":"f3""#));
        assert!(ids(&blocked).contains(r#""id":"f4""#));
        assert_eq!(aliases.alias_for("peer-a"), "f1", "derselbe Freund behält seinen Alias");
        assert_eq!(aliases.real("f3"), Some("peer-c".to_owned()));
        assert_eq!(aliases.real("f9"), None);
        assert_eq!(aliases.real("peer-a"), None, "echte IDs sind keine Aliasse");
    }

    #[test]
    fn values_without_peer_ids_pass_the_mask_unchanged() {
        let invites = TopicValue::Invites(vec![ModInvite { id: "i1".into(), from_name: "A".into(), title: "T".into() }]);
        assert_eq!(invites.clone().masked(&mut Aliases::default()), invites);
        assert_eq!(TopicValue::Session(None).masked(&mut Aliases::default()), TopicValue::Session(None));
    }

    fn game(hostable: bool) -> TopicValue {
        TopicValue::Game(GameView { hostable, reason: None, lan: None })
    }

    #[test]
    fn a_revision_counts_the_changes_of_one_topic() {
        let mut store = TopicStore::default();
        assert_eq!(store.set(game(true)), Some(Topic::Game));
        assert_eq!(store.set(game(true)), None, "ein gleicher Wert ändert nichts");
        assert_eq!(store.current(Topic::Game).unwrap().0, 1);
        assert_eq!(store.set(game(false)), Some(Topic::Game));
        assert_eq!(store.current(Topic::Game), Some((2, game(false))));
        assert_eq!(store.set(TopicValue::Invites(Vec::new())), Some(Topic::Invites));
        assert_eq!(store.current(Topic::Invites).unwrap().0, 1, "jedes Thema zählt für sich");
        assert_eq!(store.current(Topic::Me), None);
    }

    #[test]
    fn the_store_names_the_topics_that_have_a_value() {
        let mut store = TopicStore::default();
        store.set(game(true));
        store.set(TopicValue::Join(None));
        let mut valued = store.valued();
        valued.sort();
        assert_eq!(valued, [Topic::Join, Topic::Game]);
    }
}
