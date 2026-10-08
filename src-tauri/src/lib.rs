mod account_commands;
mod announcement_commands;
mod commands;
mod content_commands;
mod friends_commands;
mod friends_session_commands;
mod ingame_commands;
mod ingame_launch;
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

use std::future::Future;
use std::path::Path;
use std::sync::Arc;
use std::time::Duration;

use tauri::{Emitter, Manager};
use tracing_subscriber::EnvFilter;

use services::friends::directory::DirectoryDeps;
use services::friends::events::TauriEvents;
use services::friends::session_events::TauriSessionEvents;

/// So lange darf das Abmelden bei den Freunden das Beenden der App aufhalten.
const FRIENDS_SHUTDOWN_LIMIT: Duration = Duration::from_secs(1);

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
            focus_main_window(app);
        }))
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .setup(move |app| {
            app.manage(pack_open::OpenedPack::from_process_args());
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
            app.manage(state);
            for window in &windows {
                tauri::WebviewWindowBuilder::from_config(app, window)?.build()?;
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
            // friends: session wiring (R5)
            start_sessions(app.handle().clone())?;
            start_bridge(app.handle());
            spawn_startup_maintenance(app.handle().clone());
            attach_friends_directory(app.handle());
            start_friends(app.handle().clone());
            shut_down_friends_before_exit(app.handle());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            announcement_commands::announcement_feed,
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
            friends_session_commands::friends_mod_confirm,
            friends_session_commands::friends_mod_activity,
            ingame_commands::friends_ingame_status,
            ingame_commands::friends_ingame_set_enabled,
            ingame_commands::friends_ingame_retry,
            friends_commands::friend_add_by_name,
        ])
        .build(context)
        .expect("error while building tauri application")
        .run(handle_run_event);
}

#[cfg(target_os = "macos")]
fn handle_run_event(app: &tauri::AppHandle, event: tauri::RunEvent) {
    if let tauri::RunEvent::Opened { urls } = event {
        announce_opened_pack(app, &urls);
    }
}

/// Das Beenden räumt `shut_down_friends_before_exit` auf; sonst gibt es hier nur auf macOS etwas zu tun.
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

/// Hängt das Freunde-Verzeichnis ein, wenn dieser Build eines kennt (BYNAME 9.1); sonst gibt es Freunde nur per Code.
fn attach_friends_directory(handle: &tauri::AppHandle) {
    let state = handle.state::<state::AppState>();
    let tokens = Arc::new(friends_commands::AppAccountTokens::new(handle.clone()));
    let Some(deps) = DirectoryDeps::production(state.http.clone(), tokens) else { return };
    if state.friends.attach_directory(deps).is_err() {
        tracing::warn!("Freunde-Verzeichnis war schon eingehängt");
    }
}

fn start_bridge(handle: &tauri::AppHandle) {
    let state = handle.state::<state::AppState>();
    state.bridge.set_friends_enabled(state.friends.state().enabled);
    if let Err(err) = tauri::async_runtime::block_on(state.bridge.start()) {
        tracing::warn!(%err, "Pumpkin Bridge nicht gestartet");
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
    state.sessions.forward_mod_events_to(handle.clone());
    tauri::async_runtime::block_on(async { state.sessions.start(events) })
}

/// Läuft, sobald Tauri vor dem Beenden die Ressourcen der App freigibt (`AppHandle::cleanup_before_exit`). Das tut
/// es auf jedem Weg hinaus: nach `RunEvent::Exit`, beim Neustart und im `on_before_exit` des Updaters, der unter Windows
/// danach mit `std::process::exit` endet und `RunEvent::Exit` nie erreicht.
struct BeforeExit(Box<dyn Fn() + Send + Sync>);

impl tauri::Resource for BeforeExit {}

impl Drop for BeforeExit {
    fn drop(&mut self) {
        (self.0)();
    }
}

fn shut_down_friends_before_exit(app: &tauri::AppHandle) {
    let handle = app.clone();
    app.resources_table().add(BeforeExit(Box::new(move || shut_down_friends(&handle))));
}

/// Freunde und Gäste erfahren das Ende über `SHUTDOWN`; ein hängendes Netz hält das Beenden nicht auf.
fn shut_down_friends(app: &tauri::AppHandle) {
    let state = app.state::<state::AppState>();
    let friends = state.friends.clone();
    let bridge = state.bridge.clone();
    if block_on_within(FRIENDS_SHUTDOWN_LIMIT, async move {
        friends.shutdown().await;
        bridge.stop().await;
    }).is_none() {
        tracing::warn!("Freunde nicht rechtzeitig abgemeldet");
    }
}

/// Wartet höchstens `limit` auf `work`, von jedem Thread aus: vom Haupt-Thread der Ereignisschleife (ohne Tokio-Laufzeit)
/// ebenso wie aus einer Aufgabe der Laufzeit (der Updater installiert aus einem Befehl heraus), in der `block_on`
/// selbst nicht erlaubt ist. Deshalb wartet ein eigener Thread; die Zeitgrenze entsteht in der Laufzeit von `block_on`.
fn block_on_within<F>(limit: Duration, work: F) -> Option<F::Output>
where
    F: Future + Send + 'static,
    F::Output: Send + 'static,
{
    let waiter = std::thread::spawn(move || {
        tauri::async_runtime::block_on(async move { tokio::time::timeout(limit, work).await.ok() })
    });
    waiter.join().ok().flatten()
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

#[cfg(test)]
mod tests {
    use super::*;

    const SHORT_LIMIT: Duration = Duration::from_millis(50);

    /// Wie `RunEvent::Exit`: ein gewöhnlicher Thread ohne betretene Tokio-Laufzeit.
    fn outside_any_runtime<T: Send + 'static>(run: impl FnOnce() -> T + Send + 'static) -> T {
        std::thread::spawn(run).join().expect("no panic outside a Tokio runtime")
    }

    #[test]
    fn work_finished_in_time_returns_its_result_outside_a_runtime() {
        let result = outside_any_runtime(|| block_on_within(SHORT_LIMIT, std::future::ready(7)));

        assert_eq!(result, Some(7));
    }

    #[test]
    fn hanging_work_is_given_up_after_the_limit_outside_a_runtime() {
        let result = outside_any_runtime(|| block_on_within(SHORT_LIMIT, std::future::pending::<()>()));

        assert_eq!(result, None);
    }

    /// Wie der Updater, der aus einem asynchronen Befehl heraus installiert und dabei `on_before_exit` aufruft.
    #[tokio::test(flavor = "multi_thread")]
    async fn work_finishes_from_inside_a_runtime_task() {
        let result = block_on_within(SHORT_LIMIT, std::future::ready(7));

        assert_eq!(result, Some(7));
    }

    #[test]
    fn the_exit_hook_runs_when_tauri_frees_the_app_resources() {
        let ran = Arc::new(std::sync::atomic::AtomicUsize::new(0));
        let counter = ran.clone();
        let mut resources = tauri::ResourceTable::default();
        resources.add(BeforeExit(Box::new(move || {
            counter.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
        })));

        drop(resources);

        assert_eq!(ran.load(std::sync::atomic::Ordering::SeqCst), 1);
    }
}
