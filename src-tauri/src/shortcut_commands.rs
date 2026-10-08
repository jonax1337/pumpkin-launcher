//! Verknüpfungen auf dem Desktop, die eine Instanz ohne Rückfrage starten. Siehe `services::shortcuts` und
//! `services::shortcut_key`; der Link selbst ist in `deep_link` beschrieben.
use std::path::PathBuf;

use tauri::{AppHandle, State};

use crate::deep_link;
use crate::error::AppResult;
use crate::models::Instance;
use crate::services::shortcut_icon::{self, IconPng};
use crate::services::shortcut_key::ShortcutKey;
use crate::services::shortcuts::{self, LauncherIcon, Places, Shortcut};
use crate::state::AppState;

/// Legt eine Verknüpfung zur Instanz auf den Desktop (im Anwendungsmenü zusätzlich unter Linux); liefert den Pfad der Datei.
/// `icon_png` ist das Icon der Instanz, von der Oberfläche als quadratisches PNG gezeichnet; ohne (oder mit einem
/// unbrauchbaren) trägt die Verknüpfung das Icon des Launchers.
#[tauri::command]
pub fn instance_create_shortcut(
    app: AppHandle,
    state: State<'_, AppState>,
    key: State<'_, ShortcutKey>,
    instance_id: String,
    icon_png: Option<String>,
) -> AppResult<String> {
    let instance = state.instances.get(&instance_id)?;
    let url = deep_link::launch_link(&instance.id, &key.token_for(&instance.id)?);
    let icon = LauncherIcon {
        own: store_instance_icon(&state, &instance, icon_png.as_deref()),
        exe: std::env::current_exe()?,
        theme_name: app.config().main_binary_name.clone().unwrap_or_default(),
    };
    let shortcut = Shortcut { instance_id: &instance.id, name: &instance.name, url: &url, icon: &icon };
    let path = shortcuts::create(&Places::of_user()?, &shortcut)?;
    tracing::info!(instance = %instance.id, path = %path.display(), own_icon = icon.own.is_some(), "Verknüpfung angelegt");
    Ok(path.to_string_lossy().into_owned())
}

/// Das Icon ist Zierde: Eine Verknüpfung ohne eigenes Icon ist besser als keine, also bricht ein unbrauchbares Bild sie nicht ab.
fn store_instance_icon(state: &AppState, instance: &Instance, icon_png: Option<&str>) -> Option<PathBuf> {
    let png = IconPng::from_data_url(icon_png?).or_else(|| {
        tracing::warn!(instance = %instance.id, "Icon der Verknüpfung ist kein brauchbares PNG");
        None
    })?;
    shortcut_icon::store(&state.dirs.shortcut_icons(), &instance.id, &png)
        .inspect_err(|err| tracing::warn!(instance = %instance.id, %err, "Icon der Verknüpfung nicht gespeichert"))
        .ok()
}

/// Das Icon des Modpacks, aus dem die Instanz stammt, als `data:`-URL; `None` ohne Pack, ohne Icon und bei CurseForge.
#[tauri::command]
pub async fn instance_pack_icon(state: State<'_, AppState>, instance_id: String) -> AppResult<Option<String>> {
    let instance = state.instances.get(&instance_id)?;
    shortcut_icon::pack_icon(&state.http, &state.dirs, &instance).await
}
