//! Microsoft-Konten: Anmeldung (Browser oder Gerätecode), Liste, Entfernen. Siehe `services::auth`.
use tauri::State;

use crate::error::AppResult;
use crate::friends_commands::account_profile;
use crate::models::Account;
use crate::services::auth::{self, LoginMode, LoginStart};
use crate::state::AppState;

/// Startet die Anmeldung. Standard: Browser mit Rücksprung auf localhost, das Frontend öffnet `verificationUri`.
/// `method = "device"` erzwingt den Gerätecode (dann zeigt das Frontend `userCode` und `verificationUri`).
#[tauri::command]
pub async fn ms_login_start(state: State<'_, AppState>, method: Option<String>) -> AppResult<LoginStart> {
    auth::start_login(&state, LoginMode::from_method(method.as_deref())).await
}

/// Wartet auf die Bestätigung im Browser und liefert das gespeicherte Konto.
#[tauri::command]
pub async fn ms_login_finish(state: State<'_, AppState>) -> AppResult<Account> {
    let account = auth::finish_login(&state).await?;
    announce_account_to_friends(&state);
    Ok(account)
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
    auth::remove_account(&state, &id)?;
    announce_account_to_friends(&state);
    Ok(())
}

/// Freunde sehen das erste Microsoft-Konto; nach jeder Änderung der Konten wird es neu bestimmt.
fn announce_account_to_friends(state: &AppState) {
    state.friends.update_account(account_profile(state));
}
