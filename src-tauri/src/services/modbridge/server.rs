//! Annahme der Verbindungen und Anmeldung der Mod (`hello`, `welcome`/`reject`).
use std::sync::atomic::Ordering;
use std::sync::Arc;
use std::time::Duration;

use tokio::net::{TcpListener, TcpStream};
use tokio_util::sync::CancellationToken;

use super::connection::{write_message, Connection, LineReader};
use super::protocol::{Handshake, ModToLauncher, RejectReason};
use super::Inner;
use crate::services::gamesignal::GameSignal;

/// So viele Verbindungen dürfen gleichzeitig noch auf ihr `hello` warten.
const MAX_UNAUTHENTICATED: usize = 4;
/// So lange darf die Mod mit dem `hello` brauchen.
const HELLO_TIMEOUT: Duration = Duration::from_secs(2);
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
    let (read_half, write_half) = stream.into_split();
    let (mut reader, mut writer) = (LineReader::new(read_half), write_half);
    let admitted = match authenticate(&inner, &mut reader).await {
        Ok(admitted) => admitted,
        Err(Refusal::Rejected(reason)) => {
            let reject = Handshake::Reject { reason };
            if let Err(err) = write_message(&mut writer, &reject).await {
                tracing::debug!(%err, "Ablehnung nicht gesendet");
            }
            return;
        }
        Err(Refusal::Dropped) => return,
    };
    drop(slot);
    let instance_id = admitted.instance_id.clone();
    let connection_id = admitted.connection_id;
    inner.signals.send(GameSignal::ModConnected { instance_id: instance_id.clone() });
    if let Err(err) = Connection::new(inner.clone(), admitted, reader, writer).run().await {
        tracing::debug!(instance = %instance_id, %err, "Verbindung zur Mod beendet");
    }
    inner.release(&instance_id, connection_id);
    inner.signals.send(GameSignal::ModDisconnected { instance_id });
}

/// Warum eine Verbindung nicht zugelassen wird.
enum Refusal {
    /// Mit Antwort an die Mod.
    Rejected(RejectReason),
    /// Ohne Antwort: kein gültiges `hello`.
    Dropped,
}

/// Liest das `hello` und lässt die Verbindung zu oder lehnt sie ab; die Antwort `welcome` folgt in `Connection::run`.
async fn authenticate(inner: &Inner, reader: &mut LineReader) -> Result<super::Admitted, Refusal> {
    let first = tokio::time::timeout(HELLO_TIMEOUT, reader.next_line()).await;
    let line = match first {
        Ok(Ok(Some(line))) => line,
        Ok(Ok(None)) | Ok(Err(_)) | Err(_) => return Err(Refusal::Dropped),
    };
    let Ok(ModToLauncher::Hello { protocols, token, .. }) = serde_json::from_str(&line) else {
        return Err(Refusal::Dropped);
    };
    inner.admit(&token, &protocols).map_err(Refusal::Rejected)
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
