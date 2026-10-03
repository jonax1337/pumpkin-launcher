//! Die Naht zwischen Brücke und Freunde-Funktion: die Brücke prüft Rahmen, Ratenfenster und Aliasse und gibt jeden
//! Vorgang als [`Op`] an den [`OpHandler`]; was ein Vorgang bewirkt, liegt nicht in der Brücke.
use std::future::Future;
use std::sync::Arc;

use futures::future::BoxFuture;
use tokio::time::Instant;

use super::launch::{Link, PromptRefusal};
use super::ops::{ErrorCode, Op, OpError, OpOutcome, RateClass, Scope};
use super::protocol::{LauncherFrame, Prompt};
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
}

impl OpContext {
    pub(super) fn new(inner: Arc<Inner>, instance_id: String, request_id: String, link: Link) -> Self {
        Self { inner, instance_id, request_id, link }
    }

    pub fn instance_id(&self) -> &str {
        &self.instance_id
    }

    /// Stellt sicher, dass dieser Spielstart `scope` darf. Ist er noch nicht erlaubt, wird `ask` (der Dialog im
    /// Launcher; `true` heißt erlaubt) abgewartet, und die Mod bekommt solange `pending`. Es läuft höchstens eine
    /// Rückfrage je Spielstart (sonst `busy`), nach drei in zehn Minuten wird ohne Frage abgelehnt (`denied`).
    pub async fn require_scope(&self, scope: Scope, ask: impl Future<Output = bool>) -> Result<(), OpError> {
        if self.inner.scope_allowed(&self.instance_id, scope) {
            return Ok(());
        }
        let open = self.open_prompt()?;
        self.link.reply(LauncherFrame::Pending { id: self.request_id.clone(), prompt: Prompt::Scope, scope });
        if ask.await {
            open.close(Some(scope));
            Ok(())
        } else {
            Err(OpError::new(ErrorCode::Denied))
        }
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
        match self.inner.begin_prompt(&self.instance_id, Instant::now()) {
            Ok(()) => Ok(OpenPrompt { inner: self.inner.clone(), instance_id: self.instance_id.clone(), closed: false }),
            Err(PromptRefusal::Open) => Err(OpError::new(ErrorCode::Busy)),
            Err(PromptRefusal::Exhausted) => Err(OpError::new(ErrorCode::Denied)),
        }
    }
}

/// Die offene Rückfrage eines Spielstarts. Fällt sie weg, bevor sie beantwortet ist (die Verbindung endete mitten im
/// Dialog), gilt sie als abgelehnt und gibt den Platz frei.
struct OpenPrompt {
    inner: Arc<Inner>,
    instance_id: String,
    closed: bool,
}

impl OpenPrompt {
    fn close(mut self, granted: Option<Scope>) {
        self.closed = true;
        self.inner.end_prompt(&self.instance_id, granted);
    }
}

impl Drop for OpenPrompt {
    fn drop(&mut self) {
        if !self.closed {
            self.inner.end_prompt(&self.instance_id, None);
        }
    }
}
