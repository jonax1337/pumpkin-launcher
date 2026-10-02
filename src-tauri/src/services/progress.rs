//! Fortschritt langer Vorgänge: die Rückruf-Typen der Services und das Event `content-progress` ans Frontend.
use std::sync::Arc;

use serde::Serialize;
use tauri::{AppHandle, Emitter};

/// Abschnitt eines Vorgangs, so wie ihn das Frontend als `phase` von `content-progress` kennt (kleingeschrieben).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Phase {
    Resolve,
    Validate,
    Download,
    Extract,
    Copy,
    Pack,
    Hash,
    Backup,
    Complete,
}

/// Rückruf `(Phase, erledigt, gesamt)` eines Vorgangs, den ein Service nur ausleiht.
pub type ProgressFn<'a> = &'a (dyn Fn(Phase, u64, u64) + Send + Sync);

/// Derselbe Rückruf, aber mit eigenem Besitz: für Arbeit, die in einen Thread wandert.
pub type SharedProgress = Arc<dyn Fn(Phase, u64, u64) + Send + Sync>;

/// Rückruf `(erledigt, gesamt)` eines einzelnen Transfers oder Schritts ohne Phase.
pub type CountFn<'a> = &'a (dyn Fn(u64, u64) + Send + Sync);

const CONTENT_PROGRESS_EVENT: &str = "content-progress";

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct Progress {
    operation_id: String,
    phase: Phase,
    done: u64,
    total: u64,
}

/// Rückruf, der den Fortschritt des Vorgangs `operation_id` als `content-progress` sendet.
pub(crate) fn progress(app: AppHandle, operation_id: String) -> SharedProgress {
    Arc::new(move |phase, done, total| {
        emit(&app, CONTENT_PROGRESS_EVENT, Progress { operation_id: operation_id.clone(), phase, done, total });
    })
}

/// Sendet ein Event ans Frontend; scheitert das, läuft der Vorgang trotzdem weiter und es wird nur geloggt.
pub(crate) fn emit<T: Serialize + Clone>(app: &AppHandle, event: &str, payload: T) {
    if let Err(err) = app.emit(event, payload) {
        tracing::warn!(event, %err, "Event konnte nicht gesendet werden");
    }
}

/// Rückruf, der alles verwirft: für Tests, die den Fortschritt nicht prüfen.
#[cfg(test)]
pub(crate) fn ignored() -> SharedProgress {
    Arc::new(|_, _, _| {})
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn phases_keep_the_names_the_frontend_matches_on() {
        let names: Vec<String> = [
            Phase::Resolve,
            Phase::Validate,
            Phase::Download,
            Phase::Extract,
            Phase::Copy,
            Phase::Pack,
            Phase::Hash,
            Phase::Backup,
            Phase::Complete,
        ]
        .map(|phase| serde_json::to_value(phase).unwrap().as_str().unwrap().to_owned())
        .into();
        assert_eq!(names, ["resolve", "validate", "download", "extract", "copy", "pack", "hash", "backup", "complete"]);
    }

    #[test]
    fn payload_keeps_its_camel_case_shape() {
        let payload = Progress { operation_id: "op".into(), phase: Phase::Copy, done: 1, total: 2 };
        assert_eq!(
            serde_json::to_value(payload).unwrap(),
            serde_json::json!({"operationId": "op", "phase": "copy", "done": 1, "total": 2})
        );
    }
}
