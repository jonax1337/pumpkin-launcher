//! Eine angemeldete Verbindung der Mod: Zeilen lesen und prüfen, Nachrichten des Launchers schreiben.
use std::collections::{HashMap, VecDeque};
use std::io;
use std::sync::Arc;
use std::time::Duration;

use serde::Serialize;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::net::tcp::{OwnedReadHalf, OwnedWriteHalf};
use tokio::sync::mpsc;
use tokio::time::Instant;
use tokio_util::sync::CancellationToken;

use super::protocol::{Handshake, LauncherToMod, ModToLauncher, MAX_LINE_BYTES, PROTOCOL_VERSION};
use super::{Admitted, Inner};
use crate::services::gamesignal::{GameSignal, ModRequest};
use crate::services::shared_types::PortSource;

/// So viele Nachrichten darf die Mod in `MESSAGE_WINDOW` schicken; mehr trennt die Verbindung.
const MAX_MESSAGES_PER_WINDOW: usize = 20;
const MESSAGE_WINDOW: Duration = Duration::from_secs(1);
/// Ein neuer Stand geht frühestens so lange nach dem vorigen hinaus; zwischendurch zählt nur der letzte.
const SNAPSHOT_INTERVAL: Duration = Duration::from_millis(250);
/// So lange darf das Schreiben an eine Mod dauern, die nicht liest.
const WRITE_TIMEOUT: Duration = Duration::from_secs(5);
/// So viele Freunde darf die Mod auf einmal einladen (`MAX_GUESTS`).
const MAX_SHARED_FRIENDS: usize = 7;

/// Liest Zeilen, ohne mehr als `MAX_LINE_BYTES` zu puffern.
pub(super) struct LineReader {
    reader: BufReader<OwnedReadHalf>,
    line: Vec<u8>,
}

impl LineReader {
    pub fn new(half: OwnedReadHalf) -> Self {
        Self { reader: BufReader::new(half), line: Vec::new() }
    }

    /// Die nächste Zeile ohne Zeilenende; `None`, wenn die Gegenseite geschlossen hat. Eine längere Zeile ist ein Fehler.
    /// Abbrechen ist unschädlich: was gelesen ist, bleibt für den nächsten Aufruf im Puffer.
    pub async fn next_line(&mut self) -> io::Result<Option<String>> {
        loop {
            let available = self.reader.fill_buf().await?;
            if available.is_empty() {
                return Ok(None);
            }
            let newline = available.iter().position(|byte| *byte == b'\n');
            let taken = newline.map_or(available.len(), |end| end + 1);
            self.line.extend_from_slice(&available[..taken]);
            self.reader.consume(taken);
            if self.line.len() > MAX_LINE_BYTES {
                return Err(io::Error::new(io::ErrorKind::InvalidData, "Zeile der Mod zu lang"));
            }
            if newline.is_some() {
                return Ok(Some(self.take_line()));
            }
        }
    }

    /// Ungültiges UTF-8 wird ersetzt und scheitert dann beim Auswerten wie jede andere kaputte Zeile.
    fn take_line(&mut self) -> String {
        let bytes = std::mem::take(&mut self.line);
        String::from_utf8_lossy(&bytes).trim_end_matches(['\r', '\n']).to_owned()
    }
}

/// Schreibt `message` als eine JSON-Zeile.
pub(super) async fn write_message(writer: &mut OwnedWriteHalf, message: &impl Serialize) -> io::Result<()> {
    let mut line = serde_json::to_vec(message).map_err(io::Error::other)?;
    line.push(b'\n');
    let timed_out = |_| io::Error::new(io::ErrorKind::TimedOut, "Mod liest nicht");
    tokio::time::timeout(WRITE_TIMEOUT, writer.write_all(&line)).await.map_err(timed_out)?
}

pub(super) struct Connection {
    inner: Arc<Inner>,
    instance_id: String,
    outbox: mpsc::Receiver<LauncherToMod>,
    close: CancellationToken,
    first_snapshot: Option<LauncherToMod>,
    reader: LineReader,
    writer: OwnedWriteHalf,
    aliases: Aliases,
    inbound: SlidingWindow,
    snapshots: SnapshotDebounce,
}

impl Connection {
    pub fn new(inner: Arc<Inner>, admitted: Admitted, reader: LineReader, writer: OwnedWriteHalf) -> Self {
        Self {
            inner,
            instance_id: admitted.instance_id,
            outbox: admitted.outbox,
            close: admitted.close,
            first_snapshot: admitted.snapshot,
            reader,
            writer,
            aliases: Aliases::default(),
            inbound: SlidingWindow::new(MAX_MESSAGES_PER_WINDOW, MESSAGE_WINDOW),
            snapshots: SnapshotDebounce::default(),
        }
    }

    /// Begrüßt die Mod und bedient sie, bis eine Seite aufhört, sie zu viel schickt oder die Brücke sie trennt.
    pub async fn run(mut self) -> io::Result<()> {
        self.greet().await?;
        loop {
            let flush_at = self.snapshots.flush_at();
            tokio::select! {
                biased;
                () = self.close.cancelled() => return Ok(()),
                queued = self.outbox.recv() => match queued {
                    Some(message) => self.send_queued(message).await?,
                    None => return Ok(()),
                },
                () = tokio::time::sleep_until(flush_at.unwrap_or_else(Instant::now)), if flush_at.is_some() => self.flush_snapshot().await?,
                line = self.reader.next_line() => match line? {
                    Some(line) => if !self.accept_line(&line).await? { return Ok(()) },
                    None => return Ok(()),
                },
            }
        }
    }

    /// `welcome`, dann der aktuelle Stand (ohne einen früheren ein leerer).
    async fn greet(&mut self) -> io::Result<()> {
        let welcome = Handshake::Welcome { protocol: PROTOCOL_VERSION, launcher: env!("CARGO_PKG_VERSION").to_owned() };
        write_message(&mut self.writer, &welcome).await?;
        let snapshot = self.first_snapshot.take().unwrap_or(LauncherToMod::Snapshot { friends: Vec::new(), session: None, invites: Vec::new() });
        self.send_queued(snapshot).await
    }

    async fn send_queued(&mut self, message: LauncherToMod) -> io::Result<()> {
        if !matches!(message, LauncherToMod::Snapshot { .. }) {
            return self.send(message).await;
        }
        match self.snapshots.offer(message, Instant::now()) {
            Some(due) => self.send(due).await,
            None => Ok(()),
        }
    }

    async fn flush_snapshot(&mut self) -> io::Result<()> {
        match self.snapshots.take_pending(Instant::now()) {
            Some(due) => self.send(due).await,
            None => Ok(()),
        }
    }

    async fn send(&mut self, message: LauncherToMod) -> io::Result<()> {
        let on_wire = self.aliases.mask(message);
        write_message(&mut self.writer, &on_wire).await
    }

    /// Wertet eine Zeile der Mod aus; `false`, wenn die Verbindung wegen zu vieler Nachrichten endet.
    async fn accept_line(&mut self, line: &str) -> io::Result<bool> {
        if !self.inbound.allow(Instant::now()) {
            tracing::warn!(instance = %self.instance_id, "Mod schickt zu viele Nachrichten: Verbindung getrennt");
            return Ok(false);
        }
        match serde_json::from_str(line) {
            Ok(message) => self.handle(message).await?,
            Err(err) => tracing::debug!(instance = %self.instance_id, %err, "Zeile der Mod verworfen"),
        }
        Ok(true)
    }

    async fn handle(&mut self, message: ModToLauncher) -> io::Result<()> {
        match message {
            ModToLauncher::Ping => self.send(LauncherToMod::Pong).await?,
            ModToLauncher::LanOpened { port } => self.signal(GameSignal::LanOpened { instance_id: self.instance_id.clone(), port, source: PortSource::Mod }),
            ModToLauncher::LanClosed => self.signal(GameSignal::LanClosed { instance_id: self.instance_id.clone() }),
            ModToLauncher::Share { friend_ids } => self.request_share(&friend_ids),
            ModToLauncher::StopSharing => self.request(ModRequest::StopSharing),
            ModToLauncher::Kick { friend_id } => self.request_kick(&friend_id),
            ModToLauncher::Hello { .. } => tracing::debug!(instance = %self.instance_id, "zweites hello der Mod ignoriert"),
        }
        Ok(())
    }

    fn request_share(&self, aliases: &[String]) {
        if !(1..=MAX_SHARED_FRIENDS).contains(&aliases.len()) {
            tracing::debug!(instance = %self.instance_id, count = aliases.len(), "share mit unzulässiger Zahl von Freunden ignoriert");
            return;
        }
        let friend_ids: Option<Vec<String>> = aliases.iter().map(|alias| self.aliases.real(alias)).collect();
        match friend_ids {
            Some(friend_ids) => self.request(ModRequest::Share { friend_ids }),
            None => tracing::debug!(instance = %self.instance_id, "share mit unbekanntem Freund ignoriert"),
        }
    }

    fn request_kick(&self, alias: &str) {
        match self.aliases.real(alias) {
            Some(friend_id) => self.request(ModRequest::Kick { friend_id }),
            None => tracing::debug!(instance = %self.instance_id, "kick eines unbekannten Freundes ignoriert"),
        }
    }

    fn request(&self, request: ModRequest) {
        self.signal(GameSignal::ModRequest { instance_id: self.instance_id.clone(), request });
    }

    fn signal(&self, signal: GameSignal) {
        self.inner.signals.send(signal);
    }
}

/// Die Namen (`f1`, `f2`, …), unter denen die Mod Freunde sieht: Peer-IDs verlassen den Launcher nicht.
#[derive(Default)]
struct Aliases {
    by_id: HashMap<String, String>,
    by_alias: HashMap<String, String>,
}

impl Aliases {
    fn alias_for(&mut self, id: &str) -> String {
        if let Some(alias) = self.by_id.get(id) {
            return alias.clone();
        }
        let alias = format!("f{}", self.by_id.len() + 1);
        self.by_id.insert(id.to_owned(), alias.clone());
        self.by_alias.insert(alias.clone(), id.to_owned());
        alias
    }

    fn real(&self, alias: &str) -> Option<String> {
        self.by_alias.get(alias).cloned()
    }

    /// Ersetzt die Peer-IDs einer Nachricht durch Aliasse.
    fn mask(&mut self, message: LauncherToMod) -> LauncherToMod {
        let LauncherToMod::Snapshot { mut friends, mut session, invites } = message else { return message };
        for friend in &mut friends {
            friend.id = self.alias_for(&friend.id);
        }
        for guest in session.iter_mut().flat_map(|session| &mut session.guests) {
            guest.id = self.alias_for(&guest.id);
        }
        LauncherToMod::Snapshot { friends, session, invites }
    }
}

/// Lässt höchstens `limit` Ereignisse je Zeitspanne zu.
struct SlidingWindow {
    limit: usize,
    span: Duration,
    hits: VecDeque<Instant>,
}

impl SlidingWindow {
    fn new(limit: usize, span: Duration) -> Self {
        Self { limit, span, hits: VecDeque::new() }
    }

    fn allow(&mut self, now: Instant) -> bool {
        while self.hits.front().is_some_and(|hit| now.duration_since(*hit) >= self.span) {
            self.hits.pop_front();
        }
        if self.hits.len() >= self.limit {
            return false;
        }
        self.hits.push_back(now);
        true
    }
}

/// Fasst schnell aufeinanderfolgende Stände zusammen: der erste geht sofort hinaus, danach höchstens einer je
/// `SNAPSHOT_INTERVAL`, und zwar der letzte.
#[derive(Default)]
struct SnapshotDebounce {
    last_sent: Option<Instant>,
    pending: Option<LauncherToMod>,
}

impl SnapshotDebounce {
    /// Der Stand, der jetzt zu senden ist, oder `None`, wenn er auf den Ablauf des Intervalls wartet.
    fn offer(&mut self, snapshot: LauncherToMod, now: Instant) -> Option<LauncherToMod> {
        if self.last_sent.is_some_and(|sent| now.duration_since(sent) < SNAPSHOT_INTERVAL) {
            self.pending = Some(snapshot);
            return None;
        }
        self.pending = None;
        self.last_sent = Some(now);
        Some(snapshot)
    }

    fn take_pending(&mut self, now: Instant) -> Option<LauncherToMod> {
        let snapshot = self.pending.take()?;
        self.last_sent = Some(now);
        Some(snapshot)
    }

    /// Wann der wartende Stand dran ist.
    fn flush_at(&self) -> Option<Instant> {
        self.pending.as_ref()?;
        self.last_sent.map(|sent| sent + SNAPSHOT_INTERVAL)
    }
}

#[cfg(test)]
mod tests {
    use super::super::protocol::{ModFriend, ModGuest, ModGuestState, ModPresence, ModSession};
    use super::*;

    fn snapshot(name: &str) -> LauncherToMod {
        LauncherToMod::Snapshot {
            friends: vec![ModFriend { id: format!("peer-{name}"), name: name.into(), mc_uuid: None, presence: ModPresence::Online }],
            session: None,
            invites: Vec::new(),
        }
    }

    #[test]
    fn the_window_lets_the_limit_through_and_forgets_old_hits() {
        let start = Instant::now();
        let mut window = SlidingWindow::new(3, Duration::from_secs(1));
        assert!((0..3).all(|i| window.allow(start + Duration::from_millis(i * 100))));
        assert!(!window.allow(start + Duration::from_millis(500)));
        assert!(window.allow(start + Duration::from_millis(1000)), "der erste Treffer ist abgelaufen");
        assert!(!window.allow(start + Duration::from_millis(1050)));
    }

    #[test]
    fn snapshots_go_out_at_most_once_per_interval_and_the_last_one_wins() {
        let start = Instant::now();
        let mut debounce = SnapshotDebounce::default();
        assert_eq!(debounce.offer(snapshot("a"), start), Some(snapshot("a")));
        assert_eq!(debounce.flush_at(), None);
        assert_eq!(debounce.offer(snapshot("b"), start + Duration::from_millis(10)), None);
        assert_eq!(debounce.offer(snapshot("c"), start + Duration::from_millis(20)), None);
        assert_eq!(debounce.flush_at(), Some(start + SNAPSHOT_INTERVAL));
        assert_eq!(debounce.take_pending(start + SNAPSHOT_INTERVAL), Some(snapshot("c")));
        assert_eq!(debounce.take_pending(start + SNAPSHOT_INTERVAL), None);
        assert_eq!(debounce.offer(snapshot("d"), start + SNAPSHOT_INTERVAL + Duration::from_millis(100)), None);
        assert_eq!(debounce.offer(snapshot("e"), start + SNAPSHOT_INTERVAL * 3), Some(snapshot("e")));
        assert_eq!(debounce.flush_at(), None, "ein gesendeter Stand verdrängt den wartenden");
    }

    #[test]
    fn peer_ids_are_replaced_by_stable_aliases_and_map_back() {
        let mut aliases = Aliases::default();
        let guest = |id: &str| ModGuest { id: id.into(), name: "x".into(), state: ModGuestState::Invited };
        let masked = aliases.mask(LauncherToMod::Snapshot {
            friends: vec![
                ModFriend { id: "peer-a".into(), name: "A".into(), mc_uuid: None, presence: ModPresence::Online },
                ModFriend { id: "peer-b".into(), name: "B".into(), mc_uuid: None, presence: ModPresence::Offline },
            ],
            session: Some(ModSession { guests: vec![guest("peer-b"), guest("peer-c")] }),
            invites: Vec::new(),
        });
        let LauncherToMod::Snapshot { friends, session, .. } = masked else { panic!("kein Snapshot") };
        assert_eq!(friends.iter().map(|f| f.id.as_str()).collect::<Vec<_>>(), ["f1", "f2"]);
        assert_eq!(session.unwrap().guests.iter().map(|g| g.id.as_str()).collect::<Vec<_>>(), ["f2", "f3"]);
        assert_eq!(aliases.alias_for("peer-a"), "f1", "derselbe Freund behält seinen Alias");
        assert_eq!(aliases.real("f3"), Some("peer-c".to_owned()));
        assert_eq!(aliases.real("f9"), None);
        assert_eq!(aliases.real("peer-a"), None, "echte IDs sind keine Aliasse");
    }
}
