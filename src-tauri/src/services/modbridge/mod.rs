//! Lokale Brücke zur Fabric-Mod: JSON-Zeilen über Loopback, nur für den Start-Token der jeweiligen Instanz.
//!
//! Die Brücke lauscht ausschließlich auf `127.0.0.1`, also nehmen sie nur Prozesse dieses Rechners an. Jeder Start
//! einer Fabric-Instanz bekommt einen eigenen Token (`launch_env`); er bindet genau eine Verbindung an genau diesen
//! Start und verfällt mit `forget`. Was die Mod schickt, ist nicht vertrauenswürdig (siehe `protocol`).
mod connection;
pub mod protocol;
mod server;
#[cfg(test)]
mod tests;

use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, AtomicUsize};
use std::sync::{Arc, Mutex};

use tokio::sync::mpsc;
use tokio::task::JoinHandle;
use tokio_util::sync::CancellationToken;
use uuid::Uuid;

use crate::error::AppResult;
use crate::models::ModLoader;
use crate::services::gamesignal::GameSignals;
use crate::services::lock;
use protocol::{LauncherToMod, RejectReason, PROTOCOL_VERSION};

pub const ENV_PORT: &str = "PUMPKIN_IPC_PORT";
pub const ENV_TOKEN: &str = "PUMPKIN_IPC_TOKEN";
pub const ENV_PROTOCOL: &str = "PUMPKIN_IPC_PROTOCOL";

/// So viele Nachrichten warten höchstens auf eine langsame Mod; darüber wird die Verbindung getrennt.
const OUTBOX_CAPACITY: usize = 64;

#[derive(Clone)]
pub struct ModBridge {
    inner: Arc<Inner>,
}

struct Inner {
    signals: GameSignals,
    state: Mutex<State>,
    next_connection_id: AtomicU64,
    /// Verbindungen, die ihr `hello` noch nicht geschickt haben.
    unauthenticated: AtomicUsize,
}

#[derive(Default)]
struct State {
    listening: Option<Listening>,
    /// Gestartete Instanzen je Instanz-ID.
    launches: HashMap<String, Launch>,
}

struct Listening {
    port: u16,
    stop: CancellationToken,
    accepting: JoinHandle<()>,
}

/// Ein Start einer Instanz: sein Token und die (höchstens eine) Verbindung der Mod dazu.
struct Launch {
    token: String,
    link: Option<Link>,
    /// Zuletzt gesendeter Stand, den eine später verbindende Mod als Erstes bekommt.
    last_snapshot: Option<LauncherToMod>,
}

struct Link {
    id: u64,
    outbox: mpsc::Sender<LauncherToMod>,
    close: CancellationToken,
}

/// Was eine zugelassene Verbindung braucht.
struct Admitted {
    instance_id: String,
    connection_id: u64,
    outbox: mpsc::Receiver<LauncherToMod>,
    close: CancellationToken,
    snapshot: Option<LauncherToMod>,
}

impl ModBridge {
    /// Gestoppt: bis `start` lauscht nichts, und `launch_env` liefert nichts.
    pub fn new(signals: GameSignals) -> Self {
        Self {
            inner: Arc::new(Inner {
                signals,
                state: Mutex::default(),
                next_connection_id: AtomicU64::new(1),
                unauthenticated: AtomicUsize::new(0),
            }),
        }
    }

    /// Beginnt auf `127.0.0.1` an einem freien Port zu lauschen; läuft die Brücke schon, passiert nichts.
    pub async fn start(&self) -> AppResult<()> {
        let mut state = lock(&self.inner.state);
        if state.listening.is_some() {
            return Ok(());
        }
        let listener = std::net::TcpListener::bind((std::net::Ipv4Addr::LOCALHOST, 0))?;
        listener.set_nonblocking(true)?;
        let port = listener.local_addr()?.port();
        let stop = CancellationToken::new();
        let accepting = tokio::spawn(server::accept_loop(tokio::net::TcpListener::from_std(listener)?, self.inner.clone(), stop.clone()));
        state.listening = Some(Listening { port, stop, accepting });
        tracing::info!(port, "Brücke zur Mod lauscht");
        Ok(())
    }

    /// Hört auf zu lauschen, trennt alle Verbindungen und macht alle Tokens ungültig. Danach ist der Port frei.
    pub async fn stop(&self) {
        let (listening, launches) = {
            let mut state = lock(&self.inner.state);
            (state.listening.take(), std::mem::take(&mut state.launches))
        };
        for link in launches.into_values().filter_map(|launch| launch.link) {
            link.close.cancel();
        }
        if let Some(listening) = listening {
            listening.stop.cancel();
            if let Err(err) = listening.accepting.await {
                tracing::warn!(%err, "Annahme der Brücke abgebrochen");
            }
            tracing::info!("Brücke zur Mod gestoppt");
        }
    }

    /// Umgebungsvariablen für den Start einer Instanz: bei Fabric und laufender Brücke Port, neuer Token und
    /// Protokollversion, sonst nichts. Ein früherer Token derselben Instanz verfällt.
    pub fn launch_env(&self, instance_id: &str, loader: ModLoader) -> Vec<(String, String)> {
        if loader != ModLoader::Fabric {
            return Vec::new();
        }
        let mut state = lock(&self.inner.state);
        let Some(port) = state.listening.as_ref().map(|listening| listening.port) else { return Vec::new() };
        let token = new_token();
        let previous = state.launches.insert(instance_id.to_owned(), Launch { token: token.clone(), link: None, last_snapshot: None });
        close_link(previous);
        vec![
            (ENV_PORT.to_owned(), port.to_string()),
            (ENV_TOKEN.to_owned(), token),
            (ENV_PROTOCOL.to_owned(), PROTOCOL_VERSION.to_string()),
        ]
    }

    /// Der Start der Instanz ist zu Ende: Token ungültig, Verbindung getrennt.
    pub fn forget(&self, instance_id: &str) {
        let launch = lock(&self.inner.state).launches.remove(instance_id);
        close_link(launch);
    }

    pub fn is_connected(&self, instance_id: &str) -> bool {
        lock(&self.inner.state).launches.get(instance_id).is_some_and(|launch| launch.link.is_some())
    }

    /// Schickt der Mod der Instanz eine Nachricht; ohne Verbindung geht nur der letzte `Snapshot` nicht verloren.
    /// Hinkt die Mod so weit hinterher, dass ihre Warteschlange voll ist, wird die Verbindung getrennt.
    pub fn push(&self, instance_id: &str, message: LauncherToMod) {
        let mut state = lock(&self.inner.state);
        let Some(launch) = state.launches.get_mut(instance_id) else { return };
        if matches!(message, LauncherToMod::Snapshot { .. }) {
            launch.last_snapshot = Some(message.clone());
        }
        let Some(link) = &launch.link else { return };
        if link.outbox.try_send(message).is_err() {
            tracing::warn!(instance = %instance_id, "Warteschlange der Mod voll: Verbindung getrennt");
            link.close.cancel();
        }
    }
}

impl Inner {
    /// Lässt die Verbindung zu, deren `hello` den Token eines gestarteten Spiels nennt und Protokoll 1 spricht.
    fn admit(&self, token: &str, protocols: &[u32]) -> Result<Admitted, RejectReason> {
        let mut state = lock(&self.state);
        let (instance_id, launch) = state.launches.iter_mut().find(|(_, launch)| launch.token == token).ok_or(RejectReason::Token)?;
        if !protocols.contains(&PROTOCOL_VERSION) {
            return Err(RejectReason::Protocol);
        }
        if launch.link.is_some() {
            return Err(RejectReason::Duplicate);
        }
        let (outbox_tx, outbox) = mpsc::channel(OUTBOX_CAPACITY);
        let close = CancellationToken::new();
        let connection_id = self.next_connection_id.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
        launch.link = Some(Link { id: connection_id, outbox: outbox_tx, close: close.clone() });
        Ok(Admitted { instance_id: instance_id.clone(), connection_id, outbox, close, snapshot: launch.last_snapshot.clone() })
    }

    /// Die Verbindung ist zu Ende; der Token bleibt gültig, damit die Mod sich neu verbinden kann.
    fn release(&self, instance_id: &str, connection_id: u64) {
        let mut state = lock(&self.state);
        let Some(launch) = state.launches.get_mut(instance_id) else { return };
        if launch.link.as_ref().is_some_and(|link| link.id == connection_id) {
            launch.link = None;
        }
    }
}

fn close_link(launch: Option<Launch>) {
    if let Some(link) = launch.and_then(|launch| launch.link) {
        link.close.cancel();
    }
}

/// 32 Zufallsbyte als 64 Hexzeichen. Eine UUID v4 liefert 122 Zufallsbits aus dem Zufallsgenerator des Systems; zwei
/// davon ergeben mehr als 240 Bit.
fn new_token() -> String {
    format!("{}{}", Uuid::new_v4().simple(), Uuid::new_v4().simple())
}
