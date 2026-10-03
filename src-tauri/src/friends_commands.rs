//! Tauri-Commands der Freunde (SPEC 8.4, von `friends_state` bis `friends_retry_now`). Dünne Schicht über
//! `AppState.friends`; Sitzungen, Einladungen, Mod und Skins liegen in `friends_session_commands.rs` (R5).
use tauri::State;

use crate::error::AppResult;
use crate::models::AccountKind;
use crate::services::friends::contract::{
    BlockedPeer, Friend, FriendCode, FriendRequest, FriendsEnableInput, FriendsSettings, FriendsState,
};
use crate::services::friends::AccountProfile;
use crate::state::AppState;

/// Das erste Microsoft-Konto; der Launcher merkt sich kein „aktives“ Konto im Backend.
pub(crate) fn account_profile(state: &AppState) -> Option<AccountProfile> {
    let accounts = state.accounts.list().into_iter();
    let microsoft = accounts.filter(|account| account.kind == AccountKind::Microsoft);
    microsoft.map(|account| AccountProfile::new(&account.username, &account.id)).next()
}

#[tauri::command]
pub fn friends_state(state: State<'_, AppState>) -> FriendsState {
    state.friends.state()
}

#[tauri::command]
pub async fn friends_enable(state: State<'_, AppState>, input: FriendsEnableInput) -> AppResult<FriendsState> {
    state.friends.enable(input, account_profile(&state)).await
}

#[tauri::command]
pub async fn friends_disable(state: State<'_, AppState>) -> AppResult<FriendsState> {
    state.friends.disable().await
}

#[tauri::command]
pub async fn friends_update_settings(state: State<'_, AppState>, settings: FriendsSettings) -> AppResult<FriendsState> {
    state.friends.update_settings(settings).await
}

#[tauri::command]
pub async fn friends_rotate_identity(state: State<'_, AppState>) -> AppResult<FriendsState> {
    state.friends.rotate_identity().await
}

#[tauri::command]
pub async fn friends_reset(state: State<'_, AppState>) -> AppResult<FriendsState> {
    state.friends.reset().await
}

#[tauri::command]
pub async fn friends_list(state: State<'_, AppState>) -> AppResult<Vec<Friend>> {
    state.friends.list().await
}

#[tauri::command]
pub async fn friend_requests(state: State<'_, AppState>) -> AppResult<Vec<FriendRequest>> {
    state.friends.requests().await
}

#[tauri::command]
pub async fn friend_code_create(state: State<'_, AppState>) -> AppResult<FriendCode> {
    state.friends.code_create().await
}

#[tauri::command]
pub async fn friend_codes(state: State<'_, AppState>) -> AppResult<Vec<FriendCode>> {
    state.friends.codes().await
}

#[tauri::command]
pub async fn friend_code_revoke(state: State<'_, AppState>, code_id: String) -> AppResult<()> {
    state.friends.code_revoke(&code_id).await
}

#[tauri::command]
pub async fn friend_add(state: State<'_, AppState>, code: String) -> AppResult<FriendRequest> {
    state.friends.add(&code).await
}

#[tauri::command]
pub async fn friend_request_answer(state: State<'_, AppState>, request_id: String, accept: bool) -> AppResult<()> {
    state.friends.answer_request(&request_id, accept).await
}

#[tauri::command]
pub async fn friend_request_cancel(state: State<'_, AppState>, request_id: String) -> AppResult<()> {
    state.friends.cancel_request(&request_id).await
}

#[tauri::command]
pub async fn friend_rename(state: State<'_, AppState>, friend_id: String, alias: Option<String>) -> AppResult<()> {
    state.friends.rename(&friend_id, alias).await
}

#[tauri::command]
pub async fn friend_acknowledge(state: State<'_, AppState>, friend_id: String) -> AppResult<()> {
    state.friends.acknowledge(&friend_id).await
}

#[tauri::command]
pub async fn friend_remove(state: State<'_, AppState>, friend_id: String) -> AppResult<()> {
    state.friends.remove(&friend_id).await
}

#[tauri::command]
pub async fn friend_block(state: State<'_, AppState>, peer_id: String) -> AppResult<()> {
    state.friends.block(&peer_id).await
}

#[tauri::command]
pub async fn friend_unblock(state: State<'_, AppState>, peer_id: String) -> AppResult<()> {
    state.friends.unblock(&peer_id).await
}

#[tauri::command]
pub async fn friends_blocked(state: State<'_, AppState>) -> AppResult<Vec<BlockedPeer>> {
    state.friends.blocked().await
}

#[tauri::command]
pub async fn friends_retry_now(state: State<'_, AppState>) -> AppResult<()> {
    state.friends.retry_now().await
}
