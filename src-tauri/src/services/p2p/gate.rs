//! Zulassung eingehender Verbindungen nach dem TLS-Handshake (SPEC 3.5). Wen sie zulässt, entscheidet der Aufrufer.
use std::{fmt, sync::Arc};

use iroh::endpoint::{AfterHandshakeOutcome, Connection, EndpointHooks, Side};

use super::{CloseCode, PeerId};

/// Entscheidet nach dem TLS-Handshake über eine eingehende Verbindung; die Peer-ID ist dann authentisch.
pub trait Gate: Send + Sync + 'static {
    fn admit(&self, peer: &PeerId, alpn: &[u8]) -> Admission;
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Admission {
    Accept,
    /// Schließen mit diesem Code; die Gegenseite erfährt den Grund.
    Reject(CloseCode),
    /// Schließen mit Code 0 ohne Grund und ohne Rahmen. Nach dem Handshake schickt QUIC dabei immer ein
    /// CONNECTION_CLOSE; für die Gegenseite sieht das aus wie ein normales Ende, nicht wie eine Ablehnung.
    Drop,
}

/// Hängt ein [`Gate`] in den Handshake des Endpunkts.
pub(super) struct GateHooks {
    gate: Arc<dyn Gate>,
}

impl GateHooks {
    pub(super) fn new(gate: Arc<dyn Gate>) -> Self {
        Self { gate }
    }

    fn outcome(&self, conn: &Connection) -> AfterHandshakeOutcome {
        // iroh ruft den Hook auch für ausgehende Verbindungen auf; die prüft das Gate nicht.
        if conn.side() == Side::Client {
            return AfterHandshakeOutcome::Accept;
        }
        match self.gate.admit(&PeerId::from(conn.remote_id()), conn.alpn()) {
            Admission::Accept => AfterHandshakeOutcome::Accept,
            Admission::Reject(code) => reject(code),
            Admission::Drop => reject(CloseCode::NORMAL),
        }
    }
}

fn reject(code: CloseCode) -> AfterHandshakeOutcome {
    AfterHandshakeOutcome::Reject { error_code: code.to_varint(), reason: Vec::new() }
}

impl EndpointHooks for GateHooks {
    async fn after_handshake<'a>(&'a self, conn: &'a Connection) -> AfterHandshakeOutcome {
        self.outcome(conn)
    }
}

impl fmt::Debug for GateHooks {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str("GateHooks")
    }
}
