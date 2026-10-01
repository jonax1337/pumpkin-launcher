use crate::{
    commands::require_instance_name,
    error::{AppError, AppResult},
    models::{Instance, Template},
    services::{
        content, duplicate,
        imports::{self, ForeignInstance},
        local_files, modrinth as api, mrpack,
        progress::{emit, progress, Phase},
        providers::{self, PackRequest, ProjectType, SearchQuery, SortIndex, Source, VersionFilter},
        templates,
    },
    state::AppState,
};
use serde::Serialize;
use tauri::{AppHandle, State};

#[tauri::command]
pub async fn modrinth_search(
    query: String,
    project_type: String,
    minecraft_version: Option<String>,
    loader: Option<String>,
    offset: u32,
    index: Option<String>,
) -> AppResult<api::SearchResponse> {
    let search = SearchQuery {
        query,
        project_type: ProjectType::parse(&project_type)?,
        mc: minecraft_version,
        loader,
        offset,
        index: SortIndex::parse(index.as_deref())?,
    };
    api::search(&api::client()?, &search).await
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
    let _operation = state.begin_instance_operation(&instance_id)?;
    content::install_mod(&state, &instance_id, &version_id, &*progress(app, operation_id)).await
}

#[tauri::command]
pub async fn modrinth_install_pack(
    app: AppHandle,
    state: State<'_, AppState>,
    version_id: String,
    name: String,
    operation_id: String,
) -> AppResult<Instance> {
    let _operation = state.begin_operation()?;
    let state = state.inner();
    state
        .run_cancellable(&app, &operation_id, |on_progress| async move {
            content::install_modrinth_pack(state, &version_id, &name, &*on_progress).await
        })
        .await
}

#[tauri::command]
pub async fn modrinth_import_pack(
    app: AppHandle,
    state: State<'_, AppState>,
    path: String,
    name: String,
    operation_id: String,
) -> AppResult<Instance> {
    let _operation = state.begin_operation()?;
    let data = content::local_pack(std::path::Path::new(&path))?;
    let state = state.inner();
    state
        .run_cancellable(&app, &operation_id, |on_progress| async move {
            content::import(state, &data, &name, None, &*on_progress).await
        })
        .await
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
    let search = SearchQuery {
        query,
        project_type: ProjectType::parse(&project_type)?,
        mc: minecraft_version,
        loader,
        offset,
        index: SortIndex::parse(index.as_deref())?,
    };
    providers::search(&api::client()?, Source::parse(&source)?, &search).await
}

#[tauri::command]
pub async fn provider_project(source: String, project_id: String) -> AppResult<api::Project> {
    providers::project(&api::client()?, Source::parse(&source)?, &project_id).await
}

#[tauri::command]
pub async fn provider_versions(
    source: String,
    project_id: String,
    minecraft_version: Option<String>,
    loader: Option<String>,
) -> AppResult<Vec<api::Version>> {
    let filter = VersionFilter { mc: minecraft_version, loader };
    providers::versions(&api::client()?, Source::parse(&source)?, &project_id, &filter).await
}

/// Dateien, die CurseForge nur über die Webseite ausliefert; die Oberfläche führt den Nutzer durch das manuelle Laden.
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct BlockedEvent {
    operation_id: String,
    instance_id: String,
    items: Vec<providers::Blocked>,
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
    let request = PackRequest { source: Source::parse(&source)?, project_id, version_id, name };
    let _operation = state.begin_operation()?;
    let state = state.inner();
    let (instance, blocked) = state
        .run_cancellable(&app, &operation_id, |on_progress| async move {
            providers::install_pack(state, &request, &*on_progress).await
        })
        .await?;
    announce_blocked(&app, &operation_id, &instance, blocked);
    Ok(instance)
}

fn announce_blocked(app: &AppHandle, operation_id: &str, instance: &Instance, items: Vec<providers::Blocked>) {
    if items.is_empty() {
        return;
    }
    let event = BlockedEvent { operation_id: operation_id.to_owned(), instance_id: instance.id.clone(), items };
    emit(app, "content-blocked", event);
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
        return Err(AppError::invalid("Dieser Anbieter liefert nur Modpacks"));
    }
    let _operation = state.begin_instance_operation(&instance_id)?;
    providers::curseforge::install_mod(&state, &instance_id, &project_id, &version_id, &*progress(app, operation_id)).await
}

/// Holt eine Datei, die der Nutzer auf CurseForge von Hand geladen hat, aus dem Downloads-Ordner in die Instanz.
/// `None` = noch nicht da oder der Launcher ist gerade beschäftigt; die Oberfläche fragt wieder.
#[tauri::command]
pub async fn curseforge_adopt_download(
    state: State<'_, AppState>,
    instance_id: String,
    project_id: u32,
    file_id: u32,
    file_name: String,
) -> AppResult<Option<Instance>> {
    let Ok(_operation) = state.begin_instance_operation(&instance_id) else { return Ok(None) };
    let wanted = providers::curseforge::ManualDownload { project_id, file_id, file_name: &file_name };
    providers::curseforge::adopt_download(&state, &instance_id, &wanted).await
}

/// Bricht `modrinth_install_pack`, `modrinth_import_pack`, `provider_install_pack`, `template_create_instance`,
/// `instance_import`, `instance_duplicate` oder `instance_export` mit dieser `operationId` ab; der Vorgang endet mit
/// „Vorgang abgebrochen“.
#[tauri::command]
pub fn pack_install_cancel(state: State<'_, AppState>, operation_id: String) {
    state.cancel(&operation_id);
}

#[tauri::command]
pub async fn modrinth_check_updates(state: State<'_, AppState>, instance_id: String) -> AppResult<Vec<content::ModUpdate>> {
    let instance = state.instances.get(&instance_id)?;
    content::check_updates(&api::client()?, &instance).await
}

#[tauri::command]
pub async fn modrinth_update_mods(
    app: AppHandle,
    state: State<'_, AppState>,
    instance_id: String,
    mod_ids: Vec<String>,
    operation_id: String,
) -> AppResult<Instance> {
    let _operation = state.begin_instance_operation(&instance_id)?;
    content::update_mods(&state, &instance_id, &mod_ids, &*progress(app, operation_id)).await
}

/// Vorab-Prüfung abgelegter oder ausgewählter Dateien: Art und ob die Instanz sie schon hat.
#[tauri::command]
pub async fn instance_check_files(
    state: State<'_, AppState>,
    instance_id: String,
    paths: Vec<String>,
) -> AppResult<Vec<local_files::FileCheck>> {
    local_files::check(&state, &instance_id, paths).await
}

/// Eigene .jar-/.zip-Dateien in die Instanz; was Modrinth per SHA-1 kennt, bekommt Updates von dort.
#[tauri::command]
pub async fn instance_add_files(
    app: AppHandle,
    state: State<'_, AppState>,
    instance_id: String,
    files: Vec<local_files::LocalFile>,
    operation_id: String,
) -> AppResult<Instance> {
    let _operation = state.begin_instance_operation(&instance_id)?;
    local_files::add(&state, &instance_id, files, progress(app, operation_id)).await
}

/// Gleicht lokale Einträge der Instanz per SHA-1 mit Modrinth ab; erkannte bekommen Updates von dort.
#[tauri::command]
pub async fn modrinth_identify(
    state: State<'_, AppState>,
    instance_id: String,
    mod_ids: Vec<String>,
) -> AppResult<Instance> {
    let _operation = state.begin_instance_operation(&instance_id)?;
    local_files::identify_local(&state, &instance_id, &mod_ids).await
}

#[tauri::command]
pub async fn template_save(state: State<'_, AppState>, instance_id: String, name: String) -> AppResult<Template> {
    let _operation = state.begin_instance_operation(&instance_id)?;
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
    let _operation = state.begin_operation()?;
    let state = state.inner();
    state
        .run_cancellable(&app, &operation_id, |on_progress| async move {
            templates::create_instance(state, &template_id, &name, &*on_progress).await
        })
        .await
}

/// Kopie einer Instanz unter neuem Namen; Fortschritt als `content-progress` (Phase `copy`).
#[tauri::command]
pub async fn instance_duplicate(
    app: AppHandle,
    state: State<'_, AppState>,
    instance_id: String,
    operation_id: String,
) -> AppResult<Instance> {
    let _operation = state.begin_instance_operation(&instance_id)?;
    state
        .run_cancellable(&app, &operation_id, |on_progress| duplicate::duplicate(&state, &instance_id, on_progress))
        .await
}

/// Instanzen anderer Launcher an den bekannten Orten oder im gewählten Ordner (absolut).
#[tauri::command]
pub async fn import_detect(state: State<'_, AppState>, folder: Option<String>) -> AppResult<Vec<ForeignInstance>> {
    let folder = folder.map(std::path::PathBuf::from);
    if folder.as_ref().is_some_and(|f| !f.is_absolute()) {
        return Err(AppError::invalid("Bitte einen vollständigen Ordnerpfad angeben"));
    }
    imports::detect(&state, folder.as_deref()).await
}

/// Neue Instanz aus einer Instanz eines anderen Launchers; Fortschritt als `content-progress` (Phase `copy`),
/// abbrechbar über `pack_install_cancel`.
#[tauri::command]
pub async fn instance_import(
    app: AppHandle,
    state: State<'_, AppState>,
    source: ForeignInstance,
    operation_id: String,
) -> AppResult<Instance> {
    require_instance_name(&source.setup.name)?;
    let _operation = state.begin_operation()?;
    state
        .run_cancellable(&app, &operation_id, |on_progress| imports::import(&state, source, on_progress))
        .await
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
    let _operation = state.begin_instance_operation(&instance_id)?;
    state
        .run_cancellable(&app, &operation_id, |on_progress| {
            // Das Packen meldet keinen Fortschritt; die Oberfläche soll die Phase trotzdem von Anfang an zeigen.
            on_progress(Phase::Pack, 0, 0);
            mrpack::export(&state, &instance_id, include, std::path::Path::new(&path))
        })
        .await
}
