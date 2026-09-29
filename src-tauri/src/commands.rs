//! Tauri-Commands. Dünne Schicht über `AppState`; Argumentnamen kommen im Frontend als camelCase an.
use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, State};

use crate::error::{AppError, AppResult};
use crate::models::{now_ms, Instance, ModLoader, NewInstance, NewPreset, Preset};
use crate::services::install::{self, InstallProgress, InstallStep, INSTALL_PROGRESS_EVENT};
use crate::services::launch::{self, LaunchSpec, LogStream, EXIT_EVENT, LOG_EVENT};
use crate::services::mojang::{VersionEntry, VersionManifest, MANIFEST_URL};
use crate::services::rules::Env;
use crate::services::fabric::{self, LoaderVersion};
use crate::services::mojang::VersionJson;
use crate::services::{auth, download, java, mods};
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
    let mut desired = instance.mods.clone();
    for removed in &old.mods {
        if !desired.iter().any(|m|m.file_name==removed.file_name) {
            let mut removed=removed.clone();removed.enabled=false;desired.push(removed);
        }
    }
    mods::sync_commit(&state.dirs,&instance.id.clone(),&desired, |_| state.instances.update(instance))
}

#[tauri::command]
pub fn delete_instance(state: State<'_, AppState>, id: String) -> AppResult<()> {
    let _operation = state.operation(Some(&id))?;
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
    let _operation = state.operation(Some(&instance_id))?;
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

fn require_supported(loader: ModLoader) -> AppResult<()> {
    match loader {
        ModLoader::Vanilla | ModLoader::Fabric => Ok(()),
        _ => Err(AppError::NotImplemented("Installation und Start mit Quilt, Forge oder NeoForge")),
    }
}

/// Fabric-Loader-Version einer installierten bzw. zu startenden Instanz.
fn fabric_loader(instance: &Instance) -> AppResult<&str> {
    instance
        .loader_version
        .as_deref()
        .ok_or_else(|| AppError::Invalid("Fabric-Instanz ohne Loader-Version: bitte neu installieren".into()))
}

/// Versions-JSON zum Start: Vanilla, bei Fabric mit dem installierten Profil zusammengeführt.
async fn installed_version(state: &AppState, instance: &Instance) -> AppResult<VersionJson> {
    let version = install::installed_version(&state.dirs, &instance.minecraft_version).await?;
    match instance.loader {
        ModLoader::Fabric => {
            let profile = fabric::installed_profile(&state.dirs, &instance.minecraft_version, fabric_loader(instance)?).await?;
            fabric::merge(version, &profile)
        }
        _ => Ok(version),
    }
}

/// Loader-Versionen zu einer Minecraft-Version, neueste zuerst (Vanilla: leer).
#[tauri::command]
pub async fn loader_versions(
    state: State<'_, AppState>,
    loader: ModLoader,
    mc_version: String,
) -> AppResult<Vec<LoaderVersion>> {
    require_supported(loader)?;
    match loader {
        ModLoader::Fabric => fabric::loader_versions(&state.http, &mc_version).await,
        _ => Ok(Vec::new()),
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
    let mut instance = state.instances.get(&instance_id)?;
    require_supported(instance.loader)?;
    tracing::info!(instance = %instance_id, version = %instance.minecraft_version, loader = ?instance.loader, "Installation gestartet");
    let on_progress = |step, done, total| {
        emit(&app, INSTALL_PROGRESS_EVENT, InstallProgress { instance_id: instance_id.clone(), step, done, total });
    };
    let mut version = install::fetch_version(&state.http, &state.dirs, &instance.minecraft_version).await?;
    if instance.loader == ModLoader::Fabric {
        on_progress(InstallStep::Loader, 0, 1);
        // Ohne gewählte Version die neueste stabile nehmen und festhalten, damit der Start dieselbe nutzt.
        let loader = fabric::resolve_loader(&state.http, &instance.minecraft_version, instance.loader_version.as_deref()).await?;
        let profile = fabric::fetch_profile(&state.http, &state.dirs, &instance.minecraft_version, &loader).await?;
        version = fabric::merge(version, &profile)?;
        if instance.loader_version.as_deref() != Some(loader.as_str()) {
            instance.loader_version = Some(loader);
            instance = state.instances.update(instance)?;
        }
        on_progress(InstallStep::Loader, 1, 1);
    }
    install::install(&state.http, &state.dirs, &version, &instance_id, &on_progress).await?;
    if instance.loader != ModLoader::Vanilla {
        on_progress(InstallStep::Mods, 0, 1);
        let active = mods::sync(&state.dirs, &instance_id, &instance.mods)?;
        on_progress(InstallStep::Mods, 1, 1);
        tracing::info!(instance = %instance_id, active, "Mods bereitgestellt");
    }
    // Marker erst nach vollständigem Erfolg: `instance_status` erkennt so auch abgebrochene Installationen.
    tokio::fs::write(installed_marker(&state, &instance_id), install_key(&instance)).await?;
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
    let _operation = state.operation(Some(&instance_id))?;
    let mut instance = state.instances.get(&instance_id)?;
    require_supported(instance.loader)?;
    mods::sync(&state.dirs,&instance_id,&instance.mods)?;
    let account = auth::offline_account(&username)?;
    let version = installed_version(&state, &instance).await?;
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

/// Inhalt der Markerdatei: die MC-Version, bei Mod-Loadern plus Loader und Version. Ein Wechsel
/// von Loader oder Loader-Version gilt so als nicht installiert; Vanilla-Marker bleiben gültig.
fn install_key(instance: &Instance) -> String {
    match instance.loader {
        ModLoader::Vanilla => instance.minecraft_version.clone(),
        loader => format!("{} {loader:?} {}", instance.minecraft_version, instance.loader_version.as_deref().unwrap_or("?")),
    }
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
        .is_ok_and(|v| v == install_key(&instance));
    Ok(InstanceStatus { installed, running: state.running().contains_key(&instance_id) })
}
