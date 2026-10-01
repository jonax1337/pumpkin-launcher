//! Blockierende Arbeit abseits des Async-Executors, Abbruch und geteilter Zustand.
use std::sync::{Mutex, MutexGuard};

use tokio_util::sync::CancellationToken;

use crate::error::{AppError, AppResult};

/// Führt blockierende Dateiarbeit aus. Verwirft der Aufrufer das Future (Abbruch über `AppState::cancellable`),
/// läuft der Thread weiter, bis `work` das Token prüft ([`check_cancelled`]); aufräumen muss `work` selbst,
/// erst dann schreibt nichts mehr in das, was weg soll.
pub(crate) async fn blocking<T: Send + 'static>(
    work: impl FnOnce(&CancellationToken) -> AppResult<T> + Send + 'static,
) -> AppResult<T> {
    let stop = CancellationToken::new();
    let _stop_on_drop = stop.clone().drop_guard();
    tokio::task::spawn_blocking(move || work(&stop))
        .await
        .map_err(|e| AppError::invalid(format!("Der Vorgang ist unerwartet abgebrochen: {e}")))?
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
