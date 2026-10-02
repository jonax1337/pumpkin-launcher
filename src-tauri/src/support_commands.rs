//! Support für Fehlerberichte: Protokoll über mclo.gs teilen, Debug-Info kopieren, Protokolle früherer Sitzungen.
//! Siehe `services::logshare`, `services::debuginfo` und `services::sessionlog`.
use tauri::{AppHandle, State};

use crate::error::AppResult;
use crate::services::debuginfo::{self, InstanceState};
use crate::services::install;
use crate::services::logshare::{self, LogKind};
use crate::services::sessionlog::{self, LogSession};
use crate::state::AppState;

/// Lädt ein Protokoll der Instanz bereinigt zu mclo.gs hoch und liefert den öffentlichen Link.
#[tauri::command]
pub async fn log_share(state: State<'_, AppState>, instance_id: String, kind: LogKind) -> AppResult<String> {
    state.require_instance(&instance_id)?;
    let url = logshare::share(&state.http, &state.dirs, &instance_id, kind).await?;
    tracing::info!(instance = %instance_id, ?kind, %url, "Protokoll geteilt");
    Ok(url)
}

/// Launcher, System und Instanzen als Klartext ohne persönliche Daten. `default_memory_mb` und `java_path` sind
/// die Einstellungen des Launchers, die nur das Frontend kennt (wie bei `instance_launch`); mit `instance_id` steht
/// die Mod-Liste dieser Instanz im Bericht.
#[tauri::command]
pub async fn debug_info(
    app: AppHandle,
    state: State<'_, AppState>,
    default_memory_mb: u32,
    java_path: Option<String>,
    instance_id: Option<String>,
) -> AppResult<String> {
    let instances = state.instances.list();
    let mut states = Vec::with_capacity(instances.len());
    for instance in &instances {
        let installed = install::is_installed(&state.dirs, instance);
        let java = if installed { Some(debuginfo::java_of(&state.dirs, instance, java_path.as_deref()).await) } else { None };
        states.push(InstanceState { instance, installed, running: state.is_running(&instance.id), java });
    }
    let version = app.package_info().version.to_string();
    Ok(debuginfo::report(&version, &state.dirs.root, default_memory_mb, &states, instance_id.as_deref()))
}

/// Gesicherte Protokolle früherer Sitzungen der Instanz, neueste zuerst.
#[tauri::command]
pub async fn log_sessions(state: State<'_, AppState>, instance_id: String) -> AppResult<Vec<LogSession>> {
    state.require_instance(&instance_id)?;
    state.blocking_with_dirs(move |dirs| sessionlog::list(dirs, &instance_id)).await
}

/// Text einer gesicherten Sitzung.
#[tauri::command]
pub async fn log_session_read(state: State<'_, AppState>, instance_id: String, session_id: String) -> AppResult<String> {
    state.require_instance(&instance_id)?;
    state.blocking_with_dirs(move |dirs| sessionlog::read(dirs, &instance_id, &session_id)).await
}
