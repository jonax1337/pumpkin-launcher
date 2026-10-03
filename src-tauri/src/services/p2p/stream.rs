//! Bi-Stream einer Peer-Verbindung: liest Rahmen (SPEC 5.1) oder rohe Bytes und lässt sich mit Code zurücksetzen.
use std::{
    io,
    pin::Pin,
    task::{Context, Poll},
};

use iroh::endpoint::{RecvStream, SendStream};
use serde::de::DeserializeOwned;
use tokio::io::{AsyncRead, AsyncWrite, ReadBuf};

use super::{frame, CloseCode, FrameError};

/// Beide Richtungen eines QUIC-Streams. Als `AsyncRead`/`AsyncWrite` nutzbar; `shutdown()` beendet die Senderichtung
/// sauber, [`BiStream::reset`] bricht beide ab.
#[derive(Debug)]
pub struct BiStream {
    send: SendStream,
    recv: RecvStream,
}

impl BiStream {
    pub(super) fn new(send: SendStream, recv: RecvStream) -> Self {
        Self { send, recv }
    }

    /// Liest einen Rahmen. Ein kaputter oder zu großer Rahmen setzt den Stream mit `PROTOCOL` zurück (SPEC 5.1).
    pub async fn read_frame<T: DeserializeOwned>(&mut self, limit: usize) -> Result<T, FrameError> {
        let read = frame::read(&mut self.recv, limit).await;
        if read.is_err() {
            self.reset(CloseCode::PROTOCOL);
        }
        read
    }

    /// Bricht beide Richtungen mit `code` ab; die Gegenseite liest dann den Code statt weiterer Daten.
    pub fn reset(&mut self, code: CloseCode) {
        // Schon beendete Richtungen melden einen Fehler; abgebrochen sind sie dann ohnehin.
        let _ = self.send.reset(code.to_varint());
        let _ = self.recv.stop(code.to_varint());
    }
}

impl AsyncRead for BiStream {
    fn poll_read(mut self: Pin<&mut Self>, cx: &mut Context<'_>, buf: &mut ReadBuf<'_>) -> Poll<io::Result<()>> {
        AsyncRead::poll_read(Pin::new(&mut self.recv), cx, buf)
    }
}

impl AsyncWrite for BiStream {
    fn poll_write(mut self: Pin<&mut Self>, cx: &mut Context<'_>, buf: &[u8]) -> Poll<io::Result<usize>> {
        AsyncWrite::poll_write(Pin::new(&mut self.send), cx, buf)
    }

    fn poll_flush(mut self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<io::Result<()>> {
        AsyncWrite::poll_flush(Pin::new(&mut self.send), cx)
    }

    fn poll_shutdown(mut self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<io::Result<()>> {
        AsyncWrite::poll_shutdown(Pin::new(&mut self.send), cx)
    }
}
