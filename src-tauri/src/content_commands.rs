use crate::{
    error::AppResult,
    models::{Instance, ModpackOrigin, Template},
    services::{content, modrinth as api, templates},
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
/// Bricht `modrinth_install_pack`, `modrinth_import_pack` oder `template_create_instance` mit
/// dieser `operationId` ab; der Vorgang endet mit „Installation abgebrochen“.
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
