//! Wertetypen, die Transport (`p2p`), Spiel-Signale (`gamesignal`) und Freunde-Vertrag (`friends::contract`)
//! gemeinsam brauchen. Sie liegen hier, damit keines dieser Teile vom anderen abhängt.
use serde::{Deserialize, Serialize};

pub use crate::models::ModLoader;

/// Weg einer Peer-Verbindung: direkt per UDP oder über das Relay.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum PathKind {
    Direct,
    Relay,
}

/// Woher der LAN-Port einer geteilten Welt stammt.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum PortSource {
    Mod,
    Log,
    Manual,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn path_kinds_serialize_as_plain_strings() {
        assert_eq!(serde_json::to_string(&PathKind::Direct).unwrap(), r#""direct""#);
        assert_eq!(serde_json::to_string(&PathKind::Relay).unwrap(), r#""relay""#);
    }

    #[test]
    fn port_sources_serialize_as_plain_strings() {
        assert_eq!(serde_json::to_string(&PortSource::Mod).unwrap(), r#""mod""#);
        assert_eq!(serde_json::to_string(&PortSource::Log).unwrap(), r#""log""#);
        assert_eq!(serde_json::to_string(&PortSource::Manual).unwrap(), r#""manual""#);
    }
}
