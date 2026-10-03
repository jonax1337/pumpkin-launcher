//! Dauerhafte Ed25519-Identität der Freunde (SPEC 4.1, 4.6): Schlüssel im Schlüsselbund, Peer-ID, Fingerabdruck,
//! Signaturen und der Schlüssel der Hello-Endpunkte. Ohne Schlüsselbund gibt es keine Identität, Dateien nehmen nie Schlüssel auf.
use data_encoding::HEXLOWER;
use iroh::{PublicKey, SecretKey, Signature};
use sha2::{Digest, Sha256};

use super::contract::Availability;
use crate::error::AppResult;
use crate::services::secrets::SecretStore;

const IDENTITY_ENTRY: &str = "friends-identity";
const RETIRED_ENTRY: &str = "friends-identity-retired";
const HELLO_KEY_DOMAIN: &[u8] = b"pumpkin/hello-key/2";
const PEER_ID_HEX_LEN: usize = 64;
const FINGERPRINT_HEX_LEN: usize = 16;
const SHORT_ID_LEN: usize = 8;

/// Der geheime Schlüssel einer Freunde-Identität.
#[derive(Debug, Clone)]
pub struct Identity {
    key: SecretKey,
}

impl Identity {
    pub fn generate() -> Self {
        Self { key: SecretKey::generate() }
    }

    pub fn from_secret_bytes(bytes: &[u8; 32]) -> Self {
        Self { key: SecretKey::from_bytes(bytes) }
    }

    pub fn secret_bytes(&self) -> [u8; 32] {
        self.key.to_bytes()
    }

    /// Öffentliche ID als 64 Hex-Zeichen, klein geschrieben.
    pub fn peer_id(&self) -> String {
        self.key.public().to_string()
    }

    /// Ed25519-Signatur über `domain || parts…`.
    pub fn sign(&self, domain: &[u8], parts: &[&[u8]]) -> [u8; 64] {
        self.key.sign(&signed_message(domain, parts)).to_bytes()
    }

    /// Geheimer Schlüssel des Hello-Endpunkts eines Codes; aus der Identität abgeleitet, damit kein weiterer
    /// Schlüsselbund-Eintrag nötig ist und die Peer-ID nie im Code steht.
    pub fn hello_secret(&self, salt: &[u8; 16]) -> [u8; 32] {
        Sha256::new().chain_update(HELLO_KEY_DOMAIN).chain_update(self.secret_bytes()).chain_update(salt).finalize().into()
    }

    pub fn hello_id(&self, salt: &[u8; 16]) -> [u8; 32] {
        *SecretKey::from_bytes(&self.hello_secret(salt)).public().as_bytes()
    }

    fn from_hex(hex: &str) -> Option<Self> {
        let bytes = HEXLOWER.decode(hex.as_bytes()).ok()?;
        Some(Self::from_secret_bytes(&bytes.try_into().ok()?))
    }

    fn to_hex(&self) -> String {
        HEXLOWER.encode(&self.secret_bytes())
    }
}

/// Prüft eine Signatur über `domain || parts…` gegen die Peer-ID; eine ungültige ID gilt als falsche Signatur.
pub fn verify(peer_id: &str, domain: &[u8], parts: &[&[u8]], signature: &[u8; 64]) -> bool {
    let Some(key) = parse_peer_id(peer_id) else { return false };
    key.verify(&signed_message(domain, parts), &Signature::from_bytes(signature)).is_ok()
}

fn signed_message(domain: &[u8], parts: &[&[u8]]) -> Vec<u8> {
    [domain].into_iter().chain(parts.iter().copied()).flatten().copied().collect()
}

/// Streng: genau 64 Hex-Zeichen in Kleinbuchstaben, die einen gültigen öffentlichen Schlüssel ergeben.
pub fn parse_peer_id(peer_id: &str) -> Option<PublicKey> {
    if peer_id.len() != PEER_ID_HEX_LEN {
        return None;
    }
    let bytes: [u8; 32] = HEXLOWER.decode(peer_id.as_bytes()).ok()?.try_into().ok()?;
    PublicKey::from_bytes(&bytes).ok()
}

/// Die ersten 16 Hex-Zeichen in vier Vierergruppen: `3f9a c021 77de 01b4`.
pub fn fingerprint(peer_id: &str) -> String {
    let head: Vec<char> = peer_id.chars().take(FINGERPRINT_HEX_LEN).collect();
    let groups: Vec<String> = head.chunks(4).map(|group| group.iter().collect()).collect();
    groups.join(" ")
}

/// Die ersten 8 Hex-Zeichen: so stehen Peer-IDs in Protokollen und in Ersatznamen.
pub fn short_id(peer_id: &str) -> &str {
    peer_id.get(..SHORT_ID_LEN).unwrap_or(peer_id)
}

pub fn load(secrets: &dyn SecretStore) -> AppResult<Option<Identity>> {
    load_entry(secrets, IDENTITY_ENTRY)
}

pub fn load_retired(secrets: &dyn SecretStore) -> AppResult<Option<Identity>> {
    load_entry(secrets, RETIRED_ENTRY)
}

pub fn delete_retired(secrets: &dyn SecretStore) -> AppResult<()> {
    secrets.delete(RETIRED_ENTRY)
}

/// Legt eine neue Identität an und speichert sie. Der Aufrufer prüft vorher, dass keine existiert.
pub fn create(secrets: &dyn SecretStore) -> AppResult<Identity> {
    let identity = Identity::generate();
    secrets.save(IDENTITY_ENTRY, &identity.to_hex())?;
    Ok(identity)
}

/// Ergebnis von [`renew`]: der bisherige Schlüssel (falls es einen gab) und der neue.
pub struct Renewal {
    pub retired: Option<Identity>,
    pub current: Identity,
}

/// Der bisherige Schlüssel wird der ausgemusterte, ein neuer wird die Identität. Der alte Schlüssel wird zuerst
/// gesichert: bricht der Vorgang dazwischen ab, bleibt die Identität erhalten.
pub fn renew(secrets: &dyn SecretStore) -> AppResult<Renewal> {
    let retired = load(secrets)?;
    if let Some(old) = &retired {
        secrets.save(RETIRED_ENTRY, &old.to_hex())?;
    }
    Ok(Renewal { retired, current: create(secrets)? })
}

/// Berechnet die Verfügbarkeit (SPEC 4.1). `has_friends_data`: die Funktion ist aktiviert oder es gibt Datensätze.
pub fn availability(secrets: &dyn SecretStore, has_friends_data: bool) -> Availability {
    match load(secrets) {
        Err(err) => {
            tracing::warn!(%err, "Schlüsselbund nicht nutzbar, Freunde nicht verfügbar");
            Availability::NoSecretStore
        }
        Ok(None) if has_friends_data => Availability::IdentityLost,
        Ok(_) => Availability::Available,
    }
}

/// Ein Eintrag, der keine 64 Hex-Zeichen enthält, ist kein Schlüssel und zählt als fehlend.
fn load_entry(secrets: &dyn SecretStore, name: &str) -> AppResult<Option<Identity>> {
    let Some(hex) = secrets.load(name)? else { return Ok(None) };
    let identity = Identity::from_hex(&hex);
    if identity.is_none() {
        tracing::warn!(entry = name, "Schlüsselbund-Eintrag ist kein Schlüssel, wird als fehlend behandelt");
    }
    Ok(identity)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::services::secrets::MemorySecretStore;

    fn sequence(from: u8, len: u8) -> Vec<u8> {
        (from..from + len).collect()
    }

    fn ascending_salt(from: u8) -> [u8; 16] {
        sequence(from, 16).try_into().unwrap()
    }

    fn golden_identity() -> Identity {
        Identity::from_secret_bytes(&sequence(0x40, 32).try_into().unwrap())
    }

    #[test]
    fn hello_secret_matches_the_golden_vector() {
        let salt = ascending_salt(0);
        assert_eq!(
            HEXLOWER.encode(&golden_identity().hello_secret(&salt)),
            "0fc118eef8a72afd5f595deba158b70a7a0bf925ed85176b5ec3ef430499d80f"
        );
    }

    #[test]
    fn hello_id_is_the_public_key_of_the_hello_secret_and_not_the_peer_id() {
        let salt = ascending_salt(7);
        let identity = golden_identity();
        let hello = SecretKey::from_bytes(&identity.hello_secret(&salt)).public();
        assert_eq!(identity.hello_id(&salt), *hello.as_bytes());
        assert_ne!(HEXLOWER.encode(&identity.hello_id(&salt)), identity.peer_id());
        assert_ne!(identity.hello_id(&salt), identity.hello_id(&ascending_salt(8)));
    }

    #[test]
    fn peer_id_is_64_lowercase_hex() {
        let id = golden_identity().peer_id();
        assert_eq!(id.len(), 64);
        assert!(id.bytes().all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b)));
        assert!(parse_peer_id(&id).is_some());
    }

    #[test]
    fn peer_ids_with_wrong_shape_do_not_parse() {
        let id = golden_identity().peer_id();
        assert!(parse_peer_id(&id[..63]).is_none());
        assert!(parse_peer_id(&id.to_uppercase()).is_none());
        assert!(parse_peer_id(&format!("{}zz", &id[..62])).is_none());
        assert!(parse_peer_id("").is_none());
    }

    #[test]
    fn fingerprint_groups_the_first_sixteen_chars() {
        let id = "3f9ac02177de01b49d5e8c7a21f06b3344aa90bc12de56f7081926a3b4c5d6e7";
        assert_eq!(fingerprint(id), "3f9a c021 77de 01b4");
        assert_eq!(short_id(id), "3f9ac021");
    }

    #[test]
    fn signature_verifies_for_the_signer_over_the_same_parts_only() {
        let (alice, bob) = (golden_identity(), Identity::generate());
        let signature = alice.sign(b"pumpkin/test/1", &[b"eins", b"zwei"]);
        assert!(verify(&alice.peer_id(), b"pumpkin/test/1", &[b"eins", b"zwei"], &signature));
        assert!(!verify(&bob.peer_id(), b"pumpkin/test/1", &[b"eins", b"zwei"], &signature));
        assert!(!verify(&alice.peer_id(), b"pumpkin/other/1", &[b"eins", b"zwei"], &signature));
        assert!(!verify(&alice.peer_id(), b"pumpkin/test/1", &[b"eins", b"drei"], &signature));
        assert!(!verify("kein-peer", b"pumpkin/test/1", &[b"eins", b"zwei"], &signature));
    }

    #[test]
    fn signing_covers_domain_and_parts_as_one_concatenation() {
        let alice = golden_identity();
        let signature = alice.sign(b"ab", &[b"cd"]);
        assert!(verify(&alice.peer_id(), b"a", &[b"bcd"], &signature));
    }

    #[test]
    fn created_identity_is_stored_as_64_hex_and_loads_back() {
        let secrets = MemorySecretStore::new();
        assert!(load(&secrets).unwrap().is_none());
        let created = create(&secrets).unwrap();
        let stored = secrets.load(IDENTITY_ENTRY).unwrap().unwrap();
        assert_eq!(stored.len(), 64);
        assert_eq!(load(&secrets).unwrap().unwrap().peer_id(), created.peer_id());
    }

    #[test]
    fn unreadable_entry_counts_as_missing() {
        let secrets = MemorySecretStore::new();
        secrets.save(IDENTITY_ENTRY, "kein hex").unwrap();
        assert!(load(&secrets).unwrap().is_none());
    }

    #[test]
    fn renew_keeps_the_old_key_as_the_retired_one() {
        let secrets = MemorySecretStore::new();
        let old = create(&secrets).unwrap();
        let renewal = renew(&secrets).unwrap();
        assert_eq!(renewal.retired.unwrap().peer_id(), old.peer_id());
        assert_ne!(renewal.current.peer_id(), old.peer_id());
        assert_eq!(load(&secrets).unwrap().unwrap().peer_id(), renewal.current.peer_id());
        assert_eq!(load_retired(&secrets).unwrap().unwrap().peer_id(), old.peer_id());
        delete_retired(&secrets).unwrap();
        assert!(load_retired(&secrets).unwrap().is_none());
    }

    #[test]
    fn renew_without_an_identity_only_creates_one() {
        let secrets = MemorySecretStore::new();
        let renewal = renew(&secrets).unwrap();
        assert!(renewal.retired.is_none());
        assert!(load_retired(&secrets).unwrap().is_none());
        assert!(load(&secrets).unwrap().is_some());
    }

    #[test]
    fn availability_follows_the_matrix() {
        let secrets = MemorySecretStore::new();
        assert_eq!(availability(&secrets, false), Availability::Available);
        assert_eq!(availability(&secrets, true), Availability::IdentityLost);
        create(&secrets).unwrap();
        assert_eq!(availability(&secrets, true), Availability::Available);
        assert_eq!(availability(&MemorySecretStore::unreachable(), true), Availability::NoSecretStore);
        assert_eq!(availability(&MemorySecretStore::unreachable(), false), Availability::NoSecretStore);
    }
}
