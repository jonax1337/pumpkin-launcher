//! Screenshots einer Instanz. Siehe `services::screenshots`.
use tauri::{ipc::Response, AppHandle, Manager, State};

use crate::error::{AppError, AppResult};
use crate::services::screenshots::{self, Screenshot};
use crate::state::AppState;

/// Screenshots der Instanz, neueste zuerst.
#[tauri::command]
pub fn screenshot_list(app: AppHandle, state: State<'_, AppState>, instance_id: String) -> AppResult<Vec<Screenshot>> {
    // Read-only: no operation lock, so the gallery keeps working during an install. Every file is validated before the
    // webview may load it; the asset scope starts empty and only grows by these validated files.
    state.require_instance(&instance_id)?;
    let folder = state.dirs.screenshots_dir(&instance_id);
    crate::services::content::regular_parents(&state.dirs.instances_dir(), &folder)?;
    let screenshots = screenshots::list(&folder)?;
    for screenshot in &screenshots {
        crate::services::content::regular_parents(&state.dirs.instances_dir(), std::path::Path::new(&screenshot.path))?;
        app.asset_protocol_scope().allow_file(&screenshot.path).map_err(|err| AppError::invalid(err.to_string()))?;
    }
    Ok(screenshots)
}

/// Legt einen Screenshot in den Papierkorb. Bewusst synchron, also auf dem Hauptthread: `trash` braucht
/// COM im STA-Modus, und das hat das Fenster dort schon eingerichtet.
#[tauri::command]
pub fn screenshot_delete(state: State<'_, AppState>, instance_id: String, file_name: String) -> AppResult<()> {
    let _operation = state.begin_instance_operation_even_if_running(&instance_id)?;
    crate::services::content::regular_parents(&state.dirs.instances_dir(), &state.dirs.screenshots_dir(&instance_id))?;
    state.require_instance(&instance_id)?;
    screenshots::delete(&state.dirs.screenshots_dir(&instance_id), &file_name)?;
    tracing::info!(instance = %instance_id, %file_name, "Screenshot in den Papierkorb gelegt");
    Ok(())
}

/// Der Inhalt eines Screenshots als rohe Bytes (kein JSON-Umweg), zum Kopieren in die Zwischenablage.
#[tauri::command]
pub async fn screenshot_read(state: State<'_, AppState>, instance_id: String, file_name: String) -> AppResult<Response> {
    crate::services::content::regular_parents(&state.dirs.instances_dir(), &state.dirs.screenshots_dir(&instance_id))?;
    state.require_instance(&instance_id)?;
    let bytes = state.blocking_with_dirs(move |dirs| screenshots::read(&dirs.screenshots_dir(&instance_id), &file_name)).await?;
    Ok(Response::new(bytes))
}
