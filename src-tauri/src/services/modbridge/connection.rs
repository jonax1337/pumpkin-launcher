//! Eine angenommene Verbindung der Mod: Zeilen lesen, prüfen und verteilen, Antworten, Themen und Hinweise schreiben,
//! Ping und Stille überwachen.
use std::collections::HashSet;
use std::io;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use serde_json::Value;
use tokio::net::tcp::{OwnedReadHalf, OwnedWriteHalf};
use tokio::time::Instant;
use tokio_util::sync::CancellationToken;

use super::framing::{encode_line, write_line, Beat, LineReader, Liveness};
use super::handler::{OpContext, OpHandler};
use super::launch::Link;
use super::limits::{LAUNCHER_LINE_BYTES, MAX_IN_FLIGHT, MESSAGES_PER_WINDOW, MESSAGE_WINDOW, MOD_LINE_BYTES, REQUEST_DEADLINE};
use super::ops::{ErrorCode, Op, OpError, OpOutcome, OpResult, UnknownFriend};
use super::protocol::{is_valid_request_id, LauncherFrame, ModFrame, Response, Scopes, PROTOCOL_VERSION};
use super::queue::{Next, Outgoing};
use super::topics::{Aliases, Topic};
use super::window::SlidingWindow;
use super::Inner;
use crate::services::gamesignal::GameSignal;
use crate::services::lock;
use crate::services::shared_types::PortSource;

/// Was eine zugelassene Verbindung braucht.
pub(super) struct Admitted {
    pub instance_id: String,
    pub link: Link,
    pub scopes: Scopes,
}

pub(super) struct Connection {
    inner: Arc<Inner>,
    instance_id: String,
    link: Link,
    scopes: Scopes,
    reader: LineReader<OwnedReadHalf>,
    writer: OwnedWriteHalf,
    aliases: Aliases,
    inbound: SlidingWindow,
    liveness: Liveness,
    in_flight: Arc<InFlight>,
    /// Wird beendet, wenn die Verbindung endet; mit ihr enden die Vorgänge, die noch laufen.
    session: CancellationToken,
}

impl Connection {
    pub fn new(inner: Arc<Inner>, admitted: Admitted, reader: LineReader<OwnedReadHalf>, writer: OwnedWriteHalf) -> Self {
        let timing = inner.timing;
        Self {
            inner,
            instance_id: admitted.instance_id,
            link: admitted.link,
            scopes: admitted.scopes,
            reader,
            writer,
            aliases: Aliases::default(),
            inbound: SlidingWindow::new(MESSAGES_PER_WINDOW, MESSAGE_WINDOW),
            liveness: Liveness::new(Instant::now(), timing.ping_interval, timing.silence),
            in_flight: Arc::default(),
            session: CancellationToken::new(),
        }
    }

    /// Begrüßt die Mod und bedient sie, bis eine Seite aufhört, sie zu viel schickt, zu lange schweigt oder die Brücke
    /// sie trennt.
    pub async fn run(mut self) -> io::Result<()> {
        let _end_requests = self.session.clone().drop_guard();
        self.greet().await?;
        loop {
            let now = Instant::now();
            let mut wake_at = match self.liveness.beat(now) {
                Beat::Silent => return Ok(()),
                Beat::Ping => {
                    self.send(LauncherFrame::Ping).await?;
                    continue;
                }
                Beat::Wait(at) => at,
            };
            match self.link.queue.next(now) {
                Next::Send(item) => {
                    self.write(item).await?;
                    continue;
                }
                Next::Finished => return Ok(()),
                Next::WaitUntil(at) => wake_at = wake_at.min(at),
                Next::Idle => {}
            }
            tokio::select! {
                biased;
                () = self.link.abort.cancelled() => return Ok(()),
                () = self.link.queue.changed() => {}
                () = tokio::time::sleep_until(wake_at) => {}
                line = self.reader.next_line() => match line? {
                    Some(line) => if !self.accept_line(&line).await? { return Ok(()) },
                    None => return Ok(()),
                },
            }
        }
    }

    async fn greet(&mut self) -> io::Result<()> {
        let welcome = LauncherFrame::Welcome { protocol: PROTOCOL_VERSION, launcher: env!("CARGO_PKG_VERSION").to_owned(), scopes: self.scopes };
        self.send(welcome).await?;
        self.reader.set_limit(MOD_LINE_BYTES);
        Ok(())
    }

    async fn write(&mut self, item: Outgoing) -> io::Result<()> {
        match item {
            Outgoing::Frame(frame) => self.send(frame).await,
            Outgoing::FriendsFrame { frame, generation } => {
                if let Some(permission) = self.link.queue.friends_permission(generation) {
                    self.send_with_permission(frame, Some(permission)).await
                } else if matches!(frame, LauncherFrame::Res(_) | LauncherFrame::Pending { .. }) {
                    self.send(super::queue::revoked_reply(frame)).await
                } else {
                    Ok(())
                }
            }
            Outgoing::Topic(topic) => loop {
                let generation = self.link.queue.friends_generation();
                let permission = self.link.queue.friends_permission(generation);
                let frame = self.topic_frame(topic);
                if generation != self.link.queue.friends_generation()
                    || (permission.is_none() && self.link.queue.friends_allowed(generation)) {
                    continue;
                }
                break match frame {
                    Some(frame) => self.send_with_permission(frame, permission).await,
                    None => Ok(()),
                };
            },
        }
    }

    /// Der aktuelle Wert des Themas, mit den Aliassen dieser Verbindung statt der Peer-IDs.
    fn topic_frame(&mut self, topic: Topic) -> Option<LauncherFrame> {
        let (revision, value) = self.inner.topic_for_link(&self.instance_id, self.link.id, topic)?;
        Some(LauncherFrame::state(topic, revision, &value.masked(&mut self.aliases)))
    }

    /// Schreibt die Nachricht. Passt sie nicht in eine Zeile des Launchers, bekommt die Mod statt einer Antwort einen
    /// `internal`-Fehler und sonst nichts: ein Thema ist durch seine Obergrenzen klein genug (siehe `topics`).
    async fn send(&mut self, frame: LauncherFrame) -> io::Result<()> {
        self.send_with_permission(frame, None).await
    }

    async fn send_with_permission(&mut self, frame: LauncherFrame, permission: Option<CancellationToken>) -> io::Result<()> {
        let mut line = encode_line(&frame);
        if line.len() > LAUNCHER_LINE_BYTES {
            let LauncherFrame::Res(response) = &frame else {
                tracing::warn!(instance = %self.instance_id, bytes = line.len(), "Nachricht an die Mod zu lang, verworfen");
                return Ok(());
            };
            tracing::warn!(instance = %self.instance_id, bytes = line.len(), "Antwort an die Mod zu lang");
            line = encode_line(&LauncherFrame::Res(Response::failure(&response.id, ErrorCode::Internal)));
        }
        match permission {
            Some(permission) => super::framing::write_private_line(&mut self.writer, &line, self.inner.timing.write_stall, &permission).await,
            None => write_line(&mut self.writer, &line, self.inner.timing.write_stall).await,
        }
    }

    /// Wertet eine Zeile der Mod aus; `false`, wenn die Verbindung wegen zu vieler Nachrichten endet.
    async fn accept_line(&mut self, line: &str) -> io::Result<bool> {
        let now = Instant::now();
        self.liveness.heard(now);
        if !self.inbound.allow(now) {
            tracing::warn!(instance = %self.instance_id, "Mod schickt zu viele Nachrichten: Verbindung getrennt");
            return Ok(false);
        }
        match serde_json::from_str(line) {
            Ok(frame) => self.handle(frame).await?,
            Err(err) => tracing::debug!(instance = %self.instance_id, %err, "Zeile der Mod verworfen"),
        }
        Ok(true)
    }

    async fn handle(&mut self, frame: ModFrame) -> io::Result<()> {
        match frame {
            ModFrame::Ping => self.send(LauncherFrame::Pong).await?,
            ModFrame::Pong => {}
            ModFrame::LanOpened { port } => self.signal(GameSignal::LanOpened { instance_id: self.instance_id.clone(), port, source: PortSource::Mod }),
            ModFrame::LanClosed => self.signal(GameSignal::LanClosed { instance_id: self.instance_id.clone() }),
            ModFrame::Ready { screens } => self.inner.set_ready(&self.instance_id, screens),
            ModFrame::Req { id, op, args } => self.dispatch(id, &op, args),
            ModFrame::Hello(_) => tracing::debug!(instance = %self.instance_id, "zweites hello der Mod ignoriert"),
        }
        Ok(())
    }

    fn signal(&self, signal: GameSignal) {
        self.inner.signals.send(signal);
    }

    /// Nimmt eine Anfrage an. Was die Brücke selbst entscheiden kann (Kennung, Zahl offener Anfragen, Argumente, Alias,
    /// Ratenfenster, `state.sync`), beantwortet sie sofort; der Rest läuft im Bearbeiter, ohne die Verbindung zu
    /// blockieren.
    fn dispatch(&self, id: String, op: &str, args: Value) {
        if !is_valid_request_id(&id) {
            tracing::debug!(instance = %self.instance_id, "Anfrage mit ungültiger Kennung verworfen");
            return;
        }
        let guard = match self.in_flight.try_start(&id) {
            Ok(guard) => guard,
            Err(InFlightRefusal::Duplicate) => return tracing::debug!(instance = %self.instance_id, "doppelte Kennung verworfen"),
            Err(InFlightRefusal::Full) => return self.fail(&id, ErrorCode::Busy),
        };
        match self.accept_op(op, args) {
            Ok(Accepted::Handle(op)) => self.spawn_handler(id, op, guard),
            Ok(Accepted::Answered) => self.link.reply(LauncherFrame::Res(Response::success(&id, OpResult::empty()))),
            Err(code) => self.fail(&id, code),
        }
    }

    fn fail(&self, id: &str, code: ErrorCode) {
        self.link.reply(LauncherFrame::Res(Response::failure(id, code)));
    }

    fn accept_op(&self, op: &str, args: Value) -> Result<Accepted, ErrorCode> {
        let op = Op::from_request(op, args).map_err(|err| {
            tracing::debug!(instance = %self.instance_id, %err, "Anfrage der Mod verworfen");
            ErrorCode::BadRequest
        })?;
        if !matches!(op, Op::StateSync {} | Op::LauncherOpen { .. }) && !self.inner.friends_enabled(&self.instance_id) {
            return Err(ErrorCode::NotEnabled);
        }
        let op = op.resolve_friends(|alias| self.aliases.real(alias)).map_err(|UnknownFriend| ErrorCode::UnknownFriend)?;
        let class = op.rate_class();
        if class.counted_before_handling() && !self.inner.take_rate(&self.instance_id, class, Instant::now()) {
            return Err(ErrorCode::RateLimited);
        }
        if op == (Op::StateSync {}) {
            self.inner.resend_topics(&self.instance_id);
            return Ok(Accepted::Answered);
        }
        Ok(Accepted::Handle(op))
    }

    fn spawn_handler(&self, id: String, op: Op, guard: InFlightGuard) {
        let ctx = OpContext::new(self.inner.clone(), self.instance_id.clone(), id.clone(), self.link.clone());
        let friends_operation = !matches!(op, Op::StateSync {} | Op::LauncherOpen { .. });
        let generation = ctx.friends_generation();
        let handler = self.inner.handler();
        let (link, session) = (self.link.clone(), self.session.clone());
        drop(tokio::spawn(async move {
            let outcome = tokio::select! {
                () = session.cancelled() => return,
                outcome = answer(handler.as_ref(), ctx, op, REQUEST_DEADLINE) => outcome,
            };
            let frame = LauncherFrame::Res(Response::from_outcome(&id, outcome));
            if friends_operation {
                link.reply_friends(frame, generation);
            } else {
                link.reply(frame);
            }
            drop(guard);
        }));
    }
}

enum Accepted {
    /// Der Bearbeiter führt den Vorgang aus.
    Handle(Op),
    /// Die Brücke hat ihn erledigt.
    Answered,
}

/// Lässt den Bearbeiter höchstens `deadline` lang arbeiten; danach bekommt die Mod `timeout`, damit keine Anfrage
/// ohne Antwort bleibt.
pub(super) async fn answer(handler: &dyn OpHandler, ctx: OpContext, op: Op, deadline: Duration) -> OpOutcome {
    match tokio::time::timeout(deadline, handler.handle(ctx, op)).await {
        Ok(outcome) => outcome,
        Err(_) => Err(OpError::new(ErrorCode::Timeout)),
    }
}

/// Die Kennungen der Anfragen, auf die die Mod noch eine Antwort erwartet.
#[derive(Default)]
struct InFlight(Mutex<HashSet<String>>);

#[derive(Debug, PartialEq, Eq)]
enum InFlightRefusal {
    /// Schon `MAX_IN_FLIGHT` offen.
    Full,
    Duplicate,
}

impl InFlight {
    fn try_start(self: &Arc<Self>, id: &str) -> Result<InFlightGuard, InFlightRefusal> {
        let mut open = lock(&self.0);
        if open.contains(id) {
            return Err(InFlightRefusal::Duplicate);
        }
        if open.len() >= MAX_IN_FLIGHT {
            return Err(InFlightRefusal::Full);
        }
        open.insert(id.to_owned());
        Ok(InFlightGuard { open: self.clone(), id: id.to_owned() })
    }
}

/// Gibt die Kennung frei, sobald die Anfrage beantwortet (oder abgebrochen) ist.
struct InFlightGuard {
    open: Arc<InFlight>,
    id: String,
}

impl Drop for InFlightGuard {
    fn drop(&mut self) {
        lock(&self.open.0).remove(&self.id);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn at_most_eight_requests_are_open_and_a_kept_id_cannot_start_twice() {
        let open = Arc::new(InFlight::default());
        let guards: Vec<InFlightGuard> = (0..MAX_IN_FLIGHT).map(|index| open.try_start(&format!("a{index}")).unwrap()).collect();
        assert_eq!(open.try_start("zz").err(), Some(InFlightRefusal::Full));
        assert_eq!(open.try_start("a3").err(), Some(InFlightRefusal::Duplicate));
        drop(guards);
        assert!(open.try_start("a3").is_ok(), "eine beantwortete Kennung ist wieder frei");
    }
}
