//! Modrinth v2: ausschließlich GET, feste Origins und begrenzte Antworten.
use crate::{
    error::{AppError, AppResult},
    models::{Instance, ModLoader},
    services::download::sha1_hex,
};
use serde::{de::DeserializeOwned, Deserialize, Serialize};
use std::{
    collections::{BTreeMap, HashMap, VecDeque},
    time::Duration,
};

pub fn invalid(message: impl Into<String>) -> AppError {
    AppError::Invalid(message.into())
}
pub const FILE_LIMIT: u64 = 256 * 1024 * 1024;
const API: &str = "https://api.modrinth.com/v2";
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SearchResponse {
    pub hits: Vec<Hit>,
    pub total_hits: u64,
    pub offset: u32,
    pub limit: u32,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Hit {
    pub project_id: String,
    pub slug: String,
    pub title: String,
    pub description: String,
    pub icon_url: Option<String>,
    pub project_type: String,
    pub downloads: u64,
    pub author: String,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Project {
    pub id: String,
    pub slug: String,
    pub title: String,
    pub description: String,
    pub body: String,
    pub icon_url: Option<String>,
    pub project_type: String,
    pub client_side: String,
    pub server_side: String,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Version {
    pub id: String,
    pub project_id: String,
    pub name: String,
    pub version_number: String,
    pub game_versions: Vec<String>,
    pub loaders: Vec<String>,
    pub files: Vec<File>,
    pub dependencies: Vec<Dependency>,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct File {
    pub hashes: BTreeMap<String, String>,
    pub url: String,
    pub filename: String,
    pub primary: bool,
    pub size: u64,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Dependency {
    pub version_id: Option<String>,
    pub project_id: Option<String>,
    pub file_name: Option<String>,
    pub dependency_type: String,
}

pub fn client() -> AppResult<reqwest::Client> {
    Ok(reqwest::Client::builder()
        .user_agent(concat!("voxlet/", env!("CARGO_PKG_VERSION")))
        .redirect(reqwest::redirect::Policy::none())
        .connect_timeout(Duration::from_secs(15))
        .timeout(Duration::from_secs(120))
        .build()?)
}
pub fn identifier(s: &str) -> AppResult<()> {
    if s.is_empty()
        || s.len() > 128
        || !s
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_' || b == b'.')
        || s == "."
        || s == ".."
    {
        return Err(invalid("Ungültige ID/Version"));
    }
    Ok(())
}
pub async fn bytes(client: &reqwest::Client, url: reqwest::Url, limit: u64) -> AppResult<Vec<u8>> {
    let mut response = client.get(url).send().await?.error_for_status()?;
    if !response.status().is_success() {
        return Err(invalid("Redirects werden nicht akzeptiert"));
    }
    if response.content_length().is_some_and(|n| n > limit) {
        return Err(invalid("Download zu groß"));
    }
    let mut data = Vec::new();
    while let Some(chunk) = response.chunk().await? {
        if data.len() as u64 + chunk.len() as u64 > limit {
            return Err(invalid("Download zu groß"));
        }
        data.extend_from_slice(&chunk);
    }
    Ok(data)
}
async fn api<T: DeserializeOwned>(
    client: &reqwest::Client,
    path: &str,
    query: &[(String, String)],
) -> AppResult<T> {
    let mut url =
        reqwest::Url::parse(&format!("{API}/{path}")).map_err(|e| invalid(e.to_string()))?;
    url.query_pairs_mut().extend_pairs(query);
    Ok(serde_json::from_slice(
        &bytes(client, url, 8 * 1024 * 1024).await?,
    )?)
}
pub async fn search(
    client: &reqwest::Client,
    query: String,
    kind: String,
    mc: Option<String>,
    loader: Option<String>,
    offset: u32,
) -> AppResult<SearchResponse> {
    if !matches!(kind.as_str(), "mod" | "modpack") || query.len() > 512 || offset > 100_000 {
        return Err(invalid("Ungültige Suche"));
    }
    let mut facets = vec![vec![format!("project_type:{kind}")]];
    if let Some(mc) = mc {
        identifier(&mc)?;
        facets.push(vec![format!("versions:{mc}")]);
    }
    if let Some(loader) = loader {
        identifier(&loader)?;
        facets.push(vec![format!("categories:{loader}")]);
    }
    api(
        client,
        "search",
        &[
            ("query".into(), query),
            ("facets".into(), serde_json::to_string(&facets)?),
            ("offset".into(), offset.to_string()),
            ("limit".into(), "20".into()),
        ],
    )
    .await
}
pub async fn project(client: &reqwest::Client, id: &str) -> AppResult<Project> {
    identifier(id)?;
    api(client, &format!("project/{id}"), &[]).await
}
pub async fn version(client: &reqwest::Client, id: &str) -> AppResult<Version> {
    identifier(id)?;
    let v: Version = api(client, &format!("version/{id}"), &[]).await?;
    if v.id != id {
        return Err(invalid("Versions-ID stimmt nicht überein"));
    }
    Ok(v)
}
pub async fn versions(
    client: &reqwest::Client,
    id: &str,
    mc: Option<&str>,
    loader: Option<&str>,
) -> AppResult<Vec<Version>> {
    identifier(id)?;
    let mut q = Vec::new();
    for (key, value) in [("game_versions", mc), ("loaders", loader)] {
        if let Some(value) = value {
            identifier(value)?;
            q.push((key.into(), serde_json::to_string(&[value])?));
        }
    }
    api(client, &format!("project/{id}/version"), &q).await
}
pub fn download_url(s: &str) -> AppResult<reqwest::Url> {
    let url = reqwest::Url::parse(s).map_err(|e| invalid(e.to_string()))?;
    if url.scheme() != "https"
        || url.host_str() != Some("cdn.modrinth.com")
        || url.port_or_known_default() != Some(443)
        || !url.username().is_empty()
        || url.password().is_some()
        || url.fragment().is_some()
    {
        return Err(invalid(
            "Download-Origin nicht erlaubt (nur https://cdn.modrinth.com)",
        ));
    }
    Ok(url)
}
pub fn verify(data: &[u8], size: u64, hashes: &BTreeMap<String, String>) -> AppResult<()> {
    use sha2::{Digest, Sha512};
    if data.len() as u64 != size {
        return Err(invalid("Dateigröße stimmt nicht"));
    }
    for (key, len, actual) in [
        ("sha1", 40, sha1_hex(data)),
        (
            "sha512",
            128,
            Sha512::digest(data)
                .iter()
                .map(|b| format!("{b:02x}"))
                .collect::<String>(),
        ),
    ] {
        let hash = hashes
            .get(key)
            .ok_or_else(|| invalid(format!("{key} fehlt")))?;
        if hash.len() != len || !hash.eq_ignore_ascii_case(&actual) {
            return Err(invalid(format!("{key} stimmt nicht")));
        }
    }
    Ok(())
}
pub async fn download(client: &reqwest::Client, file: &File) -> AppResult<Vec<u8>> {
    if file.size > FILE_LIMIT {
        return Err(invalid("Datei zu groß"));
    }
    let data = bytes(client, download_url(&file.url)?, file.size).await?;
    verify(&data, file.size, &file.hashes)?;
    Ok(data)
}
pub fn primary(version: &Version, extension: &str) -> AppResult<File> {
    let files: Vec<_> = version
        .files
        .iter()
        .filter(|f| f.filename.ends_with(extension))
        .collect();
    let selected = files
        .iter()
        .find(|f| f.primary)
        .copied()
        .or_else(|| {
            if files.len() == 1 {
                Some(files[0])
            } else {
                None
            }
        })
        .ok_or_else(|| invalid("Keine eindeutige primäre Datei"))?;
    super::content::safe_path(&selected.filename)?;
    if selected.filename.contains('/') {
        return Err(invalid("Dateiname enthält Verzeichnis"));
    }
    Ok(selected.clone())
}
pub fn compatible(v: &Version, instance: &Instance) -> AppResult<()> {
    if instance.loader != ModLoader::Fabric
        || !v.game_versions.contains(&instance.minecraft_version)
        || !v.loaders.iter().any(|l| l == "fabric")
    {
        return Err(invalid(format!("Inkompatible Mod-Version {}", v.id)));
    }
    Ok(())
}
pub fn select(selected: &mut HashMap<String, Version>, v: Version) -> AppResult<bool> {
    if let Some(old) = selected.get(&v.project_id) {
        if old.id != v.id {
            return Err(invalid(format!("Dependency-Konflikt für {}", v.project_id)));
        }
        return Ok(false);
    }
    selected.insert(v.project_id.clone(), v);
    Ok(true)
}
/// Exact constraints supersede provisional latest selections; rebuild to remove their descendants.
/// ponytail: conservative retained pins, no SAT/backtracking; conflicting exact pins fail closed.
fn pin_and_rebuild(
    pinned: &mut HashMap<String, Version>,
    selected: &mut HashMap<String, Version>,
    queue: &mut VecDeque<Version>,
    deferred: &mut VecDeque<String>,
    child: &Version,
) -> AppResult<bool> {
    select(pinned, child.clone())?;
    if selected
        .get(&child.project_id)
        .is_some_and(|v| v.id != child.id)
    {
        selected.clear();
        deferred.clear();
        queue.clear();
        let mut roots: Vec<_> = pinned.values().cloned().collect();
        roots.sort_by(|a, b| a.project_id.cmp(&b.project_id));
        queue.extend(roots);
        return Ok(true);
    }
    Ok(false)
}
pub async fn resolve(
    client: &reqwest::Client,
    root: &str,
    instance: &Instance,
) -> AppResult<Vec<Version>> {
    let mut queue = VecDeque::from([version(client, root).await?]);
    let mut selected = HashMap::new();
    let mut calls = 1;
    for m in instance.mods.iter().filter(|m| m.enabled) {
        if let crate::models::ModSource::Modrinth { version_id, .. } = &m.source {
            calls += 1;
            if calls > 64 {
                return Err(invalid("Zu viele installierte Dependencies"));
            }
            queue.push_back(version(client, version_id).await?);
        }
    }
    let mut pinned = HashMap::new();
    for v in &queue {
        select(&mut pinned, v.clone())?;
    }
    let mut deferred: VecDeque<String> = VecDeque::new();
    let mut rebuilds = 0;
    loop {
        if queue.is_empty() {
            let Some(id) = deferred.pop_front() else {
                break;
            };
            if selected.contains_key(&id) {
                continue;
            }
            calls += 1;
            if calls > 192 {
                return Err(invalid("Dependency-Limit erreicht"));
            }
            let child = versions(
                client,
                &id,
                Some(&instance.minecraft_version),
                Some("fabric"),
            )
            .await?
            .into_iter()
            .next()
            .ok_or_else(|| invalid("Keine kompatible Dependency"))?;
            queue.push_back(child);
        }
        let v = queue.pop_front().unwrap();
        compatible(&v, instance)?;
        if !select(&mut selected, v.clone())? {
            continue;
        }
        calls += 1;
        if calls > 192 || selected.len() > 64 {
            return Err(invalid("Dependency-Limit erreicht"));
        }
        let p = project(client, &v.project_id).await?;
        if p.id != v.project_id || p.project_type != "mod" || p.client_side == "unsupported" {
            return Err(invalid("Projekt ist keine Client-Mod"));
        }
        for d in &v.dependencies {
            if d.dependency_type != "required" {
                continue;
            }
            calls += 1;
            if calls > 192 || queue.len() > 128 {
                return Err(invalid("Dependency-Limit erreicht"));
            }
            let child = if let Some(id) = &d.version_id {
                version(client, id).await?
            } else if let Some(id) = &d.project_id {
                if let Some(existing) = pinned.get(id).or_else(|| selected.get(id)) {
                    existing.clone()
                } else {
                    deferred.push_back(id.clone());
                    continue;
                }
            } else {
                return Err(invalid(
                    "Required Datei-Dependency ohne Projekt/Version nicht unterstützt",
                ));
            };
            if d.project_id
                .as_ref()
                .is_some_and(|p| p != &child.project_id)
            {
                return Err(invalid("Dependency-Projekt stimmt nicht"));
            }
            if d.version_id.is_some()
                && pin_and_rebuild(
                    &mut pinned,
                    &mut selected,
                    &mut queue,
                    &mut deferred,
                    &child,
                )?
            {
                rebuilds += 1;
                if rebuilds > 16 {
                    return Err(invalid("Dependency rebuild limit erreicht"));
                }
                break;
            }
            queue.push_back(child);
        }
    }
    for v in selected.values() {
        for d in &v.dependencies {
            if d.dependency_type == "incompatible"
                && selected.values().any(|other| {
                    d.version_id.as_ref().map_or_else(
                        || d.project_id.as_ref() == Some(&other.project_id),
                        |id| id == &other.id,
                    )
                })
            {
                return Err(invalid("Inkompatible Dependencies"));
            }
        }
    }
    let mut result: Vec<_> = selected.into_values().collect();
    result.sort_by(|a, b| a.project_id.cmp(&b.project_id));
    Ok(result)
}

#[cfg(test)]
mod tests {
    use super::*;
    fn v(id: &str) -> Version {
        Version {
            id: id.into(),
            project_id: "project".into(),
            name: "test".into(),
            version_number: "1".into(),
            game_versions: vec!["1.21.1".into()],
            loaders: vec!["fabric".into()],
            files: vec![],
            dependencies: vec![],
        }
    }
    #[test]
    fn dependency_dedup_cycle_and_conflict() {
        let mut selected = HashMap::new();
        assert!(select(&mut selected, v("v1")).unwrap());
        assert!(!select(&mut selected, v("v1")).unwrap());
        assert!(select(&mut selected, v("v2")).is_err());
        assert_eq!(selected["project"].id, "v1");
    }
    #[test]
    fn later_exact_pin_rebuilds_provisional_graph() {
        let mut a = v("a1");
        a.project_id = "a".into();
        let mut b2 = v("b2");
        b2.project_id = "b".into();
        let mut b1 = b2.clone();
        b1.id = "b1".into();
        let mut c = v("c1");
        c.project_id = "c".into();
        let mut pinned = HashMap::from([("a".into(), a.clone())]);
        let mut selected = HashMap::from([("a".into(), a), ("b".into(), b2), ("c".into(), c)]);
        let mut queue = VecDeque::new();
        let mut deferred = VecDeque::from(["old-child".into()]);
        assert!(
            pin_and_rebuild(&mut pinned, &mut selected, &mut queue, &mut deferred, &b1).unwrap()
        );
        assert!(selected.is_empty());
        assert!(deferred.is_empty());
        assert_eq!(
            queue.iter().map(|v| v.id.as_str()).collect::<Vec<_>>(),
            vec!["a1", "b1"]
        );
        assert_eq!(pinned["b"].id, "b1");
        let mut conflicting = b1.clone();
        conflicting.id = "b3".into();
        assert!(pin_and_rebuild(
            &mut pinned,
            &mut selected,
            &mut queue,
            &mut deferred,
            &conflicting
        )
        .is_err());
    }
    #[test]
    fn hashes_and_size_are_required() {
        use sha2::{Digest, Sha512};
        let data = b"test";
        let hashes = BTreeMap::from([
            ("sha1".into(), sha1_hex(data)),
            (
                "sha512".into(),
                Sha512::digest(data)
                    .iter()
                    .map(|b| format!("{b:02x}"))
                    .collect(),
            ),
        ]);
        assert!(verify(data, 4, &hashes).is_ok());
        assert!(verify(data, 3, &hashes).is_err());
        assert!(verify(b"evil", 4, &hashes).is_err());
        assert!(verify(data, 4, &BTreeMap::new()).is_err());
    }
}
