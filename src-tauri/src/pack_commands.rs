//! Dünne Commands für den Lebenszyklus einer Instanz: Pack-Updates und der Wechsel von Minecraft-Version und Loader.
use tauri::{AppHandle, State};

use crate::{
    error::AppResult,
    services::{
        migrate::{self, MigrationCheck, MigrationOutcome, MigrationTarget},
        modrinth,
        pack_update::{self, PackTarget, PackUpdateOutcome},
    },
    state::AppState,
};

/// Änderungsprotokoll einer Version des Packs, aus dem die Instanz stammt; `None`, wo die Quelle keins führt.
#[tauri::command]
pub async fn pack_changelog(state: State<'_, AppState>, instance_id: String, version_id: String) -> AppResult<Option<String>> {
    let instance = state.instances.get(&instance_id)?;
    pack_update::changelog(&modrinth::client()?, &instance, &version_id).await
}

/// Bringt eine Pack-Instanz auf eine andere Version ihres Packs oder eine neuere `.mrpack`-Datei; vorher werden die
/// Welten gesichert. Abbrechbar über `pack_install_cancel`, bis die Dateien wechseln.
#[tauri::command]
pub async fn pack_update(
    app: AppHandle,
    state: State<'_, AppState>,
    instance_id: String,
    target: PackTarget,
    operation_id: String,
) -> AppResult<PackUpdateOutcome> {
    let _operation = state.begin_instance_operation(&instance_id)?;
    state
        .run_cancellable(&app, &operation_id, |on_progress| pack_update::update(&state, &instance_id, target, on_progress))
        .await
}

/// Vorschau eines Wechsels von Minecraft-Version oder Loader: was mit jedem Inhalt passiert und ob er nur als Kopie geht.
#[tauri::command]
pub async fn instance_migrate_check(
    state: State<'_, AppState>,
    instance_id: String,
    target: MigrationTarget,
) -> AppResult<MigrationCheck> {
    migrate::check(&state, &instance_id, &target).await
}

/// Wechselt Minecraft-Version oder Loader der Instanz selbst, nachdem ihre Welten gesichert sind.
#[tauri::command]
pub async fn instance_migrate(
    app: AppHandle,
    state: State<'_, AppState>,
    instance_id: String,
    target: MigrationTarget,
    operation_id: String,
) -> AppResult<MigrationOutcome> {
    let _operation = state.begin_instance_operation(&instance_id)?;
    state
        .run_cancellable(&app, &operation_id, |on_progress| migrate::migrate(&state, &instance_id, &target, on_progress))
        .await
}

/// Legt eine Kopie an und wechselt nur sie; das Original bleibt, wie es ist.
#[tauri::command]
pub async fn instance_duplicate_migrate(
    app: AppHandle,
    state: State<'_, AppState>,
    instance_id: String,
    target: MigrationTarget,
    operation_id: String,
) -> AppResult<MigrationOutcome> {
    let _operation = state.begin_instance_operation(&instance_id)?;
    state
        .run_cancellable(&app, &operation_id, |on_progress| {
            migrate::duplicate_and_migrate(&state, &instance_id, &target, on_progress)
        })
        .await
}
