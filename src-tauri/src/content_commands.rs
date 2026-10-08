use crate::{
    coded,
    error::{AppError, AppResult},
    models::{Instance, Template},
    services::{
        content, duplicate,
        imports::{self, ForeignInstance, ImportRequest},
        local_files, modrinth as api, mrpack, pack_selection,
        progress::{emit, progress, Phase},
        providers::{self, PackRequest, ProjectType, SearchQuery, SortIndex, Source, VersionFilter},
        templates,
    },
    state::AppState,
};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, State};

#[tauri::command]
pub async fn modrinth_search(
    query: String,
    project_type: String,
    minecraft_version: Option<String>,
    loader: Option<String>,
    category: Option<String>,
    offset: u32,
    index: Option<String>,
) -> AppResult<api::SearchResponse> {
    let search = SearchQuery {
        query,
        project_type: ProjectType::parse(&project_type)?,
        mc: minecraft_version,
        loader,
        category,
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
    let _operation = state.begin_creation()?;
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
    let _operation = state.begin_creation()?;
    let data = content::local_pack(std::path::Path::new(&path))?;
    let state = state.inner();
    state
        .run_cancellable(&app, &operation_id, |on_progress| async move {
            content::import_file(state, &data, &name, &*on_progress).await
        })
        .await
}

/// CurseForge-Modpack-Zip von der Platte als neue Instanz (Export des CurseForge-Launchers oder Download von der Webseite).
#[tauri::command]
pub async fn curseforge_import_pack(
    app: AppHandle,
    state: State<'_, AppState>,
    path: String,
    name: String,
    operation_id: String,
) -> AppResult<Instance> {
    let _operation = state.begin_creation()?;
    let state = state.inner();
    let (instance, blocked) = state
        .run_cancellable(&app, &operation_id, |on_progress| async move {
            providers::import_curseforge_zip(state, std::path::Path::new(&path), &name, &*on_progress).await
        })
        .await?;
    announce_blocked(&app, &operation_id, &instance, blocked);
    Ok(instance)
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
        category: None,
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
    let _operation = state.begin_creation()?;
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
        return Err(AppError::invalid(coded!("errors.app.providerOnlyPacks")));
    }
    let _operation = state.begin_instance_operation(&instance_id)?;
    providers::curseforge::install_mod(&state, &instance_id, &project_id, &version_id, &*progress(app, operation_id)).await
}

/// Holt eine Datei, die der Nutzer auf CurseForge von Hand geladen hat, aus dem Downloads-Ordner in die Instanz.
/// `None` = noch nicht da oder an der Instanz läuft gerade ein Vorgang; die Oberfläche fragt wieder.
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

/// Bricht `modrinth_install_pack`, `modrinth_import_pack`, `curseforge_import_pack`, `provider_install_pack`, `template_create_instance`,
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

/// Größe und Datum der Dateien sowie Hinweise aus den Mod-Metadaten (fehlende Abhängigkeiten, Doppelte, Loader, Version).
#[tauri::command]
pub async fn instance_content_analysis(state: State<'_, AppState>, instance_id: String) -> AppResult<content::ContentAnalysis> {
    let instance = state.instances.get(&instance_id)?;
    state.blocking_with_dirs(move |dirs| Ok(content::analyze(dirs, &instance))).await
}

/// Gewählte Ressourcenpakete und Shader laut `options.txt` und Iris.
#[tauri::command]
pub async fn instance_pack_selection(state: State<'_, AppState>, instance_id: String) -> AppResult<pack_selection::PackSelection> {
    state.require_instance(&instance_id)?;
    state.blocking_with_dirs(move |dirs| pack_selection::read(dirs, &instance_id)).await
}

/// Setzt die Ressourcenpakete in `options.txt`; läuft das Spiel, schreibt nichts, denn es überschriebe die Datei beim Beenden.
#[tauri::command]
pub async fn instance_set_resource_packs(
    state: State<'_, AppState>,
    instance_id: String,
    packs: Vec<String>,
) -> AppResult<pack_selection::PackSelection> {
    let _operation = state.exclusive(&instance_id)?;
    state.blocking_with_dirs(move |dirs| pack_selection::write_resource_packs(dirs, &instance_id, &packs)).await
}

/// Wählt den Iris-Shader (Dateiname) oder keinen; läuft das Spiel, schreibt nichts.
#[tauri::command]
pub async fn instance_set_shader_pack(
    state: State<'_, AppState>,
    instance_id: String,
    pack: Option<String>,
) -> AppResult<pack_selection::PackSelection> {
    let _operation = state.exclusive(&instance_id)?;
    state.blocking_with_dirs(move |dirs| pack_selection::write_shader_pack(dirs, &instance_id, pack.as_deref())).await
}

/// Setzt einen Modrinth-Inhalt auf eine gewählte Version (neuer oder älter).
#[tauri::command]
pub async fn modrinth_switch_version(
    app: AppHandle,
    state: State<'_, AppState>,
    instance_id: String,
    mod_id: String,
    version_id: String,
    operation_id: String,
) -> AppResult<Instance> {
    let _operation = state.begin_instance_operation(&instance_id)?;
    content::switch_version(&state, &instance_id, &mod_id, &version_id, &*progress(app, operation_id)).await
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

/// Legt die Vorlage als `.mrpack` an den vom Nutzer gewählten Pfad.
#[tauri::command]
pub async fn template_export(state: State<'_, AppState>, id: String, path: String) -> AppResult<()> {
    templates::export_file(&state, &id, std::path::Path::new(&path)).await
}

/// Nimmt eine `.mrpack`-Datei (absoluter Pfad) als Vorlage auf.
#[tauri::command]
pub async fn template_import(state: State<'_, AppState>, path: String) -> AppResult<Template> {
    templates::import_file(&state, std::path::Path::new(&path)).await
}

#[tauri::command]
pub async fn template_create_instance(
    app: AppHandle,
    state: State<'_, AppState>,
    template_id: String,
    name: String,
    operation_id: String,
) -> AppResult<Instance> {
    let _operation = state.begin_creation()?;
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
        return Err(AppError::invalid(coded!("errors.app.folderNotAbsolute")));
    }
    imports::detect(&state, folder.as_deref()).await
}

/// Neue Instanz aus einer von `import_detect` gefundenen Instanz eines anderen Launchers; deren Einstellungen liest
/// das Backend selbst neu ein. Fortschritt als `content-progress` (Phase `copy`), abbrechbar über `pack_install_cancel`.
#[tauri::command]
pub async fn instance_import(
    app: AppHandle,
    state: State<'_, AppState>,
    request: ImportRequest,
    operation_id: String,
) -> AppResult<Instance> {
    let _operation = state.begin_creation()?;
    let source = imports::resolve(request).await?;
    state
        .run_cancellable(&app, &operation_id, |on_progress| imports::import(&state, source, on_progress))
        .await
}

/// Einträge des Spielordners, die `instance_export` mitnehmen kann.
#[tauri::command]
pub fn instance_export_entries(state: State<'_, AppState>, instance_id: String) -> AppResult<Vec<String>> {
    mrpack::entries(&state.dirs, &state.instances.get(&instance_id)?)
}

/// Wie `instance_export` die Inhalte verteilen würde: verlinkt, mitgeliefert, ausgeschaltet übersprungen.
#[tauri::command]
pub async fn instance_export_summary(
    state: State<'_, AppState>,
    instance_id: String,
    include: Vec<String>,
) -> AppResult<mrpack::ExportSummary> {
    mrpack::summary(&state, &instance_id, &include).await
}

/// Zielpfade für einen Mehrfach-Export in `folder`: vorhandene Dateien bleiben unberührt (siehe `mrpack::free_targets`).
#[tauri::command]
pub fn instance_export_targets(folder: String, file_names: Vec<String>) -> AppResult<Vec<String>> {
    let targets = mrpack::free_targets(std::path::Path::new(&folder), &file_names)?;
    Ok(targets.iter().map(|path| path.to_string_lossy().into_owned()).collect())
}

/// Was ein Export mitnimmt (`include`) und was im Index des Packs steht (Name, Version, Beschreibung).
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportRequest {
    include: Vec<String>,
    name: String,
    version_id: String,
    summary: Option<String>,
}

/// Schreibt die Instanz als `.mrpack` an den vom Nutzer gewählten Pfad (Phase `pack`).
#[tauri::command]
pub async fn instance_export(
    app: AppHandle,
    state: State<'_, AppState>,
    instance_id: String,
    request: ExportRequest,
    path: String,
    operation_id: String,
) -> AppResult<()> {
    let ExportRequest { include, name, version_id, summary } = request;
    let meta = mrpack::PackMeta::new(&name, &version_id, summary.as_deref())?;
    let _operation = state.begin_instance_operation(&instance_id)?;
    state
        .run_cancellable(&app, &operation_id, |on_progress| {
            // Das Packen meldet keinen Fortschritt; die Oberfläche soll die Phase trotzdem von Anfang an zeigen.
            on_progress(Phase::Pack, 0, 0);
            mrpack::export(&state, &instance_id, include, meta, std::path::Path::new(&path))
        })
        .await
}
