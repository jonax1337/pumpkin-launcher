//! Kataloge ohne API-Key: FTB (öffentliche API, installierbar), Technic und CurseForge (über den eigenen Proxy).
//! Alle liefern dieselben Formen wie Modrinth (`Hit`, `Project`, `Version`), damit die Oberfläche sie gleich zeigt.
mod archive;
mod cdn;
mod remote_file;
mod search;
mod source;

pub mod curseforge;
pub mod ftb;
pub mod net;
pub mod technic;

pub(crate) use archive::{zip_files, zip_paths};
pub use curseforge::Blocked;
pub use remote_file::RemoteFile;
pub use search::{ProjectType, SearchQuery, SortIndex};
pub use source::Source;

use crate::{
    coded,
    error::{AppError, AppResult},
    models::{Instance, ModpackOrigin},
    services::{
        content::{self, Pack},
        limits::PROVIDER_JSON_LIMIT,
        modrinth::{self, Project, SearchResponse, Version},
        progress::{Phase, ProgressFn},
        Dirs,
    },
    state::AppState,
};
use serde::de::DeserializeOwned;
use std::path::Path;

/// Einschränkung der Versionsliste eines Projekts auf Minecraft-Version und Loader.
#[derive(Debug, Default)]
pub struct VersionFilter {
    pub mc: Option<String>,
    pub loader: Option<String>,
}

/// Modpack, das ein Anbieter als neue Instanz `name` liefern soll.
pub struct PackRequest {
    pub source: Source,
    pub project_id: String,
    pub version_id: String,
    pub name: String,
}

impl PackRequest {
    /// Woher die neue Instanz stammt; CurseForge kennt die Nummern, die anderen Anbieter ihre Kennungen.
    pub(crate) fn origin(&self) -> AppResult<ModpackOrigin> {
        match self.source {
            Source::CurseForge => Ok(ModpackOrigin::CurseForge {
                project_id: curseforge::parse_cf_id(&self.project_id)?,
                file_id: curseforge::parse_cf_id(&self.version_id)?,
            }),
            Source::Ftb | Source::Technic => Ok(ModpackOrigin::Provider {
                source: self.source.key().into(),
                project_id: self.project_id.clone(),
                version_id: self.version_id.clone(),
            }),
        }
    }
}

/// Sucht im Katalog des Anbieters. Datapacks führt keiner von ihnen.
pub async fn search(client: &reqwest::Client, source: Source, request: &SearchQuery) -> AppResult<SearchResponse> {
    if request.project_type == ProjectType::Datapack {
        return Err(AppError::invalid(coded!("errors.providers.invalidSearch")));
    }
    match source {
        Source::Ftb => ftb::search(client, request).await,
        Source::Technic => technic::search(client, request).await,
        Source::CurseForge => curseforge::search(client, request).await,
    }
}

pub async fn project(client: &reqwest::Client, source: Source, project_id: &str) -> AppResult<Project> {
    match source {
        Source::Ftb => ftb::project(client, project_id).await,
        Source::Technic => technic::project(client, project_id).await,
        Source::CurseForge => curseforge::project(client, project_id).await,
    }
}

/// Versionen eines Projekts. Bei FTB und Technic gehört jede Version zu genau einem Pack, gefiltert wird dort nicht.
pub async fn versions(
    client: &reqwest::Client,
    source: Source,
    project_id: &str,
    filter: &VersionFilter,
) -> AppResult<Vec<Version>> {
    match source {
        Source::Ftb => ftb::versions(client, project_id).await,
        Source::Technic => technic::versions(client, project_id).await,
        Source::CurseForge => curseforge::versions(client, project_id, filter).await,
    }
}

/// Installiert ein Modpack des Anbieters als neue Instanz. Dazu die Dateien, die CurseForge nur über die Webseite
/// ausliefert (bei den anderen Anbietern keine).
pub async fn install_pack(
    state: &AppState,
    request: &PackRequest,
    progress: ProgressFn<'_>,
) -> AppResult<(Instance, Vec<Blocked>)> {
    progress(Phase::Resolve, 0, 1);
    let client = modrinth::client()?;
    let (pack, blocked) = plan_pack(&client, &state.dirs, request, progress).await?;
    let instance = content::import_plan(state, pack, Some(request.origin()?), progress).await?;
    Ok((instance, blocked))
}

/// Importiert ein CurseForge-Modpack-Zip von der Platte als neue Instanz; dazu die Dateien, die CurseForge nur über
/// die Webseite ausliefert.
pub async fn import_curseforge_zip(
    state: &AppState,
    path: &Path,
    name: &str,
    progress: ProgressFn<'_>,
) -> AppResult<(Instance, Vec<Blocked>)> {
    progress(Phase::Resolve, 0, 1);
    let (pack, blocked) = curseforge::plan_local_pack(&modrinth::client()?, path, name).await?;
    let instance = content::import_plan(state, pack, None, progress).await?;
    Ok((instance, blocked))
}

/// Plan des Packs, das `request` nennt, dazu die Dateien, die CurseForge nur über die Webseite ausliefert.
pub(crate) async fn plan_pack(
    client: &reqwest::Client,
    dirs: &Dirs,
    request: &PackRequest,
    progress: ProgressFn<'_>,
) -> AppResult<(Pack, Vec<Blocked>)> {
    match request.source {
        Source::Technic => Ok((technic::plan(client, dirs, request, progress).await?, Vec::new())),
        Source::CurseForge => curseforge::plan_pack(client, dirs, request, progress).await,
        Source::Ftb => Ok((ftb::plan(client, request).await?, Vec::new())),
    }
}

/// JSON-GET gegen eine feste API; Weiterleitungen und Fehlerstatus sind Fehler.
pub(crate) async fn json<T: DeserializeOwned>(client: &reqwest::Client, url: &str) -> AppResult<T> {
    Ok(serde_json::from_slice(&modrinth::bytes(client.get(url), PROVIDER_JSON_LIMIT).await?)?)
}

/// Ein Pfadstück einer Anbieter-URL: nur Buchstaben, Ziffern, `-`, `_`, `.`.
pub(crate) fn segment(s: &str) -> AppResult<&str> {
    modrinth::identifier(s)?;
    Ok(s)
}
