//! Nachrichten zwischen Launcher und Mod, Protokoll 2: JSON-Zeilen, Format und Grenzen siehe docs/friends/INGAME.md,
//! Abschnitt 5.3. Die Beispielzeilen stehen in `mod/fixtures/protocol/*.jsonl`; sie sind das gemeinsame Muster der
//! Rust- und der Java-Tests.
//!
//! Die Mod ist ein nicht vertrauenswürdiger Kanal: jede Zeile wird gegen diese Typen geprüft, Unbekanntes verworfen.
use serde::{Deserialize, Serialize};
use serde_json::Value;

use super::ops::{OpError, OpResult, Scope};
use super::topics::{Topic, TopicValue};

pub const PROTOCOL_VERSION: u32 = 2;

/// Die Kennung einer Anfrage: 1 bis 12 Zeichen aus `a-z0-9`.
pub fn is_valid_request_id(id: &str) -> bool {
    (1..=12).contains(&id.len()) && id.bytes().all(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit())
}

/// Was die Mod an den Launcher schickt.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase", rename_all_fields = "camelCase")]
pub enum ModFrame {
    Hello(Hello),
    /// Ein Vorgang; `args` gehört zu `op` und wird erst mit `Op::from_request` gelesen.
    Req {
        id: String,
        op: String,
        #[serde(default)]
        args: Value,
    },
    /// Nur ein Hinweis; der Launcher prüft den Port gegen den Spielprozess erneut.
    LanOpened { port: u16 },
    LanClosed,
    /// Diagnose für den Smoke-Test und die Instanzzeile: die Bildschirme, die die Mod anbietet.
    Ready { screens: Vec<String> },
    Ping,
    Pong,
}

/// Die Anmeldung. `game` ist Diagnose: der Launcher kennt die Wahrheit und meldet nur Abweichungen im Log.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Hello {
    pub protocol: u32,
    pub token: String,
    #[serde(rename = "mod")]
    pub mod_info: ModInfo,
    pub game: GameInfo,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModInfo {
    pub version: String,
    /// Der Anfang des SHA-256 der Mod-Datei in Hexschreibweise (kleingeschrieben).
    pub build: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GameInfo {
    pub minecraft: String,
    pub loader: String,
    pub loader_version: String,
    pub java: u32,
}

/// Was der Launcher der Mod schickt.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase", rename_all_fields = "camelCase")]
pub enum LauncherFrame {
    Welcome { protocol: u32, launcher: String, scopes: Scopes },
    /// Der Launcher schließt die Verbindung danach.
    Reject { reason: RejectReason },
    Res(Response),
    /// Ein Dialog im Launcher ist offen; die endgültige Antwort folgt innerhalb von `REQUEST_DEADLINE`.
    Pending { id: String, prompt: Prompt, scope: Scope },
    /// Der ganze Wert eines Themas; die Mod ersetzt ihre Kopie.
    State { topic: Topic, rev: u64, value: Value },
    Event(Event),
    Ping,
    Pong,
}

impl LauncherFrame {
    pub fn state(topic: Topic, rev: u64, value: &TopicValue) -> Self {
        Self::State { topic, rev, value: value.to_json() }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Prompt {
    Scope,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum RejectReason {
    /// Der Token gehört zu keinem laufenden Spiel.
    Token,
    Protocol,
    /// Die Verbindung kommt nicht vom Spielprozess, den der Launcher gestartet hat.
    Owner,
    /// Eine andere Mod-Datei als die eingebaute hat sich gemeldet.
    Build,
    /// Zu diesem Spielstart besteht schon eine Verbindung.
    Duplicate,
    /// Der Spielprozess ist dem Launcher noch nicht bekannt; die Mod versucht es gleich noch einmal.
    Retry,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Scopes {
    pub share: ScopeState,
    pub social: ScopeState,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ScopeState {
    /// Der Launcher fragt beim ersten Vorgang dieser Art.
    Ask,
    Allow,
}

/// Die Antwort auf eine Anfrage: entweder `result` oder `error`, nie beides.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Response {
    pub id: String,
    pub ok: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub result: Option<Value>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub error: Option<OpError>,
}

impl Response {
    pub fn from_outcome(id: &str, outcome: Result<OpResult, OpError>) -> Self {
        match outcome {
            Ok(result) => Self::success(id, result),
            Err(error) => Self::failure(id, error),
        }
    }

    pub fn success(id: &str, result: OpResult) -> Self {
        let result = serde_json::to_value(result).unwrap_or(Value::Null);
        Self { id: id.to_owned(), ok: true, result: Some(result), error: None }
    }

    pub fn failure(id: &str, error: impl Into<OpError>) -> Self {
        Self { id: id.to_owned(), ok: false, result: None, error: Some(error.into()) }
    }
}

/// Hinweise des Launchers, die nicht zu einem Thema gehören.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "event", rename_all = "camelCase", rename_all_fields = "camelCase")]
pub enum Event {
    /// Ein Toast in der Mod; `name` ist die Person, um die es geht.
    Notify {
        kind: ModNotify,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        name: Option<String>,
    },
    /// Der Launcher trennt gleich.
    Closing { reason: ClosingReason },
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ClosingReason {
    /// Das Spiel ist beendet.
    LaunchEnded,
    BridgeStopped,
    /// Ein neuer Start der Instanz hat den Token abgelöst.
    Replaced,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ModNotify {
    RequestReceived,
    InviteReceived,
    FriendOnline,
    GuestJoined,
    GuestLeft,
    SessionEnded,
    JoinEnded,
    ScopeDenied,
}

/// Ein Freund in der Mod. Im Launcher steht in `id` die echte Peer-ID; die Verbindung ersetzt sie vor dem Senden durch
/// ihren Alias.
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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::services::modbridge::ops::ErrorCode;
    use serde_json::json;

    fn parse(text: &str) -> serde_json::Result<ModFrame> {
        serde_json::from_str(text)
    }

    #[test]
    fn request_ids_are_one_to_twelve_lowercase_alphanumerics() {
        for id in ["a", "a1", "abcdefghij12", "0"] {
            assert!(is_valid_request_id(id), "{id}");
        }
        for id in ["", "A1", "a-1", "abcdefghij123", "ä", "a b"] {
            assert!(!is_valid_request_id(id), "{id:?}");
        }
    }

    #[test]
    fn mod_frames_have_the_documented_shape() {
        let hello = r#"{"type":"hello","protocol":2,"token":"t","mod":{"version":"2.1.0","build":"ab12cd34"},"game":{"minecraft":"1.21.1","loader":"neoforge","loaderVersion":"21.1.172","java":21}}"#;
        let expected = Hello {
            protocol: 2,
            token: "t".into(),
            mod_info: ModInfo { version: "2.1.0".into(), build: "ab12cd34".into() },
            game: GameInfo { minecraft: "1.21.1".into(), loader: "neoforge".into(), loader_version: "21.1.172".into(), java: 21 },
        };
        assert_eq!(parse(hello).unwrap(), ModFrame::Hello(expected));
        assert_eq!(parse(r#"{"type":"lanOpened","port":50123}"#).unwrap(), ModFrame::LanOpened { port: 50123 });
        assert_eq!(parse(r#"{"type":"lanClosed"}"#).unwrap(), ModFrame::LanClosed);
        assert_eq!(parse(r#"{"type":"ready","screens":["hub"]}"#).unwrap(), ModFrame::Ready { screens: vec!["hub".into()] });
        assert_eq!(parse(r#"{"type":"ping","extra":true}"#).unwrap(), ModFrame::Ping, "unbekannte Felder werden ignoriert");
        assert_eq!(parse(r#"{"type":"pong"}"#).unwrap(), ModFrame::Pong);
        let request = parse(r#"{"type":"req","id":"a1","op":"host.stop"}"#).unwrap();
        assert_eq!(request, ModFrame::Req { id: "a1".into(), op: "host.stop".into(), args: Value::Null });
    }

    #[test]
    fn unknown_or_malformed_mod_frames_do_not_parse() {
        for text in [
            r#"{"type":"format"}"#,
            r#"{"type":"lanOpened"}"#,
            r#"{"type":"lanOpened","port":70000}"#,
            r#"{"type":"req","id":"a1"}"#,
            r#"{"type":"hello","protocols":[1],"token":"t","mod":"0.1.0","minecraft":"26.3"}"#,
            r#"{"port":1}"#,
            "[1]",
            "nonsense",
        ] {
            assert!(parse(text).is_err(), "{text}");
        }
    }

    #[test]
    fn handshake_answers_have_the_documented_shape() {
        let welcome = LauncherFrame::Welcome {
            protocol: PROTOCOL_VERSION,
            launcher: "2.1.0".into(),
            scopes: Scopes { share: ScopeState::Ask, social: ScopeState::Allow },
        };
        assert_eq!(
            serde_json::to_value(welcome).unwrap(),
            json!({"type": "welcome", "protocol": 2, "launcher": "2.1.0", "scopes": {"share": "ask", "social": "allow"}})
        );
        let reject = LauncherFrame::Reject { reason: RejectReason::Retry };
        assert_eq!(serde_json::to_value(reject).unwrap(), json!({"type": "reject", "reason": "retry"}));
    }

    #[test]
    fn responses_carry_a_result_or_an_error_never_both() {
        let ok = LauncherFrame::Res(Response::success("a1", OpResult::empty()));
        assert_eq!(serde_json::to_value(ok).unwrap(), json!({"type": "res", "id": "a1", "ok": true, "result": {}}));
        let failed = LauncherFrame::Res(Response::failure("a1", ErrorCode::NameUnknown));
        assert_eq!(
            serde_json::to_value(failed).unwrap(),
            json!({"type": "res", "id": "a1", "ok": false, "error": {"code": "nameUnknown", "params": {}}})
        );
    }

    #[test]
    fn pending_events_and_state_have_the_documented_shape() {
        let pending = LauncherFrame::Pending { id: "a1".into(), prompt: Prompt::Scope, scope: Scope::Social };
        assert_eq!(serde_json::to_value(pending).unwrap(), json!({"type": "pending", "id": "a1", "prompt": "scope", "scope": "social"}));
        let notify = LauncherFrame::Event(Event::Notify { kind: ModNotify::FriendOnline, name: Some("Alex".into()) });
        assert_eq!(serde_json::to_value(notify).unwrap(), json!({"type": "event", "event": "notify", "kind": "friendOnline", "name": "Alex"}));
        let closing = LauncherFrame::Event(Event::Closing { reason: ClosingReason::LaunchEnded });
        assert_eq!(serde_json::to_value(closing).unwrap(), json!({"type": "event", "event": "closing", "reason": "launchEnded"}));
        let state = LauncherFrame::state(Topic::Invites, 3, &TopicValue::Invites(Vec::new()));
        assert_eq!(serde_json::to_value(state).unwrap(), json!({"type": "state", "topic": "invites", "rev": 3, "value": []}));
    }

    #[test]
    fn launcher_frames_read_back_what_they_wrote() {
        let frames = [
            LauncherFrame::Ping,
            LauncherFrame::Pong,
            LauncherFrame::Event(Event::Notify { kind: ModNotify::ScopeDenied, name: None }),
            LauncherFrame::Event(Event::Closing { reason: ClosingReason::Replaced }),
            LauncherFrame::Res(Response::failure("x", ErrorCode::Busy)),
        ];
        for frame in frames {
            let text = serde_json::to_string(&frame).unwrap();
            assert_eq!(serde_json::from_str::<LauncherFrame>(&text).unwrap(), frame, "{text}");
        }
    }
}
