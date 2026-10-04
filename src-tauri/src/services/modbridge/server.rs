//! Annahme der Verbindungen und Anmeldung der Mod (`hello`, `welcome`/`reject`).
use std::net::SocketAddr;
use std::sync::atomic::Ordering;
use std::sync::Arc;
use std::time::Duration;

use serde_json::Value;
use tokio::net::{TcpListener, TcpStream};
use tokio_util::sync::CancellationToken;

use super::connection::{Admitted, Connection};
use super::framing::{encode_line, write_line, LineReader};
use super::limits::{MAX_UNAUTHENTICATED, PRE_WELCOME_LINE_BYTES};
use super::protocol::{LauncherFrame, ModFrame, RejectReason};
use super::Inner;
use crate::services::gamesignal::GameSignal;

/// Pause nach einem Fehler beim Annehmen, damit ein dauerhafter Fehler nicht den Prozessor bindet.
const ACCEPT_RETRY_DELAY: Duration = Duration::from_millis(100);

pub(super) async fn accept_loop(listener: TcpListener, inner: Arc<Inner>, stop: CancellationToken) {
    loop {
        tokio::select! {
            () = stop.cancelled() => return,
            accepted = listener.accept() => match accepted {
                Ok((stream, _)) => drop(tokio::spawn(serve(stream, inner.clone()))),
                Err(err) => {
                    tracing::warn!(%err, "Verbindung zur Mod nicht angenommen");
                    tokio::time::sleep(ACCEPT_RETRY_DELAY).await;
                }
            },
        }
    }
}

/// Eine Verbindung von der Anmeldung bis zum Ende.
async fn serve(stream: TcpStream, inner: Arc<Inner>) {
    let Some(slot) = UnauthenticatedSlot::acquire(&inner) else {
        tracing::debug!("zu viele unangemeldete Verbindungen zur Mod");
        return;
    };
    if let Err(err) = stream.set_nodelay(true) {
        tracing::debug!(%err, "TCP_NODELAY der Mod-Verbindung nicht gesetzt");
    }
    let (Ok(peer), Ok(local)) = (stream.peer_addr(), stream.local_addr()) else { return };
    let (read_half, mut writer) = stream.into_split();
    let mut reader = LineReader::new(read_half, PRE_WELCOME_LINE_BYTES);
    let admitted = match authenticate(&inner, &mut reader, peer, local).await {
        Ok(admitted) => admitted,
        Err(Refusal::Rejected(reason)) => {
            let line = encode_line(&LauncherFrame::Reject { reason });
            if let Err(err) = write_line(&mut writer, &line, inner.timing.write_stall).await {
                tracing::debug!(%err, "Ablehnung nicht gesendet");
            }
            return;
        }
        Err(Refusal::Dropped) => return,
    };
    drop(slot);
    let instance_id = admitted.instance_id.clone();
    let link_id = admitted.link.id;
    inner.signals.send(GameSignal::ModConnected { instance_id: instance_id.clone() });
    if let Err(err) = Connection::new(inner.clone(), admitted, reader, writer).run().await {
        tracing::debug!(instance = %instance_id, %err, "Verbindung zur Mod beendet");
    }
    inner.release(&instance_id, link_id);
    inner.signals.send(GameSignal::ModDisconnected { instance_id });
}

/// Warum eine Verbindung nicht zugelassen wird.
enum Refusal {
    /// Mit Antwort an die Mod.
    Rejected(RejectReason),
    /// Ohne Antwort: kein gültiges `hello`.
    Dropped,
}

/// Liest das `hello` und lässt die Verbindung zu oder lehnt sie ab; `welcome` folgt in `Connection::run`.
async fn authenticate(
    inner: &Arc<Inner>,
    reader: &mut LineReader<tokio::net::tcp::OwnedReadHalf>,
    peer: SocketAddr,
    local: SocketAddr,
) -> Result<Admitted, Refusal> {
    let first = tokio::time::timeout(inner.timing.hello, reader.next_line()).await;
    let Ok(Ok(Some(line))) = first else { return Err(Refusal::Dropped) };
    match serde_json::from_str(&line) {
        Ok(ModFrame::Hello(hello)) => inner.admit(&hello, peer, local).await.map_err(Refusal::Rejected),
        Ok(_) => Err(Refusal::Dropped),
        Err(_) if is_hello_of_another_protocol(&line) => Err(Refusal::Rejected(RejectReason::Protocol)),
        Err(_) => Err(Refusal::Dropped),
    }
}

/// Ein `hello`, das nicht die Form von Protokoll 2 hat (etwa das einer Mod, die noch Protokoll 1 spricht).
fn is_hello_of_another_protocol(line: &str) -> bool {
    let message: Option<Value> = serde_json::from_str(line).ok();
    message.is_some_and(|message| message["type"] == "hello")
}

/// Zählt eine Verbindung, die noch auf ihr `hello` wartet, bis sie fällt.
struct UnauthenticatedSlot(Arc<Inner>);

impl UnauthenticatedSlot {
    fn acquire(inner: &Arc<Inner>) -> Option<Self> {
        let before = inner.unauthenticated.fetch_add(1, Ordering::SeqCst);
        let slot = Self(inner.clone());
        (before < MAX_UNAUTHENTICATED).then_some(slot)
    }
}

impl Drop for UnauthenticatedSlot {
    fn drop(&mut self) {
        self.0.unauthenticated.fetch_sub(1, Ordering::SeqCst);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_hello_in_the_shape_of_protocol_one_is_recognised_as_another_protocol() {
        assert!(is_hello_of_another_protocol(r#"{"type":"hello","protocols":[1],"token":"t","mod":"0.1.0","minecraft":"26.3"}"#));
        for line in [r#"{"type":"ping"}"#, "nonsense", "[1]", ""] {
            assert!(!is_hello_of_another_protocol(line), "{line}");
        }
    }
}
