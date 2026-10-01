//! Welten, Sicherungen und Serverliste einer Instanz, siehe `services::worlds` und `services::servers`.
//! Was Spieldateien ändert, geht nur, solange die Instanz nicht läuft (`AppState::operation`).
use tauri::{AppHandle, State};

use crate::content_commands::progress;
use crate::error::AppResult;
use crate::models::QuickPlay;
use crate::services::servers::{self, Server};
use crate::services::worlds::{self, World, WorldBackup};
use crate::services::{blocking, install, launch, Dirs};
use crate::state::AppState;

/// Verzeichnisse einer bestehenden Instanz: ihre ID wird erst nach dieser Prüfung Teil eines Pfads.
fn dirs_of(state: &AppState, instance_id: &str) -> AppResult<Dirs> {
    state.instances.get(instance_id)?;
    Ok(state.dirs.clone())
}

#[tauri::command]
pub async fn world_list(state: State<'_, AppState>, instance_id: String) -> AppResult<Vec<World>> {
    let dirs = dirs_of(&state, &instance_id)?;
    blocking(move |_| worlds::list(&dirs, &instance_id)).await
}

/// Sichert eine Welt; Fortschritt als `content-progress` (Phase `backup`).
#[tauri::command]
pub async fn world_backup(
    app: AppHandle,
    state: State<'_, AppState>,
    instance_id: String,
    world_id: String,
    operation_id: String,
) -> AppResult<WorldBackup> {
    let _operation = state.operation(Some(&instance_id))?;
    let (dirs, on_progress) = (dirs_of(&state, &instance_id)?, progress(app, operation_id));
    blocking(move |_| worlds::backup(&dirs, &instance_id, &world_id, &on_progress)).await
}

#[tauri::command]
pub fn world_backups(state: State<'_, AppState>, instance_id: String) -> AppResult<Vec<WorldBackup>> {
    worlds::backups(&dirs_of(&state, &instance_id)?, &instance_id)
}

/// Stellt eine Sicherung als neue Welt her, nie über eine bestehende.
#[tauri::command]
pub async fn world_restore(state: State<'_, AppState>, instance_id: String, backup_id: String) -> AppResult<World> {
    let _operation = state.operation(Some(&instance_id))?;
    let dirs = dirs_of(&state, &instance_id)?;
    blocking(move |_| worlds::restore(&dirs, &instance_id, &backup_id)).await
}

#[tauri::command]
pub fn world_backup_delete(state: State<'_, AppState>, instance_id: String, backup_id: String) -> AppResult<()> {
    worlds::delete_backup(&dirs_of(&state, &instance_id)?, &instance_id, &backup_id)
}

/// Löscht eine Welt, nachdem sie gesichert wurde (Fortschritt wie `world_backup`); liefert die Sicherung.
/// War die Welt das letzte Quick-Play-Ziel der Instanz, ist es damit vergessen: „Weiterspielen“ liefe ins Leere.
#[tauri::command]
pub async fn world_delete(
    app: AppHandle,
    state: State<'_, AppState>,
    instance_id: String,
    world_id: String,
    operation_id: String,
) -> AppResult<WorldBackup> {
    let _operation = state.operation(Some(&instance_id))?;
    let (dirs, on_progress) = (dirs_of(&state, &instance_id)?, progress(app, operation_id));
    let deleted = Some(QuickPlay::World { id: world_id.clone() });
    let target = instance_id.clone();
    let backup = blocking(move |_| worlds::delete(&dirs, &target, &world_id, &on_progress)).await?;
    state.instances.modify(&instance_id, |i| {
        if i.last_quick_play == deleted {
            i.last_quick_play = None;
        }
    })?;
    Ok(backup)
}

/// Kann die Minecraft-Version der Instanz direkt in eine Welt starten? Fehlt die Versions-JSON, wird sie geladen.
#[tauri::command]
pub async fn world_quick_play_supported(state: State<'_, AppState>, instance_id: String) -> AppResult<bool> {
    let mc = state.instances.get(&instance_id)?.minecraft_version;
    let version = install::installed_or_fetched_version(&state.http, &state.dirs, &mc).await?;
    Ok(launch::starts_into_worlds(&version))
}

#[tauri::command]
pub fn server_list(state: State<'_, AppState>, instance_id: String) -> AppResult<Vec<Server>> {
    servers::list(&dirs_of(&state, &instance_id)?.game_dir(&instance_id))
}

/// Legt einen Server an (`index` fehlt) oder ändert den an Stelle `index` aus `server_list`.
#[tauri::command]
pub fn server_save(state: State<'_, AppState>, instance_id: String, index: Option<usize>, server: Server) -> AppResult<()> {
    let _operation = state.operation(Some(&instance_id))?;
    servers::save(&dirs_of(&state, &instance_id)?.game_dir(&instance_id), index, &server)
}

#[tauri::command]
pub fn server_remove(state: State<'_, AppState>, instance_id: String, index: usize) -> AppResult<()> {
    let _operation = state.operation(Some(&instance_id))?;
    servers::remove(&dirs_of(&state, &instance_id)?.game_dir(&instance_id), index)
}
