mod account_commands;
mod announcement_commands;
mod commands;
mod content_commands;
mod crash_commands;
mod deep_link;
mod pack_commands;
mod pack_open;
mod profile_commands;
mod screenshot_commands;
mod shortcut_commands;
mod skin_commands;
pub mod error;
pub mod models;
pub mod services;
mod state;
mod storage_commands;
mod support_commands;
mod world_commands;

use std::path::Path;

use tauri::{Emitter, Manager};
use tracing_subscriber::EnvFilter;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tracing_subscriber::fmt()
        .with_env_filter(EnvFilter::try_from_default_env().unwrap_or_else(|_| EnvFilter::new("info")))
        .init();

    let mut context = tauri::generate_context!();
    let use_user_defaults = context.config().app.app_directories_override.is_none()
        && context.config().identifier == "dev.laux.launcher";
    #[cfg(windows)]
    if use_user_defaults {
        use tauri::utils::config::{AppDirectoriesOverride, AppDirectoryOverrides};
        context.config_mut().app.app_directories_override = Some(AppDirectoriesOverride::Directories(
            AppDirectoryOverrides {
                config: Some("$CONFIG/Pumpkin Launcher".into()),
                data: Some("$DATA/Pumpkin Launcher".into()),
                local_data: Some("$LOCALDATA/Pumpkin Launcher/WebView".into()),
                cache: Some("$LOCALDATA/Pumpkin Launcher/cache".into()),
                log: Some("$LOCALDATA/Pumpkin Launcher/logs".into()),
            },
        ));
    }
    // WebView must not create the destination before the single-instance guard and migration.
    let windows = context.config().app.windows.iter().filter(|window| window.create).cloned().collect::<Vec<_>>();
    for window in &mut context.config_mut().app.windows {
        window.create = false;
    }

    tauri::Builder::default()
        // Zuerst: ein zweiter Prozess würde dieselben JSON-Stores schreiben.
        .plugin(tauri_plugin_single_instance::init(|app, args, cwd| {
            pack_open::announce_args(app, &args, Path::new(&cwd));
            deep_link::announce_args(app, &args);
            focus_main_window(app);
        }))
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .setup(move |app| {
            app.manage(pack_open::OpenedPack::from_process_args());
            app.manage(deep_link::DeepLinkInbox::from_process_args());
            let loaded = (|| -> Result<state::AppState, Box<dyn std::error::Error>> {
                let data_dir = app.path().app_data_dir()?;
                // Folders that could not be merged or moved are reported but never stop the start.
                #[cfg(windows)]
                let mut notices = if use_user_defaults {
                    services::storage_location::migrate_windows_data(&data_dir, &app.path().app_local_data_dir()?)?
                } else {
                    Vec::new()
                };
                #[cfg(not(windows))]
                let mut notices: Vec<String> = Vec::new();
                let default_instances = use_user_defaults.then(|| {
                    app.path().document_dir().ok().map(|path| path.join("Pumpkin Launcher").join("Instances"))
                }).flatten();
                tracing::info!(?data_dir, "lade Daten");
                let mut state = state::AppState::load_with_instances_default(&data_dir, default_instances.as_deref())?;
                notices.append(&mut state.startup_notices);
                state.startup_notices = notices;
                Ok(state)
            })();
            let state = match loaded {
                Ok(state) => state,
                Err(error) => {
                    use tauri_plugin_dialog::{DialogExt, MessageDialogKind};
                    tracing::error!(%error, "Storage initialization failed");
                    let handle = app.handle().clone();
                    app.dialog().message(format!("Pumpkin Launcher could not safely open its storage. No existing library has been replaced.\n\n{error}"))
                        .title("Pumpkin Launcher — Storage")
                        .kind(MessageDialogKind::Error)
                        .show(move |_| handle.exit(1));
                    return Ok(());
                }
            };
            // Vor dem Fenster und damit vor jedem Start: was von früher übrig ist, gehört keinem laufenden Start.
            services::argfile::sweep_stale(&state.dirs);
            app.manage(services::shortcut_key::ShortcutKey::in_dir(&state.dirs.root));
            app.manage(state);
            let window_icon = tauri::image::Image::from_bytes(include_bytes!("../icons/128x128.png"))?;
            for window in &windows {
                tauri::WebviewWindowBuilder::from_config(app, window)?
                    .icon(window_icon.clone())?
                    .build()?;
            }
            let notices = app.state::<state::AppState>().startup_notices.clone();
            if !notices.is_empty() {
                use tauri_plugin_dialog::{DialogExt, MessageDialogKind};
                for notice in &notices {
                    tracing::warn!(%notice, "Storage notice at startup");
                }
                app.dialog().message(notices.join("\n\n"))
                    .title("Pumpkin Launcher — Storage")
                    .kind(MessageDialogKind::Warning)
                    .show(|_| {});
            }
            spawn_startup_maintenance(app.handle().clone());
            #[cfg(target_os = "linux")]
            deep_link::register_scheme_for_appimage(app.handle());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            announcement_commands::announcement_feed,
            commands::list_instances,
            commands::get_instance,
            commands::create_instance,
            commands::update_instance,
            commands::instance_set_group,
            commands::instance_set_sharing,
            commands::instance_set_icon,
            commands::instance_set_scene,
            profile_commands::mod_profile_save,
            profile_commands::mod_profile_apply,
            profile_commands::mod_profile_rename,
            profile_commands::mod_profile_delete,
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
            deep_link::deep_link_take,
            deep_link::deep_link_foreign_enabled,
            deep_link::deep_link_set_foreign,
            shortcut_commands::instance_create_shortcut,
            shortcut_commands::instance_pack_icon,
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
            crash_commands::crash_diagnose,
            storage_commands::storage_overview,
            storage_commands::storage_clear_cache,
            storage_commands::storage_open_dir,
            storage_commands::storage_set_instances_dir,
            storage_commands::storage_open_instances_dir,
            storage_commands::storage_open_instance_path,
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
        ])
        .build(context)
        .expect("error while building tauri application")
        .run(handle_run_event);
}

#[cfg(target_os = "macos")]
fn handle_run_event(app: &tauri::AppHandle, event: tauri::RunEvent) {
    if let tauri::RunEvent::Opened { urls } = event {
        announce_opened_pack(app, &urls);
        deep_link::announce_urls(app, &urls);
        focus_main_window(app);
    }
}

/// Nur macOS hat hier etwas zu tun.
#[cfg(not(target_os = "macos"))]
fn handle_run_event(_app: &tauri::AppHandle, _event: tauri::RunEvent) {}

/// macOS meldet geöffnete Dateien (Doppelklick, „Öffnen mit“) als Ereignis statt in der Kommandozeile.
#[cfg(target_os = "macos")]
fn announce_opened_pack(app: &tauri::AppHandle, urls: &[tauri::Url]) {
    let pack = urls.iter().filter_map(|url| url.to_file_path().ok()).find(|path| pack_open::is_pack_file(path));
    if let Some(path) = pack {
        pack_open::announce(app, path);
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
