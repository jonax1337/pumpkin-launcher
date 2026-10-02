//! Blockierende Arbeit abseits des Async-Executors, Abbruch und geteilter Zustand.
use std::future::Future;
use std::sync::{Mutex, MutexGuard};

use tokio::sync::mpsc;
use tokio_util::sync::CancellationToken;

use crate::coded;
use crate::error::{AppError, AppResult};

tokio::task_local! {
    /// Steckt in jedem Thread, den [`blocking`] innerhalb von [`until_phases_end`] startet, bis er fertig ist; es wird
    /// nie gesendet, das Schließen des Kanals meldet das Ende der letzten Phase.
    static RUNNING_PHASES: mpsc::Sender<()>;
}

/// Führt blockierende Dateiarbeit aus. Verwirft der Aufrufer das Future (Abbruch über `AppState::cancellable`),
/// läuft der Thread weiter, bis `work` das Token prüft ([`check_cancelled`]); aufräumen muss `work` selbst,
/// erst dann schreibt nichts mehr in das, was weg soll.
pub(crate) async fn blocking<T: Send + 'static>(
    work: impl FnOnce(&CancellationToken) -> AppResult<T> + Send + 'static,
) -> AppResult<T> {
    let stop = CancellationToken::new();
    let _stop_on_drop = stop.clone().drop_guard();
    let phase = RUNNING_PHASES.try_with(mpsc::Sender::clone).ok();
    tokio::task::spawn_blocking(move || {
        let _phase = phase;
        work(&stop)
    })
    .await
    .map_err(|e| AppError::invalid(coded!("errors.app.taskAborted", error = e)))?
}

/// Führt `work` aus und endet erst, wenn auch jede darin über [`blocking`] gestartete Phase fertig ist, selbst wenn
/// `work` vorher verworfen wurde: Wer danach eine Sperre freigibt, gibt sie erst frei, wenn nichts mehr schreibt.
pub(crate) async fn until_phases_end<T>(work: impl Future<Output = T>) -> T {
    let (phases, mut ended) = mpsc::channel(1);
    let result = RUNNING_PHASES.scope(phases, work).await;
    ended.recv().await;
    result
}

pub(crate) fn check_cancelled(stop: &CancellationToken) -> AppResult<()> {
    if stop.is_cancelled() {
        return Err(AppError::Cancelled);
    }
    Ok(())
}

/// Sperre auf geteilten Zustand; ein Thread, der darunter abgestürzt ist, macht die Daten nicht unbrauchbar.
pub(crate) fn lock<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
    mutex.lock().unwrap_or_else(|poisoned| poisoned.into_inner())
}
