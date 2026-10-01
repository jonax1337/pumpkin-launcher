//! CurseForge über einen eigenen Proxy (Cloudflare Worker, siehe `proxy/`), der den API-Schlüssel hält. Der Launcher
//! kennt keinen Schlüssel: Alle Abfragen gehen an den Worker, nur die Dateien selbst kommen direkt vom CurseForge-CDN.
//! Damit geht alles im Launcher: Suche, Mods mit Abhängigkeiten, Modpacks (auch sehr große). Mods, deren Autoren Downloads
//! außerhalb von CurseForge verbieten (`downloadUrl` fehlt), werden nicht umgangen, sondern als „manuell laden“ gemeldet
//! (`Blocked`).
use super::{zip_files, RemoteFile, JSON_LIMIT, MIB, ZIP_LIMIT};
use crate::{
    error::AppResult,
    models::{Instance, Mod, ModKind, ModLoader, ModSource, NewInstance},
    services::{
        content::{self, Blob, Pack, TempFile},
        forge,
        modrinth::{self, identifier, invalid, Dependency, File, Hit, Project, SearchResponse, Version},
        Dirs,
    },
    state::AppState,
};
use serde::{de::DeserializeOwned, Deserialize, Serialize};
use std::{
    collections::{BTreeMap, HashMap, HashSet, VecDeque},
    fs,
    io::Read,
    path::PathBuf,
    sync::{Arc, Mutex},
};

/// Der Worker dieses Projekts. Die Adresse ist kein Geheimnis (der Schlüssel liegt nur bei Cloudflare); Forks und Tests
/// können einen eigenen über `PUMPKIN_CF_PROXY` (Laufzeit) oder beim Bauen angeben.
const DEFAULT_PROXY: &str = "https://pumpkin-curseforge.jonas-laux.workers.dev";
const GAME_MINECRAFT: u32 = 432;
const PAGE: u32 = 20;
const MAX_DEPENDENCIES: usize = 64;

// ---------- Proxy ----------

/// Adresse des Proxys ohne Schrägstrich am Ende; ein ungültig gesetzter Wert fällt auf den Standard zurück.
pub fn proxy() -> String {
    std::env::var("PUMPKIN_CF_PROXY")
        .ok()
        .or_else(|| option_env!("PUMPKIN_CF_PROXY").map(str::to_string))
        .and_then(|raw| parse_proxy(&raw))
        .unwrap_or_else(|| DEFAULT_PROXY.to_string())
}
/// Nur eine https-Adresse ohne Zugangsdaten, Pfad, Suchteil und Anker; sonst würde ein falsch gesetzter Wert alles dorthin leiten.
fn parse_proxy(raw: &str) -> Option<String> {
    let url = reqwest::Url::parse(raw.trim()).ok()?;
    let plain = url.scheme() == "https"
        && url.username().is_empty()
        && url.password().is_none()
        && url.host_str().is_some()
        && matches!(url.path(), "" | "/")
        && url.query().is_none()
        && url.fragment().is_none();
    plain.then(|| url.as_str().trim_end_matches('/').to_string())
}

// ---------- Anfragen ----------

async fn send<T: DeserializeOwned>(request: reqwest::RequestBuilder) -> AppResult<T> {
    let response = request.header(reqwest::header::ACCEPT, "application/json").send().await?;
    let status = response.status();
    if matches!(status.as_u16(), 401 | 403) {
        return Err(invalid("Der CurseForge-Dienst lehnt die Anfrage ab"));
    }
    if status.as_u16() == 404 {
        return Err(invalid("Bei CurseForge nicht gefunden"));
    }
    if status.as_u16() == 429 {
        return Err(invalid("Zu viele Anfragen an CurseForge, bitte kurz warten"));
    }
    let mut response = response.error_for_status()?;
    let mut data = Vec::new();
    while let Some(chunk) = response.chunk().await? {
        if data.len() as u64 + chunk.len() as u64 > JSON_LIMIT {
            return Err(invalid("Antwort zu groß"));
        }
        data.extend_from_slice(&chunk);
    }
    Ok(serde_json::from_slice(&data)?)
}
async fn get<T: DeserializeOwned>(client: &reqwest::Client, path: &str, query: &[(&str, String)]) -> AppResult<T> {
    get_at(client, &proxy(), path, query).await
}
async fn post<T: DeserializeOwned>(client: &reqwest::Client, path: &str, body: &serde_json::Value) -> AppResult<T> {
    post_at(client, &proxy(), path, body).await
}
async fn get_at<T: DeserializeOwned>(client: &reqwest::Client, proxy: &str, path: &str, query: &[(&str, String)]) -> AppResult<T> {
    let mut url = reqwest::Url::parse(&format!("{proxy}/v1/{path}")).map_err(|e| invalid(e.to_string()))?;
    url.query_pairs_mut().extend_pairs(query.iter().map(|(k, v)| (*k, v.as_str())));
    send(client.get(url)).await
}
async fn post_at<T: DeserializeOwned>(client: &reqwest::Client, proxy: &str, path: &str, body: &serde_json::Value) -> AppResult<T> {
    send(client.post(format!("{proxy}/v1/{path}")).json(body)).await
}

// ---------- Datenformen der API ----------

#[derive(Debug, Clone, Deserialize)]
struct One<T> {
    data: T,
}
#[derive(Debug, Clone, Deserialize)]
struct Page<T> {
    data: Vec<T>,
    #[serde(default)]
    pagination: Option<Pagination>,
}
#[derive(Debug, Clone, Deserialize)]
struct Pagination {
    #[serde(rename = "totalCount", default)]
    total_count: u64,
}
#[derive(Debug, Clone, Deserialize)]
struct CfMod {
    id: u64,
    #[serde(default)]
    slug: String,
    #[serde(default)]
    name: String,
    #[serde(default)]
    summary: String,
    #[serde(rename = "downloadCount", default)]
    download_count: f64,
    #[serde(default)]
    logo: Option<Logo>,
    #[serde(default)]
    authors: Vec<Named>,
    #[serde(default)]
    categories: Vec<Named>,
    #[serde(rename = "classId", default)]
    class_id: Option<u32>,
    #[serde(default)]
    links: Option<Links>,
}
#[derive(Debug, Clone, Deserialize)]
struct Logo {
    #[serde(default)]
    url: String,
    #[serde(rename = "thumbnailUrl", default)]
    thumbnail_url: String,
}
#[derive(Debug, Clone, Deserialize)]
struct Named {
    #[serde(default)]
    name: String,
}
#[derive(Debug, Clone, Deserialize)]
struct Links {
    #[serde(rename = "websiteUrl", default)]
    website_url: String,
}
#[derive(Debug, Clone, Deserialize)]
struct CfFile {
    id: u64,
    #[serde(rename = "modId", default)]
    mod_id: u64,
    #[serde(rename = "displayName", default)]
    display_name: String,
    #[serde(rename = "fileName", default)]
    file_name: String,
    #[serde(rename = "releaseType", default)]
    release_type: u8,
    #[serde(rename = "fileDate", default)]
    file_date: String,
    #[serde(rename = "fileLength", default)]
    file_length: u64,
    #[serde(rename = "downloadUrl", default)]
    download_url: Option<String>,
    #[serde(rename = "gameVersions", default)]
    game_versions: Vec<String>,
    #[serde(default)]
    hashes: Vec<HashDoc>,
    #[serde(default)]
    dependencies: Vec<DepDoc>,
}
#[derive(Debug, Clone, Deserialize)]
struct HashDoc {
    value: String,
    algo: u8,
}
#[derive(Debug, Clone, Deserialize)]
struct DepDoc {
    #[serde(rename = "modId")]
    mod_id: u64,
    #[serde(rename = "relationType", default)]
    relation_type: u8,
}

const REQUIRED: u8 = 3;
const OPTIONAL: u8 = 2;
const INCOMPATIBLE: u8 = 5;

const CLASS_MOD: u32 = 6;
const CLASS_MODPACK: u32 = 4471;
const CLASS_RESOURCEPACK: u32 = 12;
const CLASS_SHADER: u32 = 6552;

fn class_of(kind: &str) -> AppResult<u32> {
    match kind {
        "mod" => Ok(CLASS_MOD),
        "modpack" => Ok(CLASS_MODPACK),
        "resourcepack" => Ok(CLASS_RESOURCEPACK),
        "shader" => Ok(CLASS_SHADER),
        _ => Err(invalid("Ungültige Suche")),
    }
}
fn kind_name(class_id: Option<u32>) -> &'static str {
    match class_id {
        Some(CLASS_MODPACK) => "modpack",
        Some(CLASS_RESOURCEPACK) => "resourcepack",
        Some(CLASS_SHADER) => "shader",
        _ => "mod",
    }
}
/// Inhaltsart einer Mod-Datei für die Instanz; Modpacks und Sonstiges sind hier keine.
fn mod_kind(class_id: Option<u32>) -> AppResult<ModKind> {
    match class_id {
        Some(CLASS_MOD) => Ok(ModKind::Mod),
        Some(CLASS_RESOURCEPACK) => Ok(ModKind::ResourcePack),
        Some(CLASS_SHADER) => Ok(ModKind::Shader),
        _ => Err(invalid("Das ist keine Mod, kein Ressourcenpaket und kein Shader")),
    }
}
/// CurseForge-Nummer des Loaders; Vanilla hat keine.
fn loader_type(loader: ModLoader) -> Option<u8> {
    match loader {
        ModLoader::Forge => Some(1),
        ModLoader::Fabric => Some(4),
        ModLoader::Quilt => Some(5),
        ModLoader::NeoForge => Some(6),
        ModLoader::Vanilla => None,
    }
}
fn loader_type_of(name: &str) -> Option<u8> {
    match name {
        "forge" => Some(1),
        "fabric" => Some(4),
        "quilt" => Some(5),
        "neoforge" => Some(6),
        _ => None,
    }
}

/// Loader-Namen einer Datei (Schreibweise wie bei Modrinth).
fn file_loaders(file: &CfFile) -> Vec<String> {
    file.game_versions
        .iter()
        .map(|v| v.to_ascii_lowercase())
        .filter(|v| matches!(v.as_str(), "forge" | "fabric" | "neoforge" | "quilt"))
        .collect()
}
fn file_minecraft(file: &CfFile) -> Vec<String> {
    file.game_versions.iter().filter(|v| v.starts_with(|c: char| c.is_ascii_digit()) && v.contains('.')).cloned().collect()
}
fn sha1_of(file: &CfFile) -> Option<String> {
    file.hashes.iter().find(|h| h.algo == 1).map(|h| h.value.to_ascii_lowercase())
}
fn release(file: &CfFile) -> &'static str {
    match file.release_type {
        2 => "beta",
        3 => "alpha",
        _ => "release",
    }
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
    let name = if f.display_name.is_empty() { f.file_name.clone() } else { f.display_name.clone() };
    Version {
        id: f.id.to_string(),
        project_id: f.mod_id.to_string(),
        name: name.clone(),
        version_number: name,
        game_versions: file_minecraft(f),
        loaders: file_loaders(f),
        version_type: release(f).into(),
        date_published: f.file_date.clone(),
        files: vec![File {
            hashes: sha1_of(f).map(|h| BTreeMap::from([("sha1".to_string(), h)])).unwrap_or_default(),
            // Leer = die Autoren erlauben den Download nur über die Webseite.
            url: f.download_url.clone().unwrap_or_default(),
            filename: f.file_name.clone(),
            primary: true,
            size: f.file_length,
        }],
        dependencies: f
            .dependencies
            .iter()
            .filter_map(|d| {
                let kind = match d.relation_type {
                    REQUIRED => "required",
                    OPTIONAL => "optional",
                    INCOMPATIBLE => "incompatible",
                    _ => return None,
                };
                Some(Dependency { version_id: None, project_id: Some(d.mod_id.to_string()), file_name: None, dependency_type: kind.into() })
            })
            .collect(),
    }
}

fn number(id: &str) -> AppResult<u32> {
    id.parse().map_err(|_| invalid("Ungültige CurseForge-Nummer"))
}

// ---------- Katalog ----------

pub async fn search(
    client: &reqwest::Client,
    query: &str,
    kind: &str,
    mc: Option<&str>,
    loader: Option<&str>,
    offset: u32,
    index: Option<&str>,
) -> AppResult<SearchResponse> {
    if query.len() > 256 || offset > 9_900 {
        return Err(invalid("Ungültige Suche"));
    }
    // CurseForge: 1 Hervorgehoben, 2 Beliebtheit, 3 Zuletzt aktualisiert, 6 Downloads, 11 Veröffentlicht.
    let sort = match index {
        None if query.trim().is_empty() => 6,
        None | Some("relevance" | "follows") => 2,
        Some("downloads") => 6,
        Some("updated") => 3,
        Some("newest") => 11,
        Some(_) => return Err(invalid("Ungültige Sortierung")),
    };
    let mut q = vec![
        ("gameId", GAME_MINECRAFT.to_string()),
        ("classId", class_of(kind)?.to_string()),
        ("searchFilter", query.trim().to_string()),
        ("sortField", sort.to_string()),
        ("sortOrder", "desc".into()),
        ("index", offset.to_string()),
        ("pageSize", PAGE.to_string()),
    ];
    if let Some(mc) = mc {
        identifier(mc)?;
        q.push(("gameVersion", mc.into()));
    }
    if let Some(t) = loader.and_then(loader_type_of) {
        q.push(("modLoaderType", t.to_string()));
    }
    let page: Page<CfMod> = get(client, "mods/search", &q).await?;
    let total = page.pagination.map_or(page.data.len() as u64, |p| p.total_count).min(10_000);
    Ok(SearchResponse { hits: page.data.iter().map(hit).collect(), total_hits: total, offset, limit: PAGE })
}

async fn mod_of(client: &reqwest::Client, id: u32) -> AppResult<CfMod> {
    Ok(get::<One<CfMod>>(client, &format!("mods/{id}"), &[]).await?.data)
}
async fn file_of(client: &reqwest::Client, project: u32, file: u32) -> AppResult<CfFile> {
    let f = get::<One<CfFile>>(client, &format!("mods/{project}/files/{file}"), &[]).await?.data;
    if f.id != u64::from(file) || f.mod_id != u64::from(project) {
        return Err(invalid("Datei gehört nicht zu diesem Projekt"));
    }
    Ok(f)
}

pub async fn project(client: &reqwest::Client, id: &str) -> AppResult<Project> {
    let id = number(id)?;
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
        web_url: m.links.as_ref().map(|l| l.website_url.clone()).filter(|u| u.starts_with("https://www.curseforge.com/")),
    })
}

pub async fn versions(client: &reqwest::Client, id: &str, mc: Option<&str>, loader: Option<&str>) -> AppResult<Vec<Version>> {
    let id = number(id)?;
    let mut q = vec![("pageSize", "50".to_string())];
    if let Some(mc) = mc {
        identifier(mc)?;
        q.push(("gameVersion", mc.into()));
    }
    if let Some(t) = loader.and_then(loader_type_of) {
        q.push(("modLoaderType", t.to_string()));
    }
    let page: Page<CfFile> = get(client, &format!("mods/{id}/files"), &q).await?;
    let mut files = page.data;
    files.sort_by(|a, b| b.file_date.cmp(&a.file_date));
    Ok(files.iter().map(version).collect())
}

// ---------- Mods installieren ----------

/// Name ohne Sonderzeichen und Schreibweise, um dieselbe Mod bei Modrinth und CurseForge zu erkennen.
fn norm(name: &str) -> String {
    name.chars().filter(|c| c.is_alphanumeric()).flat_map(char::to_lowercase).collect()
}

/// Läuft die Datei in dieser Instanz? Minecraft-Version muss passen, bei Mods auch der Loader (Quilt lädt Fabric mit).
fn runs(instance: &Instance, kind: ModKind, file: &CfFile) -> bool {
    file.game_versions.iter().any(|v| v == &instance.minecraft_version)
        && (kind != ModKind::Mod || {
            let loaders = file_loaders(file);
            instance.loader.modrinth_loaders().iter().any(|l| loaders.iter().any(|f| f == l))
        })
}

/// Bevorzugt die neueste Release-Datei, die in der Instanz läuft.
async fn pick_file(client: &reqwest::Client, project: u64, instance: &Instance, kind: ModKind) -> AppResult<Option<CfFile>> {
    let mut types: Vec<Option<u8>> = vec![loader_type(instance.loader)];
    if instance.loader == ModLoader::Quilt {
        types.push(Some(4));
    }
    for t in types {
        let mut q = vec![("pageSize", "30".to_string()), ("gameVersion", instance.minecraft_version.clone())];
        if let (Some(t), ModKind::Mod) = (t, kind) {
            q.push(("modLoaderType", t.to_string()));
        }
        let page: Page<CfFile> = get(client, &format!("mods/{project}/files"), &q).await?;
        let mut files: Vec<CfFile> = page.data.into_iter().filter(|f| runs(instance, kind, f)).collect();
        files.sort_by(|a, b| b.file_date.cmp(&a.file_date));
        if let Some(f) = files.iter().find(|f| f.release_type == 1).or(files.first()) {
            return Ok(Some(f.clone()));
        }
    }
    Ok(None)
}

fn remote(file: &CfFile) -> AppResult<RemoteFile> {
    let url = file.download_url.clone().filter(|u| !u.is_empty()).ok_or_else(|| invalid("Die Autoren erlauben den Download nur über CurseForge"))?;
    let sha1 = sha1_of(file).ok_or_else(|| invalid("Datei ohne Prüfsumme"))?;
    Ok(RemoteFile { urls: vec![url], size: file.file_length, hashes: BTreeMap::from([("sha1", sha1)]) })
}

/// Trägt eine heruntergeladene, geprüfte Datei in die Instanz ein.
fn mod_entry(m: &CfMod, f: &CfFile, kind: ModKind, sha1: String, required_by: Vec<String>, existing: &[Mod]) -> Mod {
    let id = format!("cf-{}", m.id);
    Mod {
        // Zwei Dateien desselben Projekts behalten verschiedene IDs.
        id: if existing.iter().any(|x| x.id == id) { crate::models::new_id() } else { id },
        name: m.name.clone(),
        version: if f.display_name.is_empty() { f.file_name.clone() } else { f.display_name.clone() },
        source: ModSource::CurseForge { project_id: m.id as u32, file_id: f.id as u32 },
        file_name: f.file_name.clone(),
        sha1: Some(sha1),
        enabled: true,
        kind,
        required_by,
    }
}

fn check_file_name(name: &str, kind: ModKind) -> AppResult<()> {
    content::safe_path(name)?;
    if name.contains('/') || !name.ends_with(kind.extension()) {
        return Err(invalid(format!("Unerwarteter Dateiname {name}")));
    }
    Ok(())
}

/// Installiert eine Datei samt benötigten Abhängigkeiten (nur bei Mods) in eine Instanz.
pub async fn install_mod(
    state: &AppState,
    instance_id: &str,
    project_id: &str,
    file_id: &str,
    progress: &(dyn Fn(&str, u64, u64) + Send + Sync),
) -> AppResult<Instance> {
    let (project, file_no) = (number(project_id)?, number(file_id)?);
    let mut instance = state.instances.get(instance_id)?;
    let client = modrinth::client()?;
    progress("resolve", 0, 1);
    let root_mod = mod_of(&client, project).await?;
    let kind = mod_kind(root_mod.class_id)?;
    let root_file = file_of(&client, project, file_no).await?;
    if !runs(&instance, kind, &root_file) {
        return Err(invalid(format!("{} passt nicht zu dieser Instanz ({})", root_file.display_name, instance.minecraft_version)));
    }
    let root_key = format!("cf-{project}");
    let mut plan: Vec<(CfMod, CfFile)> = vec![(root_mod, root_file)];
    if kind == ModKind::Mod {
        let installed: HashSet<String> = instance.mods.iter().map(|m| norm(&m.name)).collect();
        let installed_cf: HashSet<u64> = instance
            .mods
            .iter()
            .filter_map(|m| match m.source {
                ModSource::CurseForge { project_id, .. } => Some(u64::from(project_id)),
                _ => None,
            })
            .collect();
        let mut seen: HashSet<u64> = HashSet::from([u64::from(project)]);
        let mut queue: VecDeque<u64> = plan[0].1.dependencies.iter().filter(|d| d.relation_type == REQUIRED).map(|d| d.mod_id).collect();
        while let Some(dep) = queue.pop_front() {
            if !seen.insert(dep) || installed_cf.contains(&dep) {
                continue;
            }
            if plan.len() > MAX_DEPENDENCIES {
                return Err(invalid("Dependency-Limit erreicht"));
            }
            let m = mod_of(&client, dep as u32).await?;
            // Dieselbe Mod, die schon von Modrinth stammt, nicht noch einmal holen.
            if installed.contains(&norm(&m.name)) {
                continue;
            }
            let f = pick_file(&client, dep, &instance, ModKind::Mod).await?.ok_or_else(|| invalid(format!("Keine passende Version von {}", m.name)))?;
            queue.extend(f.dependencies.iter().filter(|d| d.relation_type == REQUIRED).map(|d| d.mod_id));
            plan.push((m, f));
        }
        // Unverträglichkeiten gegen das, was schon drin ist oder jetzt dazukommt.
        for (_, f) in &plan {
            if let Some(d) = f
                .dependencies
                .iter()
                .find(|d| d.relation_type == INCOMPATIBLE && (installed_cf.contains(&d.mod_id) || plan.iter().any(|(m, _)| m.id == d.mod_id)))
            {
                return Err(invalid(format!("{} ist mit einer vorhandenen Mod unverträglich (Projekt {})", f.display_name, d.mod_id)));
            }
        }
    }
    let mut names: HashSet<String> = instance.mods.iter().map(|m| m.file_name.to_lowercase()).collect();
    let mut files = Vec::new();
    for (m, f) in &plan {
        let k = if m.id == u64::from(project) { kind } else { ModKind::Mod };
        check_file_name(&f.file_name, k)?;
        if !names.insert(f.file_name.to_lowercase()) {
            return Err(invalid("Mod-Dateinamen kollidieren"));
        }
        let target = state.dirs.game_dir(instance_id).join(k.folder()).join(&f.file_name);
        content::regular_parents(&state.dirs.root, &target)?;
        if fs::symlink_metadata(&target).is_ok() {
            return Err(invalid("Mod-Zieldatei existiert bereits"));
        }
        let remote = remote(f).map_err(|e| invalid(format!("{}: {e}", m.name)))?;
        files.push((m, f, k, target, remote));
    }
    content::budget(files.iter().map(|(_, f, ..)| f.file_length))?;
    let total = files.len() as u64;
    let downloader = modrinth::download_client()?;
    let mut ready = Vec::new();
    for (n, (m, f, k, target, remote)) in files.into_iter().enumerate() {
        progress("download", n as u64, total);
        let data = remote.download(&downloader).await?;
        ready.push((m, f, k, target, data));
    }
    let mut created = Vec::new();
    let result = (|| {
        for (m, f, k, target, data) in ready {
            content::write_new(&state.dirs.root, &target, &data)?;
            created.push(target);
            let sha1 = crate::services::mods::cache_bytes(&state.dirs, &data)?;
            let owners = if m.id == u64::from(project) { Vec::new() } else { vec![root_key.clone()] };
            let entry = mod_entry(m, f, k, sha1, owners, &instance.mods);
            instance.mods.push(entry);
        }
        // Schon vorhandene Abhängigkeiten merken den neuen Besitzer, sofern sie selbst Abhängigkeit sind.
        for (m, _) in plan.iter().skip(1) {
            let key = format!("cf-{}", m.id);
            for existing in instance.mods.iter_mut().filter(|x| x.id == key && !x.required_by.is_empty() && !x.required_by.contains(&root_key)) {
                existing.required_by.push(root_key.clone());
            }
        }
        state.instances.update(instance.clone())
    })();
    match result {
        Err(e) => Err(content::rollback(&created, e)),
        Ok(i) => {
            progress("complete", total, total);
            Ok(i)
        }
    }
}

// ---------- Modpacks ----------

/// Eine Datei, die CurseForge nur über die Webseite ausliefert; der Nutzer lädt sie dort und der Launcher holt sie ab.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Blocked {
    pub project_id: u32,
    pub file_id: u32,
    pub name: String,
    pub file_name: String,
    /// Seite des Projekts auf CurseForge.
    pub url: String,
}

#[derive(Debug, Deserialize)]
struct Manifest {
    minecraft: ManifestMinecraft,
    #[serde(default)]
    files: Vec<ManifestFile>,
    #[serde(default = "overrides_dir")]
    overrides: String,
}
fn overrides_dir() -> String {
    "overrides".into()
}
#[derive(Debug, Deserialize)]
struct ManifestMinecraft {
    version: String,
    #[serde(rename = "modLoaders", default)]
    mod_loaders: Vec<ManifestLoader>,
}
#[derive(Debug, Deserialize)]
struct ManifestLoader {
    id: String,
    #[serde(default)]
    primary: bool,
}
#[derive(Debug, Deserialize)]
struct ManifestFile {
    #[serde(rename = "projectID")]
    project_id: u32,
    #[serde(rename = "fileID")]
    file_id: u32,
}

/// `forge-47.1.3` -> (Forge, 47.1.3); Loader, die Pumpkin Launcher nicht kennt, sind ein Fehler.
fn manifest_loader(m: &ManifestMinecraft) -> AppResult<(ModLoader, Option<String>)> {
    let Some(l) = m.mod_loaders.iter().find(|l| l.primary).or(m.mod_loaders.first()) else { return Ok((ModLoader::Vanilla, None)) };
    let (name, version) = l.id.split_once('-').ok_or_else(|| invalid("Loader im Pack nicht lesbar"))?;
    let loader = match name {
        "forge" => ModLoader::Forge,
        "neoforge" => ModLoader::NeoForge,
        "fabric" => ModLoader::Fabric,
        "quilt" => ModLoader::Quilt,
        other => return Err(invalid(format!("Das Pack braucht den Loader „{other}“, den Pumpkin Launcher nicht kennt"))),
    };
    identifier(version)?;
    identifier(&m.version)?;
    match loader {
        ModLoader::Forge => forge::check_supported(forge::Kind::Forge, &m.version)?,
        ModLoader::NeoForge => forge::check_supported(forge::Kind::NeoForge, &m.version)?,
        _ => {}
    }
    Ok((loader, Some(version.to_string())))
}

fn folder_of(class_id: Option<u32>) -> Option<&'static str> {
    match class_id {
        Some(CLASS_MOD) => Some("mods"),
        Some(CLASS_RESOURCEPACK) => Some("resourcepacks"),
        Some(CLASS_SHADER) => Some("shaderpacks"),
        _ => None,
    }
}

/// Plant ein CurseForge-Modpack: lädt das Zip, liest `manifest.json`, holt alle Dateien (mit Prüfsumme) und übernimmt
/// die Overrides. Was nur über die Webseite geladen werden darf, kommt als `Blocked` zurück.
pub(crate) async fn plan_pack(
    client: &reqwest::Client,
    dirs: &Dirs,
    project_id: &str,
    file_id: &str,
    name: &str,
    progress: &(dyn Fn(&str, u64, u64) + Send + Sync),
) -> AppResult<(Pack, Vec<Blocked>)> {
    if name.trim().is_empty() || name.len() > 200 {
        return Err(invalid("Ungültiger Instanzname"));
    }
    let (project, file_no) = (number(project_id)?, number(file_id)?);
    let pack_mod = mod_of(client, project).await?;
    if pack_mod.class_id != Some(CLASS_MODPACK) {
        return Err(invalid("Projekt ist kein Modpack"));
    }
    let pack_file = file_of(client, project, file_no).await?;
    let tmp = dirs.root.join("cache").join("tmp");
    fs::create_dir_all(&tmp)?;
    let temp = TempFile(tmp.join(format!("{}.zip", crate::models::new_id())));
    let zip_source = RemoteFile { size: pack_file.file_length.min(ZIP_LIMIT), ..remote(&pack_file)? };
    progress("download", 0, 0);
    let last = std::sync::atomic::AtomicU64::new(u64::MAX);
    zip_source
        .download_to(&modrinth::download_client()?, &temp.0, &|done, total| {
            if last.swap(done / MIB, std::sync::atomic::Ordering::Relaxed) != done / MIB {
                progress("download", done / MIB, total / MIB);
            }
        })
        .await?;

    let mut zip = zip::ZipArchive::new(fs::File::open(&temp.0)?)?;
    let manifest: Manifest = {
        let entry = zip.by_name("manifest.json")?;
        let mut bytes = Vec::new();
        entry.take(16 * MIB + 1).read_to_end(&mut bytes)?;
        if bytes.len() as u64 > 16 * MIB {
            return Err(invalid("manifest.json zu groß"));
        }
        serde_json::from_slice(&bytes)?
    };
    let (loader, loader_version) = manifest_loader(&manifest.minecraft)?;
    if manifest.files.len() > 6000 {
        return Err(invalid("Zu viele Pack-Dateien"));
    }
    // Der Ordner mit den Overrides kommt aus dem Manifest: nur einfache Namen.
    if manifest.overrides.is_empty() || manifest.overrides.contains(['/', '\\', ':']) || manifest.overrides.starts_with('.') {
        return Err(invalid("Ungültiger Overrides-Ordner im Pack"));
    }
    let prefix = format!("{}/", manifest.overrides);

    // Datei- und Projektangaben in Blöcken holen.
    let ids: Vec<u32> = manifest.files.iter().map(|f| f.file_id).collect();
    let mut infos: HashMap<u64, CfFile> = HashMap::new();
    for chunk in ids.chunks(200) {
        let got: Page<CfFile> = post(client, "mods/files", &serde_json::json!({ "fileIds": chunk })).await?;
        infos.extend(got.data.into_iter().map(|f| (f.id, f)));
    }
    let mut project_ids: Vec<u32> = manifest.files.iter().map(|f| f.project_id).collect();
    project_ids.sort_unstable();
    project_ids.dedup();
    let mut mods: HashMap<u64, CfMod> = HashMap::new();
    for chunk in project_ids.chunks(200) {
        let got: Page<CfMod> = post(client, "mods", &serde_json::json!({ "modIds": chunk })).await?;
        mods.extend(got.data.into_iter().map(|m| (m.id, m)));
    }

    let mut files = Vec::new();
    let mut origins = HashMap::new();
    let mut blocked = Vec::new();
    for mf in &manifest.files {
        let f = infos.get(&u64::from(mf.file_id)).ok_or_else(|| invalid(format!("Datei {} gibt es bei CurseForge nicht mehr", mf.file_id)))?;
        let m = mods.get(&u64::from(mf.project_id));
        let Some(folder) = folder_of(m.and_then(|m| m.class_id)) else { continue };
        if f.file_name.is_empty() || f.file_name.contains(['/', '\\']) {
            return Err(invalid(format!("Unerwarteter Dateiname {}", f.file_name)));
        }
        let page = m
            .and_then(|m| m.links.as_ref())
            .map(|l| l.website_url.clone())
            .filter(|u| u.starts_with("https://www.curseforge.com/"))
            .unwrap_or_else(|| "https://www.curseforge.com/minecraft".into());
        match remote(f) {
            Ok(r) => {
                files.push((format!("{folder}/{}", f.file_name), r));
                origins.insert(f.file_name.clone(), (mf.project_id, mf.file_id));
            }
            Err(_) => blocked.push(Blocked {
                project_id: mf.project_id,
                file_id: mf.file_id,
                name: m.map(|m| m.name.clone()).unwrap_or_else(|| f.display_name.clone()),
                file_name: f.file_name.clone(),
                url: page,
            }),
        }
    }

    // Overrides gewinnen gegen gleichnamige Downloads (wie im CurseForge-Launcher).
    let overrides = zip_files(&mut zip, &prefix, &[])?;
    let override_paths: HashSet<String> = overrides.iter().map(|(p, _)| p.to_string_lossy().to_lowercase()).collect();
    files.retain(|(path, _)| !override_paths.contains(&path.to_lowercase()));
    let instance = Instance::from_new(NewInstance { name: name.trim().into(), minecraft_version: manifest.minecraft.version.clone(), loader, loader_version });
    let mut pack = content::plan_pack(instance, files)?;
    // Overrides und Downloads dürfen sich auch nicht als Datei/Ordner in die Quere kommen.
    let downloads: HashSet<String> = pack.downloads.iter().map(|(p, _)| p.to_string_lossy().to_lowercase()).collect();
    for path in &override_paths {
        if path.match_indices('/').any(|(at, _)| downloads.contains(&path[..at])) {
            return Err(invalid("Datei/Verzeichnis-Konflikt"));
        }
    }
    let archive = Arc::new(Mutex::new(zip));
    pack.overrides = overrides.into_iter().map(|(path, index)| (path, Blob::Zip { archive: archive.clone(), index })).collect();
    pack.origins = origins;
    pack.temp = Some(temp);
    Ok((pack, blocked))
}

// ---------- Manuell geladene Dateien ----------

/// Downloads-Ordner des Systems: auch verschoben (Windows) oder mit übersetztem Namen (XDG unter Linux).
fn downloads_dir() -> Option<PathBuf> {
    dirs::download_dir().filter(|dir| dir.is_dir())
}

/// Sucht im Downloads-Ordner nach der Datei, die der Nutzer auf CurseForge geladen hat (Größe und SHA-1 müssen
/// stimmen; Browser hängen bei Doppelten ` (1)` an).
fn find_download(dir: &std::path::Path, file: &CfFile) -> AppResult<Option<Vec<u8>>> {
    let Some(expected) = sha1_of(file) else { return Ok(None) };
    let (stem, ext) = file.file_name.rsplit_once('.').unwrap_or((&file.file_name, ""));
    for entry in fs::read_dir(dir)? {
        let entry = entry?;
        let name = entry.file_name().to_string_lossy().to_string();
        let candidate = name == file.file_name || (name.starts_with(stem) && name.ends_with(&format!(".{ext}")));
        if !candidate || !entry.file_type()?.is_file() || entry.metadata()?.len() != file.file_length || file.file_length > modrinth::FILE_LIMIT {
            continue;
        }
        let data = fs::read(entry.path())?;
        if crate::services::download::sha1_hex(&data) == expected {
            return Ok(Some(data));
        }
    }
    Ok(None)
}

/// Holt eine manuell geladene Datei aus dem Downloads-Ordner und trägt sie in die Instanz ein.
/// `None` = noch nicht da (der Nutzer lädt noch).
pub async fn adopt_download(state: &AppState, instance_id: &str, project_id: u32, file_id: u32) -> AppResult<Option<Instance>> {
    let client = modrinth::client()?;
    let m = mod_of(&client, project_id).await?;
    let kind = mod_kind(m.class_id)?;
    let f = file_of(&client, project_id, file_id).await?;
    let mut instance = state.instances.get(instance_id)?;
    if instance.mods.iter().any(|x| matches!(x.source, ModSource::CurseForge { file_id: id, .. } if id == file_id)) {
        return Ok(Some(instance));
    }
    let Some(dir) = downloads_dir() else { return Ok(None) };
    let Some(data) = find_download(&dir, &f)? else { return Ok(None) };
    check_file_name(&f.file_name, kind)?;
    let target = state.dirs.game_dir(instance_id).join(kind.folder()).join(&f.file_name);
    content::regular_parents(&state.dirs.root, &target)?;
    if instance.mods.iter().any(|x| x.file_name.eq_ignore_ascii_case(&f.file_name)) || fs::symlink_metadata(&target).is_ok() {
        return Err(invalid("Mod-Dateinamen kollidieren"));
    }
    content::write_new(&state.dirs.root, &target, &data)?;
    let sha1 = match crate::services::mods::cache_bytes(&state.dirs, &data) {
        Ok(s) => s,
        Err(e) => return Err(content::rollback(&[target], e)),
    };
    let entry = mod_entry(&m, &f, kind, sha1, Vec::new(), &instance.mods);
    instance.mods.push(entry);
    match state.instances.update(instance) {
        Ok(i) => Ok(Some(i)),
        Err(e) => Err(content::rollback(&[target], e)),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn file(v: serde_json::Value) -> CfFile {
        serde_json::from_value(v).unwrap()
    }
    fn jei() -> CfFile {
        file(json!({
            "id": 9019497, "modId": 238222, "displayName": "31.8.0.49 for NeoForge 26.3", "fileName": "jei-26.3-neoforge-31.8.0.49.jar",
            "releaseType": 2, "fileDate": "2026-09-30T15:38:17.03Z", "fileLength": 2381616,
            "downloadUrl": "https://edge.forgecdn.net/files/9019/497/jei-26.3-neoforge-31.8.0.49.jar",
            "gameVersions": ["Client", "NeoForge", "Server", "26.3", "Java 21"],
            "hashes": [{"value": "ABCDEF0123456789ABCDEF0123456789ABCDEF01", "algo": 1}, {"value": "md5", "algo": 2}],
            "dependencies": [{"modId": 1, "relationType": 3}, {"modId": 2, "relationType": 2}, {"modId": 3, "relationType": 5}, {"modId": 4, "relationType": 1}]
        }))
    }

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
    fn blocked_files_have_no_url_and_cannot_be_fetched() {
        let mut f = jei();
        f.download_url = None;
        assert_eq!(version(&f).files[0].url, "");
        assert!(remote(&f).is_err());
        assert_eq!(remote(&jei()).unwrap().hashes["sha1"], "abcdef0123456789abcdef0123456789abcdef01");
    }

    #[test]
    fn instance_compatibility_follows_minecraft_and_loader() {
        let inst = |loader, mc: &str| Instance::from_new(NewInstance { name: "t".into(), minecraft_version: mc.into(), loader, loader_version: None });
        let f = jei();
        assert!(runs(&inst(ModLoader::NeoForge, "26.3"), ModKind::Mod, &f));
        assert!(!runs(&inst(ModLoader::Fabric, "26.3"), ModKind::Mod, &f));
        assert!(!runs(&inst(ModLoader::NeoForge, "1.21.1"), ModKind::Mod, &f));
        // Ressourcenpakete brauchen keinen Loader.
        assert!(runs(&inst(ModLoader::Vanilla, "26.3"), ModKind::ResourcePack, &f));
        // Quilt lädt Fabric-Mods mit.
        let fabric = file(json!({"id": 1, "gameVersions": ["Fabric", "1.20.1"]}));
        assert!(runs(&inst(ModLoader::Quilt, "1.20.1"), ModKind::Mod, &fabric));
    }

    #[test]
    fn classes_and_kinds() {
        assert_eq!((class_of("mod").unwrap(), class_of("modpack").unwrap(), class_of("shader").unwrap(), class_of("resourcepack").unwrap()), (6, 4471, 6552, 12));
        assert!(class_of("plugin").is_err());
        assert_eq!((kind_name(Some(4471)), kind_name(Some(12)), kind_name(None)), ("modpack", "resourcepack", "mod"));
        assert!(mod_kind(Some(CLASS_MODPACK)).is_err() && mod_kind(Some(CLASS_MOD)).is_ok());
        assert_eq!((folder_of(Some(6)), folder_of(Some(12)), folder_of(Some(6552)), folder_of(Some(17))), (Some("mods"), Some("resourcepacks"), Some("shaderpacks"), None));
    }

    #[test]
    fn the_same_mod_is_recognised_across_platforms() {
        assert_eq!(norm("Fabric API"), norm("fabric-api"));
        assert_ne!(norm("Sodium"), norm("Sodium Extra"));
    }

    #[test]
    fn manifest_loader_ids() {
        let mc = |v: &str, loaders: &[&str]| ManifestMinecraft {
            version: v.into(),
            mod_loaders: loaders.iter().map(|id| ManifestLoader { id: (*id).into(), primary: true }).collect(),
        };
        assert_eq!(manifest_loader(&mc("1.20.1", &["forge-47.1.3"])).unwrap(), (ModLoader::Forge, Some("47.1.3".to_string())));
        assert_eq!(manifest_loader(&mc("1.21.1", &["neoforge-21.1.172"])).unwrap().0, ModLoader::NeoForge);
        assert_eq!(manifest_loader(&mc("1.20.1", &["fabric-0.15.7"])).unwrap().0, ModLoader::Fabric);
        assert_eq!(manifest_loader(&mc("1.21.1", &[])).unwrap(), (ModLoader::Vanilla, None));
        // Forge vor 1.17, fremde Loader und kaputte IDs.
        assert!(manifest_loader(&mc("1.12.2", &["forge-14.23.5.2860"])).is_err());
        assert!(manifest_loader(&mc("1.20.1", &["cauldron-1"])).is_err());
        assert!(manifest_loader(&mc("1.20.1", &["forge"])).is_err());
        assert!(manifest_loader(&mc("1.20.1", &["forge-../x"])).is_err());
    }

    #[test]
    fn manifest_parses_like_curseforge_writes_it() {
        let m: Manifest = serde_json::from_value(json!({
            "minecraft": {"version": "1.20.1", "modLoaders": [{"id": "forge-47.1.3", "primary": true}]},
            "manifestType": "minecraftModpack", "manifestVersion": 1, "name": "P", "version": "1", "author": "a",
            "files": [{"projectID": 238222, "fileID": 4593548, "required": true}], "overrides": "overrides"
        }))
        .unwrap();
        assert_eq!((m.files.len(), m.files[0].project_id, m.files[0].file_id, m.overrides.as_str()), (1, 238222, 4593548, "overrides"));
        let bare: Manifest = serde_json::from_value(json!({"minecraft": {"version": "1.20.1"}})).unwrap();
        assert_eq!(bare.overrides, "overrides");
    }

    #[test]
    fn proxy_address_must_be_plain_https() {
        assert_eq!(parse_proxy(" https://pumpkin-curseforge.jonas.workers.dev/ ").as_deref(), Some("https://pumpkin-curseforge.jonas.workers.dev"));
        for bad in ["", "http://x.workers.dev", "https://user:pw@x.workers.dev", "https://x.workers.dev/v1", "https://x.workers.dev/?a=1", "ftp://x", "nicht-url"] {
            assert_eq!(parse_proxy(bad), None, "{bad}");
        }
    }

    /// Installation gegen die echte API in eine temporäre Instanz: eine Mod mit benötigter Abhängigkeit (Sodium Extra -> Sodium).
    /// `cargo test live_install_mod -- --ignored --nocapture`
    #[tokio::test]
    #[ignore = "braucht Netzwerk und den Worker"]
    async fn live_install_mod_with_dependencies() {
        let client = modrinth::client().unwrap();
        let hits = search(&client, "sodium extra", "mod", Some("1.20.1"), Some("fabric"), 0, None).await.unwrap();
        let extra = hits.hits.iter().find(|h| h.slug == "sodium-extra").expect("Sodium Extra fehlt");
        let v = versions(&client, &extra.project_id, Some("1.20.1"), Some("fabric")).await.unwrap();
        let file = v.iter().find(|v| v.version_type == "release").unwrap_or(&v[0]);
        let root = std::env::temp_dir().join(crate::models::new_id());
        let state = AppState::load(&root).unwrap();
        let instance = state
            .instances
            .insert(Instance::from_new(NewInstance { name: "Live".into(), minecraft_version: "1.20.1".into(), loader: ModLoader::Fabric, loader_version: None }))
            .unwrap();
        let done = install_mod(&state, &instance.id, &extra.project_id, &file.id, &|p, d, t| eprintln!("{p}: {d}/{t}")).await.unwrap();
        for m in &done.mods {
            eprintln!("{} {} ({}) von {:?} für {:?}", m.name, m.version, m.file_name, m.source, m.required_by);
        }
        assert!(done.mods.len() >= 2, "Abhängigkeit fehlt");
        assert!(done.mods[0].required_by.is_empty() && done.mods.iter().skip(1).all(|m| m.required_by == [format!("cf-{}", extra.project_id)]));
        for m in &done.mods {
            assert!(state.dirs.game_dir(&instance.id).join("mods").join(&m.file_name).is_file(), "{} fehlt auf der Platte", m.file_name);
        }
        // Zweites Mal: nichts doppelt.
        assert!(install_mod(&state, &instance.id, &extra.project_id, &file.id, &|_, _, _| {}).await.is_err());
        std::fs::remove_dir_all(root).unwrap();
    }

    /// Ganzes Modpack von CurseForge (Fabulously Optimized): Manifest, alle Mods mit Prüfsumme, Overrides.
    #[tokio::test]
    #[ignore = "braucht Netzwerk und den Worker, lädt mehrere zehn MB"]
    async fn live_install_pack() {
        let client = modrinth::client().unwrap();
        // `LIVE_PACK=all-the-mods-10` probiert ein fettes Pack aus (mehrere GB), Standard ist ein kleines.
        let slug = std::env::var("LIVE_PACK").unwrap_or_else(|_| "fabulously-optimized".into());
        let hits = search(&client, &slug.replace('-', " "), "modpack", None, None, 0, None).await.unwrap();
        let pack = hits.hits.iter().find(|h| h.slug == slug).unwrap_or_else(|| panic!("{slug} fehlt"));
        let v = versions(&client, &pack.project_id, None, None).await.unwrap();
        let file = v.iter().find(|v| v.version_type == "release" && v.files[0].size > 0 && !v.files[0].url.is_empty()).expect("keine Release-Datei");
        eprintln!("Pack-Datei {} ({} Bytes)", file.name, file.files[0].size);
        let root = std::env::temp_dir().join(crate::models::new_id());
        let state = AppState::load(&root).unwrap();
        let (plan, blocked) = plan_pack(&client, &state.dirs, &pack.project_id, &file.id, "Live-Pack", &|p, d, t| eprintln!("{p}: {d}/{t}")).await.unwrap();
        eprintln!("{} Downloads, {} Overrides, {} gesperrt", plan.downloads.len(), plan.overrides.len(), blocked.len());
        let instance = content::import_plan(&state, plan, None, &|_, _, _| {}).await.unwrap();
        let jars = std::fs::read_dir(state.dirs.game_dir(&instance.id).join("mods")).unwrap().count();
        let cf = instance.mods.iter().filter(|m| matches!(m.source, ModSource::CurseForge { .. })).count();
        eprintln!("{} {:?} {:?}: {jars} Mods, davon {cf} als CurseForge erfasst", instance.minecraft_version, instance.loader, instance.loader_version);
        assert!(jars > 10 && instance.mods.len() >= jars);
        assert_ne!(instance.loader, ModLoader::Vanilla);
        let left: Vec<_> = std::fs::read_dir(state.dirs.root.join("cache").join("tmp")).unwrap().collect();
        assert!(left.is_empty(), "Zwischenspeicher nicht aufgeräumt");
        std::fs::remove_dir_all(root).unwrap();
    }

    /// Was der Worker durchlässt und was nicht: `cargo test live_curseforge_via_proxy -- --ignored`.
    #[tokio::test]
    #[ignore = "braucht Netzwerk und den Worker"]
    async fn live_curseforge_via_proxy() {
        let proxy = proxy();
        let client = modrinth::client().unwrap();
        let q = [
            ("gameId", "432".to_string()),
            ("classId", "6".to_string()),
            ("searchFilter", "just enough items".to_string()),
            ("sortField", "6".to_string()),
            ("sortOrder", "desc".to_string()),
            ("pageSize", "10".to_string()),
        ];
        let page: Page<CfMod> = get_at(&client, &proxy, "mods/search", &q).await.unwrap();
        assert!(page.data.iter().any(|m| m.slug == "jei"), "JEI fehlt über den Proxy");
        let files: Page<CfFile> = post_at(&client, &proxy, "mods/files", &json!({ "fileIds": [9019497] })).await.unwrap();
        assert_eq!(files.data.first().map(|f| f.mod_id), Some(238222));
        eprintln!("Proxy liefert {} Treffer und die Datei 9019497", page.data.len());
        // Was der Proxy nicht durchlässt, kommt als Fehler an.
        assert!(get_at::<serde_json::Value>(&client, &proxy, "games", &[]).await.is_err());
    }

    #[test]
    fn search_ids_must_be_numbers() {
        assert_eq!(number("238222").unwrap(), 238222);
        for bad in ["", "mc-mods/jei", "-1", "1e3", "99999999999"] {
            assert!(number(bad).is_err(), "{bad}");
        }
    }

    #[test]
    fn downloads_folder_lookup_checks_size_and_hash() {
        let dir = std::env::temp_dir().join(crate::models::new_id());
        fs::create_dir_all(&dir).unwrap();
        let data = b"jar-bytes";
        let f = file(json!({
            "id": 1, "modId": 2, "fileName": "a-1.0.jar", "fileLength": data.len(),
            "hashes": [{"value": crate::services::download::sha1_hex(data), "algo": 1}]
        }));
        assert!(find_download(&dir, &f).unwrap().is_none());
        // Falscher Inhalt gleicher Größe wird nicht akzeptiert, der echte unter Browser-Namen schon.
        fs::write(dir.join("a-1.0.jar"), b"jar-bytez").unwrap();
        assert!(find_download(&dir, &f).unwrap().is_none());
        fs::write(dir.join("a-1.0 (1).jar"), data).unwrap();
        assert_eq!(find_download(&dir, &f).unwrap().unwrap(), data);
        fs::remove_dir_all(dir).unwrap();
    }

    /// Über den Worker, ohne Schlüssel im Launcher:
    /// `cargo test live_curseforge -- --ignored --nocapture`.
    #[tokio::test]
    #[ignore = "braucht Netzwerk und den Worker"]
    async fn live_curseforge_catalog() {
        let client = modrinth::client().unwrap();
        let mods = search(&client, "jei", "mod", Some("1.20.1"), Some("forge"), 0, None).await.unwrap();
        assert!(mods.total_hits > 0, "keine Treffer");
        let jei = mods.hits.iter().find(|h| h.slug == "jei").expect("JEI fehlt");
        let p = project(&client, &jei.project_id).await.unwrap();
        assert!(p.body.len() > 100 && p.web_url.is_some(), "Beschreibung/Seite fehlen");
        let v = versions(&client, &jei.project_id, Some("1.20.1"), Some("forge")).await.unwrap();
        assert!(!v.is_empty() && v[0].loaders.contains(&"forge".to_string()) && v[0].game_versions.contains(&"1.20.1".to_string()));
        eprintln!("{} – {} Versionen, neueste {}", p.title, v.len(), v[0].version_number);
        let packs = search(&client, "all the mods", "modpack", None, None, 0, None).await.unwrap();
        assert!(packs.hits.iter().any(|h| h.project_type == "modpack"));
        for kind in ["shader", "resourcepack"] {
            assert!(search(&client, "", kind, None, None, 0, None).await.unwrap().total_hits > 0, "{kind}");
        }
    }
}
