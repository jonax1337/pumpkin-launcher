//! Peer-ID: die Endpoint-ID (Ed25519-Schlüssel) eines Endpunkts, als Text genau 64 kleine Hex-Zeichen (SPEC 4.1).
use std::{fmt, str::FromStr};

use iroh::EndpointId;

const HEX_LENGTH: usize = 64;
/// So viele Hex-Zeichen einer ID dürfen ins Log (SPEC 12.1).
const SHORT_LENGTH: usize = 8;

/// Öffentlicher Schlüssel eines Endpunkts. Die Ordnung ist die der Hex-Darstellung (bytewise), wie sie der
/// Gleichstand doppelter Verbindungen braucht (SPEC 4.4).
#[derive(Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord)]
pub struct PeerId(EndpointId);

/// Text oder Bytes sind keine gültige Peer-ID.
#[derive(Debug, Clone, Copy, PartialEq, Eq, thiserror::Error)]
#[error("keine gültige Peer-ID")]
pub struct InvalidPeerId;

impl PeerId {
    /// Liest die 32 Schlüsselbytes, etwa die Hello-ID aus einem Freundescode.
    pub fn from_bytes(bytes: &[u8; 32]) -> Result<Self, InvalidPeerId> {
        EndpointId::from_bytes(bytes).map(Self).map_err(|_| InvalidPeerId)
    }

    /// Die 32 Schlüsselbytes, etwa als Teil einer signierten Nachricht.
    pub fn as_bytes(&self) -> &[u8; 32] {
        self.0.as_bytes()
    }

    /// Die Kurzform fürs Log.
    pub fn short(&self) -> String {
        self.to_string()[..SHORT_LENGTH].to_owned()
    }

    pub(super) fn endpoint_id(self) -> EndpointId {
        self.0
    }
}

impl From<EndpointId> for PeerId {
    fn from(id: EndpointId) -> Self {
        Self(id)
    }
}

impl fmt::Display for PeerId {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}", self.0)
    }
}

/// Nur die Kurzform, damit ein `{:?}` im Log keine vollständige ID verrät.
impl fmt::Debug for PeerId {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "PeerId({})", self.short())
    }
}

impl FromStr for PeerId {
    type Err = InvalidPeerId;

    /// Nur die kanonische Form; iroh selbst nähme auch andere Schreibweisen an.
    fn from_str(text: &str) -> Result<Self, Self::Err> {
        if !is_lowercase_hex_id(text) {
            return Err(InvalidPeerId);
        }
        text.parse::<EndpointId>().map(Self).map_err(|_| InvalidPeerId)
    }
}

fn is_lowercase_hex_id(text: &str) -> bool {
    text.len() == HEX_LENGTH && text.bytes().all(|byte| matches!(byte, b'0'..=b'9' | b'a'..=b'f'))
}

#[cfg(test)]
mod tests {
    use iroh::SecretKey;

    use super::*;

    fn peer(seed: u8) -> PeerId {
        PeerId::from(SecretKey::from_bytes(&[seed; 32]).public())
    }

    #[test]
    fn displays_as_64_lowercase_hex_and_parses_back() {
        let id = peer(1);

        let text = id.to_string();

        assert!(is_lowercase_hex_id(&text), "{text}");
        assert_eq!(text.parse::<PeerId>(), Ok(id));
    }

    #[test]
    fn refuses_uppercase_short_and_foreign_text() {
        let upper = peer(1).to_string().to_uppercase();

        for text in [upper.as_str(), "abc", "", &"g".repeat(HEX_LENGTH)] {
            assert_eq!(text.parse::<PeerId>(), Err(InvalidPeerId), "{text}");
        }
    }

    #[test]
    fn bytes_round_trip() {
        let id = peer(2);

        assert_eq!(PeerId::from_bytes(id.as_bytes()), Ok(id));
    }

    #[test]
    fn order_follows_the_hex_text() {
        let (a, b) = (peer(3), peer(4));

        assert_eq!(a < b, a.to_string() < b.to_string());
    }

    #[test]
    fn debug_shows_only_the_short_form() {
        let id = peer(5);

        assert_eq!(format!("{id:?}"), format!("PeerId({})", &id.to_string()[..SHORT_LENGTH]));
    }
}
