//! Speicher und Java des Rechners: Übersicht des Datenordners, Mod-Cache leeren, Datenordner öffnen, Java suchen.
//! Siehe `services::storage` und `services::javadetect`.
use tauri::{AppHandle, State};
use tauri_plugin_opener::OpenerExt;

use crate::error::{AppError, AppResult};
use crate::services::javadetect::{self, JavaInstall};
use crate::services::storage::{self, StorageOverview};
use crate::services::blocking;
use crate::state::AppState;

/// Platz je Instanz, im Mod-Cache und in den geteilten Ordnern. Läuft abseits des UI-Threads: der Datenordner kann
/// Zehntausende Dateien haben.
#[tauri::command]
pub async fn storage_overview(state: State<'_, AppState>) -> AppResult<StorageOverview> {
    let (dirs, instances) = (state.dirs.clone(), state.instances.list());
    blocking(move |_| storage::overview(&dirs, &instances)).await
}

/// Löscht die Dateien des Mod-Caches, die keine Instanz braucht, und liefert die freigegebenen Bytes. Wie
/// Installationen unter der Vorgangssperre: ein laufender Mod-Download könnte seine Datei sonst verlieren.
#[tauri::command]
pub async fn storage_clear_cache(state: State<'_, AppState>) -> AppResult<u64> {
    let _operation = state.begin_operation()?;
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
