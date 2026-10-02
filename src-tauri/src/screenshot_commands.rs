//! Screenshots einer Instanz. Siehe `services::screenshots`.
use tauri::{ipc::Response, State};

use crate::error::AppResult;
use crate::services::screenshots::{self, Screenshot};
use crate::state::AppState;

/// Screenshots der Instanz, neueste zuerst.
#[tauri::command]
pub fn screenshot_list(state: State<'_, AppState>, instance_id: String) -> AppResult<Vec<Screenshot>> {
    state.require_instance(&instance_id)?;
    screenshots::list(&state.dirs.screenshots_dir(&instance_id))
}

/// Legt einen Screenshot in den Papierkorb. Bewusst synchron, also auf dem Hauptthread: `trash` braucht
/// COM im STA-Modus, und das hat das Fenster dort schon eingerichtet.
#[tauri::command]
pub fn screenshot_delete(state: State<'_, AppState>, instance_id: String, file_name: String) -> AppResult<()> {
    state.require_instance(&instance_id)?;
    screenshots::delete(&state.dirs.screenshots_dir(&instance_id), &file_name)?;
    tracing::info!(instance = %instance_id, %file_name, "Screenshot in den Papierkorb gelegt");
    Ok(())
}

/// Der Inhalt eines Screenshots als rohe Bytes (kein JSON-Umweg), zum Kopieren in die Zwischenablage.
#[tauri::command]
pub async fn screenshot_read(state: State<'_, AppState>, instance_id: String, file_name: String) -> AppResult<Response> {
    state.require_instance(&instance_id)?;
    let bytes = state.blocking_with_dirs(move |dirs| screenshots::read(&dirs.screenshots_dir(&instance_id), &file_name)).await?;
    Ok(Response::new(bytes))
}
