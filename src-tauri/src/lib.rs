mod account_commands;
mod commands;
mod content_commands;
pub mod error;
pub mod models;
pub mod services;
mod state;

use tauri::{Emitter, Manager};
use tracing_subscriber::EnvFilter;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tracing_subscriber::fmt()
        .with_env_filter(EnvFilter::try_from_default_env().unwrap_or_else(|_| EnvFilter::new("info")))
        .init();

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
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
            account_commands::ms_account_remove,
            content_commands::modrinth_search,
            content_commands::modrinth_project,
            content_commands::modrinth_projects,
            content_commands::modrinth_versions,
            content_commands::modrinth_install_mod,
            content_commands::modrinth_install_pack,
            content_commands::modrinth_import_pack,
            content_commands::pack_install_cancel,
            content_commands::modrinth_check_updates,
            content_commands::modrinth_update_mods,
            content_commands::template_save,
            content_commands::template_list,
            content_commands::template_delete,
            content_commands::template_create_instance,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
