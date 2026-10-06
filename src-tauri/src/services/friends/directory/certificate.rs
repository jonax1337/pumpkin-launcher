//! Mojang's player certificate (docs/friends/SPEC.md#directory-api): an RSA key pair Mojang generates, whose public half
//! Mojang signs together with the account UUID and the expiry. The launcher proves its account to the directory with it.
//! Pure functions; the certificate lives in memory only and its private key never leaves the launcher.
use std::fmt;
use std::sync::Arc;

use base64::engine::general_purpose::STANDARD;
use base64::Engine;
use ring::rand::SystemRandom;
use ring::signature::{RsaKeyPair, RSA_PKCS1_SHA256};
use serde::Deserialize;
use time::format_description::well_known::Rfc3339;
use time::OffsetDateTime;

use super::wire::CertificateProof;

const MAX_PUBLIC_KEY_BYTES: usize = 800;
const MAX_SIGNATURE_BYTES: usize = 1024;
/// A certificate this close to its expiry is no longer presented: the directory checks the expiry with its own clock.
const USE_MARGIN_MS: i64 = 10 * 60 * 1000;
const NANOS_PER_MILLI: i128 = 1_000_000;
const PEM_BOUNDARY: &str = "-----";

/// Mojang's player certificate of one account; no debug output shows its keys.
#[derive(Clone)]
pub struct PlayerCertificate {
    /// 32 lowercase hex digits: the account it was fetched for.
    pub uuid: String,
    /// SPKI DER, exactly the body of Mojang's PEM.
    pub public_key: Vec<u8>,
    pub expires_at_ms: i64,
    pub refreshed_after_ms: i64,
    /// Mojang's `publicKeySignatureV2`.
    pub mojang_signature: Vec<u8>,
    key_pair: Arc<RsaKeyPair>,
}

impl fmt::Debug for PlayerCertificate {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("PlayerCertificate")
            .field("uuid", &self.uuid)
            .field("expires_at_ms", &self.expires_at_ms)
            .field("refreshed_after_ms", &self.refreshed_after_ms)
            .field("keys", &"<verborgen>")
            .finish()
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct CertificateBody {
    key_pair: KeyPairBody,
    public_key_signature_v2: String,
    expires_at: String,
    refreshed_after: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct KeyPairBody {
    private_key: String,
    public_key: String,
}

/// Reads the answer of `/player/certificates` for the account `uuid`; `None` when anything is missing or inconsistent.
pub fn parse(uuid: &str, body: &[u8]) -> Option<PlayerCertificate> {
    let body: CertificateBody = serde_json::from_slice(body).ok()?;
    let key_pair = key_pair(&pem_body(&body.key_pair.private_key)?)?;
    let public_key = pem_body(&body.key_pair.public_key)?;
    let mojang_signature = STANDARD.decode(&body.public_key_signature_v2).ok()?;
    let is_consistent = (1..=MAX_PUBLIC_KEY_BYTES).contains(&public_key.len())
        && public_key.ends_with(key_pair.public().as_ref())
        && (1..=MAX_SIGNATURE_BYTES).contains(&mojang_signature.len());
    is_consistent.then_some(())?;
    Some(PlayerCertificate {
        uuid: uuid.to_owned(),
        public_key,
        expires_at_ms: epoch_ms(&body.expires_at)?,
        refreshed_after_ms: epoch_ms(&body.refreshed_after)?,
        mojang_signature,
        key_pair: Arc::new(key_pair),
    })
}

/// The DER bytes of a PEM text. The labels are ignored: Mojang labels PKCS#8 as `RSA PRIVATE KEY` and SPKI as
/// `RSA PUBLIC KEY`.
fn pem_body(text: &str) -> Option<Vec<u8>> {
    let base64: String = text
        .lines()
        .map(str::trim)
        .filter(|line| !line.starts_with(PEM_BOUNDARY))
        .collect();
    STANDARD.decode(base64).ok()
}

/// Mojang's encoding of the private key is unverified, so both PKCS#8 and PKCS#1 are accepted.
fn key_pair(der: &[u8]) -> Option<RsaKeyPair> {
    RsaKeyPair::from_pkcs8(der)
        .or_else(|_| RsaKeyPair::from_der(der))
        .ok()
}

/// RFC 3339 with up to nine fraction digits as epoch milliseconds, truncated like Java's `Instant.toEpochMilli`.
fn epoch_ms(text: &str) -> Option<i64> {
    let nanos = OffsetDateTime::parse(text, &Rfc3339)
        .ok()?
        .unix_timestamp_nanos();
    i64::try_from(nanos / NANOS_PER_MILLI).ok()
}

impl PlayerCertificate {
    pub fn needs_refresh(&self, now_ms: i64) -> bool {
        now_ms >= self.refreshed_after_ms
    }

    pub fn is_usable(&self, now_ms: i64) -> bool {
        now_ms.saturating_add(USE_MARGIN_MS) < self.expires_at_ms
    }

    /// RSASSA-PKCS1-v1_5 with SHA-256 over `message`; `None` if ring refuses.
    pub fn sign(&self, message: &[u8]) -> Option<Vec<u8>> {
        let mut signature = vec![0; self.key_pair.public().modulus_len()];
        self.key_pair
            .sign(
                &RSA_PKCS1_SHA256,
                &SystemRandom::new(),
                message,
                &mut signature,
            )
            .ok()?;
        Some(signature)
    }

    /// The public part as the directory receives it.
    pub fn proof(&self) -> CertificateProof {
        CertificateProof {
            public_key: STANDARD.encode(&self.public_key),
            expires_at: self.expires_at_ms,
            mojang_signature: STANDARD.encode(&self.mojang_signature),
        }
    }
}

/// The fixed RSA test keys and golden vectors the Worker tests use too (`directory/test/cert-vectors.json`), and
/// synthetic `/player/certificates` answers built from them. Test only.
#[cfg(test)]
pub mod test_vectors {
    use std::sync::LazyLock;

    use base64::engine::general_purpose::STANDARD;
    use base64::Engine;
    use serde::Deserialize;
    use serde_json::json;
    use time::OffsetDateTime;

    const VECTORS: &str = include_str!("../../../../../directory/test/cert-vectors.json");
    const PEM_LINE: usize = 64;
    const HOUR_MS: i64 = 3600 * 1000;
    const MOJANG_SIGNATURE_BYTES: usize = 512;

    #[derive(Deserialize)]
    pub struct TestKey {
        pub pkcs8: String,
        pub pkcs1: String,
        pub spki: String,
    }

    impl TestKey {
        pub fn spki_der(&self) -> Vec<u8> {
            STANDARD.decode(&self.spki).unwrap()
        }
    }

    #[derive(Deserialize)]
    #[serde(rename_all = "camelCase")]
    pub struct Inputs {
        pub seed: String,
        pub peer_id: String,
        pub host: String,
        pub host_tag: String,
        pub server_id: String,
        pub uuid: String,
        pub expires_at_ms: i64,
    }

    #[derive(Deserialize)]
    pub struct Vector {
        pub length: usize,
        #[serde(default)]
        pub message: String,
        #[serde(default)]
        pub sha256: String,
        #[serde(default)]
        pub sha1: String,
        pub signature: String,
    }

    #[derive(Deserialize)]
    pub struct Golden {
        #[serde(rename = "A.2")]
        pub a2: Vector,
        #[serde(rename = "A.5")]
        pub a5: Vector,
        #[serde(rename = "A.6")]
        pub a6: Vector,
    }

    #[derive(Deserialize)]
    #[serde(rename_all = "camelCase")]
    pub struct Vectors {
        pub fake_mojang: TestKey,
        pub certificate: TestKey,
        pub other: TestKey,
        pub inputs: Inputs,
        pub vectors: Golden,
    }

    pub fn vectors() -> &'static Vectors {
        static PARSED: LazyLock<Vectors> = LazyLock::new(|| serde_json::from_str(VECTORS).unwrap());
        &PARSED
    }

    /// A `/player/certificates` answer as Mojang shapes it; every field can be changed before `body`.
    pub struct Draft {
        pub private_key: String,
        pub private_label: &'static str,
        pub public_key: String,
        pub mojang_signature: Vec<u8>,
        pub expires_at: String,
        pub refreshed_after: String,
    }

    impl Draft {
        /// PKCS#8 under Mojang's `RSA PRIVATE KEY` label, valid for 48 hours from `now_ms`, refreshed after 40.
        pub fn of(key: &TestKey, now_ms: i64) -> Self {
            Self::with_lifetime(key, now_ms + 40 * HOUR_MS, now_ms + 48 * HOUR_MS)
        }

        pub fn with_lifetime(key: &TestKey, refreshed_after_ms: i64, expires_at_ms: i64) -> Self {
            Self {
                private_key: key.pkcs8.clone(),
                private_label: "RSA PRIVATE KEY",
                public_key: key.spki.clone(),
                mojang_signature: vec![7; MOJANG_SIGNATURE_BYTES],
                expires_at: rfc3339(expires_at_ms),
                refreshed_after: rfc3339(refreshed_after_ms),
            }
        }

        pub fn body(&self) -> Vec<u8> {
            json!({
                "keyPair": {
                    "privateKey": pem(self.private_label, &self.private_key),
                    "publicKey": pem("RSA PUBLIC KEY", &self.public_key),
                },
                "publicKeySignature": "AAAA",
                "publicKeySignatureV2": STANDARD.encode(&self.mojang_signature),
                "expiresAt": self.expires_at,
                "refreshedAfter": self.refreshed_after,
            })
            .to_string()
            .into_bytes()
        }
    }

    fn pem(label: &str, base64: &str) -> String {
        let lines: Vec<&str> = base64
            .as_bytes()
            .chunks(PEM_LINE)
            .map(|line| std::str::from_utf8(line).unwrap())
            .collect();
        format!(
            "-----BEGIN {label}-----\n{}\n-----END {label}-----\n",
            lines.join("\n")
        )
    }

    /// Epoch milliseconds in Mojang's notation, with nine fraction digits.
    pub fn rfc3339(epoch_ms: i64) -> String {
        let at =
            OffsetDateTime::from_unix_timestamp_nanos(i128::from(epoch_ms) * 1_000_000).unwrap();
        format!(
            "{:04}-{:02}-{:02}T{:02}:{:02}:{:02}.{:09}Z",
            at.year(),
            u8::from(at.month()),
            at.day(),
            at.hour(),
            at.minute(),
            at.second(),
            at.nanosecond()
        )
    }
}

#[cfg(test)]
mod tests {
    use super::test_vectors::{rfc3339, vectors, Draft};
    use super::*;

    const UUID: &str = "069a79f444e94726a5befca90e38aaf5";
    const NOW_MS: i64 = 1_790_000_000_000;

    fn parsed(draft: &Draft) -> Option<PlayerCertificate> {
        parse(UUID, &draft.body())
    }

    fn draft() -> Draft {
        Draft::of(&vectors().certificate, NOW_MS)
    }

    #[test]
    fn a_pkcs8_key_under_mojangs_rsa_private_key_label_parses() {
        let certificate = parsed(&draft()).unwrap();
        assert_eq!(certificate.uuid, UUID);
        assert_eq!(certificate.public_key, vectors().certificate.spki_der());
        assert_eq!(certificate.mojang_signature, draft().mojang_signature);
    }

    #[test]
    fn a_pkcs1_private_key_parses_too() {
        let pkcs1 = Draft {
            private_key: vectors().certificate.pkcs1.clone(),
            ..draft()
        };
        assert!(parsed(&pkcs1).is_some());
    }

    #[test]
    fn the_public_key_is_the_spki_body_of_the_rsa_public_key_pem() {
        let body = String::from_utf8(draft().body()).unwrap();
        assert!(body.contains("-----BEGIN RSA PUBLIC KEY-----"), "{body}");
        assert_eq!(parsed(&draft()).unwrap().public_key.len(), 294);
    }

    #[test]
    fn a_private_key_that_does_not_match_the_public_key_is_refused() {
        let mismatched = Draft {
            private_key: vectors().other.pkcs8.clone(),
            ..draft()
        };
        assert!(parsed(&mismatched).is_none());
    }

    #[test]
    fn a_missing_v2_signature_or_key_is_refused() {
        let mut body: serde_json::Value = serde_json::from_slice(&draft().body()).unwrap();
        body.as_object_mut().unwrap().remove("publicKeySignatureV2");
        assert!(parse(UUID, body.to_string().as_bytes()).is_none());
        let mut body: serde_json::Value = serde_json::from_slice(&draft().body()).unwrap();
        body["keyPair"]
            .as_object_mut()
            .unwrap()
            .remove("privateKey");
        assert!(parse(UUID, body.to_string().as_bytes()).is_none());
    }

    #[test]
    fn signatures_and_keys_beyond_their_bounds_are_refused() {
        for mojang_signature in [Vec::new(), vec![1; MAX_SIGNATURE_BYTES + 1]] {
            assert!(parsed(&Draft {
                mojang_signature,
                ..draft()
            })
            .is_none());
        }
        assert!(parsed(&Draft {
            mojang_signature: vec![1; MAX_SIGNATURE_BYTES],
            ..draft()
        })
        .is_some());
        let oversized_key = STANDARD.encode(
            [
                vec![0; MAX_PUBLIC_KEY_BYTES],
                vectors().certificate.spki_der(),
            ]
            .concat(),
        );
        assert!(parsed(&Draft {
            public_key: oversized_key,
            ..draft()
        })
        .is_none());
    }

    #[test]
    fn garbage_is_refused() {
        assert!(parse(UUID, b"kein json").is_none());
        assert!(parsed(&Draft {
            private_key: "!!!".into(),
            ..draft()
        })
        .is_none());
        assert!(parsed(&Draft {
            expires_at: "morgen".into(),
            ..draft()
        })
        .is_none());
    }

    #[test]
    fn times_are_epoch_milliseconds_truncated_like_java() {
        assert_eq!(
            epoch_ms("2022-04-30T00:11:32.174783069Z"),
            Some(1_651_277_492_174)
        );
        assert_eq!(epoch_ms("2022-04-30T00:11:32Z"), Some(1_651_277_492_000));
        assert_eq!(
            epoch_ms("2022-04-30T00:11:32.174+00:00"),
            Some(1_651_277_492_174)
        );
        assert_eq!(
            epoch_ms(&rfc3339(1_790_172_800_123)),
            Some(1_790_172_800_123)
        );
    }

    #[test]
    fn the_certificate_key_reproduces_golden_vector_a5_byte_for_byte() {
        let golden = &vectors().vectors.a5;
        let message = data_encoding::HEXLOWER
            .decode(golden.message.as_bytes())
            .unwrap();
        let signature = parsed(&draft()).unwrap().sign(&message).unwrap();
        assert_eq!(STANDARD.encode(signature), golden.signature);
    }

    #[test]
    fn the_debug_output_shows_no_key_bytes() {
        let certificate = parsed(&draft()).unwrap();
        let shown = format!("{certificate:?}");
        assert!(
            shown.contains(UUID) && shown.contains("<verborgen>"),
            "{shown}"
        );
        let key_start = format!("{:?}", &certificate.public_key[..8]).replace(['[', ']'], "");
        assert!(!shown.contains(&key_start), "{shown}");
    }

    #[test]
    fn refresh_and_use_follow_refreshed_after_and_the_expiry_margin() {
        let certificate = parsed(&draft()).unwrap();
        let (refresh, expiry) = (certificate.refreshed_after_ms, certificate.expires_at_ms);
        assert!(!certificate.needs_refresh(refresh - 1));
        assert!(certificate.needs_refresh(refresh));
        assert!(certificate.is_usable(expiry - USE_MARGIN_MS - 1));
        assert!(!certificate.is_usable(expiry - USE_MARGIN_MS));
    }

    #[test]
    fn the_proof_carries_the_public_part_in_standard_base64() {
        let proof = parsed(&draft()).unwrap().proof();
        assert_eq!(proof.public_key, vectors().certificate.spki);
        assert_eq!(proof.expires_at, NOW_MS + 48 * 3600 * 1000);
        assert_eq!(
            proof.mojang_signature,
            STANDARD.encode(draft().mojang_signature)
        );
    }
}
