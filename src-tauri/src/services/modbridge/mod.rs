//! Lokale Brücke zur Mod im Spiel: JSON-Zeilen über Loopback, Protokoll 2 (docs/friends/INGAME.md, 5.1 bis 5.3).
//!
//! Die Brücke lauscht ausschließlich auf `127.0.0.1`. Jeder Start eines Spiels bekommt einen Datensatz mit eigenem Token
//! (`register_launch`); den Prozess des Spiels nennt `bind_pid`, sobald es ihn gibt. Eine Verbindung wird nur
//! angenommen, wenn der Token passt und das Betriebssystem sie diesem Prozess zuordnet. Der Datensatz verfällt mit
//! `forget`. Was die Mod schickt, ist nicht vertrauenswürdig (siehe `protocol`); was ein Vorgang bewirkt, entscheidet der
//! `OpHandler`, den die Freunde-Funktion einsetzt.
mod connection;
mod framing;
mod handler;
pub mod ingame;
mod launch;
pub mod limits;
mod listener;
pub mod ops;
mod owner;
pub mod protocol;
mod queue;
mod server;
mod state;
pub mod topics;
mod window;
#[cfg(test)]
mod tests;
#[cfg(test)]
mod tests_fixtures;
#[cfg(test)]
mod tests_limits;
#[cfg(test)]
mod tests_ops;

use std::sync::Arc;

use tokio::sync::broadcast;
use tokio_util::sync::CancellationToken;
use uuid::Uuid;

use crate::error::AppResult;
use crate::services::gamesignal::{GameSignal, GameSignals};
use crate::services::lock;
pub use handler::{OpContext, OpHandler};
pub use launch::Expectations;
use launch::Launch;
use limits::Timing;
use owner::{OwnerCheck, SocketOwner};
use protocol::{ClosingReason, ModNotify, PROTOCOL_VERSION};
use state::{Inner, Listening};
use topics::TopicValue;

pub const ENV_PORT: &str = "PUMPKIN_IPC_PORT";
pub const ENV_TOKEN: &str = "PUMPKIN_IPC_TOKEN";
pub const ENV_PROTOCOL: &str = "PUMPKIN_IPC_PROTOCOL";

#[derive(Clone)]
pub struct ModBridge {
    inner: Arc<Inner>,
}

impl ModBridge {
    /// Gestoppt: bis `start` lauscht nichts, und `register_launch` liefert nichts.
    pub fn new(signals: GameSignals) -> Self {
        Self::with_parts(signals, Timing::PRODUCTION, Arc::new(SocketOwner))
    }

    fn with_parts(signals: GameSignals, timing: Timing, owner: Arc<dyn OwnerCheck>) -> Self {
        Self { inner: Arc::new(Inner::new(signals, timing, owner)) }
    }

    /// Eine Brücke, deren Besitzer-Urteil der Test vorgibt statt des Betriebssystems.
    #[cfg(test)]
    pub fn with_owner_for_test(
        signals: GameSignals,
        owns: Arc<dyn Fn(u32, std::net::SocketAddr, std::net::SocketAddr) -> std::io::Result<bool> + Send + Sync>,
    ) -> Self {
        Self::with_parts(signals, Timing::PRODUCTION, Arc::new(owner::OwnerFn(owns)))
    }

    /// Der Datensatz des Starts sagt „kein Microsoft-Konto“: ein Zustand, den `register_launch` gar nicht erst entstehen
    /// lässt, den INGAME 7 aber trotzdem prüft.
    #[cfg(test)]
    pub fn mark_offline_for_test(&self, instance_id: &str) {
        let mut state = lock(&self.inner.state);
        if let Some(launch) = state.launches.get_mut(instance_id) {
            launch.expectations.online_account = false;
        }
    }

    /// Beginnt auf `127.0.0.1` an einem freien Port zu lauschen; läuft die Brücke schon, passiert nichts.
    pub async fn start(&self) -> AppResult<()> {
        let mut state = lock(&self.inner.state);
        if state.listening.is_some() {
            return Ok(());
        }
        let listener = listener::bind_loopback()?;
        let port = listener.local_addr()?.port();
        let stop = CancellationToken::new();
        let accepting = tokio::spawn(server::accept_loop(listener, self.inner.clone(), stop.clone()));
        let binding = tokio::spawn(bind_spawned_games(self.clone(), self.inner.signals.subscribe(), stop.clone()));
        state.listening = Some(Listening { port, stop, tasks: vec![accepting, binding] });
        tracing::info!(port, "Brücke zur Mod lauscht");
        Ok(())
    }

    /// Hört auf zu lauschen, trennt alle Verbindungen und macht alle Tokens ungültig. Danach ist der Port frei.
    pub async fn stop(&self) {
        let listening = lock(&self.inner.state).listening.take();
        self.inner.close_all(ClosingReason::BridgeStopped);
        if let Some(listening) = listening {
            listening.stop.cancel();
            for task in listening.tasks {
                if let Err(err) = task.await {
                    tracing::warn!(%err, "Aufgabe der Brücke abgebrochen");
                }
            }
            tracing::info!("Brücke zur Mod gestoppt");
        }
    }

    pub fn is_running(&self) -> bool {
        lock(&self.inner.state).listening.is_some()
    }

    /// Consent changes revoke Friends grants and pending work without closing the shared Bridge.
    pub fn set_friends_enabled(&self, enabled: bool) {
        self.inner.set_friends_enabled(enabled);
    }

    /// Legt den Datensatz des Starts an und liefert die Umgebungsvariablen für das Spiel (`ENV_PORT`, `ENV_TOKEN`,
    /// `ENV_PROTOCOL`). Ohne laufende Brücke oder ohne Microsoft-Konto liefert es nichts und legt nichts an. Ein
    /// früherer Datensatz derselben Instanz verfällt.
    pub fn register_launch(&self, instance_id: &str, mut expectations: Expectations) -> Vec<(String, String)> {
        if !expectations.online_account {
            return Vec::new();
        }
        let mut state = lock(&self.inner.state);
        let Some(port) = state.listening.as_ref().map(|listening| listening.port) else { return Vec::new() };
        expectations.friends_enabled &= state.friends_enabled.unwrap_or(true);
        expectations.pre_granted &= expectations.friends_enabled;
        let token = new_token();
        let previous = state.launches.insert(instance_id.to_owned(), Launch::new(token.clone(), expectations));
        if let Some(previous) = previous {
            previous.close_link(ClosingReason::Replaced);
        }
        vec![
            (ENV_PORT.to_owned(), port.to_string()),
            (ENV_TOKEN.to_owned(), token),
            (ENV_PROTOCOL.to_owned(), PROTOCOL_VERSION.to_string()),
        ]
    }

    /// Nennt den Spielprozess des Starts. Bis dahin lehnt die Brücke Verbindungen mit `retry` ab. Der Prozess steht
    /// danach fest: eine zweite Angabe mit anderer Kennung wird ignoriert.
    pub fn bind_pid(&self, instance_id: &str, pid: u32) {
        let mut state = lock(&self.inner.state);
        let Some(launch) = state.launches.get_mut(instance_id) else { return };
        match launch.pid {
            None => launch.pid = Some(pid),
            Some(bound) if bound != pid => tracing::warn!(instance = %instance_id, bound, pid, "anderer Prozess für einen gebundenen Start ignoriert"),
            Some(_) => {}
        }
    }

    /// Der Start ist zu Ende: Token ungültig, Verbindung getrennt.
    pub fn forget(&self, instance_id: &str) {
        let launch = lock(&self.inner.state).launches.remove(instance_id);
        if let Some(launch) = launch {
            launch.close_link(ClosingReason::LaunchEnded);
        }
    }

    pub fn is_connected(&self, instance_id: &str) -> bool {
        lock(&self.inner.state).launches.get(instance_id).is_some_and(|launch| launch.link.is_some())
    }

    /// Ob irgendein Spiel gerade mit einer Mod verbunden ist.
    pub fn has_active_link(&self) -> bool {
        lock(&self.inner.state).launches.values().any(|launch| launch.link.is_some())
    }

    /// Die Bildschirme, die die Mod mit `ready` gemeldet hat; `None`, solange sie es nicht getan hat.
    pub fn ready_screens(&self, instance_id: &str) -> Option<Vec<String>> {
        lock(&self.inner.state).launches.get(instance_id).and_then(|launch| launch.ready.clone())
    }

    /// Setzt den Wert eines Themas für das Spiel der Instanz. Ändert er sich, geht er (höchstens alle 250 ms je Thema)
    /// an die Mod; eine Mod, die sich später verbindet, bekommt den letzten Wert zuerst.
    pub fn set_topic(&self, instance_id: &str, value: TopicValue) {
        self.inner.set_topic(instance_id, value, None);
    }

    pub(crate) fn friends_publication(&self) -> FriendsPublication<'_> {
        FriendsPublication { bridge: self, generation: lock(&self.inner.state).friends_generation }
    }

    /// Ein Hinweis (Toast) an die Mod der Instanz; ohne Verbindung geht er verloren.
    pub fn notify(&self, instance_id: &str, kind: ModNotify, name: Option<String>) {
        self.notify_current(instance_id, kind, name, None);
    }

    fn notify_current(&self, instance_id: &str, kind: ModNotify, name: Option<String>, generation: Option<u64>) {
        let state = lock(&self.inner.state);
        if generation.is_some_and(|generation| generation != state.friends_generation) {
            return;
        }
        let Some(launch) = state.launches.get(instance_id).filter(|launch| launch.expectations.friends_enabled) else { return };
        let Some(link) = &launch.link else { return };
        link.queue.push_event(protocol::Event::Notify { kind, name });
    }

    /// Erlaubt `scope` für den Start, als hätte der Nutzer vorab zugestimmt: die Stelle, an der Tests den Zustand von
    /// „Aktionen im Spiel: erlauben“ herstellen, solange die Erwartungen kein eigenes Feld dafür tragen.
    #[cfg(test)]
    pub fn allow_scope_for_test(&self, instance_id: &str, scope: ops::Scope) {
        self.inner.allow_scope(instance_id, scope);
    }

    /// Setzt den Bearbeiter der Vorgänge ein; bis dahin antwortet die Brücke jedem mit `unsupportedOp`.
    pub fn set_handler(&self, handler: Arc<dyn OpHandler>) {
        *lock(&self.inner.handler) = handler;
    }
}

pub(crate) struct FriendsPublication<'a> {
    bridge: &'a ModBridge,
    generation: u64,
}

impl FriendsPublication<'_> {
    pub fn is_current(&self) -> bool {
        lock(&self.bridge.inner.state).friends_generation == self.generation
    }

    pub fn set_topic(&self, instance_id: &str, value: TopicValue) {
        self.bridge.inner.set_topic(instance_id, value, Some(self.generation));
    }

    pub fn notify(&self, instance_id: &str, kind: ModNotify, name: Option<String>) {
        self.bridge.notify_current(instance_id, kind, name, Some(self.generation));
    }
}

/// Nimmt den Prozess jedes gestarteten Spiels aus dem Spielsignal `Spawned` und bindet ihn an seinen Start.
async fn bind_spawned_games(bridge: ModBridge, mut signals: broadcast::Receiver<GameSignal>, stop: CancellationToken) {
    loop {
        tokio::select! {
            () = stop.cancelled() => return,
            signal = signals.recv() => match signal {
                Ok(GameSignal::Spawned { instance_id, pid, .. }) => bridge.bind_pid(&instance_id, pid),
                Ok(_) => {}
                Err(broadcast::error::RecvError::Lagged(missed)) => tracing::warn!(missed, "Spielsignale der Brücke verpasst"),
                Err(broadcast::error::RecvError::Closed) => return,
            },
        }
    }
}

/// 32 Zufallsbyte als 64 Hexzeichen. Eine UUID v4 liefert 122 Zufallsbits aus dem Zufallsgenerator des Systems; zwei
/// davon ergeben mehr als 240 Bit.
fn new_token() -> String {
    format!("{}{}", Uuid::new_v4().simple(), Uuid::new_v4().simple())
}
