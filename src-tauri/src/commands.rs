//! Tauri-Commands. Dünne Schicht über `AppState`; Argumentnamen kommen im Frontend als camelCase an.
use std::path::PathBuf;
use std::time::SystemTime;

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, State};

use crate::error::{AppError, AppResult};
use crate::models::{now_ms, Account, GameWindow, Instance, LaunchOptions, ModLoader, NewInstance, QuickPlay};
use crate::services::install::{self, InstallProgress, InstallStep, INSTALL_PROGRESS_EVENT};
use crate::services::launch::{self, LaunchSpec, LogStream, EXIT_EVENT, LOG_EVENT};
use crate::services::mojang::{VersionEntry, VersionManifest, MANIFEST_URL};
use crate::services::rules::Env;
use crate::services::fabric::{self, LoaderVersion};
use crate::services::forge;
use crate::services::mojang::VersionJson;
use crate::services::{auth, download, java, mods, system, worlds};
use crate::state::AppState;

pub(crate) fn require_name(name: &str) -> AppResult<()> {
    if name.trim().is_empty() {
        return Err(AppError::invalid("Name darf nicht leer sein"));
    }
    Ok(())
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
    let _operation = state.operation(None)?;
    require_name(&input.name)?;
    let instance = state.instances.insert(Instance::from_new(input))?;
    tracing::info!(id = %instance.id, name = %instance.name, "Instanz angelegt");
    Ok(instance)
}

#[tauri::command]
pub fn update_instance(state: State<'_, AppState>, instance: Instance) -> AppResult<Instance> {
    let _operation = state.operation(Some(&instance.id))?;
    require_name(&instance.name)?;
    let old = state.instances.get(&instance.id)?;
    require_launch_settings(&instance, &old)?;
    let instance = Instance { group: normalized_group(instance.group), ..instance };
    let mut desired = instance.mods.clone();
    for removed in &old.mods {
        if !desired.iter().any(|m|m.file_name==removed.file_name) {
            let mut removed=removed.clone();removed.enabled=false;desired.push(removed);
        }
    }
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
    let _operation = state.operation(Some(&id))?;
    if state.running().contains_key(&id) {
        return Err(AppError::invalid("Instanz läuft noch"));
    }
    // Erst den Store-Eintrag: nur eine existierende Id wird zum Pfad, und bleibt das
    // Verzeichnis liegen (Datei gesperrt), ist die Instanz trotzdem weg.
    state.instances.remove(&id)?;
    match std::fs::remove_dir_all(state.dirs.instance(&id)) {
        Ok(()) => {}
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => {}
        Err(err) => tracing::warn!(%id, %err, "Instanzverzeichnis nicht vollständig gelöscht"),
    }
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

fn emit<T: Serialize + Clone>(app: &AppHandle, event: &str, payload: T) {
    if let Err(err) = app.emit(event, payload) {
        tracing::warn!(event, %err, "Event konnte nicht gesendet werden");
    }
}

/// Wie ein Mod-Loader installiert wird: Profil vom Meta-Server (Fabric, Quilt) oder Installer (Forge, NeoForge).
enum LoaderKind {
    Profile(fabric::Flavor),
    Installer(forge::Kind),
}

fn loader_kind(loader: ModLoader) -> Option<LoaderKind> {
    match loader {
        ModLoader::Vanilla => None,
        ModLoader::Fabric => Some(LoaderKind::Profile(fabric::Flavor::Fabric)),
        ModLoader::Quilt => Some(LoaderKind::Profile(fabric::Flavor::Quilt)),
        ModLoader::Forge => Some(LoaderKind::Installer(forge::Kind::Forge)),
        ModLoader::NeoForge => Some(LoaderKind::Installer(forge::Kind::NeoForge)),
    }
}

/// Loader-Version einer installierten bzw. zu startenden Instanz.
fn loader_version(instance: &Instance) -> AppResult<&str> {
    instance
        .loader_version
        .as_deref()
        .ok_or_else(|| AppError::invalid("Instanz ohne Loader-Version: bitte neu installieren"))
}

/// Versions-JSON zum Start: Vanilla, mit Mod-Loader mit dessen installiertem Profil zusammengeführt.
async fn installed_version(state: &AppState, instance: &Instance) -> AppResult<VersionJson> {
    let version = install::installed_version(&state.dirs, &instance.minecraft_version).await?;
    let mc = &instance.minecraft_version;
    match loader_kind(instance.loader) {
        None => Ok(version),
        Some(LoaderKind::Profile(flavor)) => {
            let profile = fabric::installed_profile(&state.dirs, flavor, mc, loader_version(instance)?).await?;
            fabric::merge(version, &profile)
        }
        Some(LoaderKind::Installer(kind)) => {
            let profile = forge::installed_profile(&state.dirs, kind, mc, loader_version(instance)?).await?;
            forge::merge(version, &profile)
        }
    }
}

/// Loader-Versionen zu einer Minecraft-Version, neueste zuerst (Vanilla: leer).
#[tauri::command]
pub async fn loader_versions(
    state: State<'_, AppState>,
    loader: ModLoader,
    mc_version: String,
) -> AppResult<Vec<LoaderVersion>> {
    match loader_kind(loader) {
        None => Ok(Vec::new()),
        Some(LoaderKind::Profile(flavor)) => fabric::loader_versions(&state.http, flavor, &mc_version).await,
        Some(LoaderKind::Installer(kind)) => forge::loader_versions(&state.http, kind, &mc_version).await,
    }
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
    let _operation = state.operation(Some(&instance_id))?;
    state.cancellable(&instance_id, install_instance(app.clone(), &state, instance_id.clone())).await
}

/// Bricht eine laufende `instance_install` ab; sie endet mit „Vorgang abgebrochen“.
#[tauri::command]
pub fn instance_install_cancel(state: State<'_, AppState>, instance_id: String) {
    state.cancel(&instance_id);
}

async fn install_instance(app: AppHandle, state: &AppState, instance_id: String) -> AppResult<()> {
    let mut instance = state.instances.get(&instance_id)?;
    tracing::info!(instance = %instance_id, version = %instance.minecraft_version, loader = ?instance.loader, "Installation gestartet");
    let on_progress = |step, done, total| {
        emit(&app, INSTALL_PROGRESS_EVENT, InstallProgress { instance_id: instance_id.clone(), step, done, total });
    };
    let mut version = install::fetch_version(&state.http, &state.dirs, &instance.minecraft_version).await?;
    let mc = instance.minecraft_version.clone();
    let kind = loader_kind(instance.loader);
    if let Some(kind) = &kind {
        on_progress(InstallStep::Loader, 0, 1);
        // Ohne gewählte Version die neueste stabile nehmen und festhalten, damit der Start dieselbe nutzt.
        let wanted = instance.loader_version.as_deref();
        let loader = match kind {
            LoaderKind::Profile(flavor) => fabric::resolve_loader(&state.http, *flavor, &mc, wanted).await?,
            LoaderKind::Installer(k) => forge::resolve_loader(&state.http, *k, &mc, wanted).await?,
        };
        if let LoaderKind::Profile(flavor) = kind {
            let profile = fabric::fetch_profile(&state.http, &state.dirs, *flavor, &mc, &loader).await?;
            version = fabric::merge(version, &profile)?;
        }
        if instance.loader_version.as_deref() != Some(loader.as_str()) {
            instance = state.instances.modify(&instance_id, |i| i.loader_version = Some(loader))?;
        }
        on_progress(InstallStep::Loader, 1, 1);
    }
    // Forge/NeoForge brauchen Vanilla-Client und Java zuerst: ihre Processors patchen das Client-JAR.
    let java = install::install(&state.http, &state.dirs, &version, &instance_id, &on_progress).await?;
    if let Some(LoaderKind::Installer(k)) = kind {
        let loader = loader_version(&instance)?.to_owned();
        let on_loader = |done, total| on_progress(InstallStep::Loader, done, total);
        forge::install(&state.http, &state.dirs, k, &mc, &loader, &java, &on_loader).await?;
    }
    if instance.loader != ModLoader::Vanilla {
        on_progress(InstallStep::Mods, 0, 1);
        let active = mods::sync(&state.dirs, &instance_id, &instance.mods)?;
        on_progress(InstallStep::Mods, 1, 1);
        tracing::info!(instance = %instance_id, active, "Mods bereitgestellt");
    }
    install::mark_installed(&state.dirs, &instance).await?;
    tracing::info!(instance = %instance_id, "Installation abgeschlossen");
    Ok(())
}

/// Startet eine installierte Instanz und liefert die Prozess-ID; mit `quickPlay` direkt in eine Welt oder auf einen
/// Server. Ausgaben kommen als `instance-log`, das Ende als `instance-exit`.
#[tauri::command]
pub async fn instance_launch(app: AppHandle, state: State<'_, AppState>, instance_id: String, options: LaunchOptions) -> AppResult<u32> {
    let LaunchOptions { username, account_id, java_path, default_memory_mb, quick_play } = options;
    let _operation = state.operation(Some(&instance_id))?;
    let instance = state.instances.get(&instance_id)?;
    if let Some(target) = &quick_play {
        worlds::require_target(&state.dirs, &instance_id, target)?;
    }
    mods::sync(&state.dirs,&instance_id,&instance.mods)?;
    let (account, session) = launch_account(&state, account_id, &username).await?;
    let version = installed_version(&state, &instance).await?;
    let component = install::java_component(&version);
    let java = java::resolve(&state.dirs, component, instance.java_path.as_deref(), java_path.as_deref())?;
    let session = session.as_ref().map(|s| launch::Session { access_token: &s.access_token, xuid: &s.xuid });
    let args = launch::build_args_for(
        &LaunchSpec {
            version: &version,
            dirs: &state.dirs,
            instance_id: &instance_id,
            account: &account,
            memory_mb: instance.memory_mb.or(default_memory_mb).unwrap_or(launch::DEFAULT_MEMORY_MB),
            extra_jvm_args: &instance.jvm_args,
            window: instance.window,
            extra_game_args: &instance.game_args,
            quick_play: quick_play.as_ref(),
        },
        &Env::current(),
        session.as_ref(),
    )?;

    // Lock über Prüfen, Starten und Eintragen halten: sonst könnte ein sofort beendeter
    // Prozess seinen Eintrag entfernen, bevor er eingetragen ist.
    let mut running = state.running();
    if running.contains_key(&instance_id) {
        return Err(AppError::invalid("Instanz läuft bereits"));
    }
    let (log_app, log_id) = (app.clone(), instance_id.clone());
    let (exit_app, exit_id) = (app.clone(), instance_id.clone());
    let started = SystemTime::now();
    let game = launch::spawn(
        &java,
        &args,
        &state.dirs.game_dir(&instance_id),
        move |stream, line| {
            tracing::info!(target: "minecraft", instance = %log_id, ?stream, "{line}");
            emit(&log_app, LOG_EVENT, LogPayload { instance_id: log_id.clone(), stream, line });
        },
        move |code| on_game_exit(&exit_app, exit_id, started, code),
    )?;
    let pid = game.pid;
    running.insert(instance_id.clone(), game);
    // Noch unter dem Lock: `instance-exit` eines sofort beendeten Spiels kommt so erst nach diesem Stand.
    record_launch(&state, &instance_id, quick_play);
    drop(running);
    tracing::info!(instance = %instance_id, pid, user = %account.username, "Spiel gestartet");
    Ok(pid)
}

/// Mit Microsoft-Konto: echte Sitzung (bei Bedarf erneuert); sonst Offline mit `username`.
async fn launch_account(state: &AppState, account_id: Option<String>, username: &str) -> AppResult<(Account, Option<auth::McSession>)> {
    match account_id.filter(|id| !id.is_empty()) {
        Some(id) => {
            let (account, session) = auth::session(state, &id).await?;
            Ok((account, Some(session)))
        }
        None => {
            auth::require_offline(state)?;
            Ok((auth::offline_account(username)?, None))
        }
    }
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
    let stopped = state.running().remove(&instance_id).is_none();
    let crashed = code != Some(0) && !stopped;
    let game_dir = state.dirs.game_dir(&instance_id);
    let text = |p: PathBuf| p.to_string_lossy().into_owned();
    let crash_report = launch::crash_report(&game_dir, started).map(text);
    let log_file = Some(state.dirs.latest_log(&instance_id)).filter(|p| p.is_file()).map(text);
    record_playtime(&state, &instance_id, started);
    tracing::info!(instance = %instance_id, ?code, crashed, "Spiel beendet");
    emit(app, EXIT_EVENT, ExitPayload { instance_id, code, crashed, crash_report, log_file });
}

/// Spielzeit der Sitzung seit `started` speichern; unplausible Dauern und Fehler nur loggen,
/// damit `instance-exit` trotzdem ankommt.
fn record_playtime(state: &AppState, instance_id: &str, started: SystemTime) {
    let Some(secs) = launch::session_secs(started, SystemTime::now()) else {
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
        .running()
        .remove(&instance_id)
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
    Ok(InstanceStatus { installed: install::is_installed(&state.dirs, &instance), running: state.running().contains_key(&instance_id) })
}

/// Spielordner einer Instanz (Welten, Mods, Screenshots) zum Öffnen im Dateimanager; wird bei Bedarf angelegt.
#[tauri::command]
pub fn instance_dir(state: State<'_, AppState>, instance_id: String) -> AppResult<String> {
    state.instances.get(&instance_id)?;
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
