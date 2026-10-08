//! Profile der Inhalte einer Instanz (siehe `services::mod_profiles`). Nur Anwenden schaltet Dateien und braucht den
//! Instanzvorgang, der ein laufendes Spiel ausschließt; Speichern, Umbenennen und Löschen ändern nur Metadaten.
use tauri::State;

use crate::error::AppResult;
use crate::models::Instance;
use crate::services::{blocking, mod_profiles};
use crate::state::AppState;

#[tauri::command]
pub fn mod_profile_save(state: State<'_, AppState>, instance_id: String, name: String) -> AppResult<Instance> {
    mod_profiles::save(&state.instances, &instance_id, &name)
}

#[tauri::command]
pub async fn mod_profile_apply(state: State<'_, AppState>, instance_id: String, profile_id: String) -> AppResult<Instance> {
    let _operation = state.begin_instance_operation(&instance_id)?;
    let (dirs, instances) = (state.dirs.clone(), state.instances.clone());
    blocking(move |_| mod_profiles::apply(&dirs, &instances, &instance_id, &profile_id)).await
}

#[tauri::command]
pub fn mod_profile_rename(state: State<'_, AppState>, instance_id: String, profile_id: String, name: String) -> AppResult<Instance> {
    mod_profiles::rename(&state.instances, &instance_id, &profile_id, &name)
}

#[tauri::command]
pub fn mod_profile_delete(state: State<'_, AppState>, instance_id: String, profile_id: String) -> AppResult<Instance> {
    mod_profiles::delete(&state.instances, &instance_id, &profile_id)
}
