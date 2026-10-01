//! Support für Fehlerberichte: Protokoll über mclo.gs teilen, Debug-Info kopieren.
//! Siehe `services::logshare` und `services::debuginfo`.
use tauri::{AppHandle, State};

use crate::error::AppResult;
use crate::services::debuginfo::{self, InstanceState};
use crate::services::install;
use crate::services::logshare::{self, LogKind};
use crate::state::AppState;

/// Lädt ein Protokoll der Instanz bereinigt zu mclo.gs hoch und liefert den öffentlichen Link.
#[tauri::command]
pub async fn log_share(state: State<'_, AppState>, instance_id: String, kind: LogKind) -> AppResult<String> {
    state.require_instance(&instance_id)?;
    let url = logshare::share(&state.http, &state.dirs, &instance_id, kind).await?;
    tracing::info!(instance = %instance_id, ?kind, %url, "Protokoll geteilt");
    Ok(url)
}

/// Launcher, System und Instanzen als Klartext ohne persönliche Daten. `default_memory_mb` ist der
/// RAM-Standard aus den Einstellungen, den nur das Frontend kennt (wie bei `instance_launch`).
#[tauri::command]
pub fn debug_info(app: AppHandle, state: State<'_, AppState>, default_memory_mb: u32) -> String {
    let instances = state.instances.list();
    let states: Vec<InstanceState> = {
        // Lock nur fürs Nachsehen, nicht über die Systemabfragen im Bericht.
        let running = state.running();
        instances
            .iter()
            .map(|instance| InstanceState {
                instance,
                installed: install::is_installed(&state.dirs, instance),
                running: running.contains_key(&instance.id),
            })
            .collect()
    };
    debuginfo::report(&app.package_info().version.to_string(), &state.dirs.root, default_memory_mb, &states)
}
