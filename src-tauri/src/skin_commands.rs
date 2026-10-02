//! Skins und Umhänge: Profil über die Minecraft-API (nur Microsoft-Konten) und lokale Bibliothek. Siehe `services::skins`.
use std::path::Path;

use tauri::State;

use crate::error::AppResult;
use crate::models::{LibrarySkin, SkinVariant};
use crate::services::skins::{self, SkinProfile};
use crate::state::AppState;

#[tauri::command]
pub async fn skin_profile(state: State<'_, AppState>, account_id: String) -> AppResult<SkinProfile> {
    skins::profile(&state, &account_id).await
}

#[tauri::command]
pub fn skin_library(state: State<'_, AppState>) -> Vec<LibrarySkin> {
    state.skins.list()
}

/// PNG eines Bibliotheks-Skins als `data:`-URL.
#[tauri::command]
pub fn skin_texture(state: State<'_, AppState>, id: String) -> AppResult<String> {
    skins::texture(&state, &id)
}

/// Nimmt die PNG unter `path` (aus dem Dateidialog) in die Bibliothek auf.
#[tauri::command]
pub fn skin_add(state: State<'_, AppState>, path: String) -> AppResult<LibrarySkin> {
    skins::add_file(&state, Path::new(&path))
}

/// Lädt den Skin, den der Spieler `name` gerade trägt, in die Bibliothek (öffentliche Mojang-Endpunkte, kein Konto nötig).
#[tauri::command]
pub async fn skin_add_player(state: State<'_, AppState>, name: String) -> AppResult<LibrarySkin> {
    skins::add_player_skin(&state, &name).await
}

#[tauri::command]
pub fn skin_update(state: State<'_, AppState>, id: String, name: String, variant: SkinVariant) -> AppResult<LibrarySkin> {
    skins::update(&state, &id, &name, variant)
}

#[tauri::command]
pub fn skin_delete(state: State<'_, AppState>, id: String) -> AppResult<()> {
    skins::delete(&state, &id)
}

/// Legt den aktuell getragenen Skin des Kontos unter `name` in der Bibliothek ab.
#[tauri::command]
pub async fn skin_save_active(state: State<'_, AppState>, account_id: String, name: String) -> AppResult<LibrarySkin> {
    skins::save_active(&state, &account_id, &name).await
}

#[tauri::command]
pub async fn skin_upload(state: State<'_, AppState>, account_id: String, skin_id: String) -> AppResult<()> {
    skins::upload(&state, &account_id, &skin_id).await
}

#[tauri::command]
pub async fn skin_reset(state: State<'_, AppState>, account_id: String) -> AppResult<()> {
    skins::reset(&state, &account_id).await
}

/// Zeigt den Umhang `capeId`; ohne blendet er den aktiven aus.
#[tauri::command]
pub async fn skin_cape(state: State<'_, AppState>, account_id: String, cape_id: Option<String>) -> AppResult<()> {
    skins::set_cape(&state, &account_id, cape_id.as_deref()).await
}
