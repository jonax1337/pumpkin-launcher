//! Verbindet einen QUIC-Bi-Stream mit einer lokalen TCP-Verbindung (wie SPEC 6.3 `bridge`).

use std::io;

use iroh::endpoint::{RecvStream, SendStream};
use tokio::net::TcpStream;

/// Kopiert in beide Richtungen, bis beide Seiten fertig sind; liefert (TCP→Stream, Stream→TCP) Bytes.
pub async fn bridge(
    send: SendStream,
    recv: RecvStream,
    mut tcp: TcpStream,
) -> io::Result<(u64, u64)> {
    // Ohne TCP_NODELAY bremst Nagle die kleinen Minecraft-Pakete (SPEC 6, F7).
    tcp.set_nodelay(true)?;
    let mut stream = tokio::io::join(recv, send);
    tokio::io::copy_bidirectional(&mut tcp, &mut stream).await
}
