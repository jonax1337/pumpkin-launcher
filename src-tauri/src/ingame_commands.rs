//! Tauri-Commands des Freunde-Menüs im Spiel (docs/bridge/README.md, "Support selection"): Status der Instanz, Schalter und „Erneut
//! versuchen“. Dünne Schicht über `ingame_launch` und den Zustand je Instanz in `AppState.ingame`.
use tauri::{AppHandle, State};

use crate::error::AppResult;
use crate::ingame_launch::{announce, status};
use crate::services::friends::contract::IngameStatus;
use crate::state::AppState;

/// Was der nächste Start der Instanz mit der Mod im Spiel tut und warum, berechnet ohne zu starten.
#[tauri::command]
pub async fn friends_ingame_status(state: State<'_, AppState>, instance_id: String) -> AppResult<IngameStatus> {
    let instance = state.instances.get(&instance_id)?;
    Ok(status(&state, &instance).await)
}

/// Der Schalter der Instanz. Er hebt auch ein automatisches Ausschalten nach einem Startfehler auf.
#[tauri::command]
pub async fn friends_ingame_set_enabled(
    app: AppHandle,
    state: State<'_, AppState>,
    instance_id: String,
    enabled: bool,
) -> AppResult<IngameStatus> {
    let instance = state.instances.get(&instance_id)?;
    state.ingame.store.set_switch(&instance_id, enabled)?;
    Ok(announce_status(&app, &state, &instance_id, &instance).await)
}

/// „Erneut versuchen“ nach einem Startfehler; ein vom Spieler ausgeschalteter Schalter bleibt aus.
#[tauri::command]
pub async fn friends_ingame_retry(app: AppHandle, state: State<'_, AppState>, instance_id: String) -> AppResult<IngameStatus> {
    let instance = state.instances.get(&instance_id)?;
    state.ingame.store.retry(&instance_id)?;
    Ok(announce_status(&app, &state, &instance_id, &instance).await)
}

async fn announce_status(app: &AppHandle, state: &AppState, instance_id: &str, instance: &crate::models::Instance) -> IngameStatus {
    let current = status(state, instance).await;
    announce(app, instance_id, current.clone());
    current
}
