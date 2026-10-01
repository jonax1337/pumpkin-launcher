//! Microsoft-Konten: Anmeldung per Gerätecode, Liste, Entfernen. Siehe `services::auth`.
use tauri::State;

use crate::error::AppResult;
use crate::models::Account;
use crate::services::auth::{self, LoginStart};
use crate::state::AppState;

/// Startet die Anmeldung. Standard: Browser mit Rücksprung auf localhost, das Frontend öffnet `verificationUri`.
/// `method = "device"` erzwingt den Gerätecode (dann zeigt das Frontend `userCode` und `verificationUri`).
#[tauri::command]
pub async fn ms_login_start(state: State<'_, AppState>, method: Option<String>) -> AppResult<LoginStart> {
    auth::start_login(&state, method).await
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

/// Darf das Frontend Spielernamen ohne Konto anbieten? (Debug-Build oder angemeldetes Microsoft-Konto.)
#[tauri::command]
pub fn offline_allowed(state: State<'_, AppState>) -> bool {
    auth::offline_allowed(&state)
}

#[tauri::command]
pub fn ms_account_remove(state: State<'_, AppState>, id: String) -> AppResult<()> {
    auth::remove_account(&state, &id)
}
