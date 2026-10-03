//! Wegwerf-Spike für Pumpkin Friends (SPEC 14, R0b).
//!
//! Prüft mit echten iroh-1.3-Aufrufen, ob zwei Rechner in verschiedenen Netzen sich per
//! Endpoint-ID finden, welcher Pfad (direkt oder Relay) entsteht, wie lang ein Echo dauert und ob
//! ein Minecraft-LAN-Spiel durch einen Stream getunnelt werden kann. Die Tests unter `tests/`
//! halten das Verhalten der iroh-API fest, auf das `docs/friends/IROH-NOTES.md` verweist.

pub mod net;
pub mod observe;
pub mod protocol;
pub mod stats;
pub mod tunnel;
