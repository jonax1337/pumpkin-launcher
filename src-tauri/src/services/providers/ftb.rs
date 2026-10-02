//! FTB: öffentliche API ohne Schlüssel. Das Verzeichnis ist klein (rund 100 Packs) und wird einmal
//! geladen, zwischengespeichert und lokal durchsucht. Installation über die Dateiliste einer Version.
use super::{cdn::check_url, json, segment, PackRequest, ProjectType, RemoteFile, SearchQuery, SortIndex};
use crate::{
    coded,
    error::{AppError, AppResult},
    models::{instance_name, Instance, ModLoader, NewInstance},
    services::{
        content::{self, Pack},
        forge,
        limits::{CATALOG_CONCURRENCY, PAGE_SIZE, QUERY_MAX},
        modrinth::{identifier, Hit, Project, SearchResponse, Version},
    },
};
use futures::StreamExt;
use serde::Deserialize;
use std::{
    collections::BTreeMap,
    sync::Arc,
    time::{Duration, Instant},
};
use tokio::sync::Mutex;

const API: &str = "https://api.feed-the-beast.com/v1/modpacks/public";
const MAX_SEARCH_OFFSET: u32 = 100_000;
const TTL: Duration = Duration::from_secs(15 * 60);

#[derive(Debug, Clone, Deserialize)]
struct PackDoc {
    id: u64,
    name: String,
    slug: String,
    #[serde(default)]
    description: String,
    #[serde(default)]
    synopsis: String,
    #[serde(default)]
    released: u64,
    #[serde(default)]
    updated: u64,
    #[serde(default)]
    private: bool,
    #[serde(default)]
    installs: u64,
    #[serde(default)]
    plays: u64,
    #[serde(default)]
    tags: Vec<Tag>,
    #[serde(default)]
    art: Vec<Art>,
    #[serde(default)]
    authors: Vec<Author>,
    #[serde(default)]
    versions: Vec<VersionDoc>,
}
#[derive(Debug, Clone, Deserialize)]
struct Tag {
    name: String,
}
#[derive(Debug, Clone, Deserialize)]
struct Art {
    url: String,
    #[serde(rename = "type", default)]
    kind: String,
}
#[derive(Debug, Clone, Deserialize)]
struct Author {
    name: String,
}
#[derive(Debug, Clone, Deserialize)]
struct VersionDoc {
    id: u64,
    name: String,
    #[serde(rename = "type", default)]
    kind: String,
    #[serde(default)]
    released: u64,
    #[serde(default)]
    private: bool,
    #[serde(default)]
    targets: Vec<Target>,
}
#[derive(Debug, Clone, Deserialize)]
struct Target {
    name: String,
    version: String,
    #[serde(rename = "type", default)]
    kind: String,
}
#[derive(Deserialize)]
struct Ids {
    packs: Vec<u64>,
}
#[derive(Deserialize)]
struct VersionFiles {
    #[serde(default)]
    files: Vec<FileDoc>,
}
#[derive(Deserialize)]
struct FileDoc {
    name: String,
    #[serde(default)]
    path: String,
    #[serde(default)]
    url: String,
    #[serde(default)]
    mirrors: Vec<String>,
    #[serde(default)]
    sha1: String,
    #[serde(default)]
    hashes: Hashes,
    #[serde(default)]
    size: u64,
    #[serde(default)]
    serveronly: bool,
}
#[derive(Deserialize, Default)]
struct Hashes {
    #[serde(default)]
    sha1: String,
    #[serde(default)]
    sha256: String,
    #[serde(default)]
    sha512: String,
}

/// Was Pumpkin Launcher aus einer Pack-Version starten kann.
#[derive(Debug, Clone, PartialEq, Eq)]
struct Supported {
    mc: String,
    loader: ModLoader,
    loader_version: Option<String>,
}

fn supported(v: &VersionDoc) -> Option<Supported> {
    let mc = v.targets.iter().find(|t| t.kind == "game" && t.name == "minecraft")?.version.clone();
    identifier(&mc).ok()?;
    let (loader, loader_version) = match v.targets.iter().find(|t| t.kind == "modloader") {
        None => (ModLoader::Vanilla, None),
        Some(t) => {
            identifier(&t.version).ok()?;
            let loader = ModLoader::from_modded_name(&t.name)?;
            (loader, Some(t.version.clone()))
        }
    };
    forge::check_loader(loader, &mc).ok()?;
    Some(Supported { mc, loader, loader_version })
}

/// Sichtbare, startbare Versionen, neueste zuerst; Archiviertes bleibt draußen.
fn usable(pack: &PackDoc) -> Vec<(&VersionDoc, Supported)> {
    let mut list: Vec<_> = pack
        .versions
        .iter()
        .filter(|v| !v.private && matches!(v.kind.as_str(), "release" | "beta" | "alpha"))
        .filter_map(|v| supported(v).map(|s| (v, s)))
        .collect();
    list.sort_by(|a, b| b.0.released.cmp(&a.0.released).then(b.0.id.cmp(&a.0.id)));
    list
}

static CACHE: Mutex<Option<(Instant, Arc<Vec<PackDoc>>)>> = Mutex::const_new(None);

async fn catalog(client: &reqwest::Client) -> AppResult<Arc<Vec<PackDoc>>> {
    let mut cache = CACHE.lock().await;
    if let Some((at, packs)) = cache.as_ref() {
        if at.elapsed() < TTL {
            return Ok(packs.clone());
        }
    }
    let ids: Ids = json(client, &format!("{API}/modpack/all")).await?;
    let results: Vec<AppResult<PackDoc>> = futures::stream::iter(ids.packs)
        .map(|id| async move { json::<PackDoc>(client, &format!("{API}/modpack/{id}")).await })
        .buffer_unordered(CATALOG_CONCURRENCY)
        .collect()
        .await;
    let mut packs = Vec::new();
    let mut failed = None;
    for r in results {
        match r {
            Ok(p) if !p.private => packs.push(p),
            Ok(_) => {}
            Err(err) => {
                tracing::warn!(%err, "FTB-Modpack nicht geladen");
                failed = Some(err);
            }
        }
    }
    if packs.is_empty() {
        return Err(failed.unwrap_or_else(|| AppError::invalid(coded!("errors.providers.noFtbModpacks"))));
    }
    let packs = Arc::new(packs);
    *cache = Some((Instant::now(), packs.clone()));
    Ok(packs)
}

fn icon(pack: &PackDoc) -> Option<String> {
    pack.art.iter().find(|a| a.kind == "square").or(pack.art.first()).map(|a| a.url.clone())
}

fn hit(pack: &PackDoc) -> Hit {
    Hit {
        project_id: pack.id.to_string(),
        slug: pack.slug.clone(),
        title: pack.name.clone(),
        description: pack.synopsis.clone(),
        icon_url: icon(pack),
        project_type: "modpack".into(),
        downloads: pack.installs,
        author: pack.authors.first().map_or_else(|| "FTB".into(), |a| a.name.clone()),
        categories: pack
            .tags
            .iter()
            .filter(|t| !t.name.starts_with(|c: char| c.is_ascii_digit()))
            .map(|t| t.name.to_lowercase())
            .collect(),
    }
}

/// 3 = Name beginnt so, 2 = Name enthält es, 1 = Kurztext oder Schlagwort, 0 = kein Treffer.
fn relevance(pack: &PackDoc, query: &str) -> u8 {
    let q = query.to_lowercase();
    let name = pack.name.to_lowercase();
    if name.starts_with(&q) {
        3
    } else if name.contains(&q) {
        2
    } else if pack.synopsis.to_lowercase().contains(&q) || pack.tags.iter().any(|t| t.name.to_lowercase().contains(&q)) {
        1
    } else {
        0
    }
}

pub async fn search(client: &reqwest::Client, request: &SearchQuery) -> AppResult<SearchResponse> {
    request.ensure_within(QUERY_MAX, MAX_SEARCH_OFFSET)?;
    let offset = request.offset;
    if request.project_type != ProjectType::Modpack {
        return Ok(SearchResponse { hits: Vec::new(), total_hits: 0, offset, limit: PAGE_SIZE });
    }
    let packs = catalog(client).await?;
    let query = request.query.trim();
    let (mc, loader) = (request.mc.as_deref(), request.loader.as_deref());
    let mut found: Vec<(&PackDoc, u8)> = packs
        .iter()
        .filter(|p| {
            let versions = usable(p);
            !versions.is_empty()
                && mc.is_none_or(|mc| versions.iter().any(|(_, s)| s.mc == mc))
                && loader.is_none_or(|l| versions.iter().any(|(_, s)| s.loader.name() == l))
        })
        .map(|p| (p, if query.is_empty() { 1 } else { relevance(p, query) }))
        .filter(|(_, score)| *score > 0)
        .collect();
    match request.sort() {
        SortIndex::Downloads => found.sort_by_key(|(p, _)| std::cmp::Reverse(p.installs)),
        SortIndex::Follows => found.sort_by_key(|(p, _)| std::cmp::Reverse(p.plays)),
        SortIndex::Newest => found.sort_by_key(|(p, _)| std::cmp::Reverse(p.released)),
        SortIndex::Updated => found.sort_by_key(|(p, _)| std::cmp::Reverse(p.updated)),
        SortIndex::Relevance => found.sort_by_key(|(p, score)| (std::cmp::Reverse(*score), std::cmp::Reverse(p.installs))),
    }
    let total = found.len() as u64;
    let hits = found.into_iter().skip(offset as usize).take(PAGE_SIZE as usize).map(|(p, _)| hit(p)).collect();
    Ok(SearchResponse { hits, total_hits: total, offset, limit: PAGE_SIZE })
}

async fn find(client: &reqwest::Client, id: &str) -> AppResult<PackDoc> {
    segment(id)?;
    let packs = catalog(client).await?;
    packs
        .iter()
        .find(|p| p.id.to_string() == id)
        .cloned()
        .ok_or_else(|| AppError::invalid(coded!("errors.providers.ftbModpackNotFound")))
}

pub async fn project(client: &reqwest::Client, id: &str) -> AppResult<Project> {
    let pack = find(client, id).await?;
    Ok(Project {
        id: pack.id.to_string(),
        slug: pack.slug.clone(),
        title: pack.name.clone(),
        description: pack.synopsis.clone(),
        body: pack.description.clone(),
        icon_url: icon(&pack),
        project_type: "modpack".into(),
        client_side: "optional".into(),
        server_side: "optional".into(),
        web_url: None,
        ..Project::default()
    })
}

pub async fn versions(client: &reqwest::Client, id: &str) -> AppResult<Vec<Version>> {
    let pack = find(client, id).await?;
    Ok(usable(&pack)
        .into_iter()
        .map(|(v, s)| Version {
            id: v.id.to_string(),
            project_id: pack.id.to_string(),
            name: v.name.clone(),
            version_number: v.name.clone(),
            game_versions: vec![s.mc],
            loaders: vec![s.loader.name().into()],
            version_type: v.kind.clone(),
            date_published: String::new(),
            changelog: None,
            files: Vec::new(),
            dependencies: Vec::new(),
        })
        .collect())
}

/// Änderungsprotokoll einer Pack-Version (Markdown); `None`, wenn FTB keins führt.
pub async fn changelog(client: &reqwest::Client, pack_id: &str, version_id: &str) -> AppResult<Option<String>> {
    #[derive(Deserialize)]
    struct Notes {
        #[serde(default)]
        content: String,
    }
    let url = format!("{API}/modpack/{}/{}/changelog", segment(pack_id)?, segment(version_id)?);
    let notes: Notes = json(client, &url).await?;
    Ok(Some(notes.content).filter(|text| !text.trim().is_empty()))
}

/// `./mods/` + `a.jar` -> `mods/a.jar`; Prüfung auf unsichere Pfade übernimmt `plan_pack`.
fn target(dir: &str, name: &str) -> String {
    let dir = dir.trim_start_matches("./").trim_matches('/');
    if dir.is_empty() { name.to_string() } else { format!("{dir}/{name}") }
}

fn remote(doc: &FileDoc) -> AppResult<RemoteFile> {
    // Eigene Spiegel zuerst: was FTB selbst hostet, muss nicht über das CurseForge-CDN.
    let mut urls: Vec<String> = std::iter::once(doc.url.clone()).chain(doc.mirrors.iter().cloned()).filter(|u| !u.is_empty()).collect();
    urls.sort_by_key(|u| !u.contains("feed-the-beast.com"));
    urls.dedup();
    for u in &urls {
        check_url(&reqwest::Url::parse(u).map_err(|e| AppError::invalid(e.to_string()))?)?;
    }
    let mut hashes = BTreeMap::new();
    for (key, value, len) in [
        ("sha1", if doc.hashes.sha1.is_empty() { &doc.sha1 } else { &doc.hashes.sha1 }, 40),
        ("sha256", &doc.hashes.sha256, 64),
        ("sha512", &doc.hashes.sha512, 128),
    ] {
        if value.len() == len && value.bytes().all(|b| b.is_ascii_hexdigit()) {
            hashes.insert(key, value.to_ascii_lowercase());
        }
    }
    if hashes.is_empty() {
        return Err(AppError::invalid(coded!("errors.providers.namedFileWithoutChecksum", name = doc.name)));
    }
    Ok(RemoteFile { urls, size: doc.size, hashes })
}

/// Pack-Version als Installationsplan: Instanz mit Loader und Dateiliste, serverseitige Dateien entfallen.
pub(crate) async fn plan(client: &reqwest::Client, request: &PackRequest) -> AppResult<Pack> {
    let PackRequest { project_id: pack_id, version_id, name, .. } = request;
    segment(version_id)?;
    let name = instance_name(name)?;
    let pack = find(client, pack_id).await?;
    let (_, s) = usable(&pack)
        .into_iter()
        .find(|(v, _)| &v.id.to_string() == version_id)
        .ok_or_else(|| AppError::invalid(coded!("errors.providers.versionNotLaunchable")))?;
    let listing: VersionFiles = json(client, &format!("{API}/modpack/{pack_id}/{version_id}")).await?;
    let files = listing
        .files
        .iter()
        .filter(|f| !f.serveronly)
        .map(|f| Ok((target(&f.path, &f.name), remote(f)?)))
        .collect::<AppResult<Vec<_>>>()?;
    let instance = Instance::from_new(NewInstance {
        name: name.into(),
        minecraft_version: s.mc,
        loader: s.loader,
        loader_version: s.loader_version,
    });
    content::plan_pack(instance, files)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn version(kind: &str, targets: &[(&str, &str, &str)]) -> VersionDoc {
        serde_json::from_value(json!({
            "id": 7, "name": "1.0", "type": kind, "released": 5, "private": false,
            "targets": targets.iter().map(|(t, n, v)| json!({"type": t, "name": n, "version": v})).collect::<Vec<_>>()
        }))
        .unwrap()
    }
    fn pack(name: &str, installs: u64, versions: Vec<VersionDoc>) -> PackDoc {
        let mut p: PackDoc = serde_json::from_value(json!({
            "id": 1, "name": name, "slug": "s", "synopsis": "Tech und Magie", "installs": installs,
            "tags": [{"name": "Magic"}, {"name": "1.18.2"}],
            "art": [{"url": "https://cdn.feed-the-beast.com/a.png", "type": "splash"}, {"url": "https://cdn.feed-the-beast.com/b.png", "type": "square"}],
            "authors": [{"name": "FTB Team"}]
        }))
        .unwrap();
        p.versions = versions;
        p
    }

    /// Ganze Kette gegen die echte FTB-API: Suche, Versionen, Plan, Download mit Prüfsummen, Ablage, Erkennung.
    /// `cargo test live_ -- --ignored --nocapture`; lädt rund 170 MB.
    #[tokio::test]
    #[ignore = "braucht Netzwerk und lädt rund 170 MB"]
    async fn live_search_and_install() {
        use crate::{models::ModpackOrigin, services::providers::Source, state::AppState};
        let client = crate::services::modrinth::client().unwrap();
        let fabric = SearchQuery { loader: Some("fabric".into()), ..SearchQuery::of("unstable", ProjectType::Modpack) };
        let found = search(&client, &fabric).await.unwrap();
        assert!(found.hits.iter().any(|h| h.project_id == "109"), "FTB Unstable 1.20: Fabric fehlt in der Suche");
        let all = versions(&client, "109").await.unwrap();
        assert!(all.iter().any(|v| v.id == "6571" && v.loaders == ["fabric"] && v.game_versions == ["1.20.1"]));
        let root = std::env::temp_dir().join(crate::models::new_id());
        let state = AppState::load(&root).unwrap();
        let request = PackRequest { source: Source::Ftb, project_id: "109".into(), version_id: "6571".into(), name: "Live-Test".into() };
        let pack = plan(&client, &request).await.unwrap();
        let origin = Some(ModpackOrigin::Provider { source: "ftb".into(), project_id: "109".into(), version_id: "6571".into() });
        let last = std::sync::atomic::AtomicU64::new(0);
        let instance = content::import_plan(&state, pack, origin, &|phase, done, total| {
            if done / 25 != last.swap(done / 25, std::sync::atomic::Ordering::Relaxed) {
                eprintln!("{phase:?}: {done}/{total}");
            }
        })
        .await
        .unwrap();
        let mods = state.dirs.game_dir(&instance.id).join("mods");
        let jars = std::fs::read_dir(&mods).unwrap().filter(|e| e.as_ref().unwrap().file_name().to_string_lossy().ends_with(".jar")).count();
        eprintln!("Mods: {} erfasst, {jars} JARs, Loader {:?} {:?}", instance.mods.len(), instance.loader, instance.loader_version);
        assert_eq!((instance.loader, instance.minecraft_version.as_str()), (ModLoader::Fabric, "1.20.1"));
        assert!(jars > 20 && instance.mods.len() == jars);
        assert!(matches!(instance.modpack, Some(ModpackOrigin::Provider { .. })));
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn loader_and_minecraft_come_from_the_targets() {
        let s = supported(&version("release", &[("game", "minecraft", "1.21.1"), ("modloader", "neoforge", "21.1.172"), ("runtime", "java", "21")])).unwrap();
        assert_eq!((s.mc.as_str(), s.loader, s.loader_version.as_deref()), ("1.21.1", ModLoader::NeoForge, Some("21.1.172")));
        let fabric = supported(&version("release", &[("game", "minecraft", "1.20.1"), ("modloader", "fabric", "0.16.10")])).unwrap();
        assert_eq!(fabric.loader, ModLoader::Fabric);
        let vanilla = supported(&version("release", &[("game", "minecraft", "1.21.1")])).unwrap();
        assert_eq!((vanilla.loader, vanilla.loader_version), (ModLoader::Vanilla, None));
    }

    #[test]
    fn unsupported_versions_are_hidden() {
        // Forge vor 1.17 und unbekannte Loader kann Pumpkin Launcher nicht starten.
        assert!(supported(&version("release", &[("game", "minecraft", "1.12.2"), ("modloader", "forge", "14.23.5.2858")])).is_none());
        assert!(supported(&version("release", &[("game", "minecraft", "1.21.1"), ("modloader", "liteloader", "1")])).is_none());
        assert!(supported(&version("release", &[("modloader", "forge", "1")])).is_none());
        assert!(supported(&version("release", &[("game", "minecraft", "../x")])).is_none());
        let p = pack("Alt", 1, vec![version("archived", &[("game", "minecraft", "1.21.1")]), version("release", &[("game", "minecraft", "1.21.1")])]);
        assert_eq!(usable(&p).len(), 1);
    }

    #[test]
    fn hit_shows_square_art_and_drops_version_tags() {
        let h = hit(&pack("FTB Skies", 10, vec![]));
        assert_eq!(h.icon_url.as_deref(), Some("https://cdn.feed-the-beast.com/b.png"));
        assert_eq!((h.author.as_str(), h.categories.as_slice(), h.downloads), ("FTB Team", &["magic".to_string()][..], 10));
    }

    #[test]
    fn relevance_prefers_name_over_text() {
        let p = pack("FTB Skies", 1, vec![]);
        assert_eq!((relevance(&p, "ftb"), relevance(&p, "ski"), relevance(&p, "magie"), relevance(&p, "xyz")), (3, 2, 1, 0));
    }

    #[test]
    fn target_paths_are_relative_to_the_game_folder() {
        assert_eq!(target("./mods/", "a.jar"), "mods/a.jar");
        assert_eq!(target("./", "options.txt"), "options.txt");
        assert_eq!(target("./config/ftb/", "x.toml"), "config/ftb/x.toml");
    }

    #[test]
    fn files_prefer_own_mirrors_and_need_a_hash() {
        let sha1 = "b122fce8159ea2bedc45a039c622971c15e206d6";
        let doc = |v: serde_json::Value| -> AppResult<RemoteFile> { remote(&serde_json::from_value(v).unwrap()) };
        let f = doc(json!({
            "name": "a.jar", "path": "./mods/", "size": 3, "sha1": sha1,
            "url": "https://edge.forgecdn.net/files/4013/966/a.jar",
            "mirrors": ["https://files.feed-the-beast.com/blob/de/de90.jar"]
        }))
        .unwrap();
        assert_eq!(f.urls[0], "https://files.feed-the-beast.com/blob/de/de90.jar");
        assert_eq!(f.hashes["sha1"], sha1);
        assert!(doc(json!({"name": "a.jar", "url": "https://files.feed-the-beast.com/x"})).is_err());
        assert!(doc(json!({"name": "a.jar", "sha1": sha1, "url": "https://evil.example/x"})).is_err());
    }
}
