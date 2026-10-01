//! Alles, was im Spielordner einer Instanz unter `saves/` und in `servers.dat` liegt: Welten, Sicherungen,
//! Datenpakete und Serverliste, siehe `services::worlds`, `services::datapacks` und `services::servers`.
//! Was Spieldateien ändert, geht nur, solange die Instanz nicht läuft (`AppState::operation`).
use tauri::{AppHandle, State};

use crate::error::AppResult;
use crate::services::datapacks::{self, Datapack};
use crate::services::progress::progress;
use crate::services::servers::{self, Server, ServerInput};
use crate::services::worlds::{self, World, WorldBackup};
use crate::services::{install, launch};
use crate::state::AppState;

#[tauri::command]
pub async fn world_list(state: State<'_, AppState>, instance_id: String) -> AppResult<Vec<World>> {
    state.require_instance(&instance_id)?;
    state.blocking_with_dirs(move |dirs| worlds::list(dirs, &instance_id)).await
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
    let _operation = state.exclusive(&instance_id)?;
    let on_progress = progress(app, operation_id);
    state.blocking_with_dirs(move |dirs| worlds::backup(dirs, &instance_id, &world_id, &*on_progress)).await
}

#[tauri::command]
pub fn world_backups(state: State<'_, AppState>, instance_id: String) -> AppResult<Vec<WorldBackup>> {
    state.require_instance(&instance_id)?;
    worlds::backups(&state.dirs, &instance_id)
}

/// Stellt eine Sicherung als neue Welt her, nie über eine bestehende.
#[tauri::command]
pub async fn world_restore(state: State<'_, AppState>, instance_id: String, backup_id: String) -> AppResult<World> {
    let _operation = state.exclusive(&instance_id)?;
    state.blocking_with_dirs(move |dirs| worlds::restore(dirs, &instance_id, &backup_id)).await
}

#[tauri::command]
pub fn world_backup_delete(state: State<'_, AppState>, instance_id: String, backup_id: String) -> AppResult<()> {
    state.require_instance(&instance_id)?;
    worlds::delete_backup(&state.dirs, &instance_id, &backup_id)
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
    let _operation = state.exclusive(&instance_id)?;
    worlds::delete_and_forget_target(&state, &instance_id, &world_id, progress(app, operation_id)).await
}

/// Kann die Minecraft-Version der Instanz direkt in eine Welt starten? Fehlt die Versions-JSON, wird sie geladen.
#[tauri::command]
pub async fn world_quick_play_supported(state: State<'_, AppState>, instance_id: String) -> AppResult<bool> {
    let mc = state.instances.get(&instance_id)?.minecraft_version;
    let version = install::installed_or_fetched_version(&state.http, &state.dirs, &mc).await?;
    Ok(launch::starts_into_worlds(&version))
}

#[tauri::command]
pub async fn datapack_list(state: State<'_, AppState>, instance_id: String, world_id: String) -> AppResult<Vec<Datapack>> {
    state.require_instance(&instance_id)?;
    state.blocking_with_dirs(move |dirs| datapacks::list(dirs, &instance_id, &world_id)).await
}

/// Eigene Datenpaket-Zips (absolute Pfade) in eine Welt; passt eins nicht, kommt keins hinein.
#[tauri::command]
pub async fn datapack_add(state: State<'_, AppState>, instance_id: String, world_id: String, paths: Vec<String>) -> AppResult<()> {
    let _operation = state.exclusive(&instance_id)?;
    state.blocking_with_dirs(move |dirs| datapacks::add_files(dirs, &instance_id, &world_id, &paths)).await
}

/// Datenpaket-Version von Modrinth in eine Welt; Fortschritt als `content-progress`.
#[tauri::command]
pub async fn datapack_install(
    app: AppHandle,
    state: State<'_, AppState>,
    instance_id: String,
    world_id: String,
    version_id: String,
    operation_id: String,
) -> AppResult<()> {
    let _operation = state.operation(Some(&instance_id))?;
    datapacks::install(&state, &instance_id, &world_id, &version_id, &*progress(app, operation_id)).await
}

/// Legt ein Datenpaket in den Papierkorb. Synchron auf dem Hauptthread wie `screenshot_delete`: `trash` braucht COM im STA-Modus.
#[tauri::command]
pub fn datapack_remove(state: State<'_, AppState>, instance_id: String, world_id: String, pack_id: String) -> AppResult<()> {
    let _operation = state.exclusive(&instance_id)?;
    datapacks::remove(&state.dirs, &instance_id, &world_id, &pack_id)
}

#[tauri::command]
pub fn server_list(state: State<'_, AppState>, instance_id: String) -> AppResult<Vec<Server>> {
    state.require_instance(&instance_id)?;
    servers::list(&state.dirs.game_dir(&instance_id))
}

/// Legt einen Server an (`index` fehlt) oder ändert den an Stelle `index` aus `server_list`.
#[tauri::command]
pub fn server_save(state: State<'_, AppState>, instance_id: String, index: Option<usize>, server: ServerInput) -> AppResult<()> {
    let _operation = state.exclusive(&instance_id)?;
    servers::save(&state.dirs.game_dir(&instance_id), index, &server)
}

#[tauri::command]
pub fn server_remove(state: State<'_, AppState>, instance_id: String, index: usize) -> AppResult<()> {
    let _operation = state.exclusive(&instance_id)?;
    servers::remove(&state.dirs.game_dir(&instance_id), index)
}
