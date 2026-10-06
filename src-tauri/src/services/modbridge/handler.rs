//! Die Naht zwischen Brücke und Freunde-Funktion: die Brücke prüft Rahmen, Ratenfenster und Aliasse und gibt jeden
//! Vorgang als [`Op`] an den [`OpHandler`]; was ein Vorgang bewirkt, liegt nicht in der Brücke.
use std::future::Future;
use std::sync::Arc;

use futures::future::BoxFuture;
use tokio::time::Instant;
use tokio_util::sync::CancellationToken;

use super::launch::{Link, PromptRefusal};
use super::ops::{ErrorCode, Op, OpError, OpOutcome, RateClass, Scope};
use super::protocol::{Event, LauncherFrame, ModNotify, Prompt};
use super::Inner;

pub trait OpHandler: Send + Sync {
    /// Führt den Vorgang aus. Ein Aufruf, den die Verbindung nicht überlebt, wird abgebrochen (die Zukunft fällt weg).
    fn handle<'a>(&'a self, ctx: OpContext, op: Op) -> BoxFuture<'a, OpOutcome>;
}

/// Der Bearbeiter, solange die Freunde-Funktion keinen eingesetzt hat: kein Vorgang wird bearbeitet.
pub(super) struct NoOps;

impl OpHandler for NoOps {
    fn handle<'a>(&'a self, _ctx: OpContext, _op: Op) -> BoxFuture<'a, OpOutcome> {
        Box::pin(async { Err(OpError::new(ErrorCode::UnsupportedOp)) })
    }
}

/// Was ein Bearbeiter über die Anfrage hinaus von der Brücke braucht: Zustimmungen, Rückfragen und Zähler gehören dem
/// Spielstart, nicht der Verbindung, und liegen deshalb bei der Brücke.
#[derive(Clone)]
pub struct OpContext {
    inner: Arc<Inner>,
    instance_id: String,
    request_id: String,
    link: Link,
    friends_stop: CancellationToken,
    friends_generation: u64,
}

impl OpContext {
    pub(super) fn new(inner: Arc<Inner>, instance_id: String, request_id: String, link: Link) -> Self {
        let friends_stop = inner.friends_stop(&instance_id);
        let friends_generation = link.queue.friends_generation();
        Self { inner, instance_id, request_id, link, friends_stop, friends_generation }
    }

    pub fn instance_id(&self) -> &str {
        &self.instance_id
    }

    pub fn friends_enabled(&self) -> bool {
        !self.friends_stop.is_cancelled()
            && self.link.queue.friends_allowed(self.friends_generation)
            && self.inner.friends_enabled(&self.instance_id)
    }

    pub async fn friends_disabled(&self) {
        self.friends_stop.cancelled().await;
    }

    pub(super) fn friends_generation(&self) -> u64 {
        self.friends_generation
    }

    /// Stellt sicher, dass dieser Spielstart `scope` darf. Ist er noch nicht erlaubt, wird `ask` (der Dialog im
    /// Launcher; `true` heißt erlaubt) abgewartet, und die Mod bekommt solange `pending`. Es läuft höchstens eine
    /// Rückfrage je Spielstart (sonst `busy`), nach drei in zehn Minuten wird ohne Frage abgelehnt (`denied`). Jede
    /// Ablehnung, ob vom Nutzer oder wegen der Obergrenze, meldet der Mod zusätzlich den Toast `scopeDenied`.
    pub async fn require_scope(&self, scope: Scope, ask: impl Future<Output = bool>) -> Result<(), OpError> {
        if !self.friends_enabled() {
            return Err(OpError::new(ErrorCode::NotEnabled));
        }
        if self.inner.scope_allowed(&self.instance_id, scope) {
            return Ok(());
        }
        let open = self.open_prompt()?;
        self.link.reply_friends(LauncherFrame::Pending { id: self.request_id.clone(), prompt: Prompt::Scope, scope }, self.friends_generation);
        if ask.await && self.friends_enabled() {
            open.close(Some(scope));
            Ok(())
        } else {
            drop(open);
            Err(self.denied())
        }
    }

    /// Ob dieser Start ein Microsoft-Konto hat (docs/bridge/README.md, "In-game navigation and world behavior").
    pub fn online_account(&self) -> bool {
        self.inner.launch_facts(&self.instance_id).is_some_and(|facts| facts.online_account)
    }

    /// Der Prozess des Spiels, sobald der Launcher ihn kennt.
    pub fn game_pid(&self) -> Option<u32> {
        self.inner.launch_facts(&self.instance_id)?.pid
    }

    /// Prüft noch einmal, dass die Verbindung dem Spielprozess gehört, mit derselben Prüfung wie bei der Anmeldung. Wer
    /// das nicht belegen kann, bekommt `denied` (docs/bridge/README.md, "Connection and ownership").
    pub async fn verify_owner(&self) -> Result<(), OpError> {
        let owned = match self.game_pid() {
            Some(pid) => self.inner.verify_owner(pid, self.link.peer, self.link.local).await.is_ok(),
            None => false,
        };
        if owned {
            Ok(())
        } else {
            tracing::warn!(instance = %self.instance_id, "Verbindung der Mod gehört nicht (mehr) zum Spielprozess, Vorgang abgelehnt");
            Err(OpError::new(ErrorCode::Denied).with_param("reason", "owner"))
        }
    }

    /// Abgelehnt: die Mod bekommt `denied`, und ein Toast sagt dem Spieler, dass der Launcher den Vorgang nicht erlaubt hat.
    fn denied(&self) -> OpError {
        self.link.queue.push_event(Event::Notify { kind: ModNotify::ScopeDenied, name: None });
        OpError::new(ErrorCode::Denied)
    }

    /// Zählt einen Vorgang der Klasse für diesen Spielstart; für Klassen, die die Brücke nicht schon vorher zählt.
    pub fn charge(&self, class: RateClass) -> Result<(), OpError> {
        if self.inner.take_rate(&self.instance_id, class, Instant::now()) {
            Ok(())
        } else {
            Err(OpError::new(ErrorCode::RateLimited))
        }
    }

    fn open_prompt(&self) -> Result<OpenPrompt, OpError> {
        match self.inner.begin_prompt(&self.instance_id, Instant::now(), &self.friends_stop) {
            Ok(()) => Ok(OpenPrompt { inner: self.inner.clone(), instance_id: self.instance_id.clone(), permission: self.friends_stop.clone(), closed: false }),
            Err(PromptRefusal::Open) => Err(OpError::new(ErrorCode::Busy)),
            Err(PromptRefusal::Exhausted) => Err(self.denied()),
        }
    }
}

/// Die offene Rückfrage eines Spielstarts. Fällt sie weg, bevor sie beantwortet ist (die Verbindung endete mitten im
/// Dialog), gilt sie als abgelehnt und gibt den Platz frei.
struct OpenPrompt {
    inner: Arc<Inner>,
    instance_id: String,
    closed: bool,
    permission: CancellationToken,
}

impl OpenPrompt {
    fn close(mut self, granted: Option<Scope>) {
        self.closed = true;
        self.inner.end_prompt(&self.instance_id, granted, &self.permission);
    }
}

impl Drop for OpenPrompt {
    fn drop(&mut self) {
        if !self.closed {
            self.inner.end_prompt(&self.instance_id, None, &self.permission);
        }
    }
}
