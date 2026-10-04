//! Tunnel zwischen einem Peer-Stream und einer lokalen TCP-Verbindung (SPEC 6.3). Kennt kein Spielprotokoll: was eine
//! lokale Verbindung darf, prüft der Aufrufer in `admit`.
use std::{
    future::Future,
    io,
    net::{IpAddr, SocketAddr},
    sync::{
        atomic::{AtomicBool, AtomicUsize, Ordering},
        Arc,
    },
};

use bytes::Bytes;
use tokio::{
    io::AsyncWriteExt,
    net::{TcpListener, TcpStream},
    task::JoinHandle,
};
use tokio_util::sync::CancellationToken;

use super::{BiStream, CloseCode, FrameError, NetError};

/// Verbindet einen Tunnel-Stream mit einer lokalen TCP-Verbindung (beide Seiten mit TCP_NODELAY); `prefix` (schon von
/// `local` gelesene Bytes) geht zuerst in den Stream. `stop` setzt den Stream zurück und schließt `local`.
pub async fn bridge(
    mut stream: BiStream,
    mut local: TcpStream,
    prefix: Bytes,
    stop: CancellationToken,
) -> io::Result<()> {
    // Ohne TCP_NODELAY hält Nagle kleine Pakete interaktiver Protokolle zurück.
    local.set_nodelay(true)?;
    tokio::select! {
        forwarded = forward(&mut stream, &mut local, &prefix) => forwarded,
        () = stop.cancelled() => {
            stream.reset(CloseCode::NORMAL);
            Ok(())
        }
    }
}

async fn forward(stream: &mut BiStream, local: &mut TcpStream, prefix: &[u8]) -> io::Result<()> {
    stream.write_all(prefix).await?;
    tokio::io::copy_bidirectional(local, stream).await?;
    Ok(())
}

/// Warum kein Tunnel-Stream zustande kam.
#[derive(Debug, thiserror::Error)]
pub enum TunnelError {
    #[error(transparent)]
    Net(#[from] NetError),
    #[error(transparent)]
    Frame(#[from] FrameError),
    /// Die Gegenseite lehnt mit diesem Fehlercode ab.
    #[error("Tunnel abgelehnt: {0}")]
    Refused(String),
    #[error("Tunnel nicht rechtzeitig bestätigt")]
    Timeout,
}

/// Wie viele lokale Verbindungen gleichzeitig laufen dürfen.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ListenerLimits {
    /// Bis zur ersten gültigen Verbindung: so viele ungeprüfte zugleich, weitere werden sofort geschlossen.
    pub before_first_valid: usize,
    /// Danach: so viele zugleich, jede einzeln geprüft.
    pub after_first_valid: usize,
}

/// Lokaler Zuhörer auf `ip:0`. `admit` prüft jede Verbindung, bevor ein Stream geöffnet wird, und liefert die schon
/// gelesenen Bytes zurück; `None` schließt die Verbindung.
#[derive(Debug)]
pub struct LocalListener {
    pub addr: SocketAddr,
    listener: TcpListener,
}

impl LocalListener {
    pub async fn bind(ip: IpAddr) -> io::Result<Self> {
        let listener = TcpListener::bind((ip, 0)).await?;
        Ok(Self { addr: listener.local_addr()?, listener })
    }

    /// Nimmt Verbindungen an, bis `stop` auslöst; danach ist die Adresse geschlossen und jeder Tunnel beendet.
    pub fn serve<A, AF, O, OF>(
        self,
        admit: A,
        open: O,
        limits: ListenerLimits,
        stop: CancellationToken,
    ) -> JoinHandle<()>
    where
        A: Fn(TcpStream, SocketAddr) -> AF + Send + Sync + 'static,
        AF: Future<Output = Option<(TcpStream, Bytes)>> + Send + 'static,
        O: Fn() -> OF + Send + Sync + 'static,
        OF: Future<Output = Result<BiStream, TunnelError>> + Send + 'static,
    {
        let tunnels = Arc::new(Tunnels {
            admit,
            open,
            limits,
            active: Arc::new(AtomicUsize::new(0)),
            validated: AtomicBool::new(false),
            stop,
        });
        tokio::spawn(tunnels.accept_until_stopped(self.listener))
    }
}

/// Geteilter Zustand aller Verbindungen eines Zuhörers.
struct Tunnels<A, O> {
    admit: A,
    open: O,
    limits: ListenerLimits,
    active: Arc<AtomicUsize>,
    validated: AtomicBool,
    stop: CancellationToken,
}

impl<A, AF, O, OF> Tunnels<A, O>
where
    A: Fn(TcpStream, SocketAddr) -> AF + Send + Sync + 'static,
    AF: Future<Output = Option<(TcpStream, Bytes)>> + Send + 'static,
    O: Fn() -> OF + Send + Sync + 'static,
    OF: Future<Output = Result<BiStream, TunnelError>> + Send + 'static,
{
    async fn accept_until_stopped(self: Arc<Self>, listener: TcpListener) {
        loop {
            let accepted = tokio::select! {
                accepted = listener.accept() => accepted,
                () = self.stop.cancelled() => return,
            };
            match accepted {
                Ok((local, client)) => self.handle(local, client),
                Err(err) => tracing::debug!(%err, "lokale Verbindung nicht angenommen"),
            }
        }
    }

    /// Über der Grenze wird die Verbindung sofort geschlossen (fallen gelassen).
    fn handle(self: &Arc<Self>, local: TcpStream, client: SocketAddr) {
        let Some(slot) = self.claim_slot() else {
            return;
        };
        let tunnels = self.clone();
        tokio::spawn(async move {
            tunnels.tunnel(local, client).await;
            drop(slot);
        });
    }

    fn claim_slot(&self) -> Option<Slot> {
        let limit = if self.validated.load(Ordering::SeqCst) {
            self.limits.after_first_valid
        } else {
            self.limits.before_first_valid
        };
        // Statt des auf neueren rustc missbilligten fetch_update: den Zähler nur unter dem Limit anheben und bei einem
        // Rennen mit einem anderen Zuwachs erneut lesen. Der Slot wird einzig am Limit verweigert.
        loop {
            let active = self.active.load(Ordering::SeqCst);
            if active >= limit {
                return None;
            }
            match self.active.compare_exchange(active, active + 1, Ordering::SeqCst, Ordering::SeqCst) {
                Ok(_) => break,
                Err(_) => continue,
            }
        }
        Some(Slot(self.active.clone()))
    }

    async fn tunnel(&self, local: TcpStream, client: SocketAddr) {
        if let Err(err) = local.set_nodelay(true) {
            tracing::debug!(%err, "TCP_NODELAY nicht gesetzt");
            return;
        }
        let Some((local, prefix)) = (self.admit)(local, client).await else {
            return;
        };
        self.validated.store(true, Ordering::SeqCst);
        match (self.open)().await {
            Ok(stream) => {
                if let Err(err) = bridge(stream, local, prefix, self.stop.child_token()).await {
                    tracing::debug!(%err, "Tunnel mit Fehler beendet");
                }
            }
            Err(err) => tracing::debug!(%err, "Tunnel-Stream nicht geöffnet"),
        }
    }
}

/// Belegter Platz unter den gleichzeitigen Verbindungen; wird beim Ende der Verbindung frei.
struct Slot(Arc<AtomicUsize>);

impl Drop for Slot {
    fn drop(&mut self) {
        self.0.fetch_sub(1, Ordering::SeqCst);
    }
}
