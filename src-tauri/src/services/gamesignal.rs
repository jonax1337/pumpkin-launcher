//! Signale vom Spielstart und -ende an die Freunde-Funktion (gestartet, beendet, Fortschritt, LAN-Port, Mod-Anfragen).
use std::future::Future;
use std::sync::Mutex;
use std::time::{Duration, Instant};

use tokio::sync::broadcast;

use crate::error::AppResult;
use crate::services::lan_detect::{LanDetector, LanLine};
use crate::services::lock;
use crate::services::shared_types::PortSource;

/// Wer langsamer liest, verliert die ältesten Signale (`RecvError::Lagged`).
const CHANNEL_CAPACITY: usize = 256;
/// So selten meldet ein Start seinen Fortschritt höchstens.
const PROGRESS_INTERVAL: Duration = Duration::from_secs(1);

#[derive(Debug, Clone, PartialEq)]
pub enum GameSignal {
    /// Nur für Beitritte zu Freundeswelten, höchstens einmal je Sekunde.
    LaunchProgress { instance_id: String, friend_join: String },
    /// Nur für Beitritte zu Freundeswelten: der Start ist vor dem Spielprozess gescheitert.
    LaunchFailed { instance_id: String, friend_join: String },
    Spawned { instance_id: String, pid: u32, online_account: bool, friend_join: Option<String> },
    /// Ungeprüfter Hinweis aus Mod oder Spielausgabe.
    LanOpened { instance_id: String, port: u16, source: PortSource },
    /// Aus Spielausgabe oder Mod; wer das Signal liest, prüft den Port erneut.
    LanClosed { instance_id: String },
    Exited { instance_id: String },
    ModConnected { instance_id: String },
    ModDisconnected { instance_id: String },
    ModRequest { instance_id: String, request: ModRequest },
}

/// Was die Mod verlangt. Die Freunde-IDs sind echte Peer-IDs: die Brücke hat die Aliasse der Mod schon aufgelöst.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ModRequest {
    Share { friend_ids: Vec<String> },
    StopSharing,
    Kick { friend_id: String },
}

#[derive(Clone)]
pub struct GameSignals {
    sender: broadcast::Sender<GameSignal>,
}

impl Default for GameSignals {
    fn default() -> Self {
        Self { sender: broadcast::channel(CHANNEL_CAPACITY).0 }
    }
}

impl GameSignals {
    pub fn send(&self, signal: GameSignal) {
        if self.sender.send(signal).is_err() {
            tracing::trace!("kein Empfänger für das Spielsignal");
        }
    }

    pub fn subscribe(&self) -> broadcast::Receiver<GameSignal> {
        self.sender.subscribe()
    }
}

/// Reicht die rohen stdout-Zeilen einer Instanz an einen `LanDetector` und meldet, was er findet.
pub fn lan_line_forwarder(signals: GameSignals, instance_id: String) -> impl Fn(&str) + Send + Sync + 'static {
    let detector = Mutex::new(LanDetector::default());
    move |raw| {
        let signal = match lock(&detector).feed(raw) {
            Some(LanLine::Opened(port)) => GameSignal::LanOpened { instance_id: instance_id.clone(), port, source: PortSource::Log },
            Some(LanLine::Closed) => GameSignal::LanClosed { instance_id: instance_id.clone() },
            None => return,
        };
        signals.send(signal);
    }
}

/// Meldet Fortschritt und Scheitern eines Starts, wenn er einer Freundeswelt beitritt; ohne Beitritt tut es nichts.
pub struct LaunchReporter {
    signals: GameSignals,
    instance_id: String,
    friend_join: Option<String>,
    throttle: Mutex<ProgressThrottle>,
}

impl LaunchReporter {
    pub fn new(signals: GameSignals, instance_id: &str, friend_join: Option<&str>) -> Self {
        Self {
            signals,
            instance_id: instance_id.to_owned(),
            friend_join: friend_join.map(str::to_owned),
            throttle: Mutex::new(ProgressThrottle::new(PROGRESS_INTERVAL)),
        }
    }

    pub fn progress(&self) {
        let Some(join) = &self.friend_join else { return };
        if lock(&self.throttle).admit(Instant::now()) {
            self.signals.send(GameSignal::LaunchProgress { instance_id: self.instance_id.clone(), friend_join: join.clone() });
        }
    }

    /// Führt den Start aus; scheitert er, geht `LaunchFailed` hinaus, bevor der Fehler zurückkommt.
    pub async fn guard<T>(&self, launch: impl Future<Output = AppResult<T>>) -> AppResult<T> {
        let result = launch.await;
        if let (Err(_), Some(join)) = (&result, &self.friend_join) {
            self.signals.send(GameSignal::LaunchFailed { instance_id: self.instance_id.clone(), friend_join: join.clone() });
        }
        result
    }
}

/// Lässt höchstens einen Aufruf je Zeitspanne durch.
struct ProgressThrottle {
    interval: Duration,
    last: Option<Instant>,
}

impl ProgressThrottle {
    fn new(interval: Duration) -> Self {
        Self { interval, last: None }
    }

    fn admit(&mut self, now: Instant) -> bool {
        let due = self.last.is_none_or(|last| now.duration_since(last) >= self.interval);
        if due {
            self.last = Some(now);
        }
        due
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::error::AppError;
    use tokio::sync::broadcast::error::TryRecvError;

    fn reporter(friend_join: Option<&str>) -> (LaunchReporter, broadcast::Receiver<GameSignal>) {
        let signals = GameSignals::default();
        let receiver = signals.subscribe();
        (LaunchReporter::new(signals, "i1", friend_join), receiver)
    }

    #[test]
    fn signals_reach_every_subscriber_and_sending_without_one_is_harmless() {
        let signals = GameSignals::default();
        signals.send(GameSignal::Exited { instance_id: "nobody".into() });
        let (mut first, mut second) = (signals.subscribe(), signals.subscribe());
        signals.send(GameSignal::Exited { instance_id: "i1".into() });
        let expected = GameSignal::Exited { instance_id: "i1".into() };
        assert_eq!(first.try_recv(), Ok(expected.clone()));
        assert_eq!(second.try_recv(), Ok(expected));
    }

    #[test]
    fn throttle_admits_one_call_per_interval() {
        let start = Instant::now();
        let mut throttle = ProgressThrottle::new(Duration::from_secs(1));
        assert!(throttle.admit(start));
        assert!(!throttle.admit(start + Duration::from_millis(999)));
        assert!(throttle.admit(start + Duration::from_secs(1)));
        assert!(!throttle.admit(start + Duration::from_millis(1500)));
    }

    #[test]
    fn progress_of_a_friend_join_is_throttled_and_names_the_join() {
        let (reporter, mut receiver) = reporter(Some("j1"));
        for _ in 0..5 {
            reporter.progress();
        }
        let expected = GameSignal::LaunchProgress { instance_id: "i1".into(), friend_join: "j1".into() };
        assert_eq!(receiver.try_recv(), Ok(expected));
        assert_eq!(receiver.try_recv(), Err(TryRecvError::Empty));
    }

    #[tokio::test]
    async fn a_failed_friend_join_launch_is_reported_before_the_error_returns() {
        let (reporter, mut receiver) = reporter(Some("j1"));
        let result: AppResult<()> = reporter.guard(async { Err(AppError::Cancelled) }).await;
        assert!(result.is_err());
        let expected = GameSignal::LaunchFailed { instance_id: "i1".into(), friend_join: "j1".into() };
        assert_eq!(receiver.try_recv(), Ok(expected));
        assert_eq!(reporter.guard(async { Ok(7) }).await.unwrap(), 7);
        assert_eq!(receiver.try_recv(), Err(TryRecvError::Empty));
    }

    #[tokio::test]
    async fn launches_without_a_friend_join_send_neither_signal() {
        let (reporter, mut receiver) = reporter(None);
        reporter.progress();
        let result: AppResult<()> = reporter.guard(async { Err(AppError::Cancelled) }).await;
        assert!(result.is_err());
        assert_eq!(receiver.try_recv(), Err(TryRecvError::Empty));
    }

    #[test]
    fn lan_lines_of_the_game_become_signals() {
        let signals = GameSignals::default();
        let mut receiver = signals.subscribe();
        let forward = lan_line_forwarder(signals, "i1".into());
        forward("[12:00:00] [Server thread/INFO]: Started serving on 50123");
        forward("[12:00:01] [Server thread/INFO]: <Bob> hi");
        forward("[12:00:02] [Server thread/INFO]: Stopping server");
        let opened = GameSignal::LanOpened { instance_id: "i1".into(), port: 50123, source: PortSource::Log };
        assert_eq!(receiver.try_recv(), Ok(opened));
        assert_eq!(receiver.try_recv(), Ok(GameSignal::LanClosed { instance_id: "i1".into() }));
        assert_eq!(receiver.try_recv(), Err(TryRecvError::Empty));
    }
}
