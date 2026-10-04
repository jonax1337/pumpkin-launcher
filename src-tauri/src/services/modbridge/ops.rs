//! Die Vorgänge der Mod (docs/friends/INGAME.md, 5.4): Name, Argumente, Ergebnis, Fehlercode, nötiger Geltungsbereich
//! und Zählklasse der Ratenbegrenzung (5.6). Die Freunde-IDs in den Argumenten sind auf dem Draht Aliasse der
//! Verbindung; erst [`Op::resolve_friends`] macht echte Peer-IDs daraus.
use std::time::Duration;

use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};

/// Wofür der Nutzer im Launcher einmal je Spielstart gefragt wird (INGAME 5.5).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Scope {
    /// Eine Welt mit ausgewählten Freunden teilen.
    Share,
    /// Freunde hinzufügen, Anfragen beantworten, Einladungen annehmen, Freundesliste ändern.
    Social,
}

/// Welche Seite des Launchers `launcher.open` zeigt.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum OpenTarget {
    Friends,
    Requests,
    Invites,
    Settings,
}

/// Ein Vorgang, den die Mod verlangt. `Serialize` dient nur den Tests und der Java-Gegenseite als Muster.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "op", content = "args", rename_all_fields = "camelCase")]
pub enum Op {
    #[serde(rename = "state.sync")]
    StateSync {},
    #[serde(rename = "launcher.open")]
    LauncherOpen { target: OpenTarget },
    #[serde(rename = "request.answer")]
    RequestAnswer { id: String, accept: bool },
    #[serde(rename = "request.cancel")]
    RequestCancel { id: String },
    #[serde(rename = "friend.addByName")]
    FriendAddByName { name: String },
    #[serde(rename = "invite.decline")]
    InviteDecline { id: String },
    #[serde(rename = "invite.plan")]
    InvitePlan { id: String },
    #[serde(rename = "invite.joinHere")]
    InviteJoinHere { id: String },
    #[serde(rename = "join.leave")]
    JoinLeave {},
    /// Die Mod meldet: das Verbinden des Spiels mit der Welt aus `invite.joinHere` ist gescheitert.
    #[serde(rename = "join.failed")]
    JoinFailed {},
    #[serde(rename = "host.invite")]
    HostInvite {
        friends: Vec<String>,
        #[serde(default)]
        show_world: bool,
    },
    #[serde(rename = "host.kick")]
    HostKick { friend: String },
    #[serde(rename = "host.stop")]
    HostStop {},
    #[serde(rename = "friend.addByCode")]
    FriendAddByCode { code: String },
    #[serde(rename = "code.create")]
    CodeCreate {},
    #[serde(rename = "code.revoke")]
    CodeRevoke { id: String },
    /// `alias: None` nimmt den eigenen Spitznamen wieder weg.
    #[serde(rename = "friend.rename")]
    FriendRename { friend: String, alias: Option<String> },
    #[serde(rename = "friend.remove")]
    FriendRemove { friend: String },
    #[serde(rename = "friend.block")]
    FriendBlock { friend: String },
    #[serde(rename = "blocked.unblock")]
    BlockedUnblock { id: String },
    #[serde(rename = "friend.acknowledge")]
    FriendAcknowledge { id: String },
    #[serde(rename = "friends.retry")]
    FriendsRetry {},
}

/// Die Namen aller Vorgänge von 5.4, in der Reihenfolge von [`Op`]; `Op::name` ist dazu die Gegenprobe.
pub const OP_NAMES: [&str; 22] = [
    "state.sync",
    "launcher.open",
    "request.answer",
    "request.cancel",
    "friend.addByName",
    "invite.decline",
    "invite.plan",
    "invite.joinHere",
    "join.leave",
    "join.failed",
    "host.invite",
    "host.kick",
    "host.stop",
    "friend.addByCode",
    "code.create",
    "code.revoke",
    "friend.rename",
    "friend.remove",
    "friend.block",
    "blocked.unblock",
    "friend.acknowledge",
    "friends.retry",
];

/// Die Freunde-ID aus den Argumenten ist keinem Alias dieser Verbindung zugeordnet.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct UnknownFriend;

impl Op {
    /// Liest einen Vorgang aus Name und Argumenten einer Anfrage; fehlende Argumente zählen als leeres Objekt.
    pub fn from_request(op: &str, args: Value) -> serde_json::Result<Self> {
        let args = if args.is_null() { Value::Object(Map::new()) } else { args };
        serde_json::from_value(serde_json::json!({ "op": op, "args": args }))
    }

    pub fn name(&self) -> &'static str {
        match self {
            Self::StateSync {} => "state.sync",
            Self::LauncherOpen { .. } => "launcher.open",
            Self::RequestAnswer { .. } => "request.answer",
            Self::RequestCancel { .. } => "request.cancel",
            Self::FriendAddByName { .. } => "friend.addByName",
            Self::InviteDecline { .. } => "invite.decline",
            Self::InvitePlan { .. } => "invite.plan",
            Self::InviteJoinHere { .. } => "invite.joinHere",
            Self::JoinLeave {} => "join.leave",
            Self::JoinFailed {} => "join.failed",
            Self::HostInvite { .. } => "host.invite",
            Self::HostKick { .. } => "host.kick",
            Self::HostStop {} => "host.stop",
            Self::FriendAddByCode { .. } => "friend.addByCode",
            Self::CodeCreate {} => "code.create",
            Self::CodeRevoke { .. } => "code.revoke",
            Self::FriendRename { .. } => "friend.rename",
            Self::FriendRemove { .. } => "friend.remove",
            Self::FriendBlock { .. } => "friend.block",
            Self::BlockedUnblock { .. } => "blocked.unblock",
            Self::FriendAcknowledge { .. } => "friend.acknowledge",
            Self::FriendsRetry {} => "friends.retry",
        }
    }

    /// Der Geltungsbereich, den der Vorgang braucht (Spalte „Scope“ in 5.4).
    pub fn scope(&self) -> Option<Scope> {
        match self {
            Self::HostInvite { .. } => Some(Scope::Share),
            Self::RequestAnswer { .. }
            | Self::FriendAddByName { .. }
            | Self::InviteJoinHere { .. }
            | Self::FriendAddByCode { .. }
            | Self::CodeCreate {}
            | Self::CodeRevoke { .. }
            | Self::FriendRename { .. }
            | Self::FriendRemove { .. }
            | Self::FriendBlock { .. }
            | Self::BlockedUnblock { .. }
            | Self::FriendAcknowledge { .. } => Some(Scope::Social),
            _ => None,
        }
    }

    /// Das Zählfenster des Vorgangs je Spielstart (5.6).
    pub fn rate_class(&self) -> RateClass {
        match self {
            Self::FriendAddByName { .. } => RateClass::AddByName,
            Self::RequestAnswer { .. } => RateClass::Answer,
            Self::HostInvite { .. } => RateClass::HostInvite,
            Self::LauncherOpen { .. } => RateClass::LauncherOpen,
            _ => RateClass::Other,
        }
    }

    /// Ersetzt die Aliasse der Freunde durch das, was `resolve` daraus macht (echte Peer-IDs).
    pub fn resolve_friends(self, resolve: impl Fn(&str) -> Option<String>) -> Result<Self, UnknownFriend> {
        let one = |alias: String| resolve(&alias).ok_or(UnknownFriend);
        Ok(match self {
            Self::HostInvite { friends, show_world } => {
                let friends = friends.into_iter().map(one).collect::<Result<_, _>>()?;
                Self::HostInvite { friends, show_world }
            }
            Self::HostKick { friend } => Self::HostKick { friend: one(friend)? },
            Self::FriendRename { friend, alias } => Self::FriendRename { friend: one(friend)?, alias },
            Self::FriendRemove { friend } => Self::FriendRemove { friend: one(friend)? },
            Self::FriendBlock { friend } => Self::FriendBlock { friend: one(friend)? },
            Self::BlockedUnblock { id } => Self::BlockedUnblock { id: one(id)? },
            Self::FriendAcknowledge { id } => Self::FriendAcknowledge { id: one(id)? },
            other => other,
        })
    }

    /// Liest das Ergebnis dieses Vorgangs aus seiner JSON-Form (für Tests und Fixtures).
    pub fn read_result(&self, value: Value) -> serde_json::Result<OpResult> {
        Ok(match self {
            Self::InvitePlan { .. } => OpResult::InvitePlan(serde_json::from_value(value)?),
            Self::InviteJoinHere { .. } => OpResult::JoinHere(serde_json::from_value(value)?),
            Self::CodeCreate {} => OpResult::CodeCreated(serde_json::from_value(value)?),
            _ => OpResult::Empty(serde_json::from_value(value)?),
        })
    }
}

/// Wie ein Vorgang gezählt wird (INGAME 5.6). Jede Klasse hat ihre Fenster je Spielstart.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum RateClass {
    /// 5 je Minute und 20 je Stunde.
    AddByName,
    /// 20 je Minute.
    Answer,
    /// 3 je Minute. Zählt erst nach der Zustimmung, und zwar der Bearbeiter (`OpContext::charge`), damit abgelehnte
    /// oder an Vorbedingungen gescheiterte Versuche kein Kontingent kosten.
    HostInvite,
    /// 1 je 10 Sekunden.
    LauncherOpen,
    /// 30 je Minute.
    Other,
}

impl RateClass {
    /// Ob die Brücke diese Klasse schon vor dem Bearbeiter zählt.
    pub fn counted_before_handling(self) -> bool {
        self != Self::HostInvite
    }
}

/// Die Fenster einer Klasse: Anzahl und Zeitspanne.
pub(super) fn windows_of(class: RateClass) -> &'static [(usize, Duration)] {
    const MINUTE: Duration = Duration::from_secs(60);
    const ADD_BY_NAME: &[(usize, Duration)] = &[(5, MINUTE), (20, Duration::from_secs(3600))];
    const ANSWER: &[(usize, Duration)] = &[(20, MINUTE)];
    const HOST_INVITE: &[(usize, Duration)] = &[(3, MINUTE)];
    const LAUNCHER_OPEN: &[(usize, Duration)] = &[(1, Duration::from_secs(10))];
    const OTHER: &[(usize, Duration)] = &[(30, MINUTE)];
    match class {
        RateClass::AddByName => ADD_BY_NAME,
        RateClass::Answer => ANSWER,
        RateClass::HostInvite => HOST_INVITE,
        RateClass::LauncherOpen => LAUNCHER_OPEN,
        RateClass::Other => OTHER,
    }
}

/// Was ein gelungener Vorgang zurückgibt. Die meisten antworten mit `{}`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(untagged)]
pub enum OpResult {
    Empty(Empty),
    InvitePlan(InvitePlan),
    JoinHere(JoinHere),
    CodeCreated(CodeCreated),
}

impl OpResult {
    pub fn empty() -> Self {
        Self::Empty(Empty {})
    }
}

/// Ein leeres JSON-Objekt.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Empty {}

/// So passt die Einladung zum laufenden Spiel (`invite.plan`, SPEC 5.6).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InvitePlan {
    pub verdict: PlanVerdict,
    /// Inhalte des Gastgebers, die dem laufenden Spiel fehlen.
    pub missing: u32,
    /// Inhalte des laufenden Spiels, die der Gastgeber nicht hat.
    pub extra: u32,
    /// Andere Instanzen, höchstens [`MAX_ALTERNATIVES`], passende zuerst.
    pub alternatives: Vec<PlanAlternative>,
}

pub const MAX_ALTERNATIVES: usize = 5;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum PlanVerdict {
    Ready,
    MissingContent,
    NoInstance,
    VersionUnsupported,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PlanAlternative {
    pub name: String,
    pub matches: bool,
}

/// Wohin das laufende Spiel für `invite.joinHere` verbindet: eine Loopback-Adresse (INGAME 7).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct JoinHere {
    pub host: String,
    pub port: u16,
}

/// Der Freundescode steht nur in der Antwort auf `code.create`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CodeCreated {
    pub id: String,
    pub code: String,
}

/// Fehlercodes der Antworten (INGAME 5.3, 5.4); die Mod übersetzt sie in Texte.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ErrorCode {
    NotEnabled,
    PeerOffline,
    GuestLimit,
    LanPortUnknown,
    PortNotGame,
    /// Abgelehnt im Launcher, oder die Rückfragen dieses Spielstarts sind aufgebraucht.
    Denied,
    VersionUnsupported,
    MsAccountRequired,
    /// Es läuft schon eine Rückfrage oder ein gleichartiger Vorgang, oder zu viele Anfragen sind offen.
    Busy,
    RateLimited,
    /// Den Vorgang gibt es, aber diese Ausgabe des Launchers bearbeitet ihn noch nicht.
    UnsupportedOp,
    /// Unbekannter Vorgang, falsche Argumente, doppelte oder ungültige Kennung.
    BadRequest,
    UnknownFriend,
    NotFound,
    NameUnknown,
    DirectoryUnavailable,
    Timeout,
    Internal,
    /// `invite.joinHere`: das laufende Spiel passt nicht zur Einladung (andere Instanz, Version oder Inhalte).
    InstanceMismatch,
    /// Der Vorgang ist für die Mod nicht erlaubt, auch nicht mit Zustimmung: `friend.acknowledge` für einen Hinweis, den nur
    /// der Nutzer im Launcher prüft (`identityChanged`, `addedInGame`).
    Forbidden,
}

/// Ein Fehler als Antwort: der Code und seine Parameter (etwa `min` bei `versionUnsupported`).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct OpError {
    pub code: ErrorCode,
    #[serde(default)]
    pub params: Map<String, Value>,
}

impl OpError {
    pub fn new(code: ErrorCode) -> Self {
        Self { code, params: Map::new() }
    }

    pub fn with_param(mut self, name: &str, value: impl Into<Value>) -> Self {
        self.params.insert(name.to_owned(), value.into());
        self
    }
}

impl From<ErrorCode> for OpError {
    fn from(code: ErrorCode) -> Self {
        Self::new(code)
    }
}

pub type OpOutcome = Result<OpResult, OpError>;

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn parse(op: &str, args: Value) -> Op {
        Op::from_request(op, args).unwrap()
    }

    #[test]
    fn every_op_name_is_listed_once_and_matches_its_variant() {
        let samples = [
            parse("state.sync", json!({})),
            parse("launcher.open", json!({"target": "friends"})),
            parse("request.answer", json!({"id": "r1", "accept": true})),
            parse("request.cancel", json!({"id": "r1"})),
            parse("friend.addByName", json!({"name": "Notch"})),
            parse("invite.decline", json!({"id": "i1"})),
            parse("invite.plan", json!({"id": "i1"})),
            parse("invite.joinHere", json!({"id": "i1"})),
            parse("join.leave", json!({})),
            parse("join.failed", json!({})),
            parse("host.invite", json!({"friends": ["f1"], "showWorld": true})),
            parse("host.kick", json!({"friend": "f1"})),
            parse("host.stop", json!({})),
            parse("friend.addByCode", json!({"code": "pumpkin-x"})),
            parse("code.create", json!({})),
            parse("code.revoke", json!({"id": "c1"})),
            parse("friend.rename", json!({"friend": "f1", "alias": null})),
            parse("friend.remove", json!({"friend": "f1"})),
            parse("friend.block", json!({"friend": "f1"})),
            parse("blocked.unblock", json!({"id": "f1"})),
            parse("friend.acknowledge", json!({"id": "f1"})),
            parse("friends.retry", json!({})),
        ];
        let names: Vec<&str> = samples.iter().map(Op::name).collect();
        assert_eq!(names, OP_NAMES);
    }

    #[test]
    fn missing_args_count_as_an_empty_object() {
        assert_eq!(parse("host.stop", Value::Null), Op::HostStop {});
    }

    #[test]
    fn host_invite_defaults_to_hiding_the_world_name() {
        assert_eq!(parse("host.invite", json!({"friends": ["f1"]})), Op::HostInvite { friends: vec!["f1".into()], show_world: false });
    }

    #[test]
    fn unknown_ops_and_wrong_args_do_not_parse() {
        for (op, args) in [
            ("host.explode", json!({})),
            ("host.kick", json!({})),
            ("host.kick", json!({"friend": 7})),
            ("launcher.open", json!({"target": "nowhere"})),
            ("request.answer", json!({"id": "r1"})),
        ] {
            assert!(Op::from_request(op, args.clone()).is_err(), "{op} {args}");
        }
    }

    #[test]
    fn unknown_argument_fields_are_ignored() {
        assert_eq!(parse("host.kick", json!({"friend": "f1", "extra": true})), Op::HostKick { friend: "f1".into() });
    }

    #[test]
    fn ops_serialize_as_name_and_camel_case_args() {
        let op = Op::HostInvite { friends: vec!["f1".into()], show_world: true };
        assert_eq!(serde_json::to_value(op).unwrap(), json!({"op": "host.invite", "args": {"friends": ["f1"], "showWorld": true}}));
    }

    #[test]
    fn the_scope_column_of_the_op_table_holds() {
        let share = ["host.invite"];
        let social = [
            "request.answer",
            "friend.addByName",
            "invite.joinHere",
            "friend.addByCode",
            "code.create",
            "code.revoke",
            "friend.rename",
            "friend.remove",
            "friend.block",
            "blocked.unblock",
            "friend.acknowledge",
        ];
        for name in OP_NAMES {
            let op = sample(name);
            let expected = if share.contains(&name) {
                Some(Scope::Share)
            } else if social.contains(&name) {
                Some(Scope::Social)
            } else {
                None
            };
            assert_eq!(op.scope(), expected, "{name}");
        }
    }

    /// Ein Vorgang mit Platzhalter-Argumenten, die jede Form von Argumenten erfüllen.
    fn sample(name: &str) -> Op {
        let args = json!({"target": "friends", "id": "x", "accept": true, "name": "x", "friends": ["x"], "friend": "x", "code": "x", "alias": null});
        Op::from_request(name, args).unwrap()
    }

    #[test]
    fn only_the_listed_ops_have_their_own_rate_class() {
        let classes: Vec<(&str, RateClass)> =
            OP_NAMES.iter().map(|name| (*name, sample(name).rate_class())).filter(|(_, class)| *class != RateClass::Other).collect();
        assert_eq!(
            classes,
            [
                ("launcher.open", RateClass::LauncherOpen),
                ("request.answer", RateClass::Answer),
                ("friend.addByName", RateClass::AddByName),
                ("host.invite", RateClass::HostInvite),
            ]
        );
    }

    #[test]
    fn aliases_are_replaced_by_real_ids_in_every_op_that_names_friends() {
        let real = |alias: &str| (alias != "f9").then(|| format!("peer-{alias}"));
        let invite = Op::HostInvite { friends: vec!["f1".into(), "f2".into()], show_world: false };
        assert_eq!(
            invite.resolve_friends(real),
            Ok(Op::HostInvite { friends: vec!["peer-f1".into(), "peer-f2".into()], show_world: false })
        );
        assert_eq!(Op::HostKick { friend: "f1".into() }.resolve_friends(real), Ok(Op::HostKick { friend: "peer-f1".into() }));
        assert_eq!(Op::BlockedUnblock { id: "f1".into() }.resolve_friends(real), Ok(Op::BlockedUnblock { id: "peer-f1".into() }));
        assert_eq!(Op::FriendAcknowledge { id: "f1".into() }.resolve_friends(real), Ok(Op::FriendAcknowledge { id: "peer-f1".into() }));
        assert_eq!(Op::HostKick { friend: "f9".into() }.resolve_friends(real), Err(UnknownFriend));
        let request = Op::RequestCancel { id: "r1".into() };
        assert_eq!(request.clone().resolve_friends(real), Ok(request), "Anfrage-IDs sind keine Freunde");
    }

    #[test]
    fn errors_carry_their_params_and_default_to_none() {
        let error = OpError::new(ErrorCode::VersionUnsupported).with_param("min", "1.20");
        assert_eq!(serde_json::to_value(&error).unwrap(), json!({"code": "versionUnsupported", "params": {"min": "1.20"}}));
        assert_eq!(serde_json::from_value::<OpError>(json!({"code": "busy"})).unwrap(), OpError::new(ErrorCode::Busy));
    }

    #[test]
    fn results_read_back_by_the_op_that_produced_them() {
        let plan = json!({"verdict": "missingContent", "missing": 2, "extra": 0, "alternatives": [{"name": "Welt", "matches": true}]});
        let read = Op::InvitePlan { id: "i1".into() }.read_result(plan.clone()).unwrap();
        assert_eq!(serde_json::to_value(read).unwrap(), plan);
        assert!(Op::HostStop {}.read_result(json!({"unexpected": 1})).is_err(), "ein leeres Ergebnis ist leer");
    }
}
