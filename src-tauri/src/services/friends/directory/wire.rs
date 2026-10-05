//! Die JSON-Formen der Worker-API (BYNAME 4). Felder camelCase wie auf dem Draht; Ids und Hashes sind Hex in Kleinbuchstaben.
use std::fmt;

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Challenge {
    pub challenge: String,
    /// 40 hex digits, the per-challenge nonce both login signatures cover.
    pub server_id: String,
    pub expires_at: u64,
}

/// The login body of BYNAME-ATTEST 1.2: Mojang's certificate and two signatures over the same login parts.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionRequest {
    pub challenge: String,
    /// The account, 32 hex digits; the one Mojang signed in the certificate.
    pub uuid: String,
    pub certificate: CertificateProof,
    /// RSASSA-PKCS1-v1_5 / SHA-256 with the certificate key (layout L2), standard base64.
    pub cert_signature: String,
    /// Ed25519 with the friends key (layout L1), 128 hex digits.
    pub signature: String,
}

/// The public part of Mojang's player certificate, standard base64 with padding.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CertificateProof {
    /// SPKI DER.
    pub public_key: String,
    /// Epoch milliseconds, as Mojang signed them.
    pub expires_at: i64,
    pub mojang_signature: String,
}

/// Die Antwort auf die Anmeldung; das Token steht in keiner Debug-Ausgabe.
#[derive(Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DirectorySession {
    pub token: String,
    pub expires_at: u64,
    /// Proven by Mojang's certificate, 32 hex digits.
    pub uuid: String,
}

impl fmt::Debug for DirectorySession {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("DirectorySession")
            .field("token", &"<verborgen>")
            .field("expires_at", &self.expires_at)
            .field("uuid", &self.uuid)
            .finish()
    }
}

/// Ein Brief, wie der Absender ihn einliefert; alle Felder sind signiert (`proof::letter_parts`), `signature` ist die Signatur.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OutgoingLetter {
    pub to: String,
    pub nonce: String,
    pub hello_id: String,
    pub relay_index: u8,
    pub secret: String,
    pub display_name: String,
    pub created_at: u64,
    pub signature: String,
}

/// Quittung des Verzeichnisses für einen eingelieferten Brief.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SentLetter {
    pub id: String,
    pub expires_at: u64,
}

/// The directory's stamp: who posted the letter according to the token. It carries no name; the recipient looks
/// that up at Mojang (BYNAME-ATTEST 4.3).
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LetterFrom {
    pub uuid: String,
    pub peer_id: String,
}

/// Ein Brief im Postfach des Empfängers; was nicht in der Signatur steht (`from`, `id`, `expires_at`), ist ungeprüft.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InboxLetter {
    pub id: String,
    pub from: LetterFrom,
    pub to: String,
    pub nonce: String,
    pub hello_id: String,
    pub relay_index: u8,
    pub secret: String,
    pub display_name: String,
    pub created_at: u64,
    pub expires_at: u64,
    pub signature: String,
}

#[derive(Debug, Deserialize)]
pub(super) struct Inbox {
    pub letters: Vec<InboxLetter>,
}

#[derive(Debug, Deserialize)]
pub(super) struct ErrorBody {
    pub error: String,
}

#[cfg(test)]
mod tests {
    use serde_json::{json, Value};

    use super::*;

    const UUID_RECIPIENT: &str = "069a79f444e94726a5befca90e38aaf5";
    const UUID_SENDER: &str = "853c80ef3c3749fdaa49938b674adae6";
    const PEER_ID: &str = "2543b92ff1095511476adc8369db6ddc933665a11978dda1404ee1066ca9559d";
    const HELLO_ID: &str = "202122232425262728292a2b2c2d2e2f303132333435363738393a3b3c3d3e3f";
    const SIGNATURE: &str = "da54bc072f53090eff8de51d3bed6931509fa27d41e4e0cc9d8e80930eba82ce2354b99e3afadbfcb8e61d5ee3aa3a8aebb6b95ce20d4638111f9f5a09ae3c03";

    fn letter_json() -> Value {
        json!({
            "to": UUID_RECIPIENT, "nonce": "000102030405060708090a0b0c0d0e0f", "helloId": HELLO_ID, "relayIndex": 0,
            "secret": "a0a1a2a3a4a5a6a7a8", "displayName": "Alex", "createdAt": 1_790_000_000u64, "signature": SIGNATURE,
        })
    }

    fn inbox_letter_json() -> Value {
        let mut letter = letter_json();
        letter["id"] = json!("7c9e6679-7425-40de-944b-e07fc1f90ae7");
        letter["from"] = json!({ "uuid": UUID_SENDER, "peerId": PEER_ID });
        letter["expiresAt"] = json!(1_791_209_600u64);
        letter
    }

    #[test]
    fn an_outgoing_letter_has_exactly_the_fields_of_the_worker_example() {
        let letter = OutgoingLetter {
            to: UUID_RECIPIENT.into(),
            nonce: "000102030405060708090a0b0c0d0e0f".into(),
            hello_id: HELLO_ID.into(),
            relay_index: 0,
            secret: "a0a1a2a3a4a5a6a7a8".into(),
            display_name: "Alex".into(),
            created_at: 1_790_000_000,
            signature: SIGNATURE.into(),
        };
        assert_eq!(serde_json::to_value(letter).unwrap(), letter_json());
    }

    #[test]
    fn an_inbox_letter_reads_the_worker_example_with_its_stamp() {
        let letter: InboxLetter = serde_json::from_value(inbox_letter_json()).unwrap();
        assert_eq!(letter.id, "7c9e6679-7425-40de-944b-e07fc1f90ae7");
        assert_eq!(
            letter.from,
            LetterFrom {
                uuid: UUID_SENDER.into(),
                peer_id: PEER_ID.into()
            }
        );
        assert_eq!(
            (
                letter.to.as_str(),
                letter.hello_id.as_str(),
                letter.relay_index
            ),
            (UUID_RECIPIENT, HELLO_ID, 0)
        );
        assert_eq!(
            (
                letter.created_at,
                letter.expires_at,
                letter.signature.as_str()
            ),
            (1_790_000_000, 1_791_209_600, SIGNATURE)
        );
    }

    #[test]
    fn an_inbox_is_a_list_of_letters() {
        let inbox: Inbox =
            serde_json::from_value(json!({ "letters": [inbox_letter_json()] })).unwrap();
        assert_eq!(inbox.letters.len(), 1);
    }

    #[test]
    fn a_challenge_reads_the_worker_answer() {
        let body = json!({ "challenge": "abc.def", "serverId": "0123456789abcdef0123456789abcdef01234567", "expiresAt": 1_790_000_120u64 });
        let challenge: Challenge = serde_json::from_value(body).unwrap();
        assert_eq!(
            challenge,
            Challenge {
                challenge: "abc.def".into(),
                server_id: "0123456789abcdef0123456789abcdef01234567".into(),
                expires_at: 1_790_000_120
            }
        );
    }

    #[test]
    fn a_session_request_has_exactly_the_keys_of_the_login_body() {
        let certificate = CertificateProof {
            public_key: "MIIB".into(),
            expires_at: 1_790_172_800_123,
            mojang_signature: "c2ln".into(),
        };
        let request = SessionRequest {
            challenge: "abc.def".into(),
            uuid: UUID_RECIPIENT.into(),
            certificate,
            cert_signature: "Y2VydA==".into(),
            signature: SIGNATURE.into(),
        };
        let expected = json!({
            "challenge": "abc.def",
            "uuid": UUID_RECIPIENT,
            "certificate": { "publicKey": "MIIB", "expiresAt": 1_790_172_800_123i64, "mojangSignature": "c2ln" },
            "certSignature": "Y2VydA==",
            "signature": SIGNATURE,
        });
        assert_eq!(serde_json::to_value(request).unwrap(), expected);
    }

    #[test]
    fn a_session_reads_the_token_with_its_expiry_and_account_and_no_name() {
        let body =
            json!({ "token": "v2.x.y", "expiresAt": 1_790_021_600u64, "uuid": UUID_RECIPIENT });
        let session: DirectorySession = serde_json::from_value(body).unwrap();
        assert_eq!(
            (
                session.token.as_str(),
                session.expires_at,
                session.uuid.as_str()
            ),
            ("v2.x.y", 1_790_021_600, UUID_RECIPIENT)
        );
    }

    #[test]
    fn the_token_never_shows_in_debug_output() {
        let session = DirectorySession {
            token: "v2.geheim.mac".into(),
            expires_at: 1,
            uuid: UUID_RECIPIENT.into(),
        };
        let shown = format!("{session:?}");
        assert!(!shown.contains("geheim"), "{shown}");
        assert!(shown.contains(UUID_RECIPIENT));
    }

    #[test]
    fn a_sent_letter_reads_id_and_expiry() {
        let sent: SentLetter = serde_json::from_value(
            json!({ "id": "7c9e6679-7425-40de-944b-e07fc1f90ae7", "expiresAt": 5 }),
        )
        .unwrap();
        assert_eq!(
            sent,
            SentLetter {
                id: "7c9e6679-7425-40de-944b-e07fc1f90ae7".into(),
                expires_at: 5
            }
        );
    }

    #[test]
    fn an_error_body_reads_the_machine_code() {
        let body: ErrorBody = serde_json::from_str(r#"{"error":"notFindable"}"#).unwrap();
        assert_eq!(body.error, "notFindable");
    }

    #[test]
    fn a_letter_with_a_missing_field_is_refused() {
        let mut letter = inbox_letter_json();
        letter.as_object_mut().unwrap().remove("secret");
        assert!(serde_json::from_value::<InboxLetter>(letter).is_err());
    }

    #[test]
    fn a_relay_index_beyond_a_byte_is_refused() {
        let mut letter = inbox_letter_json();
        letter["relayIndex"] = json!(256);
        assert!(serde_json::from_value::<InboxLetter>(letter).is_err());
    }
}
