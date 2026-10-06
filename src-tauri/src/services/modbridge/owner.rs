//! Die Frage, ob eine Verbindung vom Spielprozess kommt, den der Launcher gestartet hat (docs/bridge/README.md, "Connection and ownership").
use std::io;
use std::net::SocketAddr;

use crate::services::sockowner;

pub trait OwnerCheck: Send + Sync {
    /// Gehört dem Prozess `pid` die Verbindung, die der Launcher von `peer` an `local` angenommen hat? Ein Fehler beim
    /// Nachschlagen ist ein Fehler, kein „nein“; die Brücke lehnt dann trotzdem ab.
    fn owns(&self, pid: u32, peer: SocketAddr, local: SocketAddr) -> io::Result<bool>;
}

/// Ein vorgegebenes Urteil, das ein Test jederzeit ändern kann.
#[cfg(test)]
pub(super) struct OwnerFn(pub std::sync::Arc<dyn Fn(u32, SocketAddr, SocketAddr) -> io::Result<bool> + Send + Sync>);

#[cfg(test)]
impl OwnerCheck for OwnerFn {
    fn owns(&self, pid: u32, peer: SocketAddr, local: SocketAddr) -> io::Result<bool> {
        (self.0)(pid, peer, local)
    }
}

/// Fragt das Betriebssystem (`sockowner`).
pub(super) struct SocketOwner;

impl OwnerCheck for SocketOwner {
    fn owns(&self, pid: u32, peer: SocketAddr, local: SocketAddr) -> io::Result<bool> {
        sockowner::connects_from(pid, peer, local)
    }
}
