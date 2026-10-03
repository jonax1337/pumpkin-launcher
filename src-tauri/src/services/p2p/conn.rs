//! Eine Peer-Verbindung: Streams, Weg (direkt oder Relay), Umlaufzeit und Schließen mit den Codes aus SPEC 3.6.
use std::{fmt, time::Duration};

use iroh::endpoint::{Connection, ConnectionError, Side, VarInt};

use super::{BiStream, NetError, PeerId};
use crate::services::shared_types::PathKind;

/// QUIC-Anwendungs-Fehlercode beim Schließen einer Verbindung oder beim Zurücksetzen eines Streams.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub struct CloseCode(u32);

impl CloseCode {
    /// Normales Ende; auch für das stille Abweisen.
    pub const NORMAL: Self = Self(0);
    pub const NOT_FRIEND: Self = Self(2);
    pub const DUPLICATE: Self = Self(3);
    /// Kaputter Rahmen, zu groß oder Tunnel-Prüfung fehlgeschlagen; auch der Code zum Zurücksetzen eines Streams.
    pub const PROTOCOL: Self = Self(4);
    pub const RATE_LIMITED: Self = Self(5);
    /// Launcher beendet, Funktion aus oder Endpunkt neu gebunden.
    pub const SHUTDOWN: Self = Self(6);

    pub(super) fn to_varint(self) -> VarInt {
        VarInt::from_u32(self.0)
    }

    /// Codes außerhalb von `u32` hat keine Seite vergeben; sie landen auf einem Wert, den kein Vergleich trifft.
    fn from_varint(code: VarInt) -> Self {
        Self(u32::try_from(code.into_inner()).unwrap_or(u32::MAX))
    }
}

/// Wie eine Verbindung geendet hat.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CloseReason {
    /// Die Gegenseite hat mit diesem Code geschlossen.
    Peer(CloseCode),
    /// Wir selbst haben geschlossen.
    Local,
    /// Leerlauf über die Leerlaufzeit hinaus: die Gegenseite ist weg (Absturz, Netz).
    TimedOut,
    /// Sonst abgebrochen (Protokollfehler des QUIC-Stacks, Neustart der Gegenseite).
    Lost,
}

impl From<ConnectionError> for CloseReason {
    fn from(error: ConnectionError) -> Self {
        match error {
            ConnectionError::ApplicationClosed(close) => Self::Peer(CloseCode::from_varint(close.error_code)),
            ConnectionError::LocallyClosed => Self::Local,
            ConnectionError::TimedOut => Self::TimedOut,
            _ => Self::Lost,
        }
    }
}

/// Wer eine Verbindung aufgebaut hat.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Direction {
    /// Wir haben angewählt.
    Outgoing,
    /// Die Gegenseite hat angewählt.
    Incoming,
}

/// Bei zwei Verbindungen zwischen denselben Peers bleibt die, die der Peer mit der kleineren ID angewählt hat
/// (SPEC 4.4); beide Seiten kommen so unabhängig voneinander auf dieselbe Verbindung.
pub fn duplicate_survivor(local: &PeerId, remote: &PeerId) -> Direction {
    if local < remote {
        Direction::Outgoing
    } else {
        Direction::Incoming
    }
}

/// Eine aufgebaute, authentifizierte Verbindung. Sie lebt nur so lange wie ihr [`super::PeerNet`].
#[derive(Clone)]
pub struct PeerConn {
    conn: Connection,
}

impl PeerConn {
    pub(super) fn new(conn: Connection) -> Self {
        Self { conn }
    }

    /// Die durch den TLS-Handshake belegte ID der Gegenseite.
    pub fn remote(&self) -> PeerId {
        PeerId::from(self.conn.remote_id())
    }

    pub fn direction(&self) -> Direction {
        match self.conn.side() {
            Side::Client => Direction::Outgoing,
            Side::Server => Direction::Incoming,
        }
    }

    /// Öffnet einen Bi-Stream. Die Gegenseite sieht ihn erst mit dem ersten Byte, also sofort den Öffnungsrahmen senden.
    /// Wartet, solange schon 16 Streams offen sind.
    pub async fn open_bi(&self) -> Result<BiStream, NetError> {
        let (send, recv) = self.conn.open_bi().await.map_err(closed)?;
        Ok(BiStream::new(send, recv))
    }

    pub async fn accept_bi(&self) -> Result<BiStream, NetError> {
        let (send, recv) = self.conn.accept_bi().await.map_err(closed)?;
        Ok(BiStream::new(send, recv))
    }

    /// Weg, über den gerade gesendet wird; `None`, solange keiner gewählt ist.
    pub fn path(&self) -> Option<PathKind> {
        let paths = self.conn.paths();
        let selected = paths.iter().find(|path| path.is_selected())?;
        if selected.is_ip() {
            Some(PathKind::Direct)
        } else {
            selected.is_relay().then_some(PathKind::Relay)
        }
    }

    /// Umlaufzeit des gewählten Wegs.
    pub fn rtt(&self) -> Option<Duration> {
        self.conn.paths().iter().find(|path| path.is_selected()).map(|path| path.rtt())
    }

    pub fn close(&self, code: CloseCode) {
        self.conn.close(code.to_varint(), b"");
    }

    /// Wartet, bis die Verbindung endet, und sagt, wie.
    pub async fn closed(&self) -> CloseReason {
        CloseReason::from(self.conn.closed().await)
    }

    pub(super) fn is_open(&self) -> bool {
        self.conn.close_reason().is_none()
    }
}

impl fmt::Debug for PeerConn {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("PeerConn").field("remote", &self.remote()).field("direction", &self.direction()).finish()
    }
}

fn closed(error: ConnectionError) -> NetError {
    NetError::Closed(CloseReason::from(error))
}

#[cfg(test)]
mod tests {
    use iroh::{endpoint::ApplicationClose, SecretKey};

    use super::*;

    fn peer(seed: u8) -> PeerId {
        PeerId::from(SecretKey::from_bytes(&[seed; 32]).public())
    }

    #[test]
    fn both_sides_keep_the_connection_dialed_by_the_lower_id() {
        let (a, b) = (peer(1), peer(2));
        let (low, high) = if a < b { (a, b) } else { (b, a) };

        assert_eq!(duplicate_survivor(&low, &high), Direction::Outgoing);
        assert_eq!(duplicate_survivor(&high, &low), Direction::Incoming);
    }

    #[test]
    fn application_close_keeps_the_peer_code() {
        let close = ApplicationClose { error_code: VarInt::from_u32(6), reason: Vec::new().into() };

        assert_eq!(
            CloseReason::from(ConnectionError::ApplicationClosed(close)),
            CloseReason::Peer(CloseCode::SHUTDOWN)
        );
    }

    #[test]
    fn codes_beyond_u32_match_no_known_code() {
        let code = CloseCode::from_varint(VarInt::from_u64(u64::from(u32::MAX) + 1).unwrap());

        assert_eq!(code, CloseCode(u32::MAX));
    }

    #[test]
    fn idle_timeout_and_local_close_are_told_apart() {
        assert_eq!(CloseReason::from(ConnectionError::TimedOut), CloseReason::TimedOut);
        assert_eq!(CloseReason::from(ConnectionError::LocallyClosed), CloseReason::Local);
        assert_eq!(CloseReason::from(ConnectionError::Reset), CloseReason::Lost);
    }
}
