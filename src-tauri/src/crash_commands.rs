//! Absturzassistent: Befunde zum letzten Absturz einer Instanz. Siehe `services::crashdiagnosis`.
use tauri::State;

use crate::error::AppResult;
use crate::services::crashdiagnosis::{self, CrashDiagnosis, Machine};
use crate::services::system;
use crate::state::AppState;

/// Befunde zum letzten Absturz der Instanz, wichtigster zuerst; leer, wenn es nichts zu diagnostizieren gibt.
/// `default_memory_mb` ist der RAM, den Instanzen ohne eigenen Wert bekommen: eine Einstellung des Launchers, die nur das
/// Frontend kennt (wie bei `debug_info`).
#[tauri::command]
pub async fn crash_diagnose(state: State<'_, AppState>, instance_id: String, default_memory_mb: u32) -> AppResult<Vec<CrashDiagnosis>> {
    let instance = state.instances.get(&instance_id)?;
    state
        .blocking_with_dirs(move |dirs| {
            let total_memory_mb = system::total_memory_mb()
                .inspect_err(|err| tracing::warn!(%err, "Arbeitsspeicher des PCs unbekannt, der Absturzassistent rechnet mit dem Standard"))
                .ok();
            Ok(crashdiagnosis::diagnose_instance(dirs, &instance, Machine { default_memory_mb, total_memory_mb }))
        })
        .await
}
