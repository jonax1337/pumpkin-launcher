//! Speicher und Java des Rechners: Übersicht des Datenordners, Mod-Cache leeren, Datenordner öffnen, Java suchen.
//! Siehe `services::storage` und `services::javadetect`.
use tauri::{AppHandle, State};
use tauri_plugin_opener::OpenerExt;

use crate::error::{AppError, AppResult};
use crate::services::javadetect::{self, JavaInstall};
use crate::services::storage::{self, StorageOverview};
use crate::services::blocking;
use crate::state::AppState;

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StorageRelocation {
    overview: StorageOverview,
    retained_source_dir: Option<String>,
}

#[tauri::command]
pub async fn storage_set_instances_dir(state: State<'_, AppState>, path: String) -> AppResult<StorageRelocation> {
    let _operation = state.begin_storage_operation()?;
    let (dirs, instances) = (state.dirs.clone(), state.instances.list());
    blocking(move |_| {
        // All fallible accounting happens before commit; an accounting failure must not
        // make a successfully moved library appear to have failed.
        let mut overview = storage::overview(&dirs, &instances)?;
        // The user's choice here replaces any installer request, which would otherwise move the library again at the
        // next start; if it cannot be removed, nothing is moved.
        crate::services::storage_location::discard_request(&dirs)?;
        let retained = crate::services::storage_location::relocate(&dirs, std::path::Path::new(&path))?;
        overview.instances_dir = dirs.instances_dir().to_string_lossy().into_owned();
        overview.instances_free_mb = crate::services::system::free_space_mb(&dirs.instances_dir()).ok();
        Ok(StorageRelocation {
            overview,
            retained_source_dir: retained.map(|path| path.to_string_lossy().into_owned()),
        })
    }).await
}

#[tauri::command]
pub fn storage_open_instances_dir(app: AppHandle, state: State<'_, AppState>) -> AppResult<()> {
    app.opener().open_path(state.dirs.instances_dir().to_string_lossy(), None::<&str>)
        .map_err(|err| AppError::invalid(err.to_string()))
}

#[tauri::command]
pub fn storage_open_instance_path(app: AppHandle, state: State<'_, AppState>, path: String) -> AppResult<()> {
    // No operation lock: opening a crash report must work during an install. The path is validated against the live
    // library and the opener only receives the validated canonical path.
    let path = crate::services::storage_location::instance_open_path(
        &state.dirs, &state.instances.list(), std::path::Path::new(&path),
    )?;
    app.opener().open_path(path.to_string_lossy(), None::<&str>).map_err(|err| AppError::invalid(err.to_string()))
}

/// Platz je Instanz, im Mod-Cache und in den geteilten Ordnern. Läuft abseits des UI-Threads: der Datenordner kann
/// Zehntausende Dateien haben.
#[tauri::command]
pub async fn storage_overview(state: State<'_, AppState>) -> AppResult<StorageOverview> {
    let (dirs, instances) = (state.dirs.clone(), state.instances.list());
    blocking(move |_| storage::overview(&dirs, &instances)).await
}

/// Löscht die Dateien des Mod-Caches, die keine Instanz braucht, und liefert die freigegebenen Bytes. Unter der Sperre
/// der ganzen Bibliothek, solange also kein Vorgang an einer Instanz läuft: ein Mod-Download oder -Einbau könnte seine
/// Datei sonst verlieren, bevor die Instanz sie einträgt.
#[tauri::command]
pub async fn storage_clear_cache(state: State<'_, AppState>) -> AppResult<u64> {
    let _operation = state.begin_library_operation()?;
    let (dirs, instances) = (state.dirs.clone(), state.instances.list());
    let freed = blocking(move |_| storage::clear_unused_cache(&dirs, &instances)).await?;
    tracing::info!(freed, "Mod-Cache aufgeräumt");
    Ok(freed)
}

/// Öffnet den Datenordner im Dateimanager.
#[tauri::command]
pub fn storage_open_dir(app: AppHandle, state: State<'_, AppState>) -> AppResult<()> {
    app.opener().open_path(state.dirs.root.to_string_lossy(), None::<&str>).map_err(|err| AppError::invalid(err.to_string()))
}

/// Auf dem Rechner installierte Java-Versionen, neueste zuerst.
#[tauri::command]
pub async fn java_detect() -> AppResult<Vec<JavaInstall>> {
    blocking(|_| Ok(javadetect::detect())).await
}
