//! Tauri-Commands. Dünne Schicht über `AppState`; Argumentnamen kommen im Frontend als camelCase an.
use std::path::PathBuf;
use std::time::SystemTime;

use serde::Serialize;
use tauri::{AppHandle, Manager, State};

use crate::error::{AppError, AppResult};
use crate::models::{
    now_ms, require_name, Account, GameWindow, Instance, LaunchOptions, Mod, ModLoader, NewInstance, QuickPlay,
    NO_NAME_LIMIT,
};
use crate::services::install::{self, InstallProgress, InstallStep, OnProgress, INSTALL_PROGRESS_EVENT};
use crate::services::launch::{self, LaunchSpec, LogStream, Running, Session, EXIT_EVENT, LOG_EVENT};
use crate::services::loader::{self, LoaderVersion};
use crate::services::mojang::{VersionEntry, VersionManifest, MANIFEST_URL};
use crate::services::progress::emit;
use crate::services::rules::Env;
use crate::services::{auth, download, gamelog, java, mods, remove_logged, system, worlds};
use crate::state::AppState;

pub(crate) fn require_instance_name(name: &str) -> AppResult<()> {
    require_name(name, NO_NAME_LIMIT, "Name darf nicht leer sein").map(drop)
}

/// Eigene Startoptionen prüfen. Ein unveränderter Java-Pfad wird nicht erneut geprüft,
/// damit andere Änderungen nicht an einem inzwischen entfernten Java scheitern.
fn require_launch_settings(instance: &Instance, old: &Instance) -> AppResult<()> {
    if matches!(instance.window, GameWindow::Size { width: 0, .. } | GameWindow::Size { height: 0, .. }) {
        return Err(AppError::invalid("Breite und Höhe des Fensters müssen größer als 0 sein"));
    }
    match &instance.java_path {
        Some(path) if instance.java_path != old.java_path => java::custom_java(path.trim(), java::JavaSetting::Instance).map(drop),
        _ => Ok(()),
    }
}

#[tauri::command]
pub fn list_instances(state: State<'_, AppState>) -> Vec<Instance> {
    state.instances.list()
}

#[tauri::command]
pub fn get_instance(state: State<'_, AppState>, id: String) -> AppResult<Instance> {
    state.instances.get(&id)
}

#[tauri::command]
pub fn create_instance(state: State<'_, AppState>, input: NewInstance) -> AppResult<Instance> {
    let _operation = state.begin_operation()?;
    require_instance_name(&input.name)?;
    let instance = state.instances.insert(Instance::from_new(input))?;
    tracing::info!(id = %instance.id, name = %instance.name, "Instanz angelegt");
    Ok(instance)
}

#[tauri::command]
pub fn update_instance(state: State<'_, AppState>, instance: Instance) -> AppResult<Instance> {
    let _operation = state.begin_instance_operation(&instance.id)?;
    require_instance_name(&instance.name)?;
    let old = state.instances.get(&instance.id)?;
    require_launch_settings(&instance, &old)?;
    let instance = Instance { group: normalized_group(instance.group), ..instance };
    let desired = with_removed_disabled(&instance.mods, &old.mods);
    let id = instance.id.clone();
    // Spielzeit und letzten Start (samt Quick-Play-Ziel) führt nur das Backend: ein veralteter Stand im Frontend darf
    // sie nicht zurücksetzen, auch nicht, wenn das Spielende sie gerade erst speichert.
    let commit = |_| {
        state.instances.modify(&id, |current| {
            *current = Instance {
                playtime_secs: current.playtime_secs,
                last_played_at: current.last_played_at,
                last_quick_play: current.last_quick_play.take(),
                ..instance
            }
        })
    };
    mods::sync_commit(&state.dirs, &id, &desired, commit)
}

/// Der gewünschte Mod-Stand: die Mods der Instanz plus die aus `old` entfernten, deaktiviert, damit
/// `mods::sync_commit` ihre Dateien wegräumt.
fn with_removed_disabled(mods: &[Mod], old: &[Mod]) -> Vec<Mod> {
    let mut desired = mods.to_vec();
    for removed in old {
        if !desired.iter().any(|m| m.file_name == removed.file_name) {
            desired.push(Mod { enabled: false, ..removed.clone() });
        }
    }
    desired
}

/// Gruppenname getrimmt; leer heißt keine Gruppe.
fn normalized_group(group: Option<String>) -> Option<String> {
    group.map(|g| g.trim().to_owned()).filter(|g| !g.is_empty())
}

/// Gruppe allein setzen, ohne die übrige Instanz zu überschreiben: eine Änderung gleichzeitig laufender Vorgänge (Mods, Spielzeit) geht so nicht verloren.
#[tauri::command]
pub fn instance_set_group(state: State<'_, AppState>, instance_id: String, group: Option<String>) -> AppResult<Instance> {
    state.instances.modify(&instance_id, |i| i.group = normalized_group(group))
}

#[tauri::command]
pub fn delete_instance(state: State<'_, AppState>, id: String) -> AppResult<()> {
    let _operation = state.begin_instance_operation(&id)?;
    // Erst den Store-Eintrag: nur eine existierende Id wird zum Pfad, und bleibt das
    // Verzeichnis liegen (Datei gesperrt), ist die Instanz trotzdem weg.
    state.instances.remove(&id)?;
    remove_logged(&state.dirs.instance(&id));
    tracing::info!(%id, "Instanz gelöscht");
    Ok(())
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct LogPayload {
    instance_id: String,
    stream: LogStream,
    line: String,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct ExitPayload {
    instance_id: String,
    code: Option<i32>,
    /// Beendet mit Fehlercode, ohne dass der Nutzer es gestoppt hat.
    crashed: bool,
    /// Absolute Pfade (für `openPath`), falls vorhanden.
    crash_report: Option<String>,
    log_file: Option<String>,
}

/// Loader-Versionen zu einer Minecraft-Version, neueste zuerst (Vanilla: leer).
#[tauri::command]
pub async fn loader_versions(
    state: State<'_, AppState>,
    loader: ModLoader,
    mc_version: String,
) -> AppResult<Vec<LoaderVersion>> {
    loader::versions(&state.http, loader, &mc_version).await
}

/// Alle Minecraft-Versionen aus Mojangs Manifest (neueste zuerst).
#[tauri::command]
pub async fn versions_list(state: State<'_, AppState>) -> AppResult<Vec<VersionEntry>> {
    let manifest: VersionManifest = download::get_json(&state.http, MANIFEST_URL).await?;
    Ok(manifest.versions)
}

/// Installiert die Version der Instanz; Fortschritt kommt als `install-progress`.
#[tauri::command]
pub async fn instance_install(app: AppHandle, state: State<'_, AppState>, instance_id: String) -> AppResult<()> {
    let _operation = state.begin_instance_operation(&instance_id)?;
    state.cancellable(&instance_id, install_instance(app.clone(), &state, instance_id.clone())).await
}

/// Bricht eine laufende `instance_install` ab; sie endet mit „Vorgang abgebrochen“.
#[tauri::command]
pub fn instance_install_cancel(state: State<'_, AppState>, instance_id: String) {
    state.cancel(&instance_id);
}

async fn install_instance(app: AppHandle, state: &AppState, instance_id: String) -> AppResult<()> {
    let instance = state.instances.get(&instance_id)?;
    tracing::info!(instance = %instance_id, version = %instance.minecraft_version, loader = ?instance.loader, "Installation gestartet");
    let on_progress = |step, done, total| {
        emit(&app, INSTALL_PROGRESS_EVENT, InstallProgress { instance_id: instance_id.clone(), step, done, total });
    };
    let plan = loader::plan_install(&state.http, &state.dirs, (&instance).into(), &on_progress).await?;
    let instance = remember_loader_version(state, instance, plan.loader_version())?;
    plan.install(&state.http, &state.dirs, &instance_id, &on_progress).await?;
    provide_mods(state, &instance, &on_progress)?;
    install::mark_installed(&state.dirs, &instance).await?;
    tracing::info!(instance = %instance_id, "Installation abgeschlossen");
    Ok(())
}

/// Hält die aufgelöste Loader-Version fest (ohne Wahl die neueste stabile), damit der Start dieselbe nutzt.
fn remember_loader_version(state: &AppState, instance: Instance, resolved: Option<&str>) -> AppResult<Instance> {
    match resolved {
        Some(version) if instance.loader_version.as_deref() != Some(version) => {
            let version = version.to_owned();
            state.instances.modify(&instance.id, |i| i.loader_version = Some(version))
        }
        _ => Ok(instance),
    }
}

/// Bringt die Mods in den Spielordner; ohne Mod-Loader hat eine Instanz keine.
fn provide_mods(state: &AppState, instance: &Instance, on_progress: OnProgress<'_>) -> AppResult<()> {
    if instance.loader == ModLoader::Vanilla {
        return Ok(());
    }
    on_progress(InstallStep::Mods, 0, 1);
    let active = mods::sync(&state.dirs, &instance.id, &instance.mods)?;
    on_progress(InstallStep::Mods, 1, 1);
    tracing::info!(instance = %instance.id, active, "Mods bereitgestellt");
    Ok(())
}

/// Startet eine installierte Instanz und liefert die Prozess-ID; mit `quickPlay` direkt in eine Welt oder auf einen
/// Server. Ausgaben kommen als `instance-log`, das Ende als `instance-exit`.
#[tauri::command]
pub async fn instance_launch(app: AppHandle, state: State<'_, AppState>, instance_id: String, options: LaunchOptions) -> AppResult<u32> {
    let _operation = state.begin_instance_operation(&instance_id)?;
    let instance = state.instances.get(&instance_id)?;
    let prepared = prepare_launch(&state, &instance, &options).await?;
    let pid = state.spawn_running(&instance_id, || {
        let game = spawn_game(&app, &instance_id, &prepared)?;
        // Noch unter der Sperre: `instance-exit` eines sofort beendeten Spiels kommt so erst nach diesem Stand.
        record_launch(&state, &instance_id, options.quick_play);
        Ok(game)
    })?;
    tracing::info!(instance = %instance_id, pid, user = %prepared.player, "Spiel gestartet");
    Ok(pid)
}

/// Was für einen Start feststeht, bevor das Spiel läuft.
struct PreparedLaunch {
    java: PathBuf,
    args: Vec<String>,
    game_dir: PathBuf,
    /// Spielername, nur fürs Protokoll.
    player: String,
}

/// Prüft das Quick-Play-Ziel, bringt die Mods auf Stand, meldet das Konto an und baut die Startargumente.
async fn prepare_launch(state: &AppState, instance: &Instance, options: &LaunchOptions) -> AppResult<PreparedLaunch> {
    if let Some(target) = &options.quick_play {
        worlds::require_target(&state.dirs, &instance.id, target)?;
    }
    mods::sync(&state.dirs, &instance.id, &instance.mods)?;
    let (account, session) = launch_account(state, options).await?;
    let version = loader::installed_version(&state.dirs, instance.into()).await?;
    let java = java::resolve(&state.dirs, version.java_component(), instance.java_path.as_deref(), options.java_path.as_deref())?;
    let spec = LaunchSpec {
        version: &version,
        dirs: &state.dirs,
        instance_id: &instance.id,
        account: &account,
        memory_mb: instance.memory_mb.or(options.default_memory_mb).unwrap_or(launch::DEFAULT_MEMORY_MB),
        extra_jvm_args: &instance.jvm_args,
        window: instance.window,
        extra_game_args: &instance.game_args,
        quick_play: options.quick_play.as_ref(),
        session: session.as_ref().map(Session::from),
    };
    let args = launch::build_args(&spec, &Env::current())?;
    Ok(PreparedLaunch { java, args, game_dir: state.dirs.game_dir(&instance.id), player: account.username })
}

/// Mit Microsoft-Konto: echte Sitzung (bei Bedarf erneuert); sonst Offline mit dem Spielernamen der Optionen.
async fn launch_account(state: &AppState, options: &LaunchOptions) -> AppResult<(Account, Option<auth::McSession>)> {
    match options.account_id.as_deref().filter(|id| !id.is_empty()) {
        Some(id) => {
            let (account, session) = auth::session(state, id).await?;
            Ok((account, Some(session)))
        }
        None => {
            auth::require_offline(state)?;
            Ok((auth::offline_account(&options.username)?, None))
        }
    }
}

/// Startet das Spiel: Ausgabezeilen gehen als `instance-log` ans Frontend, das Ende an `on_game_exit`.
fn spawn_game(app: &AppHandle, instance_id: &str, prepared: &PreparedLaunch) -> AppResult<Running> {
    let (log_app, log_id) = (app.clone(), instance_id.to_owned());
    let (exit_app, exit_id) = (app.clone(), instance_id.to_owned());
    let started = SystemTime::now();
    launch::spawn(
        &prepared.java,
        &prepared.args,
        &prepared.game_dir,
        move |stream, line| {
            tracing::info!(target: "minecraft", instance = %log_id, ?stream, "{line}");
            emit(&log_app, LOG_EVENT, LogPayload { instance_id: log_id.clone(), stream, line });
        },
        move |code| on_game_exit(&exit_app, exit_id, started, code),
    )
}

/// Merkt sich Startzeit und Quick-Play-Ziel. Das Spiel läuft schon: ein Schreibfehler (etwa durch ein
/// kurz gesperrtes `instances.json`) wird nur geloggt, damit der Start nicht als gescheitert gemeldet wird.
fn record_launch(state: &AppState, instance_id: &str, quick_play: Option<QuickPlay>) {
    let result = state.instances.modify(instance_id, |i| {
        i.last_played_at = Some(now_ms());
        if quick_play.is_some() {
            i.last_quick_play = quick_play;
        }
    });
    if let Err(err) = result {
        tracing::warn!(instance = %instance_id, %err, "Startzeit nicht gespeichert");
    }
}

/// Aufräumen nach dem Ende des Spiels: Eintrag entfernen, Spielzeit buchen, `instance-exit` senden.
fn on_game_exit(app: &AppHandle, instance_id: String, started: SystemTime, code: Option<i32>) {
    let state = app.state::<AppState>();
    // `instance_kill` hat den Eintrag schon entfernt: dann hat der Nutzer gestoppt.
    let stopped = state.take_running(&instance_id).is_none();
    let crashed = code != Some(0) && !stopped;
    let game_dir = state.dirs.game_dir(&instance_id);
    let text = |p: PathBuf| p.to_string_lossy().into_owned();
    let crash_report = gamelog::crash_report(&game_dir, started).map(text);
    let log_file = Some(state.dirs.latest_log(&instance_id)).filter(|p| p.is_file()).map(text);
    record_playtime(&state, &instance_id, started);
    tracing::info!(instance = %instance_id, ?code, crashed, "Spiel beendet");
    emit(app, EXIT_EVENT, ExitPayload { instance_id, code, crashed, crash_report, log_file });
}

/// Spielzeit der Sitzung seit `started` speichern; unplausible Dauern und Fehler nur loggen,
/// damit `instance-exit` trotzdem ankommt.
fn record_playtime(state: &AppState, instance_id: &str, started: SystemTime) {
    let Some(secs) = gamelog::session_secs(started, SystemTime::now()) else {
        tracing::warn!(instance = %instance_id, "Spielzeit verworfen: Sitzungsdauer unplausibel");
        return;
    };
    let result = state.instances.modify(instance_id, |i| i.playtime_secs = i.playtime_secs.saturating_add(secs));
    if let Err(err) = result {
        tracing::warn!(instance = %instance_id, %err, "Spielzeit nicht gespeichert");
    }
}

/// Beendet das laufende Spiel einer Instanz; `instance-exit` folgt.
#[tauri::command]
pub fn instance_kill(state: State<'_, AppState>, instance_id: String) -> AppResult<()> {
    let game = state
        .take_running(&instance_id)
        .ok_or_else(|| AppError::NotFound { kind: "Laufendes Spiel", id: instance_id.clone() })?;
    game.kill();
    tracing::info!(instance = %instance_id, "Spiel wird beendet");
    Ok(())
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InstanceStatus {
    /// Aktuelle Minecraft-Version der Instanz ist vollständig installiert.
    installed: bool,
    running: bool,
}

/// Installations- und Laufzustand einer Instanz (für die Statusanzeige im Frontend).
#[tauri::command]
pub fn instance_status(state: State<'_, AppState>, instance_id: String) -> AppResult<InstanceStatus> {
    let instance = state.instances.get(&instance_id)?;
    Ok(InstanceStatus { installed: install::is_installed(&state.dirs, &instance), running: state.is_running(&instance_id) })
}

/// Spielordner einer Instanz (Welten, Mods, Screenshots) zum Öffnen im Dateimanager; wird bei Bedarf angelegt.
#[tauri::command]
pub fn instance_dir(state: State<'_, AppState>, instance_id: String) -> AppResult<String> {
    state.require_instance(&instance_id)?;
    let dir = state.dirs.game_dir(&instance_id);
    std::fs::create_dir_all(&dir)?;
    Ok(dir.to_string_lossy().into_owned())
}

/// Physischer Arbeitsspeicher in MiB (Grundlage für RAM-Vorgabe und Slider-Obergrenze).
#[tauri::command]
pub fn system_memory_mb() -> AppResult<u64> {
    system::total_memory_mb()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::Duration;

    fn state_with_instance() -> (AppState, String, PathBuf) {
        let root = std::env::temp_dir().join(crate::models::new_id());
        let state = AppState::load(&root).unwrap();
        let new = NewInstance { name: "Start".into(), minecraft_version: "1.21.4".into(), loader: ModLoader::Vanilla, loader_version: None };
        let id = state.instances.insert(Instance::from_new(new)).unwrap().id;
        (state, id, root)
    }

    #[test]
    fn launch_bookkeeping_keeps_last_target_and_survives_write_errors() {
        let (state, id, root) = state_with_instance();
        let target = QuickPlay::Server { address: "lobby.example.net".into() };
        record_launch(&state, &id, Some(target.clone()));
        let instance = state.instances.get(&id).unwrap();
        assert!(instance.last_played_at.is_some());
        assert_eq!(instance.last_quick_play, Some(target.clone()));
        record_launch(&state, &id, None);
        assert_eq!(state.instances.get(&id).unwrap().last_quick_play, Some(target), "ohne Ziel bleibt das letzte erhalten");
        record_launch(&state, "weg", None);
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn group_names_are_trimmed_and_empty_means_none() {
        assert_eq!(normalized_group(Some("  Technik ".into())), Some("Technik".into()));
        assert_eq!(normalized_group(Some("   ".into())), None);
        assert_eq!(normalized_group(None), None);
    }

    #[test]
    fn playtime_adds_up_per_session() {
        let (state, id, root) = state_with_instance();
        let ago = |secs| SystemTime::now() - Duration::from_secs(secs);
        record_playtime(&state, &id, ago(90));
        record_playtime(&state, &id, ago(30));
        assert!((120..=122).contains(&state.instances.get(&id).unwrap().playtime_secs));
        record_playtime(&state, "weg", ago(1));
        std::fs::remove_dir_all(root).unwrap();
    }
}
