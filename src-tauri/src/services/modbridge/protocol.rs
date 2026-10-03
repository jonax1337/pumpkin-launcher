//! Nachrichten zwischen Launcher und Fabric-Mod: JSON-Zeilen, Format und Grenzen siehe docs/friends/SPEC.md, Abschnitt 7.
//!
//! Die Mod ist ein nicht vertrauenswürdiger Kanal: jede Zeile wird gegen diese Typen geprüft, Unbekanntes verworfen.
use serde::{Deserialize, Serialize};

pub const PROTOCOL_VERSION: u32 = 1;

/// Was die Mod an den Launcher schickt. Die Freunde-IDs von `Share` und `Kick` sind die Aliasse einer Verbindung.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase", rename_all_fields = "camelCase")]
pub enum ModToLauncher {
    Hello {
        protocols: Vec<u32>,
        token: String,
        #[serde(rename = "mod")]
        mod_version: String,
        minecraft: String,
    },
    LanOpened { port: u16 },
    LanClosed,
    Share { friend_ids: Vec<String> },
    StopSharing,
    Kick { friend_id: String },
    Ping,
}

/// Antwort auf `hello`; bei `Reject` schließt der Launcher die Verbindung danach.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase", rename_all_fields = "camelCase")]
pub enum Handshake {
    Welcome { protocol: u32, launcher: String },
    Reject { reason: RejectReason },
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum RejectReason {
    Token,
    Protocol,
    Duplicate,
}

/// Was der Launcher der Mod schickt. In `ModFriend` und `ModSession` stehen im Launcher echte Peer-IDs; die Brücke
/// ersetzt sie vor dem Senden durch die Aliasse der Verbindung.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase", rename_all_fields = "camelCase")]
pub enum LauncherToMod {
    Snapshot { friends: Vec<ModFriend>, session: Option<ModSession>, invites: Vec<ModInvite> },
    Notify { event: ModNotify, name: Option<String>, mc_uuid: Option<String> },
    Error { code: ModErrorCode, r#ref: Option<String> },
    Pong,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModFriend {
    pub id: String,
    pub name: String,
    pub mc_uuid: Option<String>,
    pub presence: ModPresence,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ModPresence {
    Offline,
    Online,
    Playing,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModSession {
    pub guests: Vec<ModGuest>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModGuest {
    pub id: String,
    pub name: String,
    pub state: ModGuestState,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ModGuestState {
    Invited,
    Connected,
}

/// Der Beitritt läuft im Launcher; die Mod zeigt eine Einladung nur an.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModInvite {
    pub id: String,
    pub from_name: String,
    pub title: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ModNotify {
    InviteReceived,
    GuestJoined,
    GuestLeft,
    SessionEnded,
    FriendOnline,
    ConfirmInLauncher,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ModErrorCode {
    NotEnabled,
    PeerOffline,
    GuestLimit,
    LanPortUnknown,
    PortNotGame,
    Denied,
    VersionUnsupported,
    Busy,
    Internal,
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn parse(text: &str) -> serde_json::Result<ModToLauncher> {
        serde_json::from_str(text)
    }

    #[test]
    fn mod_messages_have_the_documented_shape() {
        let hello = parse(r#"{"type":"hello","protocols":[1],"token":"t","mod":"0.1.0","minecraft":"26.3"}"#).unwrap();
        assert_eq!(hello, ModToLauncher::Hello { protocols: vec![1], token: "t".into(), mod_version: "0.1.0".into(), minecraft: "26.3".into() });
        assert_eq!(parse(r#"{"type":"lanOpened","port":50123}"#).unwrap(), ModToLauncher::LanOpened { port: 50123 });
        assert_eq!(parse(r#"{"type":"lanClosed"}"#).unwrap(), ModToLauncher::LanClosed);
        assert_eq!(parse(r#"{"type":"share","friendIds":["f1","f2"]}"#).unwrap(), ModToLauncher::Share { friend_ids: vec!["f1".into(), "f2".into()] });
        assert_eq!(parse(r#"{"type":"stopSharing"}"#).unwrap(), ModToLauncher::StopSharing);
        assert_eq!(parse(r#"{"type":"kick","friendId":"f1"}"#).unwrap(), ModToLauncher::Kick { friend_id: "f1".into() });
        assert_eq!(parse(r#"{"type":"ping","extra":true}"#).unwrap(), ModToLauncher::Ping, "unbekannte Felder werden ignoriert");
    }

    #[test]
    fn unknown_or_malformed_mod_messages_do_not_parse() {
        for text in [r#"{"type":"format"}"#, r#"{"type":"lanOpened"}"#, r#"{"type":"lanOpened","port":70000}"#, r#"{"port":1}"#, "[1]", "nonsense"] {
            assert!(parse(text).is_err(), "{text}");
        }
    }

    #[test]
    fn launcher_messages_have_the_documented_shape() {
        let snapshot = LauncherToMod::Snapshot {
            friends: vec![ModFriend { id: "f1".into(), name: "Alex".into(), mc_uuid: None, presence: ModPresence::Playing }],
            session: Some(ModSession { guests: vec![ModGuest { id: "f1".into(), name: "Alex".into(), state: ModGuestState::Invited }] }),
            invites: vec![ModInvite { id: "i1".into(), from_name: "Sam".into(), title: "Insel".into() }],
        };
        assert_eq!(
            serde_json::to_value(snapshot).unwrap(),
            json!({
                "type": "snapshot",
                "friends": [{"id": "f1", "name": "Alex", "mcUuid": null, "presence": "playing"}],
                "session": {"guests": [{"id": "f1", "name": "Alex", "state": "invited"}]},
                "invites": [{"id": "i1", "fromName": "Sam", "title": "Insel"}]
            })
        );
        let notify = LauncherToMod::Notify { event: ModNotify::ConfirmInLauncher, name: None, mc_uuid: Some("ab".into()) };
        assert_eq!(serde_json::to_value(notify).unwrap(), json!({"type": "notify", "event": "confirmInLauncher", "name": null, "mcUuid": "ab"}));
        let error = LauncherToMod::Error { code: ModErrorCode::LanPortUnknown, r#ref: None };
        assert_eq!(serde_json::to_value(error).unwrap(), json!({"type": "error", "code": "lanPortUnknown", "ref": null}));
        assert_eq!(serde_json::to_value(LauncherToMod::Pong).unwrap(), json!({"type": "pong"}));
    }

    #[test]
    fn handshake_replies_have_the_documented_shape() {
        let welcome = Handshake::Welcome { protocol: PROTOCOL_VERSION, launcher: "0.2.0".into() };
        assert_eq!(serde_json::to_value(welcome).unwrap(), json!({"type": "welcome", "protocol": 1, "launcher": "0.2.0"}));
        let reject = Handshake::Reject { reason: RejectReason::Duplicate };
        assert_eq!(serde_json::to_value(reject).unwrap(), json!({"type": "reject", "reason": "duplicate"}));
    }
}
