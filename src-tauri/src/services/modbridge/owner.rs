//! Die Frage, ob eine Verbindung vom Spielprozess kommt, den der Launcher gestartet hat (docs/friends/INGAME.md, 5.2).
use std::io;
use std::net::SocketAddr;

use crate::services::sockowner;

pub trait OwnerCheck: Send + Sync {
    /// Gehört dem Prozess `pid` die Verbindung, die der Launcher von `peer` an `local` angenommen hat? Ein Fehler beim
    /// Nachschlagen ist ein Fehler, kein „nein“; die Brücke lehnt dann trotzdem ab.
    fn owns(&self, pid: u32, peer: SocketAddr, local: SocketAddr) -> io::Result<bool>;
}

/// Fragt das Betriebssystem (`sockowner`).
pub(super) struct SocketOwner;

impl OwnerCheck for SocketOwner {
    fn owns(&self, pid: u32, peer: SocketAddr, local: SocketAddr) -> io::Result<bool> {
        sockowner::connects_from(pid, peer, local)
    }
}
