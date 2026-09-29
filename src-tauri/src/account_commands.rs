//! Microsoft-Konten: Anmeldung per Gerätecode, Liste, Entfernen. Siehe `services::auth`.
use tauri::State;

use crate::error::AppResult;
use crate::models::Account;
use crate::services::auth::{self, DeviceCode};
use crate::state::AppState;

/// Startet die Anmeldung; das Frontend zeigt `userCode` und `verificationUri` an.
#[tauri::command]
pub async fn ms_login_start(state: State<'_, AppState>, client_id: Option<String>) -> AppResult<DeviceCode> {
    auth::start_login(&state, client_id).await
}

/// Wartet auf die Bestätigung im Browser und liefert das gespeicherte Konto.
#[tauri::command]
pub async fn ms_login_finish(state: State<'_, AppState>) -> AppResult<Account> {
    auth::finish_login(&state).await
}

#[tauri::command]
pub fn ms_login_cancel(state: State<'_, AppState>) {
    auth::cancel_login(&state);
}

#[tauri::command]
pub fn ms_accounts(state: State<'_, AppState>) -> Vec<Account> {
    auth::accounts(&state)
}

#[tauri::command]
pub fn ms_account_remove(state: State<'_, AppState>, id: String) -> AppResult<()> {
    auth::remove_account(&state, &id)
}
