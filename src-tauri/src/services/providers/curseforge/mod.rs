//! CurseForge über einen eigenen Proxy (Cloudflare Worker, siehe `proxy/`), der den API-Schlüssel hält. Der Launcher
//! kennt keinen Schlüssel: Alle Abfragen gehen an den Worker, nur die Dateien selbst kommen direkt vom CurseForge-CDN.
//! Damit geht alles im Launcher: Suche, Mods mit Abhängigkeiten, Modpacks (auch sehr große). Mods, deren Autoren Downloads
//! außerhalb von CurseForge verbieten (`downloadUrl` fehlt), werden nicht umgangen, sondern als „manuell laden“ gemeldet
//! (`Blocked`).
mod codes;
mod dto;
mod install;
mod manual;
mod pack;
mod proxy;

pub use install::install_mod;
pub use manual::{adopt_download, ManualDownload};
pub use pack::Blocked;
pub(crate) use pack::plan_pack;

use super::{SearchQuery, VersionFilter};
use crate::{
    error::{AppError, AppResult},
    services::{
        limits::PAGE_SIZE,
        modrinth::{identifier, Dependency, File, Hit, Project, SearchResponse, Version},
    },
};
use codes::{class_of, kind_name, loader_type_of, sort_field};
use dto::{CfFile, CfMod, One, Page};
use proxy::{get, mod_of};
use std::collections::BTreeMap;

const GAME_MINECRAFT: u32 = 432;
/// Dateien je Seite der Dateiliste eines Projekts.
const FILES_PAGE_SIZE: u32 = 50;
/// Die Suche von CurseForge liefert nur die ersten 10 000 Treffer; `index + pageSize` darf sie nicht überschreiten.
const MAX_SEARCH_OFFSET: u32 = 9_900;
const MAX_SEARCH_TOTAL: u64 = 10_000;
const MAX_QUERY_LEN: usize = 256;

/// Die Nummer eines Projekts oder einer Datei bei CurseForge.
pub(super) fn parse_cf_id(id: &str) -> AppResult<u32> {
    id.parse().map_err(|_| AppError::invalid("Ungültige CurseForge-Nummer"))
}

pub async fn search(client: &reqwest::Client, request: &SearchQuery) -> AppResult<SearchResponse> {
    request.ensure_within(MAX_QUERY_LEN, MAX_SEARCH_OFFSET)?;
    let mut params = vec![
        ("gameId", GAME_MINECRAFT.to_string()),
        ("classId", class_of(request.project_type)?.to_string()),
        ("searchFilter", request.query.trim().to_string()),
        ("sortField", sort_field(request.sort()).to_string()),
        ("sortOrder", "desc".into()),
        ("index", request.offset.to_string()),
        ("pageSize", PAGE_SIZE.to_string()),
    ];
    params.extend(filter_params(request.mc.as_deref(), request.loader.as_deref())?);
    let page: Page<CfMod> = get(client, "mods/search", &params).await?;
    let total = page.pagination.map_or(page.data.len() as u64, |p| p.total_count).min(MAX_SEARCH_TOTAL);
    Ok(SearchResponse { hits: page.data.iter().map(hit).collect(), total_hits: total, offset: request.offset, limit: PAGE_SIZE })
}

/// Einschränkung auf Minecraft-Version und Loader, wie die API sie als Abfrageparameter kennt.
fn filter_params(mc: Option<&str>, loader: Option<&str>) -> AppResult<Vec<(&'static str, String)>> {
    let mut params = Vec::new();
    if let Some(mc) = mc {
        identifier(mc)?;
        params.push(("gameVersion", mc.to_string()));
    }
    if let Some(loader_type) = loader.and_then(loader_type_of) {
        params.push(("modLoaderType", loader_type.to_string()));
    }
    Ok(params)
}

pub async fn project(client: &reqwest::Client, id: &str) -> AppResult<Project> {
    let id = parse_cf_id(id)?;
    let m = mod_of(client, id).await?;
    // Die Beschreibung ist HTML und kommt extra; ohne sie bleibt die Kurzfassung.
    let body = get::<One<String>>(client, &format!("mods/{id}/description"), &[]).await.map(|d| d.data).unwrap_or_default();
    Ok(Project {
        id: m.id.to_string(),
        slug: m.slug.clone(),
        title: m.name.clone(),
        description: m.summary.clone(),
        body: if body.is_empty() { m.summary.clone() } else { body },
        icon_url: hit(&m).icon_url,
        project_type: kind_name(m.class_id).into(),
        client_side: "optional".into(),
        server_side: "optional".into(),
        web_url: m.website(),
    })
}

pub async fn versions(client: &reqwest::Client, id: &str, filter: &VersionFilter) -> AppResult<Vec<Version>> {
    let id = parse_cf_id(id)?;
    let mut params = vec![("pageSize", FILES_PAGE_SIZE.to_string())];
    params.extend(filter_params(filter.mc.as_deref(), filter.loader.as_deref())?);
    let page: Page<CfFile> = get(client, &format!("mods/{id}/files"), &params).await?;
    let mut files = page.data;
    files.sort_by(|a, b| b.file_date.cmp(&a.file_date));
    Ok(files.iter().map(version).collect())
}

fn hit(m: &CfMod) -> Hit {
    Hit {
        project_id: m.id.to_string(),
        slug: m.slug.clone(),
        title: m.name.clone(),
        description: m.summary.clone(),
        icon_url: m.logo.as_ref().map(|l| if l.thumbnail_url.is_empty() { l.url.clone() } else { l.thumbnail_url.clone() }).filter(|u| u.starts_with("https://")),
        project_type: kind_name(m.class_id).into(),
        downloads: m.download_count.max(0.0) as u64,
        author: m.authors.first().map(|a| a.name.clone()).unwrap_or_default(),
        categories: m.categories.iter().map(|c| c.name.to_lowercase()).collect(),
    }
}

fn version(f: &CfFile) -> Version {
    let name = f.title().to_string();
    Version {
        id: f.id.to_string(),
        project_id: f.mod_id.to_string(),
        name: name.clone(),
        version_number: name,
        game_versions: f.minecraft_versions(),
        loaders: f.loaders(),
        version_type: f.release_kind().into(),
        date_published: f.file_date.clone(),
        files: vec![File {
            hashes: f.sha1().map(|h| BTreeMap::from([("sha1".to_string(), h)])).unwrap_or_default(),
            // Leer = die Autoren erlauben den Download nur über die Webseite.
            url: f.download_url.clone().unwrap_or_default(),
            filename: f.file_name.clone(),
            primary: true,
            size: f.file_length,
        }],
        dependencies: f
            .dependency_kinds()
            .map(|(project_id, kind)| Dependency {
                version_id: None,
                project_id: Some(project_id.to_string()),
                file_name: None,
                dependency_type: kind.into(),
            })
            .collect(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{models::ModLoader, services::modrinth::client};
    use crate::services::providers::ProjectType;
    use dto::fixtures::jei;

    #[test]
    fn file_maps_to_the_shared_version_shape() {
        let v = version(&jei());
        assert_eq!((v.id.as_str(), v.project_id.as_str(), v.version_type.as_str()), ("9019497", "238222", "beta"));
        assert_eq!((v.loaders.as_slice(), v.game_versions.as_slice()), (&["neoforge".to_string()][..], &["26.3".to_string()][..]));
        assert_eq!(v.files[0].hashes["sha1"], "abcdef0123456789abcdef0123456789abcdef01");
        let kinds: Vec<_> = v.dependencies.iter().map(|d| (d.project_id.clone().unwrap(), d.dependency_type.clone())).collect();
        assert_eq!(kinds, [("1".to_string(), "required".to_string()), ("2".into(), "optional".into()), ("3".into(), "incompatible".into())]);
    }

    #[test]
    fn blocked_files_are_listed_without_a_download_url() {
        let mut f = jei();
        f.download_url = None;
        assert_eq!(version(&f).files[0].url, "");
    }

    #[test]
    fn search_ids_must_be_numbers() {
        assert_eq!(parse_cf_id("238222").unwrap(), 238222);
        for bad in ["", "mc-mods/jei", "-1", "1e3", "99999999999"] {
            assert!(parse_cf_id(bad).is_err(), "{bad}");
        }
    }

    #[test]
    fn filters_become_query_parameters() {
        assert_eq!(filter_params(Some("1.20.1"), Some("fabric")).unwrap(), [("gameVersion", "1.20.1".to_string()), ("modLoaderType", "4".to_string())]);
        assert!(filter_params(None, Some("vanilla")).unwrap().is_empty());
        assert!(filter_params(Some("../x"), None).is_err());
    }

    /// Über den Worker, ohne Schlüssel im Launcher:
    /// `cargo test live_curseforge -- --ignored --nocapture`.
    #[tokio::test]
    #[ignore = "braucht Netzwerk und den Worker"]
    async fn live_curseforge_catalog() {
        let client = client().unwrap();
        let forge_1_20_1 = SearchQuery {
            mc: Some("1.20.1".into()),
            loader: Some(ModLoader::Forge.name().into()),
            ..SearchQuery::of("jei", ProjectType::Mod)
        };
        let mods = search(&client, &forge_1_20_1).await.unwrap();
        assert!(mods.total_hits > 0, "keine Treffer");
        let jei = mods.hits.iter().find(|h| h.slug == "jei").expect("JEI fehlt");
        let p = project(&client, &jei.project_id).await.unwrap();
        assert!(p.body.len() > 100 && p.web_url.is_some(), "Beschreibung/Seite fehlen");
        let filter = VersionFilter { mc: Some("1.20.1".into()), loader: Some("forge".into()) };
        let v = versions(&client, &jei.project_id, &filter).await.unwrap();
        assert!(!v.is_empty() && v[0].loaders.contains(&"forge".to_string()) && v[0].game_versions.contains(&"1.20.1".to_string()));
        eprintln!("{} – {} Versionen, neueste {}", p.title, v.len(), v[0].version_number);
        let packs = search(&client, &SearchQuery::of("all the mods", ProjectType::Modpack)).await.unwrap();
        assert!(packs.hits.iter().any(|h| h.project_type == "modpack"));
        for kind in [ProjectType::Shader, ProjectType::ResourcePack] {
            assert!(search(&client, &SearchQuery::of("", kind)).await.unwrap().total_hits > 0, "{kind:?}");
        }
    }
}
