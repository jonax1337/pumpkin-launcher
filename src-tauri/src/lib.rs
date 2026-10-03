mod account_commands;
mod commands;
mod content_commands;
mod friends_commands;
mod friends_session_commands;
mod pack_commands;
mod pack_open;
mod screenshot_commands;
mod skin_commands;
pub mod error;
pub mod models;
pub mod services;
mod state;
mod storage_commands;
mod support_commands;
mod world_commands;

use std::path::Path;
use std::sync::Arc;
use std::time::Duration;

use tauri::{Emitter, Manager};
use tracing_subscriber::EnvFilter;

use services::friends::events::TauriEvents;
use services::friends::session_events::TauriSessionEvents;

/// So lange darf das Abmelden bei den Freunden das Beenden der App aufhalten.
const FRIENDS_SHUTDOWN_LIMIT: Duration = Duration::from_secs(1);

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tracing_subscriber::fmt()
        .with_env_filter(EnvFilter::try_from_default_env().unwrap_or_else(|_| EnvFilter::new("info")))
        .init();

    tauri::Builder::default()
        // Zuerst: ein zweiter Prozess würde dieselben JSON-Stores schreiben.
        .plugin(tauri_plugin_single_instance::init(|app, args, cwd| {
            pack_open::announce_args(app, &args, Path::new(&cwd));
            focus_main_window(app);
        }))
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .setup(|app| {
            let data_dir = app.path().app_data_dir()?;
            tracing::info!(?data_dir, "lade Daten");
            app.manage(state::AppState::load(&data_dir)?);
            // friends: session wiring (R5)
            start_sessions(app.handle().clone())?;
            app.manage(pack_open::OpenedPack::from_process_args());
            spawn_startup_maintenance(app.handle().clone());
            start_friends(app.handle().clone());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::list_instances,
            commands::get_instance,
            commands::create_instance,
            commands::update_instance,
            commands::instance_set_group,
            commands::instance_set_icon,
            commands::instance_set_scene,
            commands::delete_instance,
            commands::versions_list,
            commands::instance_install,
            commands::instance_install_cancel,
            commands::system_memory_mb,
            commands::instance_launch,
            commands::instance_kill,
            commands::instance_status,
            commands::instance_dir,
            commands::loader_versions,
            account_commands::ms_login_start,
            account_commands::ms_login_finish,
            account_commands::ms_login_cancel,
            account_commands::ms_accounts,
            account_commands::offline_allowed,
            account_commands::ms_account_remove,
            content_commands::modrinth_search,
            content_commands::modrinth_project,
            content_commands::modrinth_projects,
            content_commands::modrinth_versions,
            content_commands::modrinth_install_mod,
            content_commands::modrinth_install_pack,
            content_commands::modrinth_import_pack,
            content_commands::curseforge_import_pack,
            content_commands::provider_search,
            content_commands::provider_project,
            content_commands::provider_versions,
            content_commands::provider_install_pack,
            content_commands::provider_install_mod,
            content_commands::curseforge_adopt_download,
            content_commands::pack_install_cancel,
            content_commands::modrinth_check_updates,
            content_commands::modrinth_update_mods,
            content_commands::modrinth_switch_version,
            content_commands::instance_content_analysis,
            content_commands::instance_pack_selection,
            content_commands::instance_set_resource_packs,
            content_commands::instance_set_shader_pack,
            content_commands::modrinth_identify,
            content_commands::instance_check_files,
            content_commands::instance_add_files,
            content_commands::template_save,
            content_commands::template_list,
            content_commands::template_delete,
            content_commands::template_export,
            content_commands::template_import,
            content_commands::template_create_instance,
            content_commands::instance_duplicate,
            content_commands::instance_export_entries,
            content_commands::instance_export_summary,
            content_commands::instance_export_targets,
            content_commands::instance_export,
            pack_open::pack_open_take,
            content_commands::import_detect,
            content_commands::instance_import,
            pack_commands::pack_changelog,
            pack_commands::pack_update,
            pack_commands::instance_migrate_check,
            pack_commands::instance_migrate,
            pack_commands::instance_duplicate_migrate,
            support_commands::log_share,
            support_commands::debug_info,
            support_commands::log_sessions,
            support_commands::log_session_read,
            storage_commands::storage_overview,
            storage_commands::storage_clear_cache,
            storage_commands::storage_open_dir,
            storage_commands::java_detect,
            skin_commands::skin_profile,
            skin_commands::skin_library,
            skin_commands::skin_texture,
            skin_commands::skin_add,
            skin_commands::skin_add_player,
            skin_commands::skin_update,
            skin_commands::skin_delete,
            skin_commands::skin_save_active,
            skin_commands::skin_upload,
            skin_commands::skin_reset,
            skin_commands::skin_cape,
            world_commands::world_list,
            world_commands::world_backup,
            world_commands::world_backups,
            world_commands::world_restore,
            world_commands::world_backup_delete,
            world_commands::world_delete,
            world_commands::world_import,
            world_commands::world_backups_export,
            world_commands::world_quick_play_supported,
            world_commands::datapack_list,
            world_commands::datapack_add,
            world_commands::datapack_install,
            world_commands::datapack_remove,
            world_commands::server_list,
            world_commands::server_save,
            world_commands::server_remove,
            world_commands::server_ping,
            screenshot_commands::screenshot_list,
            screenshot_commands::screenshot_delete,
            screenshot_commands::screenshot_read,
            friends_commands::friends_state,
            friends_commands::friends_enable,
            friends_commands::friends_disable,
            friends_commands::friends_update_settings,
            friends_commands::friends_rotate_identity,
            friends_commands::friends_reset,
            friends_commands::friends_list,
            friends_commands::friend_requests,
            friends_commands::friend_code_create,
            friends_commands::friend_codes,
            friends_commands::friend_code_revoke,
            friends_commands::friend_add,
            friends_commands::friend_request_answer,
            friends_commands::friend_request_cancel,
            friends_commands::friend_rename,
            friends_commands::friend_acknowledge,
            friends_commands::friend_remove,
            friends_commands::friend_block,
            friends_commands::friend_unblock,
            friends_commands::friends_blocked,
            friends_commands::friends_retry_now,
            friends_session_commands::friend_skin,
            friends_session_commands::lan_status,
            friends_session_commands::host_sessions,
            friends_session_commands::host_start,
            friends_session_commands::host_invite,
            friends_session_commands::host_kick,
            friends_session_commands::host_stop,
            friends_session_commands::invites_list,
            friends_session_commands::invite_decline,
            friends_session_commands::invite_plan,
            friends_session_commands::invite_join,
            friends_session_commands::join_leave,
            friends_session_commands::friends_mod_status,
            friends_session_commands::friends_mod_install,
            friends_session_commands::friends_mod_confirm,
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(handle_run_event);
}

fn handle_run_event(app: &tauri::AppHandle, event: tauri::RunEvent) {
    match event {
        tauri::RunEvent::Exit => shut_down_friends(app),
        #[cfg(target_os = "macos")]
        tauri::RunEvent::Opened { urls } => announce_opened_pack(app, &urls),
        _ => {}
    }
}

/// macOS meldet geöffnete Dateien (Doppelklick, „Öffnen mit“) als Ereignis statt in der Kommandozeile.
#[cfg(target_os = "macos")]
fn announce_opened_pack(app: &tauri::AppHandle, urls: &[tauri::Url]) {
    let pack = urls.iter().filter_map(|url| url.to_file_path().ok()).find(|path| pack_open::is_pack_file(path));
    if let Some(path) = pack {
        pack_open::announce(app, path);
    }
}

/// Startet die Freunde-Funktion, wenn sie aktiviert ist; ohne Aktivierung bindet sie nichts.
fn start_friends(handle: tauri::AppHandle) {
    tauri::async_runtime::spawn(async move {
        let state = handle.state::<state::AppState>();
        let account = friends_commands::account_profile(&state);
        state.friends.start(Arc::new(TauriEvents(handle.clone())), account).await;
    });
}

/// Hängt die geteilten Welten in den Freunde-Dienst ein, bevor er Streams annimmt; ihre Aufgaben laufen in der
/// Tokio-Laufzeit der App.
fn start_sessions(handle: tauri::AppHandle) -> Result<(), services::friends::HandlerAlreadySet> {
    let state = handle.state::<state::AppState>();
    let events = Arc::new(TauriSessionEvents(handle.clone()));
    tauri::async_runtime::block_on(async { state.sessions.start(events) })
}

/// Freunde und Gäste erfahren das Ende über `SHUTDOWN`; ein hängendes Netz hält das Beenden nicht auf.
fn shut_down_friends(app: &tauri::AppHandle) {
    let state = app.state::<state::AppState>();
    let shutdown = tokio::time::timeout(FRIENDS_SHUTDOWN_LIMIT, state.friends.shutdown());
    if tauri::async_runtime::block_on(shutdown).is_err() {
        tracing::warn!("Freunde nicht rechtzeitig abgemeldet");
    }
}

/// Aufräumen im Hintergrund nach dem Start: Reste unterbrochener Weltvorgänge entfernen, Dateien eines abgestürzten
/// Pack-Updates zurückholen, dann bei alten Pack-Instanzen Inhalte im Ordner nachtragen, die nicht in der Instanz stehen.
fn spawn_startup_maintenance(handle: tauri::AppHandle) {
    tauri::async_runtime::spawn(async move {
        let state = handle.state::<state::AppState>();
        match services::worlds::remove_leftovers(&state).await {
            Ok(0) => {}
            Ok(removed) => tracing::info!(removed, "Reste unterbrochener Weltvorgänge entfernt"),
            Err(err) => tracing::warn!(%err, "Aufräumen der Sicherungsordner fehlgeschlagen"),
        }
        match services::pack_update::recover_interrupted(&state).await {
            Ok(0) => {}
            Ok(recovered) => tracing::info!(recovered, "Dateien unterbrochener Pack-Updates zurückgeholt"),
            Err(err) => tracing::warn!(%err, "Zurückholen unterbrochener Pack-Updates fehlgeschlagen"),
        }
        match services::content::adopt_untracked(&state).await {
            Ok(0) => {}
            Ok(added) => {
                tracing::info!(added, "Inhalte in Instanzen nachgetragen");
                if let Err(err) = handle.emit("instances-changed", ()) {
                    tracing::warn!(%err, "Event instances-changed nicht gesendet");
                }
            }
            Err(err) => tracing::warn!(%err, "Nachtragen der Instanz-Inhalte fehlgeschlagen"),
        }
    });
}

/// Zweiter Start: das laufende Fenster nach vorn holen, auch aus der Taskleiste.
fn focus_main_window(app: &tauri::AppHandle) {
    let Some(window) = app.get_webview_window("main") else {
        return;
    };
    for result in [window.unminimize(), window.show(), window.set_focus()] {
        if let Err(err) = result {
            tracing::warn!(%err, "Fenster nicht nach vorn geholt");
        }
    }
}
