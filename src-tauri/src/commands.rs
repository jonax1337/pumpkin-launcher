//! Tauri-Commands. Dünne Schicht über `AppState`; Argumentnamen kommen im Frontend als camelCase an.
use tauri::State;

use crate::error::{AppError, AppResult};
use crate::models::{Instance, NewInstance, NewPreset, Preset};
use crate::state::AppState;

fn require_name(name: &str) -> AppResult<()> {
    if name.trim().is_empty() {
        return Err(AppError::Invalid("Name darf nicht leer sein".into()));
    }
    Ok(())
}

#[tauri::command]
pub fn list_instances(state: State<'_, AppState>) -> Vec<Instance> {
    state.instances.list()
}

#[tauri::command]
pub fn get_instance(state: State<'_, AppState>, id: String) -> AppResult<Instance> {
    state.instances.get(&id)
}

#[tauri::command]
pub fn create_instance(state: State<'_, AppState>, input: NewInstance) -> AppResult<Instance> {
    require_name(&input.name)?;
    let instance = state.instances.insert(Instance::from_new(input))?;
    tracing::info!(id = %instance.id, name = %instance.name, "Instanz angelegt");
    Ok(instance)
}

#[tauri::command]
pub fn update_instance(state: State<'_, AppState>, instance: Instance) -> AppResult<Instance> {
    require_name(&instance.name)?;
    state.instances.update(instance)
}

#[tauri::command]
pub fn delete_instance(state: State<'_, AppState>, id: String) -> AppResult<()> {
    state.instances.remove(&id)?;
    tracing::info!(%id, "Instanz gelöscht");
    Ok(())
}

#[tauri::command]
pub fn list_presets(state: State<'_, AppState>) -> Vec<Preset> {
    state.presets.list()
}

#[tauri::command]
pub fn create_preset(state: State<'_, AppState>, input: NewPreset) -> AppResult<Preset> {
    require_name(&input.name)?;
    let preset = Preset::from_new(input);
    state.resolve_preset(&preset)?;
    let preset = state.presets.insert(preset)?;
    tracing::info!(id = %preset.id, name = %preset.name, "Preset angelegt");
    Ok(preset)
}

#[tauri::command]
pub fn update_preset(state: State<'_, AppState>, preset: Preset) -> AppResult<Preset> {
    require_name(&preset.name)?;
    state.resolve_preset(&preset)?;
    state.presets.update(preset)
}

#[tauri::command]
pub fn delete_preset(state: State<'_, AppState>, id: String) -> AppResult<()> {
    state.delete_preset(&id)?;
    tracing::info!(%id, "Preset gelöscht");
    Ok(())
}

#[tauri::command]
pub fn apply_preset(
    state: State<'_, AppState>,
    instance_id: String,
    preset_id: String,
) -> AppResult<Instance> {
    let instance = state.apply_preset(&instance_id, &preset_id)?;
    tracing::info!(instance = %instance_id, preset = %preset_id, "Preset angewendet");
    Ok(instance)
}
