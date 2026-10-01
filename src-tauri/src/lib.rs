mod account_commands;
mod commands;
mod content_commands;
mod screenshot_commands;
mod skin_commands;
pub mod error;
pub mod models;
pub mod services;
mod state;
mod support_commands;
mod world_commands;

use tauri::{Emitter, Manager};
use tracing_subscriber::EnvFilter;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tracing_subscriber::fmt()
        .with_env_filter(EnvFilter::try_from_default_env().unwrap_or_else(|_| EnvFilter::new("info")))
        .init();

    tauri::Builder::default()
        // Zuerst: ein zweiter Prozess würde dieselben JSON-Stores schreiben.
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| focus_main_window(app)))
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .setup(|app| {
            let data_dir = app.path().app_data_dir()?;
            tracing::info!(?data_dir, "lade Daten");
            app.manage(state::AppState::load(&data_dir)?);
            // Alte Pack-Instanzen: Inhalte im Ordner nachtragen, die nicht in der Instanz stehen.
            let handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                match services::content::adopt_untracked(&handle.state::<state::AppState>()).await {
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
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::list_instances,
            commands::get_instance,
            commands::create_instance,
            commands::update_instance,
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
            content_commands::provider_search,
            content_commands::provider_project,
            content_commands::provider_versions,
            content_commands::provider_install_pack,
            content_commands::provider_install_mod,
            content_commands::curseforge_adopt_download,
            content_commands::pack_install_cancel,
            content_commands::modrinth_check_updates,
            content_commands::modrinth_update_mods,
            content_commands::modrinth_identify,
            content_commands::instance_check_files,
            content_commands::instance_add_files,
            content_commands::template_save,
            content_commands::template_list,
            content_commands::template_delete,
            content_commands::template_create_instance,
            support_commands::log_share,
            support_commands::debug_info,
            content_commands::instance_duplicate,
            content_commands::instance_export_entries,
            content_commands::instance_export,
            content_commands::import_detect,
            content_commands::instance_import,
            skin_commands::skin_profile,
            skin_commands::skin_library,
            skin_commands::skin_texture,
            skin_commands::skin_add,
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
            world_commands::world_quick_play_supported,
            world_commands::datapack_list,
            world_commands::datapack_add,
            world_commands::datapack_install,
            world_commands::datapack_remove,
            world_commands::server_list,
            world_commands::server_save,
            world_commands::server_remove,
            screenshot_commands::screenshot_list,
            screenshot_commands::screenshot_delete,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
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
