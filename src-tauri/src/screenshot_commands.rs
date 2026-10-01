//! Screenshots einer Instanz. Siehe `services::screenshots`.
use tauri::State;

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
