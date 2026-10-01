use crate::{
    error::AppResult,
    models::{Instance, ModpackOrigin, Template},
    services::{
        content, duplicate, modrinth as api, mrpack,
        providers::{self, Source},
        templates,
    },
    state::AppState,
};
use serde::Serialize;
use tauri::{AppHandle, Emitter, State};
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct Progress {
    operation_id: String,
    phase: String,
    done: u64,
    total: u64,
}
fn progress(app: AppHandle, id: String) -> impl Fn(&str, u64, u64) + Send + Sync {
    move |phase, done, total| {
        if let Err(e) = app.emit(
            "content-progress",
            Progress {
                operation_id: id.clone(),
                phase: phase.into(),
                done,
                total,
            },
        ) {
            tracing::warn!(%e,"Content-Event fehlgeschlagen");
        }
    }
}
#[tauri::command]
pub async fn modrinth_search(
    query: String,
    project_type: String,
    minecraft_version: Option<String>,
    loader: Option<String>,
    offset: u32,
    index: Option<String>,
) -> AppResult<api::SearchResponse> {
    api::search(
        &api::client()?,
        query,
        project_type,
        minecraft_version,
        loader,
        offset,
        index,
    )
    .await
}
#[tauri::command]
pub async fn modrinth_project(project_id: String) -> AppResult<api::Project> {
    api::project(&api::client()?, &project_id).await
}
#[tauri::command]
pub async fn modrinth_projects(project_ids: Vec<String>) -> AppResult<Vec<api::Project>> {
    api::projects(&api::client()?, &project_ids).await
}
#[tauri::command]
pub async fn modrinth_versions(
    project_id: String,
    minecraft_version: Option<String>,
    loader: Option<String>,
) -> AppResult<Vec<api::Version>> {
    api::versions(
        &api::client()?,
        &project_id,
        minecraft_version.as_deref(),
        loader.as_deref(),
    )
    .await
}
#[tauri::command]
pub async fn modrinth_install_mod(
    app: AppHandle,
    state: State<'_, AppState>,
    instance_id: String,
    version_id: String,
    operation_id: String,
) -> AppResult<Instance> {
    let _operation = state.operation(Some(&instance_id))?;
    content::install_mod(
        &state,
        &instance_id,
        &version_id,
        &progress(app, operation_id),
    )
    .await
}
#[tauri::command]
pub async fn modrinth_install_pack(
    app: AppHandle,
    state: State<'_, AppState>,
    version_id: String,
    name: String,
    operation_id: String,
) -> AppResult<Instance> {
    let _operation = state.operation(None)?;
    let on_progress = progress(app, operation_id.clone());
    let work = async {
        on_progress("resolve", 0, 1);
        let client = api::client()?;
        let version = api::version(&client, &version_id).await?;
        let project = api::project(&client, &version.project_id).await?;
        if project.project_type != "modpack" {
            return Err(api::invalid("Projekt ist kein Modpack"));
        }
        let file = api::primary(&version, ".mrpack")?;
        on_progress("download", 0, 1);
        let data = api::download(&client, &file).await?;
        let origin = ModpackOrigin::Modrinth { project_id: version.project_id, version_id: version.id };
        content::import(&state, &data, &name, Some(origin), &on_progress).await
    };
    state.cancellable(&operation_id, work).await
}
#[tauri::command]
pub async fn modrinth_import_pack(
    app: AppHandle,
    state: State<'_, AppState>,
    path: String,
    name: String,
    operation_id: String,
) -> AppResult<Instance> {
    let _operation = state.operation(None)?;
    let data = content::local_pack(std::path::Path::new(&path))?;
    let on_progress = progress(app, operation_id.clone());
    let work = content::import(&state, &data, &name, None, &on_progress);
    state.cancellable(&operation_id, work).await
}
/// Katalog der Anbieter (FTB, Technic, CurseForge über den Worker); gleiche Formen wie bei Modrinth.
#[tauri::command]
pub async fn provider_search(
    source: String,
    query: String,
    project_type: String,
    minecraft_version: Option<String>,
    loader: Option<String>,
    offset: u32,
    index: Option<String>,
) -> AppResult<api::SearchResponse> {
    if !matches!(project_type.as_str(), "mod" | "modpack" | "resourcepack" | "shader") {
        return Err(api::invalid("Ungültige Suche"));
    }
    for v in minecraft_version.iter().chain(loader.iter()) {
        api::identifier(v)?;
    }
    let client = api::client()?;
    let (mc, loader, index) = (minecraft_version.as_deref(), loader.as_deref(), index.as_deref());
    match Source::parse(&source)? {
        Source::Ftb => providers::ftb::search(&client, &query, &project_type, mc, loader, offset, index).await,
        Source::Technic => providers::technic::search(&client, &query, &project_type, mc, offset, index).await,
        Source::CurseForge => providers::curseforge::search(&client, &query, &project_type, mc, loader, offset, index).await,
    }
}
#[tauri::command]
pub async fn provider_project(source: String, project_id: String) -> AppResult<api::Project> {
    let client = api::client()?;
    match Source::parse(&source)? {
        Source::Ftb => providers::ftb::project(&client, &project_id).await,
        Source::Technic => providers::technic::project(&client, &project_id).await,
        Source::CurseForge => providers::curseforge::project(&client, &project_id).await,
    }
}
#[tauri::command]
pub async fn provider_versions(
    source: String,
    project_id: String,
    minecraft_version: Option<String>,
    loader: Option<String>,
) -> AppResult<Vec<api::Version>> {
    let client = api::client()?;
    match Source::parse(&source)? {
        Source::Ftb => providers::ftb::versions(&client, &project_id).await,
        Source::Technic => providers::technic::versions(&client, &project_id).await,
        Source::CurseForge => {
            providers::curseforge::versions(&client, &project_id, minecraft_version.as_deref(), loader.as_deref()).await
        }
    }
}
/// Dateien, die CurseForge nur über die Webseite ausliefert; die Oberfläche führt den Nutzer durch das manuelle Laden.
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct BlockedEvent {
    operation_id: String,
    instance_id: String,
    items: Vec<providers::curseforge::Blocked>,
}
/// Modpack als neue Instanz: FTB (Dateiliste), Technic (Pack-Zip des Autors) und CurseForge (mit Schlüssel).
#[tauri::command]
pub async fn provider_install_pack(
    app: AppHandle,
    state: State<'_, AppState>,
    source: String,
    project_id: String,
    version_id: String,
    name: String,
    operation_id: String,
) -> AppResult<Instance> {
    let source = Source::parse(&source)?;
    let _operation = state.operation(None)?;
    let on_progress = progress(app.clone(), operation_id.clone());
    let work = async {
        on_progress("resolve", 0, 1);
        let client = api::client()?;
        let mut blocked = Vec::new();
        let (pack, origin) = match source {
            Source::Technic => (
                providers::technic::plan(&client, &state.dirs, &project_id, &name, &on_progress).await?,
                ModpackOrigin::Provider { source: source.key().into(), project_id, version_id },
            ),
            Source::CurseForge => {
                let (pack, b) = providers::curseforge::plan_pack(&client, &state.dirs, &project_id, &version_id, &name, &on_progress).await?;
                blocked = b;
                let origin = ModpackOrigin::CurseForge { project_id: project_id.parse().map_err(|_| api::invalid("Ungültige CurseForge-Nummer"))?, file_id: version_id.parse().map_err(|_| api::invalid("Ungültige CurseForge-Nummer"))? };
                (pack, origin)
            }
            Source::Ftb => (
                providers::ftb::plan(&client, &project_id, &version_id, &name).await?,
                ModpackOrigin::Provider { source: source.key().into(), project_id, version_id },
            ),
        };
        let instance = content::import_plan(&state, pack, Some(origin), &on_progress).await?;
        if !blocked.is_empty() {
            let event = BlockedEvent { operation_id: operation_id.clone(), instance_id: instance.id.clone(), items: blocked };
            if let Err(e) = app.emit("content-blocked", event) {
                tracing::warn!(%e, "Event content-blocked fehlgeschlagen");
            }
        }
        Ok(instance)
    };
    state.cancellable(&operation_id, work).await
}
/// Mod, Shader oder Ressourcenpaket von CurseForge in eine Instanz, samt benötigter Abhängigkeiten.
#[tauri::command]
pub async fn provider_install_mod(
    app: AppHandle,
    state: State<'_, AppState>,
    source: String,
    instance_id: String,
    project_id: String,
    version_id: String,
    operation_id: String,
) -> AppResult<Instance> {
    if Source::parse(&source)? != Source::CurseForge {
        return Err(api::invalid("Dieser Anbieter liefert nur Modpacks"));
    }
    let _operation = state.operation(Some(&instance_id))?;
    providers::curseforge::install_mod(&state, &instance_id, &project_id, &version_id, &progress(app, operation_id)).await
}
/// Holt eine Datei, die der Nutzer auf CurseForge von Hand geladen hat, aus dem Downloads-Ordner in die Instanz.
/// `None` = noch nicht da oder der Launcher ist gerade beschäftigt; die Oberfläche fragt wieder.
#[tauri::command]
pub async fn curseforge_adopt_download(state: State<'_, AppState>, instance_id: String, project_id: u32, file_id: u32) -> AppResult<Option<Instance>> {
    let Ok(_operation) = state.operation(Some(&instance_id)) else { return Ok(None) };
    providers::curseforge::adopt_download(&state, &instance_id, project_id, file_id).await
}
/// Bricht `modrinth_install_pack`, `modrinth_import_pack`, `provider_install_pack`, `template_create_instance`,
/// `instance_duplicate` oder `instance_export` mit dieser `operationId` ab; der Vorgang endet mit „Vorgang abgebrochen“.
#[tauri::command]
pub fn pack_install_cancel(state: State<'_, AppState>, operation_id: String) {
    state.cancel(&operation_id);
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ModUpdate {
    mod_id: String,
    current_version: String,
    version_id: String,
    version_number: String,
}
#[tauri::command]
pub async fn modrinth_check_updates(
    state: State<'_, AppState>,
    instance_id: String,
) -> AppResult<Vec<ModUpdate>> {
    let instance = state.instances.get(&instance_id)?;
    Ok(content::check_updates(&api::client()?, &instance)
        .await?
        .into_iter()
        .map(|(i, v)| ModUpdate {
            mod_id: instance.mods[i].id.clone(),
            current_version: instance.mods[i].version.clone(),
            version_id: v.id,
            version_number: v.version_number,
        })
        .collect())
}
#[tauri::command]
pub async fn modrinth_update_mods(
    app: AppHandle,
    state: State<'_, AppState>,
    instance_id: String,
    mod_ids: Vec<String>,
    operation_id: String,
) -> AppResult<Instance> {
    let _operation = state.operation(Some(&instance_id))?;
    content::update_mods(&state, &instance_id, &mod_ids, &progress(app, operation_id)).await
}
#[tauri::command]
pub async fn template_save(state: State<'_, AppState>, instance_id: String, name: String) -> AppResult<Template> {
    let _operation = state.operation(Some(&instance_id))?;
    templates::save(&state, &instance_id, &name).await
}
#[tauri::command]
pub fn template_list(state: State<'_, AppState>) -> Vec<Template> {
    state.templates.list()
}
#[tauri::command]
pub fn template_delete(state: State<'_, AppState>, id: String) -> AppResult<()> {
    templates::delete(&state, &id)
}
#[tauri::command]
pub async fn template_create_instance(
    app: AppHandle,
    state: State<'_, AppState>,
    template_id: String,
    name: String,
    operation_id: String,
) -> AppResult<Instance> {
    let _operation = state.operation(None)?;
    let on_progress = progress(app, operation_id.clone());
    let work = templates::create_instance(&state, &template_id, &name, &on_progress);
    state.cancellable(&operation_id, work).await
}
/// Kopie einer Instanz unter neuem Namen; Fortschritt als `content-progress` (Phase `copy`).
#[tauri::command]
pub async fn instance_duplicate(
    app: AppHandle,
    state: State<'_, AppState>,
    instance_id: String,
    operation_id: String,
) -> AppResult<Instance> {
    let _operation = state.operation(Some(&instance_id))?;
    let work = duplicate::duplicate(&state, &instance_id, progress(app, operation_id.clone()));
    state.cancellable(&operation_id, work).await
}
/// Einträge des Spielordners, die `instance_export` mitnehmen kann.
#[tauri::command]
pub fn instance_export_entries(state: State<'_, AppState>, instance_id: String) -> AppResult<Vec<String>> {
    mrpack::entries(&state.dirs, &state.instances.get(&instance_id)?)
}
/// Schreibt die Instanz als `.mrpack` an den vom Nutzer gewählten Pfad (Phase `pack`).
#[tauri::command]
pub async fn instance_export(
    app: AppHandle,
    state: State<'_, AppState>,
    instance_id: String,
    include: Vec<String>,
    path: String,
    operation_id: String,
) -> AppResult<()> {
    let _operation = state.operation(Some(&instance_id))?;
    progress(app, operation_id.clone())("pack", 0, 0);
    let work = mrpack::export(&state, &instance_id, include, std::path::Path::new(&path));
    state.cancellable(&operation_id, work).await
}
