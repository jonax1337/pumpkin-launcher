//! Datensätze der Freunde (SPEC 9): je eine JSON-Datei unter `friends/`. Unlesbare Einträge einer neueren Version
//! bleiben beim Speichern erhalten (`JsonStore`). Laufende Zustände wie Präsenz, Sitzungen und Einladungen werden nicht gespeichert.
use std::path::Path;

use serde::{Deserialize, Serialize};

use super::contract::{FriendNotice, RequestDirection, RequestState, RequestVia};
use crate::coded;
use crate::error::{AppError, AppResult};
use crate::services::store::{Entity, JsonStore};

/// `Entity` für Datensätze mit dem Feld `id`; nur der Fehlercode „nicht gefunden“ unterscheidet sich.
macro_rules! record {
    ($($ty:ty => $not_found:literal),* $(,)?) => {$(
        impl Entity for $ty {
            fn id(&self) -> &str {
                &self.id
            }
            fn not_found(id: &str) -> AppError {
                AppError::NotFound(coded!($not_found, id = id).into())
            }
        }
    )*};
}

record!(
    FriendRecord => "errors.friends.notFound.friend",
    RequestRecord => "errors.friends.notFound.request",
    CodeRecord => "errors.friends.notFound.code",
    BlockedRecord => "errors.friends.notFound.blocked",
    OutboxRecord => "errors.friends.notFound.friend",
);

/// Ein Freund; `id` ist seine Peer-ID.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FriendRecord {
    pub id: String,
    pub display_name: String,
    pub alias: Option<String>,
    pub mc_name: Option<String>,
    pub mc_uuid: Option<String>,
    /// Index des Heimat-Relays in der eingebauten Relay-Liste, nie eine URL.
    pub home_relay: Option<u8>,
    pub added_at: u64,
    pub last_seen: Option<u64>,
    pub confirmed: bool,
    pub removed_by_peer: bool,
    pub notice: Option<FriendNotice>,
}

/// Eine Freundschaftsanfrage; eingehend oder ausgehend.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RequestRecord {
    pub id: String,
    pub direction: RequestDirection,
    pub state: RequestState,
    pub peer_id: Option<String>,
    /// Hello-ID des eingelösten Codes (nur ausgehend).
    pub hello_id: Option<String>,
    pub relay_index: Option<u8>,
    /// Geheimnis des eingelösten Codes als Hex, nur ausgehend und nur, um die Zustellung zu wiederholen.
    pub secret: Option<String>,
    pub display_name: Option<String>,
    pub mc_name: Option<String>,
    pub mc_uuid: Option<String>,
    pub code_tail: Option<String>,
    pub created_at: u64,
    pub expires_at: u64,
    #[serde(default)]
    pub via: RequestVia,
    /// ID des Briefs im Verzeichnis, nur bei Anfragen per Name.
    #[serde(default)]
    pub mail_id: Option<String>,
}

/// Ein selbst erzeugter Code; das Geheimnis liegt nur als Hash vor, der Klartext nur einmal in der Antwort von `friend_code_create`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CodeRecord {
    pub id: String,
    /// Salz, aus dem sich der Schlüssel des Hello-Endpunkts ableitet (hex).
    pub salt: String,
    pub secret_sha256: String,
    pub relay_index: u8,
    pub tail: String,
    pub created_at: u64,
    pub expires_at: u64,
    /// Peer-ID dessen, der den Code eingelöst hat.
    pub used_by: Option<String>,
    /// Minecraft-UUID des Empfängers; `Some` heißt: der Code gehört zu einer Anfrage per Name und zählt nicht zu den eigenen Codes.
    #[serde(default)]
    pub name_request_to: Option<String>,
}

/// Ein gesperrter Peer; `id` ist seine Peer-ID.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BlockedRecord {
    pub id: String,
    pub display_name: String,
    pub blocked_at: u64,
    /// Minecraft-UUID, wenn der Peer per Name angefragt hat; damit sperrt auch das Verzeichnis.
    #[serde(default)]
    pub mc_uuid: Option<String>,
}

/// Was einem Freund noch zugestellt werden muss, auch wenn der alte Schlüssel schon ausgemustert ist.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OutboxRecord {
    /// Peer-ID des Freundes (unter der alten Identität).
    pub id: String,
    pub kind: OutboxKind,
    pub new_peer_id: Option<String>,
    pub signature: Option<String>,
    /// Unix-Sekunden, ab denen der Eintrag verfällt.
    pub until: u64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum OutboxKind {
    Unfriend,
    Rotated,
}

/// Alle Datensatz-Dateien der Freunde.
pub struct RecordStores {
    pub friends: JsonStore<FriendRecord>,
    pub requests: JsonStore<RequestRecord>,
    pub codes: JsonStore<CodeRecord>,
    pub blocked: JsonStore<BlockedRecord>,
    pub outbox: JsonStore<OutboxRecord>,
}

impl RecordStores {
    pub fn open(dir: &Path) -> AppResult<Self> {
        std::fs::create_dir_all(dir)?;
        Ok(Self {
            friends: JsonStore::open(dir.join("friends.json"))?,
            requests: JsonStore::open(dir.join("requests.json"))?,
            codes: JsonStore::open(dir.join("codes.json"))?,
            blocked: JsonStore::open(dir.join("blocked.json"))?,
            outbox: JsonStore::open(dir.join("outbox.json"))?,
        })
    }

    /// Gibt es irgendeinen Datensatz? Dann darf die Identität nicht stillschweigend neu entstehen (SPEC 4.1).
    pub fn any(&self) -> bool {
        !(self.friends.list().is_empty()
            && self.requests.list().is_empty()
            && self.codes.list().is_empty()
            && self.blocked.list().is_empty()
            && self.outbox.list().is_empty())
    }
}

#[cfg(test)]
mod tests {
    use serde_json::{json, Value};

    use super::*;
    use crate::services::friends::test_support::{error_key, TempDir};

    fn friend(id: &str) -> FriendRecord {
        FriendRecord {
            id: id.into(),
            display_name: "Alex".into(),
            alias: None,
            mc_name: Some("Alex".into()),
            mc_uuid: None,
            home_relay: Some(0),
            added_at: 1_789_136_000,
            last_seen: None,
            confirmed: false,
            removed_by_peer: false,
            notice: Some(FriendNotice::Renamed { previous_name: "Alexander".into() }),
        }
    }

    fn blocked(id: &str) -> BlockedRecord {
        BlockedRecord { id: id.into(), display_name: "Eli".into(), blocked_at: 1_789_913_600, mc_uuid: None }
    }

    #[test]
    fn records_round_trip_through_their_files() {
        let dir = TempDir::new();
        let stores = RecordStores::open(dir.path()).unwrap();
        stores.friends.insert(friend("a")).unwrap();
        stores.blocked.insert(blocked("b")).unwrap();
        let reopened = RecordStores::open(dir.path()).unwrap();
        assert_eq!(reopened.friends.get("a").unwrap(), friend("a"));
        assert_eq!(reopened.blocked.get("b").unwrap(), blocked("b"));
    }

    #[test]
    fn friend_file_uses_camel_case_keys() {
        let dir = TempDir::new();
        RecordStores::open(dir.path()).unwrap().friends.insert(friend("a")).unwrap();
        let written: Vec<Value> = serde_json::from_slice(&std::fs::read(dir.path().join("friends.json")).unwrap()).unwrap();
        assert_eq!(written[0]["displayName"], "Alex");
        assert_eq!(written[0]["homeRelay"], 0);
        assert_eq!(written[0]["notice"], json!({ "type": "renamed", "previousName": "Alexander" }));
    }

    #[test]
    fn optional_fields_may_be_missing_in_the_file() {
        let minimal = json!({ "id": "a", "displayName": "Alex", "addedAt": 1, "confirmed": true, "removedByPeer": false });
        let record: FriendRecord = serde_json::from_value(minimal).unwrap();
        assert_eq!((record.alias, record.home_relay, record.notice), (None, None, None));
    }

    #[test]
    fn unknown_ids_give_the_not_found_code_of_their_kind() {
        let dir = TempDir::new();
        let stores = RecordStores::open(dir.path()).unwrap();
        let keys = [
            error_key(&stores.friends.get("x").unwrap_err()),
            error_key(&stores.requests.get("x").unwrap_err()),
            error_key(&stores.codes.get("x").unwrap_err()),
            error_key(&stores.blocked.get("x").unwrap_err()),
        ];
        let expected = ["friend", "request", "code", "blocked"].map(|kind| format!("errors.friends.notFound.{kind}"));
        assert_eq!(keys, expected);
        assert!(matches!(stores.outbox.get("x"), Err(AppError::NotFound(_))));
    }

    #[test]
    fn entries_of_a_newer_version_survive_a_save() {
        let dir = TempDir::new();
        let future = json!({ "id": "z", "zukunft": true });
        let known = serde_json::to_value(friend("a")).unwrap();
        std::fs::write(dir.path().join("friends.json"), serde_json::to_vec(&[known, future.clone()]).unwrap()).unwrap();

        let stores = RecordStores::open(dir.path()).unwrap();
        assert_eq!(stores.friends.list().len(), 1);
        stores.friends.modify("a", |f| f.confirmed = true).unwrap();

        let saved: Vec<Value> = serde_json::from_slice(&std::fs::read(dir.path().join("friends.json")).unwrap()).unwrap();
        assert_eq!(saved[1], future);
        assert_eq!(saved[0]["confirmed"], true);
    }

    #[test]
    fn any_is_true_as_soon_as_one_store_has_a_record() {
        let dir = TempDir::new();
        let stores = RecordStores::open(dir.path()).unwrap();
        assert!(!stores.any());
        stores.blocked.insert(blocked("b")).unwrap();
        assert!(stores.any());
    }

    #[test]
    fn request_and_outbox_enums_use_plain_camel_case_strings() {
        let request = RequestRecord {
            id: "r".into(),
            direction: RequestDirection::Outgoing,
            state: RequestState::AwaitingAnswer,
            peer_id: None,
            hello_id: None,
            relay_index: None,
            secret: None,
            display_name: None,
            mc_name: None,
            mc_uuid: None,
            code_tail: None,
            created_at: 1,
            expires_at: 2,
            via: RequestVia::Name,
            mail_id: Some("m".into()),
        };
        let value = serde_json::to_value(&request).unwrap();
        assert_eq!((&value["direction"], &value["state"]), (&json!("outgoing"), &json!("awaitingAnswer")));
        assert_eq!((&value["via"], &value["mailId"]), (&json!("name"), &json!("m")));
        assert_eq!(serde_json::to_value(OutboxKind::Rotated).unwrap(), json!("rotated"));
        assert_eq!(serde_json::to_value(OutboxKind::Unfriend).unwrap(), json!("unfriend"));
    }

    #[test]
    fn records_from_before_the_name_search_still_load() {
        let request = json!({ "id": "r", "direction": "incoming", "state": "pending", "peerId": null, "helloId": null,
            "relayIndex": null, "secret": null, "displayName": null, "mcName": null, "mcUuid": null, "codeTail": "abcd",
            "createdAt": 1, "expiresAt": 2 });
        let request: RequestRecord = serde_json::from_value(request).unwrap();
        assert_eq!((request.via, request.mail_id), (RequestVia::Code, None));

        let code = json!({ "id": "c", "salt": "00", "secretSha256": "00", "relayIndex": 0, "tail": "abcd",
            "createdAt": 1, "expiresAt": 2, "usedBy": null });
        assert_eq!(serde_json::from_value::<CodeRecord>(code).unwrap().name_request_to, None);

        let blocked = json!({ "id": "b", "displayName": "Eli", "blockedAt": 1 });
        assert_eq!(serde_json::from_value::<BlockedRecord>(blocked).unwrap().mc_uuid, None);
    }

    #[test]
    fn name_request_fields_survive_their_file() {
        let dir = TempDir::new();
        let code = CodeRecord {
            id: "c".into(),
            salt: "00".into(),
            secret_sha256: "00".into(),
            relay_index: 0,
            tail: "abcd".into(),
            created_at: 1,
            expires_at: 2,
            used_by: None,
            name_request_to: Some("069a79f444e94726a5befca90e38aaf5".into()),
        };
        RecordStores::open(dir.path()).unwrap().codes.insert(code.clone()).unwrap();
        assert_eq!(RecordStores::open(dir.path()).unwrap().codes.get("c").unwrap(), code);
    }
}
