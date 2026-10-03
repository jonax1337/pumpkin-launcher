//! Ein iroh-Endpunkt mit den festen Einstellungen aus SPEC 3.3: kein Adress-Lookup, nur Relays der eigenen Karte,
//! Zulassung eingehender Verbindungen durch ein [`Gate`], Schließen mit eigenem Code.
use std::{
    future::Future,
    sync::{Arc, Mutex},
    time::Duration,
};

use futures::future::BoxFuture;
use iroh::{
    endpoint::{presets, Builder, Connection, Incoming, QuicTransportConfig, RelayStatus, VarInt},
    Endpoint, EndpointAddr, SecretKey, TransportAddr, Watcher,
};
use tokio::{
    sync::{mpsc, watch, OwnedSemaphorePermit, Semaphore},
    task::JoinHandle,
};

use super::{
    dialer::within_dial_timeout, gate::GateHooks, relays::SelectedRelays, CloseCode, CloseReason, Dialer, Gate,
    PeerConn, PeerId, RelayEntry, RelaySelection,
};
use crate::services::lock;

const KEEP_ALIVE: Duration = Duration::from_secs(15);
/// Mindestens zwei Lebenszeichen je Leerlaufzeit: auch ein kurzer Testwert lässt eine lebende Verbindung nicht ablaufen,
/// und die 40 s in Produktion behalten ihre 15 s.
const KEEP_ALIVES_PER_IDLE_TIMEOUT: u32 = 2;
const MAX_BIDI_STREAMS: u32 = 16;
/// Mehr gleichzeitige Handshakes werden vor dem Handshake verworfen (SPEC 3.5).
const MAX_HANDSHAKES: usize = 8;
/// So lange darf das erste Erreichen eines Relays dauern, bevor der Endpunkt als ohne Relay gilt.
const ONLINE_WAIT: Duration = Duration::from_secs(5);
/// Angenommene Verbindungen, die noch niemand mit [`PeerNet::accept`] abgeholt hat.
const ACCEPT_QUEUE: usize = 16;

/// Alles, was einen Endpunkt ausmacht.
#[derive(Debug, Clone)]
pub struct NetConfig {
    /// Ed25519-Geheimnis; bestimmt die [`PeerId`].
    pub secret: [u8; 32],
    /// Angenommene ALPNs; leer für einen Endpunkt, der nur anwählt.
    pub alpns: Vec<&'static [u8]>,
    pub relay_map: Vec<RelayEntry>,
    pub relays: RelaySelection,
    /// Ohne IP-Transporte: nur über ein Relay erreichbar, die eigenen Adressen bleiben verborgen.
    pub relay_only: bool,
    pub relay_tls: RelayTls,
    /// Ohne ein Paket so lange gilt die Verbindung als verloren (abgestürzter Peer); in Produktion 40 s.
    pub idle_timeout: Duration,
}

/// Prüfung der Relay-Zertifikate. Abschaltbar nur in Tests, für das In-Process-Relay mit selbst signiertem Zertifikat.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RelayTls {
    Verify,
    #[cfg(test)]
    InsecureForTests,
}

impl RelayTls {
    fn configure(self, builder: Builder) -> Builder {
        match self {
            Self::Verify => builder,
            #[cfg(test)]
            Self::InsecureForTests => builder.ca_tls_config(iroh::tls::CaTlsConfig::insecure_skip_verify()),
        }
    }
}

/// Verbindung zu den Relays.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum NetState {
    /// Noch kein Relay erreicht, die Wartezeit läuft.
    Starting,
    /// Verbunden mit dem Heim-Relay dieses Index.
    Online { home_relay: u8 },
    /// Kein Relay der Karte erreichbar; Peers außerhalb des eigenen Netzes sind nicht anwählbar.
    RelayUnreachable,
}

#[derive(Debug, thiserror::Error)]
pub enum NetError {
    #[error("Relay-Index {0} steht nicht in der Relay-Karte")]
    UnknownRelay(u8),
    #[error("Relay-Adresse „{0}“ ist ungültig")]
    InvalidRelayUrl(String),
    #[error("Endpunkt nicht gebunden: {0}")]
    Bind(String),
    #[error("Peer hat nicht innerhalb des Zeitlimits geantwortet")]
    Timeout,
    #[error("Peer nicht erreichbar")]
    Unreachable,
    #[error("Verbindung beendet ({0:?})")]
    Closed(CloseReason),
}

/// Ein gebundener Endpunkt. Verbindungen leben nur so lange wie er; [`PeerNet::close`] beendet alle mit einem Code.
pub struct PeerNet {
    endpoint: Endpoint,
    relays: SelectedRelays,
    status: watch::Receiver<NetState>,
    accepted: tokio::sync::Mutex<mpsc::Receiver<(Vec<u8>, PeerConn)>>,
    connections: Arc<OpenConnections>,
    acceptor: JoinHandle<()>,
}

impl PeerNet {
    pub async fn bind(config: NetConfig, gate: Arc<dyn Gate>) -> Result<Self, NetError> {
        let relays = SelectedRelays::select(&config.relay_map, config.relays)?;
        let endpoint = builder(&config, &relays, gate)?.bind().await.map_err(|err| NetError::Bind(err.to_string()))?;
        let (status_tx, status) = watch::channel(NetState::Starting);
        tokio::spawn(report_status_until_closed(&endpoint, relays.clone(), status_tx));
        let connections = Arc::new(OpenConnections::default());
        let (accepted_tx, accepted) = mpsc::channel(ACCEPT_QUEUE);
        let acceptor = tokio::spawn(accept_loop(endpoint.clone(), connections.clone(), accepted_tx));
        Ok(Self { endpoint, relays, status, accepted: tokio::sync::Mutex::new(accepted), connections, acceptor })
    }

    pub fn id(&self) -> PeerId {
        PeerId::from(self.endpoint.id())
    }

    /// Index des Heim-Relays, solange eines verbunden ist; das geht als `homeRelay` an Freunde.
    pub fn home_relay(&self) -> Option<u8> {
        match *self.status.borrow() {
            NetState::Online { home_relay } => Some(home_relay),
            NetState::Starting | NetState::RelayUnreachable => None,
        }
    }

    pub fn status(&self) -> watch::Receiver<NetState> {
        self.status.clone()
    }

    /// Wählt `peer` über alle Relays der eigenen Karte an, höchstens 8 s lang. Eine Adresse oder URL vom Peer wird nie
    /// gewählt; iroh probiert alle Relays der Adresse zugleich, ein Heim-Relay muss deshalb nicht vorn stehen.
    pub async fn dial(&self, peer: &PeerId, alpn: &'static [u8]) -> Result<PeerConn, NetError> {
        let addr = dial_addr(peer, &self.relays);
        let conn = within_dial_timeout(async {
            self.endpoint.connect(addr, alpn).await.map_err(|err| {
                tracing::debug!(peer = %peer.short(), %err, "Peer nicht angewählt");
                NetError::Unreachable
            })
        })
        .await?;
        let conn = PeerConn::new(conn);
        self.connections.add(conn.clone());
        Ok(conn)
    }

    /// Nächste vom Gate zugelassene Verbindung mit ihrem ALPN; `None`, sobald der Endpunkt geschlossen ist.
    pub async fn accept(&self) -> Option<(Vec<u8>, PeerConn)> {
        self.accepted.lock().await.recv().await
    }

    /// Schließt jede Verbindung mit `code`, dann den Endpunkt. iroh allein schlösse mit Code 0.
    pub async fn close(&self, code: CloseCode) {
        self.connections.close_all(code);
        self.endpoint.close().await;
    }

    /// Eigene direkte (IP-)Adressen, wie iroh sie Peers anbieten würde.
    #[cfg(test)]
    pub(super) fn direct_addrs(&self) -> Vec<std::net::SocketAddr> {
        self.endpoint.addr().ip_addrs().copied().chain(self.endpoint.bound_sockets()).collect()
    }
}

impl Dialer for PeerNet {
    fn dial<'a>(&'a self, peer: &'a PeerId, alpn: &'static [u8]) -> BoxFuture<'a, Result<PeerConn, NetError>> {
        Box::pin(PeerNet::dial(self, peer, alpn))
    }
}

/// Der Annahme-Task hält eine Kopie des Endpunkts; ohne Abbruch lebte der Endpunkt nach dem Drop weiter.
impl Drop for PeerNet {
    fn drop(&mut self) {
        self.acceptor.abort();
    }
}

fn builder(config: &NetConfig, relays: &SelectedRelays, gate: Arc<dyn Gate>) -> Result<Builder, NetError> {
    let builder = Endpoint::builder(presets::Minimal)
        .secret_key(SecretKey::from_bytes(&config.secret))
        .alpns(config.alpns.iter().map(|alpn| alpn.to_vec()).collect())
        .relay_mode(relays.relay_mode())
        .transport_config(transport_config(config.idle_timeout)?)
        .hooks(GateHooks::new(gate));
    let builder = config.relay_tls.configure(builder);
    if config.relay_only {
        Ok(builder.clear_ip_transports())
    } else {
        with_ip_transports(builder)
    }
}

#[cfg(not(test))]
fn with_ip_transports(builder: Builder) -> Result<Builder, NetError> {
    Ok(builder)
}

/// Tests binden nur Loopback, damit keine Firewall-Abfrage kommt und nichts das eigene Netz verlässt.
#[cfg(test)]
fn with_ip_transports(builder: Builder) -> Result<Builder, NetError> {
    builder.clear_ip_transports().bind_addr("127.0.0.1:0").map_err(|err| NetError::Bind(err.to_string()))
}

fn transport_config(idle_timeout: Duration) -> Result<QuicTransportConfig, NetError> {
    let max_idle =
        idle_timeout.try_into().map_err(|_| NetError::Bind(format!("Leerlaufzeit {idle_timeout:?} zu groß")))?;
    Ok(QuicTransportConfig::builder()
        .keep_alive_interval(keep_alive(idle_timeout))
        .max_idle_timeout(Some(max_idle))
        .max_concurrent_bidi_streams(VarInt::from_u32(MAX_BIDI_STREAMS))
        .max_concurrent_uni_streams(VarInt::from_u32(0))
        .build())
}

fn keep_alive(idle_timeout: Duration) -> Duration {
    KEEP_ALIVE.min(idle_timeout / KEEP_ALIVES_PER_IDLE_TIMEOUT)
}

/// Nur die ID und die Relays der eigenen Karte; ohne Adress-Lookup kennt iroh sonst keinen Weg zum Peer.
fn dial_addr(peer: &PeerId, relays: &SelectedRelays) -> EndpointAddr {
    EndpointAddr::from_parts(peer.endpoint_id(), relays.urls().cloned().map(TransportAddr::Relay))
}

/// Hält den Zustand der Relay-Verbindung aktuell, bis der Endpunkt schließt. Der Task hält den Endpunkt nicht fest.
fn report_status_until_closed(
    endpoint: &Endpoint,
    relays: SelectedRelays,
    status: watch::Sender<NetState>,
) -> impl Future<Output = ()> + Send + 'static {
    let homes = endpoint.home_relay_status();
    let closed = endpoint.closed();
    async move {
        tokio::select! {
            () = closed => {}
            () = report_status(homes, relays, status) => {}
        }
    }
}

/// Ein unerreichbares Relay wird nie Heim-Relay, `homes` bleibt dann leer: erkennbar nur am Ablauf der Wartezeit.
async fn report_status(
    mut homes: impl Watcher<Value = Vec<RelayStatus>>,
    relays: SelectedRelays,
    status: watch::Sender<NetState>,
) {
    let _ = tokio::time::timeout(ONLINE_WAIT, until_connected(&mut homes)).await;
    loop {
        status.send_replace(state_of(&homes.get(), &relays));
        if homes.updated().await.is_err() {
            return;
        }
    }
}

async fn until_connected(homes: &mut impl Watcher<Value = Vec<RelayStatus>>) {
    while !homes.get().iter().any(RelayStatus::is_connected) {
        if homes.updated().await.is_err() {
            return;
        }
    }
}

fn state_of(homes: &[RelayStatus], relays: &SelectedRelays) -> NetState {
    homes
        .iter()
        .filter(|home| home.is_connected())
        .find_map(|home| relays.index_of(home.url()))
        .map_or(NetState::RelayUnreachable, |home_relay| NetState::Online { home_relay })
}

/// Nimmt eingehende Verbindungen an, solange der Endpunkt lebt; nie ohne diese Schleife, sonst hingen Anwählende bis
/// zur Leerlaufzeit, statt abgewiesen zu werden.
async fn accept_loop(
    endpoint: Endpoint,
    connections: Arc<OpenConnections>,
    accepted: mpsc::Sender<(Vec<u8>, PeerConn)>,
) {
    let handshakes = Arc::new(Semaphore::new(MAX_HANDSHAKES));
    while let Some(incoming) = endpoint.accept().await {
        match handshakes.clone().try_acquire_owned() {
            Ok(permit) => {
                tokio::spawn(finish_handshake(incoming, permit, connections.clone(), accepted.clone()));
            }
            // Vor dem Handshake: kein Paket zurück, die Gegenseite erfährt nichts.
            Err(_) => incoming.ignore(),
        }
    }
}

/// Der Handshake schließt den Aufruf des Gates ein; abgewiesene Verbindungen enden hier als Fehler.
async fn finish_handshake(
    incoming: Incoming,
    permit: OwnedSemaphorePermit,
    connections: Arc<OpenConnections>,
    accepted: mpsc::Sender<(Vec<u8>, PeerConn)>,
) {
    let handshake = incoming.await;
    drop(permit);
    match handshake {
        Ok(conn) => hand_over(conn, &connections, &accepted).await,
        Err(err) => tracing::debug!(%err, "eingehende Verbindung nicht zustande gekommen"),
    }
}

/// Holt niemand mehr Verbindungen ab, ist der Endpunkt am Ende; die Gegenseite erfährt das als `SHUTDOWN`.
async fn hand_over(conn: Connection, connections: &OpenConnections, accepted: &mpsc::Sender<(Vec<u8>, PeerConn)>) {
    let alpn = conn.alpn().to_vec();
    let conn = PeerConn::new(conn);
    connections.add(conn.clone());
    if let Err(unclaimed) = accepted.send((alpn, conn)).await {
        let (_, conn) = unclaimed.0;
        conn.close(CloseCode::SHUTDOWN);
    }
}

/// Alle offenen Verbindungen eines Endpunkts, damit [`PeerNet::close`] jede mit dem eigenen Code schließen kann.
#[derive(Default)]
struct OpenConnections {
    open: Mutex<Vec<PeerConn>>,
}

impl OpenConnections {
    fn add(&self, conn: PeerConn) {
        let mut open = lock(&self.open);
        open.retain(PeerConn::is_open);
        open.push(conn);
    }

    fn close_all(&self, code: CloseCode) {
        for conn in lock(&self.open).drain(..) {
            conn.close(code);
        }
    }
}

#[cfg(test)]
mod tests {
    use std::borrow::Cow;

    use super::*;
    use crate::services::p2p::RelayOperator;

    #[test]
    fn dial_address_holds_only_the_relays_of_the_own_map() {
        let map = vec![RelayEntry {
            index: 0,
            url: Cow::Borrowed("https://relay-a.example.org./"),
            operator: RelayOperator::Pumpkin,
            quic_port: None,
        }];
        let relays = SelectedRelays::select(&map, RelaySelection::All).unwrap();
        let peer = PeerId::from(SecretKey::from_bytes(&[1; 32]).public());

        let addr = dial_addr(&peer, &relays);

        let urls: Vec<String> = addr.relay_urls().map(|url| url.to_string()).collect();
        assert_eq!(urls, ["https://relay-a.example.org./"]);
        assert_eq!(addr.ip_addrs().count(), 0);
    }

    #[test]
    fn keep_alive_is_fifteen_seconds_for_the_production_idle_timeout() {
        assert_eq!(keep_alive(Duration::from_secs(40)), Duration::from_secs(15));
    }

    #[test]
    fn short_idle_timeout_gets_two_keep_alives_per_period() {
        assert_eq!(keep_alive(Duration::from_millis(1500)), Duration::from_millis(750));
    }
}
