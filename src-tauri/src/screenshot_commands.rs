//! Screenshots einer Instanz. Siehe `services::screenshots`.
use std::path::PathBuf;

use tauri::State;

use crate::error::AppResult;
use crate::services::screenshots::{self, Screenshot};
use crate::state::AppState;

/// `screenshots/` der Instanz; nur eine existierende Id wird zum Pfad.
fn screenshots_dir(state: &AppState, instance_id: &str) -> AppResult<PathBuf> {
    state.instances.get(instance_id)?;
    Ok(state.dirs.screenshots_dir(instance_id))
}

/// Screenshots der Instanz, neueste zuerst.
#[tauri::command]
pub fn screenshot_list(state: State<'_, AppState>, instance_id: String) -> AppResult<Vec<Screenshot>> {
    screenshots::list(&screenshots_dir(&state, &instance_id)?)
}

/// Legt einen Screenshot in den Papierkorb. Bewusst synchron, also auf dem Hauptthread: `trash` braucht
/// COM im STA-Modus, und das hat das Fenster dort schon eingerichtet.
#[tauri::command]
pub fn screenshot_delete(state: State<'_, AppState>, instance_id: String, file_name: String) -> AppResult<()> {
    screenshots::delete(&screenshots_dir(&state, &instance_id)?, &file_name)?;
    tracing::info!(instance = %instance_id, %file_name, "Screenshot in den Papierkorb gelegt");
    Ok(())
}
