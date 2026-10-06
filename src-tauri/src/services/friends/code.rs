//! Freundescode (SPEC 4.2): `pumpkin-` plus 72 Base32-Zeichen für Version, Relay-Index, Hello-ID, Geheimnis und
//! Prüfsumme. Die dauerhafte Peer-ID steht nicht im Code. Das TypeScript-Gegenstück prüft nur die Form (`friendCode.ts`).
use std::io;

use data_encoding::{BASE32_NOPAD, HEXLOWER};
use sha2::{Digest, Sha256};

use super::contract::{FRIEND_CODE_BODY_LENGTH, FRIEND_CODE_PREFIX};
use super::identity::Identity;
use crate::coded;
use crate::error::{AppError, AppResult};

const VERSION: u8 = 0x02;
const SECRET_LEN: usize = 9;
const CHECK_LEN: usize = 2;
const BODY_LEN: usize = 1 + 1 + 32 + SECRET_LEN;
const TAIL_LEN: usize = 4;

/// Inhalt eines Freundescodes.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CodeParts {
    pub relay_index: u8,
    pub hello_id: [u8; 32],
    pub secret: [u8; SECRET_LEN],
}

/// Ein frisch erzeugter Code samt dem Salz, aus dem sich der Schlüssel seines Hello-Endpunkts ableiten lässt.
#[derive(Debug, Clone)]
pub struct IssuedCode {
    pub salt: [u8; 16],
    pub parts: CodeParts,
}

/// Erzeugt einen neuen Code für das Relay mit dem Index `relay_index`.
pub fn issue(identity: &Identity, relay_index: u8) -> AppResult<IssuedCode> {
    let salt = random_bytes()?;
    let parts = CodeParts {
        relay_index,
        hello_id: identity.hello_id(&salt),
        secret: random_bytes()?,
    };
    Ok(IssuedCode { salt, parts })
}

/// Liest einen eingegebenen Code: Groß-/Kleinschreibung, Leerzeichen und `-` im Hauptteil sind egal.
pub fn parse(input: &str) -> AppResult<CodeParts> {
    let payload = normalized_body(input)
        .and_then(|body| BASE32_NOPAD.decode(body.to_uppercase().as_bytes()).ok());
    payload
        .and_then(|payload| CodeParts::from_payload(&payload))
        .ok_or_else(invalid)
}

/// Ob der Klartext-Hash `secret_digest` zum Geheimnis `secret_hex` (18 Hex-Zeichen aus der Anfrage) gehört.
pub fn secret_matches(secret_digest: &str, secret_hex: &str) -> bool {
    let Ok(secret) = HEXLOWER.decode(secret_hex.as_bytes()) else {
        return false;
    };
    secret.len() == SECRET_LEN && digest_of(&secret) == secret_digest
}

impl CodeParts {
    pub fn encode(&self) -> String {
        let body = self.body();
        let payload = [&body[..], &checksum(&body)[..]].concat();
        format!(
            "{FRIEND_CODE_PREFIX}{}",
            BASE32_NOPAD.encode(&payload).to_lowercase()
        )
    }

    /// Die letzten vier Zeichen des Codes: so erkennt der Nutzer seine Codes wieder.
    pub fn tail(&self) -> String {
        let code = self.encode();
        code[code.len() - TAIL_LEN..].to_owned()
    }

    /// Das Geheimnis als 18 Hex-Zeichen, so steht es in der Anfrage an den Code-Besitzer.
    pub fn secret_hex(&self) -> String {
        HEXLOWER.encode(&self.secret)
    }

    /// SHA-256 des Geheimnisses als Hex: das speichert der Code-Besitzer statt des Geheimnisses.
    pub fn secret_digest(&self) -> String {
        digest_of(&self.secret)
    }

    /// Ein Relay-Index, den die eingebaute Relay-Liste nicht kennt, kommt von einem anderen Launcher-Stand.
    pub fn ensure_relay_known(&self, is_known: impl Fn(u8) -> bool) -> AppResult<()> {
        if is_known(self.relay_index) {
            return Ok(());
        }
        Err(AppError::invalid(coded!(
            "errors.friends.protocolUnsupported"
        )))
    }

    pub fn ensure_not_own(&self, own_hello_ids: &[[u8; 32]]) -> AppResult<()> {
        if own_hello_ids.contains(&self.hello_id) {
            return Err(AppError::invalid(coded!("errors.friends.codeOwn")));
        }
        Ok(())
    }

    fn body(&self) -> Vec<u8> {
        [
            &[VERSION, self.relay_index][..],
            &self.hello_id[..],
            &self.secret[..],
        ]
        .concat()
    }

    fn from_payload(payload: &[u8]) -> Option<Self> {
        let (body, check) = payload.split_at_checked(BODY_LEN)?;
        if check != checksum(body) || body[0] != VERSION {
            return None;
        }
        Some(Self {
            relay_index: body[1],
            hello_id: body[2..34].try_into().ok()?,
            secret: body[34..].try_into().ok()?,
        })
    }
}

fn invalid() -> AppError {
    AppError::invalid(coded!("errors.friends.codeInvalid"))
}

/// Hauptteil des Codes in Kleinbuchstaben ohne Leerzeichen und `-`, oder `None`, wenn Präfix, Länge oder Alphabet nicht passen.
fn normalized_body(input: &str) -> Option<String> {
    let lowered = input.trim().to_lowercase();
    let body: String = lowered
        .strip_prefix(FRIEND_CODE_PREFIX)?
        .chars()
        .filter(|c| !matches!(c, ' ' | '-'))
        .collect();
    let in_alphabet = body.bytes().all(|b| matches!(b, b'a'..=b'z' | b'2'..=b'7'));
    (body.len() == FRIEND_CODE_BODY_LENGTH && in_alphabet).then_some(body)
}

fn checksum(body: &[u8]) -> [u8; CHECK_LEN] {
    let digest = Sha256::digest(body);
    [digest[0], digest[1]]
}

fn digest_of(secret: &[u8]) -> String {
    HEXLOWER.encode(&Sha256::digest(secret))
}

fn random_bytes<const N: usize>() -> AppResult<[u8; N]> {
    let mut bytes = [0; N];
    getrandom::fill(&mut bytes).map_err(|err| io::Error::other(err.to_string()))?;
    Ok(bytes)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::services::friends::test_support::error_key;

    const GOLDEN: &str =
        "pumpkin-aiaaaaicamcakbqhbaequcymbuha6earcijrifiwc4mbsgq3dqor4h5augrkhjffu2t2rvw3";
    const GOLDEN_GROUPED_BODY: &str =
        "aiaa aaic amca kbqh baeq ucym buha 6ear cijr ifiw c4mb sgq3 dqor 4h5a ugrk hjff u2t2 rvw3";

    fn golden_parts() -> CodeParts {
        CodeParts {
            relay_index: 0,
            hello_id: std::array::from_fn(|i| i as u8),
            secret: std::array::from_fn(|i| 0xa0 + i as u8),
        }
    }

    #[test]
    fn golden_vector_encodes_to_the_appendix_b_code() {
        let code = golden_parts().encode();
        assert_eq!(code, GOLDEN);
        assert_eq!(code.len(), 80);
    }

    #[test]
    fn golden_checksum_is_d6db() {
        assert_eq!(checksum(&golden_parts().body()), [0xd6, 0xdb]);
    }

    #[test]
    fn golden_code_parses_back_to_its_parts() {
        assert_eq!(parse(GOLDEN).unwrap(), golden_parts());
    }

    #[test]
    fn random_code_round_trips() {
        let issued = issue(&Identity::generate(), 7).unwrap();
        assert_eq!(parse(&issued.parts.encode()).unwrap(), issued.parts);
    }

    #[test]
    fn issued_code_points_at_the_hello_endpoint_of_its_salt() {
        let identity = Identity::generate();
        let issued = issue(&identity, 0).unwrap();
        assert_eq!(issued.parts.hello_id, identity.hello_id(&issued.salt));
    }

    #[test]
    fn issued_codes_differ() {
        let identity = Identity::generate();
        let (first, second) = (issue(&identity, 0).unwrap(), issue(&identity, 0).unwrap());
        assert_ne!(first.salt, second.salt);
        assert_ne!(first.parts.secret, second.parts.secret);
    }

    #[test]
    fn parsing_accepts_grouped_upper_case_and_padded_input() {
        let grouped = format!("pumpkin-{GOLDEN_GROUPED_BODY}");
        let hyphenated = format!("pumpkin-{}", GOLDEN_GROUPED_BODY.replace(' ', "-"));
        for input in [
            grouped.clone(),
            hyphenated,
            grouped.to_uppercase(),
            format!("  {GOLDEN}\n"),
            GOLDEN.to_uppercase(),
        ] {
            assert_eq!(parse(&input).unwrap(), golden_parts(), "{input}");
        }
    }

    #[test]
    fn flipping_any_body_character_gives_code_invalid() {
        for at in FRIEND_CODE_PREFIX.len()..GOLDEN.len() {
            let mut bytes = GOLDEN.as_bytes().to_vec();
            bytes[at] = if bytes[at] == b'a' { b'b' } else { b'a' };
            let err = parse(std::str::from_utf8(&bytes).unwrap()).unwrap_err();
            assert_eq!(
                error_key(&err),
                "errors.friends.codeInvalid",
                "Position {at}"
            );
        }
    }

    #[test]
    fn malformed_input_gives_code_invalid() {
        let body = &GOLDEN[FRIEND_CODE_PREFIX.len()..];
        let inputs = [
            String::new(),
            "pumpkin-".to_owned(),
            body.to_owned(),
            format!("pumpkim-{body}"),
            format!("{GOLDEN}a"),
            GOLDEN[..GOLDEN.len() - 1].to_owned(),
            format!("pumpkin-{}1", &body[1..]),
            format!("pumpkin-{}0", &body[1..]),
            format!("pumpkin-{}8", &body[1..]),
        ];
        for input in inputs {
            assert_eq!(
                error_key(&parse(&input).unwrap_err()),
                "errors.friends.codeInvalid",
                "{input}"
            );
        }
    }

    #[test]
    fn another_version_gives_code_invalid_even_with_a_valid_checksum() {
        let mut body = golden_parts().body();
        body[0] = 0x03;
        let payload = [&body[..], &checksum(&body)[..]].concat();
        let code = format!(
            "{FRIEND_CODE_PREFIX}{}",
            BASE32_NOPAD.encode(&payload).to_lowercase()
        );
        assert_eq!(
            error_key(&parse(&code).unwrap_err()),
            "errors.friends.codeInvalid"
        );
    }

    #[test]
    fn tail_is_the_last_four_characters() {
        assert_eq!(golden_parts().tail(), "rvw3");
    }

    #[test]
    fn unknown_relay_index_is_protocol_unsupported() {
        let parts = golden_parts();
        parts.ensure_relay_known(|index| index == 0).unwrap();
        let err = parts.ensure_relay_known(|index| index == 1).unwrap_err();
        assert_eq!(error_key(&err), "errors.friends.protocolUnsupported");
    }

    #[test]
    fn own_hello_id_is_code_own() {
        let parts = golden_parts();
        parts.ensure_not_own(&[[9; 32]]).unwrap();
        let err = parts
            .ensure_not_own(&[[9; 32], parts.hello_id])
            .unwrap_err();
        assert_eq!(error_key(&err), "errors.friends.codeOwn");
    }

    #[test]
    fn secret_is_checked_against_the_stored_digest() {
        let parts = golden_parts();
        assert_eq!(parts.secret_hex(), "a0a1a2a3a4a5a6a7a8");
        assert!(secret_matches(&parts.secret_digest(), &parts.secret_hex()));
        assert!(!secret_matches(
            &parts.secret_digest(),
            "a0a1a2a3a4a5a6a7a9"
        ));
        assert!(!secret_matches(&parts.secret_digest(), "a0a1a2a3a4a5a6a7"));
        assert!(!secret_matches(&parts.secret_digest(), "kein hex"));
        assert!(!secret_matches(
            &parts.secret_digest(),
            &parts.secret_hex().to_uppercase()
        ));
    }
}
