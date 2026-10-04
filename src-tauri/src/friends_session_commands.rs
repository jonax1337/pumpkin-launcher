//! Tauri-Commands der geteilten Welten (SPEC 8.4, von `friend_skin` bis `friends_mod_confirm`). Dünne Schicht über
//! `AppState.sessions`; nur der Skin braucht mehr vom App-Zustand.
use tauri::State;

use crate::error::{AppError, AppResult};
use crate::services::friends::avatar;
use crate::services::friends::contract::{HostSession, Invite, JoinPlan, JoinTicket, LanStatus, ModActivityEntry};
use crate::state::AppState;

/// Der Skin eines Freundes als PNG-Data-URL; Rust lädt und merkt ihn, die Oberfläche fragt Mojang nie selbst.
#[tauri::command]
pub async fn friend_skin(state: State<'_, AppState>, friend_id: String) -> AppResult<Option<String>> {
    let friends = state.friends.list().await?;
    let friend = friends.into_iter().find(|friend| friend.id == friend_id).ok_or_else(|| {
        AppError::NotFound(crate::coded!("errors.friends.notFound.friend", id = friend_id).into())
    })?;
    match friend.mc_uuid {
        Some(mc_uuid) => avatar::skin(&state.http, &state.dirs, &mc_uuid).await,
        None => Ok(None),
    }
}

#[tauri::command]
pub async fn lan_status(state: State<'_, AppState>, instance_id: String) -> AppResult<Option<LanStatus>> {
    state.sessions.lan_status(&instance_id).await
}

#[tauri::command]
pub async fn host_sessions(state: State<'_, AppState>) -> AppResult<Vec<HostSession>> {
    state.sessions.host_sessions().await
}

#[tauri::command]
pub async fn host_start(
    state: State<'_, AppState>,
    instance_id: String,
    port: Option<u16>,
    show_world_name: bool,
) -> AppResult<HostSession> {
    state.sessions.host_start(&instance_id, port, show_world_name).await
}

#[tauri::command]
pub async fn host_invite(
    state: State<'_, AppState>,
    session_id: String,
    friend_ids: Vec<String>,
) -> AppResult<HostSession> {
    state.sessions.host_invite(&session_id, friend_ids).await
}

#[tauri::command]
pub async fn host_kick(state: State<'_, AppState>, session_id: String, friend_id: String) -> AppResult<HostSession> {
    state.sessions.host_kick(&session_id, &friend_id).await
}

#[tauri::command]
pub async fn host_stop(state: State<'_, AppState>, session_id: String) -> AppResult<()> {
    state.sessions.host_stop(&session_id).await
}

#[tauri::command]
pub async fn invites_list(state: State<'_, AppState>) -> AppResult<Vec<Invite>> {
    state.sessions.invites().await
}

#[tauri::command]
pub async fn invite_decline(state: State<'_, AppState>, invite_id: String) -> AppResult<()> {
    state.sessions.invite_decline(&invite_id).await
}

#[tauri::command]
pub async fn invite_plan(state: State<'_, AppState>, invite_id: String) -> AppResult<JoinPlan> {
    state.sessions.invite_plan(&invite_id).await
}

#[tauri::command]
pub async fn invite_join(state: State<'_, AppState>, invite_id: String, instance_id: String) -> AppResult<JoinTicket> {
    state.sessions.invite_join(&invite_id, &instance_id).await
}

#[tauri::command]
pub async fn join_leave(state: State<'_, AppState>, join_id: String) -> AppResult<()> {
    state.sessions.join_leave(&join_id).await
}

#[tauri::command]
pub async fn friends_mod_confirm(state: State<'_, AppState>, request_id: String, allow: bool) -> AppResult<()> {
    state.sessions.mod_confirm(&request_id, allow).await
}

/// Die Vorgänge der Bereiche `share` und `social`, die aus dem Spiel kamen (INGAME 5.7): die letzten 100, neueste zuerst.
/// Nur im Speicher; neue Einträge kommen als Ereignis `friends-mod-activity`.
#[tauri::command]
#[expect(dead_code, reason = "lib.rs trägt den Befehl in generate_handler! ein; erst dann wird er benutzt (dann diese Zeile löschen)")]
pub fn friends_mod_activity(state: State<'_, AppState>) -> Vec<ModActivityEntry> {
    state.sessions.mod_activity()
}
