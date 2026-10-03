//! Tauri-Commands der Freunde (SPEC 8.4, von `friends_state` bis `friends_retry_now`, BYNAME 9.4). Dünne Schicht über
//! `AppState.friends`; Sitzungen, Einladungen, Mod und Skins liegen in `friends_session_commands.rs` (R5).
use futures::future::BoxFuture;
use futures::FutureExt;
use tauri::{AppHandle, Manager, State};

use crate::coded;
use crate::error::{AppError, AppResult};
use crate::models::{AccountKind, MsAccount};
use crate::services::auth;
use crate::services::friends::contract::{
    BlockedPeer, Friend, FriendCode, FriendRequest, FriendsEnableInput, FriendsSettings, FriendsState,
};
use crate::services::friends::directory::{AccountTokens, McIdentity};
use crate::services::friends::AccountProfile;
use crate::state::AppState;

/// Das erste Microsoft-Konto; der Launcher merkt sich kein „aktives“ Konto im Backend.
pub(crate) fn account_profile(state: &AppState) -> Option<AccountProfile> {
    first_microsoft_account(state).map(|account| AccountProfile::new(&account.username, &account.id))
}

fn first_microsoft_account(state: &AppState) -> Option<MsAccount> {
    state.accounts.list().into_iter().find(|account| account.kind == AccountKind::Microsoft)
}

/// Die Minecraft-Sitzung des ersten Microsoft-Kontos für das Verzeichnis (BYNAME 9.1). Der Weg über den `AppHandle`
/// bricht den Kreis: `AppState` enthält den Freunde-Dienst, der diese Sitzung braucht.
pub(crate) struct AppAccountTokens {
    handle: AppHandle,
}

impl AppAccountTokens {
    pub(crate) fn new(handle: AppHandle) -> Self {
        Self { handle }
    }
}

impl AccountTokens for AppAccountTokens {
    fn minecraft_session(&self) -> BoxFuture<'_, AppResult<McIdentity>> {
        async move {
            let state = self.handle.state::<AppState>();
            let stored = first_microsoft_account(&state)
                .ok_or_else(|| AppError::invalid(coded!("errors.friends.msAccountRequired")))?;
            let (account, session) = auth::session(&state, &stored.id).await?;
            let profile = AccountProfile::new(&account.username, &account.id);
            Ok(McIdentity { uuid: profile.uuid, name: profile.name, access_token: session.access_token })
        }
        .boxed()
    }
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

/// Anfrage an den Spieler mit genau diesem Minecraft-Namen (BYNAME 7.1).
#[tauri::command]
pub async fn friend_add_by_name(state: State<'_, AppState>, name: String) -> AppResult<FriendRequest> {
    state.friends.add_by_name(&name).await
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
