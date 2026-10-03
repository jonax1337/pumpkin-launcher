//! Modrinth-Abfrage für den Abgleich (SPEC 5.6): welche Mod-Dateien gehören zu welchem Projekt, und welche davon
//! braucht der Server nicht (nur Client). Gesucht wird nach SHA-512, gebündelt und eine Stunde im Speicher gemerkt.
use std::collections::{HashMap, HashSet};
use std::sync::Mutex;
use std::time::{Duration, Instant};

use futures::future::BoxFuture;

use super::modinstall::MOD_PROJECT_ID;
use crate::error::AppResult;
use crate::services::lock;
use crate::services::modrinth::{self, Project, Version, MAX_PROJECT_IDS};

const CACHE_TTL: Duration = Duration::from_secs(3600);
const SERVER_SIDE_UNSUPPORTED: &str = "unsupported";

/// Was Modrinth über eine Mod-Datei weiß.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ModInfo {
    pub title: String,
    pub project_id: String,
    /// Der Server braucht die Mod nicht: ein reines Client-Projekt oder die Freunde-Mod selbst.
    pub client_only: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
#[error("Modrinth-Abfrage fehlgeschlagen: {0}")]
pub struct LookupError(pub String);

/// Nur Dateien, die Modrinth kennt, stehen im Ergebnis; für alle anderen gilt die Mod als erforderlich.
pub trait ModLookup: Send + Sync + 'static {
    fn classify<'a>(&'a self, sha512: &'a [String]) -> BoxFuture<'a, Result<HashMap<String, ModInfo>, LookupError>>;
}

/// Die zwei Modrinth-Aufrufe, auf die [`ModrinthLookup`] aufsetzt; Tests setzen einen Fake ein.
pub trait ModrinthApi: Send + Sync + 'static {
    fn versions_by_sha512<'a>(&'a self, hashes: &'a [String]) -> BoxFuture<'a, AppResult<HashMap<String, Version>>>;
    fn projects<'a>(&'a self, ids: &'a [String]) -> BoxFuture<'a, AppResult<Vec<Project>>>;
}

/// Echte Anfragen an `api.modrinth.com` mit dem Client des Launchers (Kennung und Grenzen wie überall).
pub struct ModrinthHttp(reqwest::Client);

impl ModrinthHttp {
    pub fn new() -> AppResult<Self> {
        Ok(Self(modrinth::client()?))
    }
}

impl ModrinthApi for ModrinthHttp {
    fn versions_by_sha512<'a>(&'a self, hashes: &'a [String]) -> BoxFuture<'a, AppResult<HashMap<String, Version>>> {
        Box::pin(modrinth::versions_by_sha512(&self.0, hashes))
    }

    fn projects<'a>(&'a self, ids: &'a [String]) -> BoxFuture<'a, AppResult<Vec<Project>>> {
        Box::pin(async move {
            let mut projects = Vec::with_capacity(ids.len());
            for chunk in ids.chunks(MAX_PROJECT_IDS) {
                projects.extend(modrinth::projects(&self.0, chunk).await?);
            }
            Ok(projects)
        })
    }
}

pub struct ModrinthLookup<A> {
    api: A,
    own_project_id: String,
    ttl: Duration,
    /// Auch Treffer ohne Ergebnis stehen drin, damit unbekannte Dateien nicht bei jeder Frage neu angefragt werden.
    cache: Mutex<HashMap<String, CachedAnswer>>,
}

struct CachedAnswer {
    stored: Instant,
    info: Option<ModInfo>,
}

impl<A: ModrinthApi> ModrinthLookup<A> {
    pub fn new(api: A) -> Self {
        Self::with(api, MOD_PROJECT_ID, CACHE_TTL)
    }

    /// Mit eigener Projekt-ID und eigener Gültigkeitsdauer; Tests brauchen beides anders als [`Self::new`].
    pub(super) fn with(api: A, own_project_id: &str, ttl: Duration) -> Self {
        Self { api, own_project_id: own_project_id.to_owned(), ttl, cache: Mutex::default() }
    }

    /// Die Hashes ohne Doppelte: was noch gültig im Speicher liegt, und was erst angefragt werden muss.
    fn split_cached(&self, hashes: &[String]) -> (HashMap<String, Option<ModInfo>>, Vec<String>) {
        let cache = lock(&self.cache);
        let (mut known, mut unknown) = (HashMap::new(), Vec::new());
        let mut seen = HashSet::new();
        for hash in hashes.iter().filter(|hash| seen.insert(hash.as_str())) {
            match cache.get(hash).filter(|answer| answer.stored.elapsed() < self.ttl) {
                Some(answer) => drop(known.insert(hash.clone(), answer.info.clone())),
                None => unknown.push(hash.clone()),
            }
        }
        (known, unknown)
    }

    fn remember(&self, answers: &HashMap<String, Option<ModInfo>>) {
        let now = Instant::now();
        let mut cache = lock(&self.cache);
        cache.retain(|_, answer| now.duration_since(answer.stored) < self.ttl);
        cache.extend(answers.iter().map(|(hash, info)| (hash.clone(), CachedAnswer { stored: now, info: info.clone() })));
    }

    async fn ask_modrinth(&self, hashes: &[String]) -> AppResult<HashMap<String, Option<ModInfo>>> {
        let versions = self.api.versions_by_sha512(hashes).await?;
        let project_ids = distinct_project_ids(&versions);
        let projects: HashMap<String, Project> = if project_ids.is_empty() {
            HashMap::new()
        } else {
            self.api.projects(&project_ids).await?.into_iter().map(|p| (p.id.clone(), p)).collect()
        };
        Ok(hashes
            .iter()
            .map(|hash| {
                let info = versions.get(hash).and_then(|v| projects.get(&v.project_id)).map(|p| self.describe(p));
                (hash.clone(), info)
            })
            .collect())
    }

    fn describe(&self, project: &Project) -> ModInfo {
        let ours = !self.own_project_id.is_empty() && project.id == self.own_project_id;
        ModInfo {
            title: project.title.clone(),
            project_id: project.id.clone(),
            client_only: ours || project.server_side == SERVER_SIDE_UNSUPPORTED,
        }
    }
}

impl<A: ModrinthApi> ModLookup for ModrinthLookup<A> {
    fn classify<'a>(&'a self, sha512: &'a [String]) -> BoxFuture<'a, Result<HashMap<String, ModInfo>, LookupError>> {
        Box::pin(async move {
            let (mut known, unknown) = self.split_cached(sha512);
            if !unknown.is_empty() {
                let answers = self.ask_modrinth(&unknown).await.map_err(|err| LookupError(err.to_string()))?;
                self.remember(&answers);
                known.extend(answers);
            }
            Ok(known.into_iter().filter_map(|(hash, info)| Some((hash, info?))).collect())
        })
    }
}

fn distinct_project_ids(versions: &HashMap<String, Version>) -> Vec<String> {
    let mut ids: Vec<String> = versions.values().map(|v| v.project_id.clone()).collect();
    ids.sort();
    ids.dedup();
    ids
}
