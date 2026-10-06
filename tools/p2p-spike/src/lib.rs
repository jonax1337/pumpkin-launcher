//! Standalone network probe for Pumpkin Friends (tools/p2p-spike/README.md).
//!
//! Prüft mit echten iroh-1.3-Aufrufen, ob zwei Rechner in verschiedenen Netzen sich per
//! Endpoint-ID finden, welcher Pfad (direkt oder Relay) entsteht, wie lang ein Echo dauert und ob
//! ein Minecraft-LAN-Spiel durch einen Stream getunnelt werden kann. Die Tests unter `tests/`
//! halten das Verhalten der iroh-API fest, das der produktive Transport verwendet.

pub mod net;
pub mod observe;
pub mod protocol;
pub mod stats;
pub mod tunnel;
