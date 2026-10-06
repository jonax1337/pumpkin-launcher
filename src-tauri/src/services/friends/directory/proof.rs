//! Reine Beweisfunktionen des Verzeichnisses (BYNAME 3.2, 4, 7.2 und Anhang A): was signiert wird, welche `serverId`s
//! beim Annehmen bei Mojang landen und wann ein Brief aus dem Postfach glaubwürdig ist. Kein Netz, kein Zustand.
use std::str::FromStr;

use base64::engine::general_purpose::STANDARD;
use base64::Engine;
use data_encoding::HEXLOWER;
use sha2::{Digest, Sha256};

use super::certificate::PlayerCertificate;
use super::wire::SessionRequest;
use crate::services::friends::contract::REQUEST_TTL_SECS;
use crate::services::friends::identity::{self, Identity};
use crate::services::p2p::PeerId;

pub const LETTER_DOMAIN: &[u8] = b"pumpkin/name-request/1";
/// Layout L1 (BYNAME-ATTEST 2): the friends key logs this peer id in for this account.
pub const AUTH_DOMAIN: &[u8] = b"pumpkin/directory-auth/2";
/// Layout L2: the holder of Mojang's certificate key logs in with this peer id. Never a Minecraft chat format.
pub const CERT_DOMAIN: &[u8] = b"pumpkin/directory-cert/1";
const REDEEMER_DOMAIN: &[u8] = b"pumpkin/name-proof/redeemer/1";
const OWNER_DOMAIN: &[u8] = b"pumpkin/name-proof/owner/1";

/// Wie weit die Uhr eines Absenders und die des Verzeichnisses auseinanderliegen dürfen.
pub const CLOCK_SKEW_SECS: u64 = 600;
const SERVER_ID_HEX_LEN: usize = 40;
const HOST_TAG_LEN: usize = 16;

/// Die Teile einer Signatur in ihrer Reihenfolge, bereit für `Identity::sign` und `identity::verify`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SignedParts(Vec<Vec<u8>>);

impl SignedParts {
    pub fn as_slices(&self) -> Vec<&[u8]> {
        self.0.iter().map(Vec::as_slice).collect()
    }

    /// The signed bytes for a key that does not prepend a domain itself (the certificate key): domain ‖ parts.
    pub fn message(&self, domain: &[u8]) -> Vec<u8> {
        [domain]
            .into_iter()
            .chain(self.as_slices())
            .flatten()
            .copied()
            .collect()
    }
}

/// Die signierten Felder eines Briefes, so wie sie auf dem Draht stehen (Hex, klein geschrieben).
#[derive(Debug, Clone, Copy)]
pub struct LetterFields<'a> {
    pub to: &'a str,
    pub from_uuid: &'a str,
    pub nonce: &'a str,
    pub hello_id: &'a str,
    pub relay_index: u8,
    pub secret: &'a str,
    pub created_at: u64,
    pub display_name: &'a str,
}

/// Ein Brief aus dem Postfach samt dem Stempel des Verzeichnisses; nichts davon ist schon geprüft.
#[derive(Debug, Clone, Copy)]
pub struct StampedLetter<'a> {
    pub fields: LetterFields<'a>,
    pub from_peer_id: &'a str,
    pub expires_at: u64,
    pub signature: &'a str,
}

/// Wer den Brief prüft.
#[derive(Debug, Clone, Copy)]
pub struct Recipient<'a> {
    pub uuid: &'a str,
    pub peer_id: &'a str,
    pub now: u64,
}

/// Warum ein Brief nicht angezeigt wird.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Rejection {
    /// Der Brief ist ungültig und wird im Verzeichnis gelöscht.
    Malformed,
    /// Der Brief stammt von einem anderen Launcher-Stand (unbekanntes Relay) und bleibt unangetastet liegen.
    UnknownRelay,
}

/// Die Eingaben beider `serverId`s: der Hello-Endpunkt, die authentifizierte ID des Einlösers und das Geheimnis des Codes.
#[derive(Debug, Clone, Copy)]
pub struct NameProof<'a> {
    pub hello_id: &'a [u8; 32],
    pub redeemer_peer_id: &'a [u8; 32],
    pub secret: &'a [u8; 9],
}

impl NameProof<'_> {
    /// Die `serverId`, mit der der Einlöser bei Mojang `join` aufruft.
    pub fn server_id_redeemer(&self) -> String {
        self.server_id(REDEEMER_DOMAIN)
    }

    /// Die `serverId`, mit der der Code-Besitzer bei Mojang `join` aufruft.
    pub fn server_id_owner(&self) -> String {
        self.server_id(OWNER_DOMAIN)
    }

    fn server_id(&self, domain: &[u8]) -> String {
        let digest = Sha256::new()
            .chain_update(domain)
            .chain_update(self.hello_id)
            .chain_update(self.redeemer_peer_id)
            .chain_update(self.secret)
            .finalize();
        HEXLOWER.encode(&digest)[..SERVER_ID_HEX_LEN].to_owned()
    }
}

/// `None`, wenn ein Feld kein Hex in Kleinbuchstaben der richtigen Länge ist.
pub fn letter_parts(fields: &LetterFields) -> Option<SignedParts> {
    Some(SignedParts(vec![
        decode::<16>(fields.to)?.to_vec(),
        decode::<16>(fields.from_uuid)?.to_vec(),
        decode::<16>(fields.nonce)?.to_vec(),
        decode::<32>(fields.hello_id)?.to_vec(),
        vec![fields.relay_index],
        decode::<9>(fields.secret)?.to_vec(),
        fields.created_at.to_be_bytes().to_vec(),
        fields.display_name.as_bytes().to_vec(),
    ]))
}

/// What L1 and L2 sign after their domain (BYNAME-ATTEST 2 with review finding 4):
/// SHA-256(host)[0..16] ‖ serverId (40 ASCII characters) ‖ peerId (32 bytes) ‖ uuid (16 bytes). `host` is the
/// directory's hostname, so signatures made for another directory are worthless at this one. `None` for a `serverId`
/// that is not 40 lowercase hex digits or a malformed peer id or uuid: the launcher signs nothing else.
pub fn login_parts(host: &str, server_id: &str, peer_id: &str, uuid: &str) -> Option<SignedParts> {
    decode::<20>(server_id)?;
    let host_tag = Sha256::digest(host.as_bytes())[..HOST_TAG_LEN].to_vec();
    Some(SignedParts(vec![
        host_tag,
        server_id.as_bytes().to_vec(),
        decode::<32>(peer_id)?.to_vec(),
        decode::<16>(uuid)?.to_vec(),
    ]))
}

/// The login body (BYNAME-ATTEST 1.2): the certificate's public part, L2 with its key and L1 with the friends key.
/// `None` if the certificate key cannot sign.
pub fn session_request(
    challenge: String,
    parts: &SignedParts,
    identity: &Identity,
    certificate: &PlayerCertificate,
) -> Option<SessionRequest> {
    let cert_signature = certificate.sign(&parts.message(CERT_DOMAIN))?;
    Some(SessionRequest {
        challenge,
        uuid: certificate.uuid.clone(),
        certificate: certificate.proof(),
        cert_signature: STANDARD.encode(cert_signature),
        signature: HEXLOWER.encode(&identity.sign(AUTH_DOMAIN, &parts.as_slices())),
    })
}

/// Prüft einen Brief aus dem Postfach (BYNAME 7.2). Ob der Absender schon Freund oder gesperrt ist, weiß nur der Dienst.
pub fn validate_letter(
    letter: &StampedLetter,
    me: &Recipient,
    relay_is_known: impl Fn(u8) -> bool,
) -> Result<(), Rejection> {
    let fields = &letter.fields;
    let sender_is_plausible = fields.from_uuid != me.uuid
        && is_other_peer(letter.from_peer_id, me.peer_id)
        && PeerId::from_str(fields.hello_id).is_ok();
    let is_addressed_to_me = fields.to == me.uuid;
    if !(is_addressed_to_me
        && sender_is_plausible
        && is_within_lifetime(letter, me.now)
        && signature_holds(letter))
    {
        return Err(Rejection::Malformed);
    }
    if relay_is_known(fields.relay_index) {
        Ok(())
    } else {
        Err(Rejection::UnknownRelay)
    }
}

fn is_other_peer(candidate: &str, own: &str) -> bool {
    candidate != own && PeerId::from_str(candidate).is_ok()
}

fn is_within_lifetime(letter: &StampedLetter, now: u64) -> bool {
    let created_at = letter.fields.created_at;
    let latest_expiry = created_at.saturating_add(REQUEST_TTL_SECS + CLOCK_SKEW_SECS);
    created_at <= now.saturating_add(CLOCK_SKEW_SECS)
        && now < letter.expires_at
        && letter.expires_at <= latest_expiry
}

fn signature_holds(letter: &StampedLetter) -> bool {
    let (Some(signature), Some(parts)) =
        (decode::<64>(letter.signature), letter_parts(&letter.fields))
    else {
        return false;
    };
    identity::verify(
        letter.from_peer_id,
        LETTER_DOMAIN,
        &parts.as_slices(),
        &signature,
    )
}

fn decode<const N: usize>(hex: &str) -> Option<[u8; N]> {
    HEXLOWER.decode(hex.as_bytes()).ok()?.try_into().ok()
}

#[cfg(test)]
mod tests {
    use ring::signature::{UnparsedPublicKey, RSA_PKCS1_2048_8192_SHA1_FOR_LEGACY_USE_ONLY};
    use sha1::Sha1;

    use super::super::certificate::parse;
    use super::super::certificate::test_vectors::{vectors, Draft, Inputs};
    use super::*;

    /// An RSA-2048 SubjectPublicKeyInfo: a 24-byte header, then the PKCS#1 RSAPublicKey ring expects.
    const RSA_2048_SPKI_LEN: usize = 294;
    const SPKI_HEADER_LEN: usize = 24;
    const SEED_PEER_ID: &str = "2543b92ff1095511476adc8369db6ddc933665a11978dda1404ee1066ca9559d";
    const UUID_RECIPIENT: &str = "069a79f444e94726a5befca90e38aaf5";
    const UUID_SENDER: &str = "853c80ef3c3749fdaa49938b674adae6";
    const NOW: u64 = 1_790_000_100;

    fn bytes_from<const N: usize>(first: u8) -> [u8; N] {
        std::array::from_fn(|i| first + i as u8)
    }

    fn seed_identity() -> Identity {
        Identity::from_secret_bytes(&bytes_from::<32>(0x40))
    }

    fn signature_hex(domain: &[u8], parts: &SignedParts) -> String {
        HEXLOWER.encode(&seed_identity().sign(domain, &parts.as_slices()))
    }

    fn golden_fields() -> LetterFields<'static> {
        LetterFields {
            to: UUID_RECIPIENT,
            from_uuid: UUID_SENDER,
            nonce: "000102030405060708090a0b0c0d0e0f",
            hello_id: "202122232425262728292a2b2c2d2e2f303132333435363738393a3b3c3d3e3f",
            relay_index: 0,
            secret: "a0a1a2a3a4a5a6a7a8",
            created_at: 1_790_000_000,
            display_name: "Alex",
        }
    }

    fn golden_proof<'a>(
        hello_id: &'a [u8; 32],
        redeemer: &'a [u8; 32],
        secret: &'a [u8; 9],
    ) -> NameProof<'a> {
        NameProof {
            hello_id,
            redeemer_peer_id: redeemer,
            secret,
        }
    }

    #[test]
    fn seed_40_to_5f_is_the_peer_id_of_the_appendix() {
        assert_eq!(seed_identity().peer_id(), SEED_PEER_ID);
    }

    #[test]
    fn a1_letter_signature_matches_the_golden_vector() {
        let parts = letter_parts(&golden_fields()).unwrap();
        let expected = "da54bc072f53090eff8de51d3bed6931509fa27d41e4e0cc9d8e80930eba82ce\
                        2354b99e3afadbfcb8e61d5ee3aa3a8aebb6b95ce20d4638111f9f5a09ae3c03";
        assert_eq!(signature_hex(LETTER_DOMAIN, &parts), expected);
    }

    fn golden_login_parts() -> SignedParts {
        let inputs = &vectors().inputs;
        login_parts(
            &inputs.host,
            &inputs.server_id,
            &inputs.peer_id,
            &inputs.uuid,
        )
        .unwrap()
    }

    #[test]
    fn the_seed_and_peer_id_of_the_worker_vectors_are_those_of_the_appendix() {
        let inputs = &vectors().inputs;
        assert_eq!(inputs.seed, HEXLOWER.encode(&bytes_from::<32>(0x40)));
        assert_eq!(inputs.peer_id, SEED_PEER_ID);
    }

    #[test]
    fn a2_l1_message_and_signature_match_the_worker_vector() {
        let golden = &vectors().vectors.a2;
        let message = golden_login_parts().message(AUTH_DOMAIN);
        assert_eq!(
            (message.len(), HEXLOWER.encode(&message)),
            (golden.length, golden.message.clone())
        );
        assert_eq!(
            signature_hex(AUTH_DOMAIN, &golden_login_parts()),
            golden.signature
        );
    }

    #[test]
    fn a5_l2_message_matches_the_worker_vector() {
        let golden = &vectors().vectors.a5;
        let message = golden_login_parts().message(CERT_DOMAIN);
        assert_eq!(
            (message.len(), HEXLOWER.encode(&message)),
            (golden.length, golden.message.clone())
        );
        assert_eq!(HEXLOWER.encode(&Sha256::digest(&message)), golden.sha256);
    }

    #[test]
    fn a6_l3_verifies_with_ring_against_the_fake_mojang_key() {
        let (inputs, golden) = (&vectors().inputs, &vectors().vectors.a6);
        let spki = vectors().fake_mojang.spki_der();
        assert_eq!(spki.len(), RSA_2048_SPKI_LEN);
        let payload = [
            HEXLOWER.decode(inputs.uuid.as_bytes()).unwrap(),
            inputs.expires_at_ms.to_be_bytes().to_vec(),
            vectors().certificate.spki_der(),
        ]
        .concat();
        assert_eq!(
            (payload.len(), HEXLOWER.encode(&Sha1::digest(&payload))),
            (golden.length, golden.sha1.clone())
        );
        let key = UnparsedPublicKey::new(
            &RSA_PKCS1_2048_8192_SHA1_FOR_LEGACY_USE_ONLY,
            &spki[SPKI_HEADER_LEN..],
        );
        assert!(key
            .verify(&payload, &STANDARD.decode(&golden.signature).unwrap())
            .is_ok());
    }

    #[test]
    fn the_session_request_carries_both_signatures_over_the_login_parts() {
        let inputs = &vectors().inputs;
        let certificate =
            parse(&inputs.uuid, &Draft::of(&vectors().certificate, 0).body()).unwrap();
        let parts = golden_login_parts();
        let request = session_request("c".into(), &parts, &seed_identity(), &certificate).unwrap();
        assert_eq!(
            (request.challenge.as_str(), request.uuid.as_str()),
            ("c", inputs.uuid.as_str())
        );
        assert_eq!(request.cert_signature, vectors().vectors.a5.signature);
        assert_eq!(request.signature, vectors().vectors.a2.signature);
        assert_eq!(request.certificate, certificate.proof());
    }

    #[test]
    fn a3_a4_server_ids_match_the_golden_vectors() {
        let (hello_id, redeemer, secret) = (bytes_from(0x20), bytes_from(0x60), bytes_from(0xa0));
        let proof = golden_proof(&hello_id, &redeemer, &secret);
        assert_eq!(
            proof.server_id_redeemer(),
            "1173a19b66402ae0b58b86da1777f8ee4a797703"
        );
        assert_eq!(
            proof.server_id_owner(),
            "da7b9698d86d1aeb398af253249ef76dc60eecd5"
        );
    }

    #[test]
    fn server_ids_differ_per_redeemer_secret_and_role() {
        let (hello_id, secret) = (bytes_from(0x20), bytes_from(0xa0));
        let (redeemer, other_redeemer) = (bytes_from(0x60), bytes_from(0x61));
        let base = golden_proof(&hello_id, &redeemer, &secret);
        let other = golden_proof(&hello_id, &other_redeemer, &secret);
        assert_ne!(base.server_id_redeemer(), other.server_id_redeemer());
        assert_ne!(base.server_id_owner(), other.server_id_owner());
        assert_ne!(base.server_id_redeemer(), base.server_id_owner());
        assert_eq!(base.server_id_redeemer().len(), SERVER_ID_HEX_LEN);
    }

    #[test]
    fn letter_parts_refuse_malformed_fields() {
        let golden = golden_fields();
        let malformed = [
            LetterFields {
                to: "069A79F444E94726A5BEFCA90E38AAF5",
                ..golden
            },
            LetterFields {
                from_uuid: "853c80ef",
                ..golden
            },
            LetterFields {
                nonce: "00",
                ..golden
            },
            LetterFields {
                hello_id: "zz",
                ..golden
            },
            LetterFields {
                secret: "a0a1a2a3a4a5a6a7a8a9",
                ..golden
            },
        ];
        for fields in malformed {
            assert_eq!(letter_parts(&fields), None, "{fields:?}");
        }
    }

    #[test]
    fn login_parts_refuse_a_server_id_that_is_not_40_lowercase_hex_and_malformed_ids() {
        let inputs = &vectors().inputs;
        let (server_id, peer_id, uuid) = (
            inputs.server_id.as_str(),
            inputs.peer_id.as_str(),
            inputs.uuid.as_str(),
        );
        let (longer, upper_uuid) = (format!("{server_id}8"), uuid.to_uppercase());
        let refused = [
            ("0123456789ABCDEF0123456789ABCDEF01234567", peer_id, uuid),
            (&server_id[..38], peer_id, uuid),
            (&longer, peer_id, uuid),
            ("0123456789abcdef0123456789abcdef0123456g", peer_id, uuid),
            (server_id, "abcd", uuid),
            (server_id, peer_id, &upper_uuid),
        ];
        for (case, (server_id, peer_id, uuid)) in refused.into_iter().enumerate() {
            assert!(
                login_parts(&inputs.host, server_id, peer_id, uuid).is_none(),
                "malformed login case {case} must be refused"
            );
        }
    }

    #[test]
    fn login_parts_are_bound_to_the_directory_host() {
        let Inputs {
            server_id,
            peer_id,
            uuid,
            ..
        } = &vectors().inputs;
        assert_eq!(
            HEXLOWER.encode(golden_login_parts().as_slices()[0]),
            vectors().inputs.host_tag
        );
        let here = login_parts("directory.example", server_id, peer_id, uuid).unwrap();
        let elsewhere = login_parts("fork.example", server_id, peer_id, uuid).unwrap();
        assert_ne!(here.message(AUTH_DOMAIN), elsewhere.message(AUTH_DOMAIN));
        assert_eq!(
            here.message(AUTH_DOMAIN).len(),
            elsewhere.message(AUTH_DOMAIN).len()
        );
    }

    /// Ein gültiger Brief des Absenders mit der Seed-Identität an einen Empfänger mit eigener Identität.
    struct Fixture {
        recipient: Identity,
        fields: LetterFields<'static>,
        hello_id: String,
        from_peer_id: String,
        expires_at: u64,
        signature: String,
    }

    impl Fixture {
        fn valid() -> Self {
            let hello_id = HEXLOWER.encode(&seed_identity().hello_id(&bytes_from(7)));
            Self {
                recipient: Identity::from_secret_bytes(&bytes_from::<32>(0x60)),
                fields: golden_fields(),
                hello_id,
                from_peer_id: SEED_PEER_ID.into(),
                expires_at: 1_790_000_000 + REQUEST_TTL_SECS,
                signature: String::new(),
            }
            .sign()
        }

        fn with_fields(self, fields: LetterFields<'static>) -> Self {
            Self { fields, ..self }.sign()
        }

        fn sign(mut self) -> Self {
            let fields = self.fields_with_own_hello_id();
            self.signature = signature_hex(LETTER_DOMAIN, &letter_parts(&fields).unwrap());
            self
        }

        fn fields_with_own_hello_id(&self) -> LetterFields<'_> {
            LetterFields {
                hello_id: &self.hello_id,
                ..self.fields
            }
        }

        fn check(&self, now: u64, relay_is_known: bool) -> Result<(), Rejection> {
            let letter = StampedLetter {
                fields: self.fields_with_own_hello_id(),
                from_peer_id: &self.from_peer_id,
                expires_at: self.expires_at,
                signature: &self.signature,
            };
            let peer_id = self.recipient.peer_id();
            validate_letter(
                &letter,
                &Recipient {
                    uuid: UUID_RECIPIENT,
                    peer_id: &peer_id,
                    now,
                },
                |_| relay_is_known,
            )
        }
    }

    #[test]
    fn a_correctly_signed_letter_is_accepted() {
        assert_eq!(Fixture::valid().check(NOW, true), Ok(()));
    }

    #[test]
    fn a_letter_for_someone_else_is_malformed() {
        let fixture = Fixture::valid().with_fields(LetterFields {
            to: UUID_SENDER,
            ..golden_fields()
        });
        assert_eq!(fixture.check(NOW, true), Err(Rejection::Malformed));
    }

    #[test]
    fn a_letter_from_myself_is_malformed() {
        let own_uuid = Fixture::valid().with_fields(LetterFields {
            from_uuid: UUID_RECIPIENT,
            ..golden_fields()
        });
        let own_peer_id = Fixture {
            from_peer_id: Fixture::valid().recipient.peer_id(),
            ..Fixture::valid()
        };
        for fixture in [own_uuid, own_peer_id] {
            assert_eq!(fixture.check(NOW, true), Err(Rejection::Malformed));
        }
    }

    #[test]
    fn a_stamp_that_is_not_a_uuid_or_peer_id_is_malformed() {
        let bad_peer = Fixture {
            from_peer_id: "abcd".into(),
            ..Fixture::valid()
        };
        let bad_uuid = Fixture {
            fields: LetterFields {
                from_uuid: "ABC",
                ..golden_fields()
            },
            ..Fixture::valid()
        };
        for fixture in [bad_peer, bad_uuid] {
            assert_eq!(fixture.check(NOW, true), Err(Rejection::Malformed));
        }
    }

    #[test]
    fn a_hello_id_that_is_no_key_is_malformed() {
        let not_a_curve_point = format!("02{}", "00".repeat(31));
        let fixture = Fixture {
            hello_id: not_a_curve_point,
            ..Fixture::valid()
        }
        .sign();
        assert_eq!(fixture.check(NOW, true), Err(Rejection::Malformed));
    }

    #[test]
    fn a_letter_from_the_future_is_malformed_but_clock_skew_is_tolerated() {
        let fixture = Fixture::valid();
        let created_at = fixture.fields.created_at;
        assert_eq!(fixture.check(created_at - CLOCK_SKEW_SECS, true), Ok(()));
        assert_eq!(
            fixture.check(created_at - CLOCK_SKEW_SECS - 1, true),
            Err(Rejection::Malformed)
        );
    }

    #[test]
    fn an_expired_letter_is_malformed() {
        let fixture = Fixture::valid();
        assert_eq!(fixture.check(fixture.expires_at - 1, true), Ok(()));
        assert_eq!(
            fixture.check(fixture.expires_at, true),
            Err(Rejection::Malformed)
        );
    }

    #[test]
    fn a_lifetime_beyond_the_ttl_plus_skew_is_malformed() {
        let created_at = golden_fields().created_at;
        let latest = created_at + REQUEST_TTL_SECS + CLOCK_SKEW_SECS;
        assert_eq!(
            Fixture {
                expires_at: latest,
                ..Fixture::valid()
            }
            .check(NOW, true),
            Ok(())
        );
        assert_eq!(
            Fixture {
                expires_at: latest + 1,
                ..Fixture::valid()
            }
            .check(NOW, true),
            Err(Rejection::Malformed)
        );
    }

    #[test]
    fn a_tampered_or_truncated_signature_is_malformed() {
        // Absichtlich ohne `with_fields`: die Signatur des Originals bleibt stehen.
        let tampered_fields = LetterFields {
            display_name: "Mallory",
            ..golden_fields()
        };
        let tampered = Fixture {
            fields: tampered_fields,
            ..Fixture::valid()
        };
        let truncated = Fixture {
            signature: "ab".into(),
            ..Fixture::valid()
        };
        for fixture in [tampered, truncated] {
            assert_eq!(fixture.check(NOW, true), Err(Rejection::Malformed));
        }
    }

    #[test]
    fn a_forged_stamp_with_a_valid_signature_of_another_key_is_malformed() {
        let attacker = Identity::from_secret_bytes(&bytes_from::<32>(0x80));
        let fixture = Fixture {
            from_peer_id: attacker.peer_id(),
            ..Fixture::valid()
        };
        assert_eq!(fixture.check(NOW, true), Err(Rejection::Malformed));
    }

    #[test]
    fn an_unknown_relay_is_ignored_not_malformed() {
        assert_eq!(
            Fixture::valid().check(NOW, false),
            Err(Rejection::UnknownRelay)
        );
    }

    #[test]
    fn a_forged_letter_with_an_unknown_relay_is_still_malformed() {
        let fixture = Fixture {
            from_peer_id: "abcd".into(),
            ..Fixture::valid()
        };
        assert_eq!(fixture.check(NOW, false), Err(Rejection::Malformed));
    }
}
