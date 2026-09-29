//! Tauri-Commands. Dünne Schicht über `AppState`; Argumentnamen kommen im Frontend als camelCase an.
use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, State};

use crate::error::{AppError, AppResult};
use crate::models::{now_ms, Instance, ModLoader, NewInstance, NewPreset, Preset};
use crate::services::install::{self, InstallProgress, INSTALL_PROGRESS_EVENT};
use crate::services::launch::{self, LaunchSpec, LogStream, EXIT_EVENT, LOG_EVENT};
use crate::services::mojang::{VersionEntry, VersionManifest, MANIFEST_URL};
use crate::services::rules::Env;
use crate::services::{auth, download, java};
use crate::state::AppState;

fn require_name(name: &str) -> AppResult<()> {
    if name.trim().is_empty() {
        return Err(AppError::Invalid("Name darf nicht leer sein".into()));
    }
    Ok(())
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
    require_name(&input.name)?;
    let instance = state.instances.insert(Instance::from_new(input))?;
    tracing::info!(id = %instance.id, name = %instance.name, "Instanz angelegt");
    Ok(instance)
}

#[tauri::command]
pub fn update_instance(state: State<'_, AppState>, instance: Instance) -> AppResult<Instance> {
    require_name(&instance.name)?;
    state.instances.update(instance)
}

#[tauri::command]
pub fn delete_instance(state: State<'_, AppState>, id: String) -> AppResult<()> {
    if state.running().contains_key(&id) {
        return Err(AppError::Invalid("Instanz läuft noch".into()));
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

#[tauri::command]
pub fn list_presets(state: State<'_, AppState>) -> Vec<Preset> {
    state.presets.list()
}

#[tauri::command]
pub fn create_preset(state: State<'_, AppState>, input: NewPreset) -> AppResult<Preset> {
    require_name(&input.name)?;
    let preset = Preset::from_new(input);
    state.resolve_preset(&preset)?;
    let preset = state.presets.insert(preset)?;
    tracing::info!(id = %preset.id, name = %preset.name, "Preset angelegt");
    Ok(preset)
}

#[tauri::command]
pub fn update_preset(state: State<'_, AppState>, preset: Preset) -> AppResult<Preset> {
    require_name(&preset.name)?;
    state.resolve_preset(&preset)?;
    state.presets.update(preset)
}

#[tauri::command]
pub fn delete_preset(state: State<'_, AppState>, id: String) -> AppResult<()> {
    state.delete_preset(&id)?;
    tracing::info!(%id, "Preset gelöscht");
    Ok(())
}

#[tauri::command]
pub fn apply_preset(
    state: State<'_, AppState>,
    instance_id: String,
    preset_id: String,
) -> AppResult<Instance> {
    let instance = state.apply_preset(&instance_id, &preset_id)?;
    tracing::info!(instance = %instance_id, preset = %preset_id, "Preset angewendet");
    Ok(instance)
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
}

fn emit<T: Serialize + Clone>(app: &AppHandle, event: &str, payload: T) {
    if let Err(err) = app.emit(event, payload) {
        tracing::warn!(event, %err, "Event konnte nicht gesendet werden");
    }
}

fn require_vanilla(instance: &Instance) -> AppResult<()> {
    match instance.loader {
        ModLoader::Vanilla => Ok(()),
        _ => Err(AppError::NotImplemented("Installation und Start mit Mod-Loader")),
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
    let instance = state.instances.get(&instance_id)?;
    require_vanilla(&instance)?;
    tracing::info!(instance = %instance_id, version = %instance.minecraft_version, "Installation gestartet");
    let version = install::fetch_version(&state.http, &state.dirs, &instance.minecraft_version).await?;
    let on_progress = |step, done, total| {
        emit(&app, INSTALL_PROGRESS_EVENT, InstallProgress { instance_id: instance_id.clone(), step, done, total });
    };
    install::install(&state.http, &state.dirs, &version, &instance_id, &on_progress).await?;
    // Marker erst nach vollständigem Erfolg: `instance_status` erkennt so auch abgebrochene Installationen.
    tokio::fs::write(installed_marker(&state, &instance_id), &instance.minecraft_version).await?;
    tracing::info!(instance = %instance_id, "Installation abgeschlossen");
    Ok(())
}

/// Startet eine installierte Instanz mit Offline-Account und liefert die Prozess-ID.
/// Ausgaben kommen als `instance-log`, das Ende als `instance-exit`.
#[tauri::command]
pub async fn instance_launch(
    app: AppHandle,
    state: State<'_, AppState>,
    instance_id: String,
    username: String,
    java_path: Option<String>,
    default_memory_mb: Option<u32>,
) -> AppResult<u32> {
    let mut instance = state.instances.get(&instance_id)?;
    require_vanilla(&instance)?;
    let account = auth::offline_account(&username)?;
    let version = install::installed_version(&state.dirs, &instance.minecraft_version).await?;
    // Eigener Java-Pfad aus den Einstellungen hat Vorrang vor der mitgelieferten Runtime.
    let java = match java_path.filter(|p| !p.trim().is_empty()) {
        Some(p) => std::path::PathBuf::from(p.trim()),
        None => java::java_exe(&state.dirs, install::java_component(&version)),
    };
    if !java.exists() {
        return Err(AppError::Invalid(format!("Java nicht gefunden: {}", java.display())));
    }
    let args = launch::build_args(
        &LaunchSpec {
            version: &version,
            dirs: &state.dirs,
            instance_id: &instance_id,
            account: &account,
            memory_mb: instance.memory_mb.or(default_memory_mb).unwrap_or(launch::DEFAULT_MEMORY_MB),
            extra_jvm_args: &instance.jvm_args,
        },
        &Env::current(),
    )?;

    // Lock über Prüfen, Starten und Eintragen halten: sonst könnte ein sofort beendeter
    // Prozess seinen Eintrag entfernen, bevor er eingetragen ist.
    let mut running = state.running();
    if running.contains_key(&instance_id) {
        return Err(AppError::Invalid("Instanz läuft bereits".into()));
    }
    let (log_app, log_id) = (app.clone(), instance_id.clone());
    let (exit_app, exit_id) = (app.clone(), instance_id.clone());
    let game = launch::spawn(
        &java,
        &args,
        &state.dirs.game_dir(&instance_id),
        move |stream, line| {
            tracing::info!(target: "minecraft", instance = %log_id, ?stream, "{line}");
            emit(&log_app, LOG_EVENT, LogPayload { instance_id: log_id.clone(), stream, line });
        },
        move |code| {
            exit_app.state::<AppState>().running().remove(&exit_id);
            tracing::info!(instance = %exit_id, ?code, "Spiel beendet");
            emit(&exit_app, EXIT_EVENT, ExitPayload { instance_id: exit_id, code });
        },
    )?;
    let pid = game.pid;
    running.insert(instance_id.clone(), game);
    drop(running);
    tracing::info!(instance = %instance_id, pid, user = %account.username, "Spiel gestartet");

    instance.last_played_at = Some(now_ms());
    state.instances.update(instance)?;
    Ok(pid)
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

fn installed_marker(state: &AppState, instance_id: &str) -> std::path::PathBuf {
    state.dirs.natives_dir(instance_id).with_file_name("installed")
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
    let installed = std::fs::read_to_string(installed_marker(&state, &instance_id))
        .is_ok_and(|v| v == instance.minecraft_version);
    Ok(InstanceStatus { installed, running: state.running().contains_key(&instance_id) })
}
