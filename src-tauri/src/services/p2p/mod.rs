//! Transport der Freunde-Funktion über iroh (QUIC): Endpunkte, Relay-Karte, Zulassung, Rahmen, Streams und Tunnel.
//! Kennt weder Freunde noch Minecraft: wen ein Endpunkt zulässt, entscheidet ein [`Gate`] des Aufrufers.
mod conn;
mod dialer;
mod endpoint;
pub mod frame;
mod gate;
mod peer_id;
mod relays;
mod stream;
pub mod tunnel;

#[cfg(test)]
mod tests;

pub use conn::{duplicate_survivor, CloseCode, CloseReason, Direction, PeerConn};
pub use dialer::{Dialer, DIAL_TIMEOUT};
pub use endpoint::{NetConfig, NetError, NetState, PeerNet, RelayTls};
pub use frame::FrameError;
pub use gate::{Admission, Gate};
pub use peer_id::{InvalidPeerId, PeerId};
pub use relays::{find_relay, RelayEntry, RelayOperator, RelaySelection, RELAY_MAP};
pub use stream::BiStream;

#[cfg(test)]
pub(crate) use relays::test_relay;
