//! Transaktionaler Content-Import. Ziele werden exklusiv neu angelegt, niemals ersetzt.
use super::limits::{
    DOWNLOAD_CONCURRENCY, FILE_LIMIT, MIB, MRPACK_ENTRIES, MRPACK_EXPANDED_LIMIT, MRPACK_INDEX_FILES, PLAN_FILES,
    PLAN_LIMIT, ZIP_JSON_LIMIT,
};
use super::progress::{Phase, ProgressFn};
use super::transport::read_capped_io;
use super::zip_guard::{
    check_entry_count, ensure_no_file_dir_conflict, read_entry, reject_special, ExpandedSize,
};
use super::{download::RemoveOnDrop, none_if_missing, remove_logged};
use super::modrinth::{self, File, Version};
use super::providers::RemoteFile;
use crate::{
    error::{AppError, AppResult},
    models::{instance_name, Instance, Mod, ModKind, ModLoader, ModSource, NewInstance},
    state::AppState,
};
use futures::StreamExt;
use serde::Deserialize;
use std::{
    borrow::Cow,
    collections::{BTreeMap, HashMap, HashSet},
    fs,
    io::{Cursor, Write},
    path::{Path, PathBuf},
    sync::{Arc, Mutex},
};
use tokio_util::sync::CancellationToken;

const MAX_PATH_LEN: usize = 240;

pub fn safe_path(value: &str) -> AppResult<PathBuf> {
    if value.is_empty() || value.len() > MAX_PATH_LEN || value.contains('\\') {
        return Err(AppError::invalid("Unsicherer Pfad"));
    }
    if value.split('/').any(is_unsafe_component) {
        return Err(AppError::invalid(format!("Unsicherer Windows-Pfad: {value}")));
    }
    Ok(PathBuf::from(value))
}

/// Ein Pfadstück, das unter Windows nicht anlegbar ist oder aus dem Ordner führt.
fn is_unsafe_component(part: &str) -> bool {
    part.is_empty() || part == "." || part == ".." || part.ends_with(['.', ' ']) || has_unsafe_chars(part) || is_reserved_windows_name(part)
}

fn has_unsafe_chars(part: &str) -> bool {
    part.chars().any(|c| c.is_control() || "<>:\"|?*".contains(c))
}

/// Gerätenamen wie `CON` oder `COM1`, auch mit Endung (`CON.txt`).
fn is_reserved_windows_name(part: &str) -> bool {
    let base = part.split('.').next().unwrap_or("").to_ascii_uppercase();
    let numbered = (base.starts_with("COM") || base.starts_with("LPT"))
        && matches!(&base[3..], "1" | "2" | "3" | "4" | "5" | "6" | "7" | "8" | "9" | "¹" | "²" | "³");
    numbered || matches!(base.as_str(), "CON" | "PRN" | "AUX" | "NUL" | "CONIN$" | "CONOUT$")
}
/// Kein Symlink zwischen `root` und `path`. Oberhalb von `root` zählt nichts: Unter macOS ist schon `/var`
/// ein Symlink, unter manchen Linux-Systemen `/home`.
pub(crate) fn regular_parents(root: &Path, path: &Path) -> AppResult<()> {
    for ancestor in path.ancestors().take_while(|ancestor| *ancestor != root) {
        match none_if_missing(fs::symlink_metadata(ancestor))? {
            Some(m) if m.file_type().is_symlink() => return Err(AppError::invalid("Symlink im Zielpfad")),
            #[cfg(windows)]
            Some(m) if std::os::windows::fs::MetadataExt::file_attributes(&m) & 0x400 != 0 => {
                return Err(AppError::invalid("Reparse-Point im Zielpfad"))
            }
            Some(_) | None => {}
        }
    }
    Ok(())
}
pub(crate) fn write_new(root: &Path, path: &Path, data: &[u8]) -> AppResult<()> {
    regular_parents(root, path)?;
    let parent = path
        .parent()
        .ok_or_else(|| AppError::invalid("Fehlender Elternpfad"))?;
    fs::create_dir_all(parent)?;
    let mut file = fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(path)?;
    if let Err(e) = file.write_all(data).and_then(|()| file.sync_all()) {
        drop(file);
        return Err(match fs::remove_file(path) {
            Ok(()) => e.into(),
            Err(cleanup) => AppError::invalid(format!("{e}; Aufräumen: {cleanup}")),
        });
    }
    Ok(())
}

/// Ist `path` schon belegt? Verweise werden nicht aufgelöst; nur ein fehlendes Ziel ist frei, jeder andere Fehler bleibt einer.
pub(crate) fn is_occupied(path: &Path) -> AppResult<bool> {
    Ok(none_if_missing(fs::symlink_metadata(path))?.is_some())
}
pub(crate) fn rollback(paths: &[PathBuf], original: AppError) -> AppError {
    let mut errors = Vec::new();
    for path in paths.iter().rev() {
        if let Err(e) = fs::remove_file(path) {
            errors.push(format!("{}: {e}", path.display()));
        }
    }
    if errors.is_empty() {
        original
    } else {
        AppError::invalid(format!("{original}; Rollback: {}", errors.join("; ")))
    }
}
pub async fn install_mod(
    state: &AppState,
    id: &str,
    version: &str,
    progress: ProgressFn<'_>,
) -> AppResult<Instance> {
    let mut instance = state.instances.get(id)?;
    let client = modrinth::client()?;
    progress(Phase::Resolve, 0, 1);
    let root = modrinth::version(&client, version).await?;
    let project = modrinth::project(&client, &root.project_id).await?;
    let kind = match project.project_type.as_str() {
        "mod" => ModKind::Mod,
        "resourcepack" => ModKind::ResourcePack,
        "shader" => ModKind::Shader,
        _ => return Err(AppError::invalid("Projekt ist keine Mod, kein Ressourcenpaket und kein Shader")),
    };
    let root_project = root.project_id.clone();
    let mut selected = HashMap::new();
    if kind == ModKind::Mod {
        // Existing Modrinth roots also enter the graph, so incompatibilities work in both directions.
        for v in modrinth::resolve(&client, version, &instance).await? {
            modrinth::select(&mut selected, v)?;
        }
    } else {
        // Resource packs and shaders have no loader graph: MC version only, no dependencies.
        if project.id != root.project_id || !root.game_versions.contains(&instance.minecraft_version) {
            return Err(AppError::invalid(format!("Inkompatible Version {}", root.id)));
        }
        selected.insert(root_project.clone(), root);
    }
    if modrinth::has_incompatibility(&selected) {
        return Err(AppError::invalid("Inkompatible vorhandene Mod"));
    }
    let mut files = Vec::new();
    let mut fresh = HashSet::new();
    let mut names: HashSet<String> = instance
        .mods
        .iter()
        .map(|m| m.file_name.to_lowercase())
        .collect();
    for v in selected.values() {
        if let Some(existing) = instance
            .mods
            .iter_mut()
            .find(|m| project_of(m) == Some(&v.project_id))
        {
            if !existing.enabled {
                return Err(AppError::invalid("Benötigte vorhandene Mod ist deaktiviert"));
            }
            // Installing a present dependency directly makes it direct.
            if v.project_id == root_project {
                existing.required_by.clear();
            }
            continue;
        }
        let file = modrinth::primary(v, kind.extension())?;
        if !names.insert(file.filename.to_lowercase()) {
            return Err(AppError::invalid("Mod-Dateinamen kollidieren"));
        }
        let target = state.dirs.game_dir(id).join(kind.folder()).join(&file.filename);
        regular_parents(&state.dirs.root, &target)?;
        if is_occupied(&target)? {
            return Err(AppError::invalid("Mod-Zieldatei existiert bereits"));
        }
        if v.project_id != root_project {
            fresh.insert(v.project_id.clone());
        }
        files.push((v.clone(), file, target));
    }
    budget(files.iter().map(|(_, f, _)| f.size))?;
    let mut ready = Vec::new();
    let total = files.len() as u64;
    for (v, file, target) in files {
        progress(Phase::Download, ready.len() as u64, total);
        let data = modrinth::download(&client, &file).await?;
        ready.push((v, file, target, data));
    }
    let mut created = Vec::new();
    let result = (|| {
        for (v, file, target, data) in ready {
            write_new(&state.dirs.root, &target, &data)?;
            created.push(target);
            // Cache aus den verifizierten Bytes; Fehler rollen nur die Ziele zurück.
            let sha1 = super::mods::cache_bytes(&state.dirs, &data)?;
            instance.mods.push(Mod {
                id: v.project_id.clone(),
                name: v.name,
                version: v.version_number,
                source: ModSource::Modrinth {
                    project_id: v.project_id,
                    version_id: v.id,
                },
                file_name: file.filename,
                sha1: Some(sha1),
                enabled: true,
                kind,
                required_by: Vec::new(),
            });
        }
        mark_dependencies(&mut instance.mods, &selected, &fresh);
        commit_mods(state, id, instance.mods)
    })();
    match result {
        Err(e) => Err(rollback(&created, e)),
        Ok(i) => {
            progress(Phase::Complete, total, total);
            Ok(i)
        }
    }
}

pub(crate) fn budget(mut sizes: impl Iterator<Item = u64>) -> AppResult<()> {
    if sizes
        .try_fold(0u64, |a, b| a.checked_add(b))
        .is_none_or(|n| n > FILE_LIMIT)
    {
        return Err(AppError::invalid(format!(
            "Gesamtbudget für Mod-Download überschritten ({} MiB)",
            FILE_LIMIT / MIB
        )));
    }
    Ok(())
}

pub(crate) fn project_of(m: &Mod) -> Option<&String> {
    match &m.source {
        ModSource::Modrinth { project_id, .. } => Some(project_id),
        _ => None,
    }
}

/// Projects reachable over required dependencies from `root` inside the resolved graph.
fn reachable(root: &str, selected: &HashMap<String, Version>) -> HashSet<String> {
    let mut seen = HashSet::new();
    let mut stack = vec![root.to_string()];
    while let Some(p) = stack.pop() {
        let Some(v) = selected.get(&p) else { continue };
        for d in v.dependencies.iter().filter(|d| d.dependency_type == "required") {
            let target = d
                .version_id
                .as_ref()
                .and_then(|id| selected.values().find(|o| &o.id == id))
                .map(|o| o.project_id.clone())
                .or_else(|| d.project_id.clone());
            if let Some(t) = target.filter(|t| seen.insert(t.clone())) {
                stack.push(t);
            }
        }
    }
    seen
}

/// `required_by` = direct Modrinth mods (empty `required_by`) whose required graph reaches the mod.
/// Direct mods stay direct; `fresh` are dependencies installed by this operation, existing
/// dependencies gain additional owners. Removing owner P: drop P everywhere, emptied lists may go.
fn mark_dependencies(mods: &mut [Mod], selected: &HashMap<String, Version>, fresh: &HashSet<String>) {
    let owners: Vec<(String, HashSet<String>)> = mods
        .iter()
        .filter(|m| m.required_by.is_empty())
        .filter_map(project_of)
        .filter(|p| !fresh.contains(*p))
        .map(|p| (p.clone(), reachable(p, selected)))
        .collect();
    for m in mods.iter_mut() {
        let Some(p) = project_of(m).cloned() else { continue };
        if m.required_by.is_empty() && !fresh.contains(&p) {
            continue;
        }
        for (owner, reach) in &owners {
            if owner != &p && reach.contains(&p) && !m.required_by.contains(owner) {
                m.required_by.push(owner.clone());
            }
        }
        m.required_by.sort();
    }
}

/// Index into `mods` plus the other version from a `version_files/update` answer; whether it is
/// really newer decides `drop_older` once the installed versions are known.
fn newer(mods: &[Mod], latest: &HashMap<String, Version>, mc: &str) -> Vec<(usize, Version)> {
    mods.iter()
        .enumerate()
        .filter_map(|(i, m)| {
            let ModSource::Modrinth { project_id, version_id } = &m.source else {
                return None;
            };
            let v = latest.get(&m.sha1.as_ref()?.to_ascii_lowercase())?;
            (&v.project_id == project_id
                && &v.id != version_id
                && v.game_versions.iter().any(|g| g == mc))
            .then(|| (i, v.clone()))
        })
        .collect()
}

pub async fn check_updates(
    client: &reqwest::Client,
    instance: &Instance,
) -> AppResult<Vec<(usize, Version)>> {
    let mut found = Vec::new();
    for kind in ModKind::ALL {
        let hashes: Vec<String> = instance
            .mods
            .iter()
            .filter(|m| m.kind == kind && project_of(m).is_some())
            .filter_map(|m| m.sha1.as_ref().map(|h| h.to_ascii_lowercase()))
            .collect();
        let loaders = kind.update_loaders(instance.loader);
        let latest = modrinth::latest_by_hash(client, &hashes, loaders, &instance.minecraft_version).await?;
        found.extend(
            newer(&instance.mods, &latest, &instance.minecraft_version)
                .into_iter()
                .filter(|(i, _)| instance.mods[*i].kind == kind),
        );
    }
    if found.is_empty() {
        return Ok(found);
    }
    let hashes: Vec<String> = instance
        .mods
        .iter()
        .filter(|m| m.enabled && project_of(m).is_some())
        .filter_map(|m| m.sha1.as_ref().map(|h| h.to_ascii_lowercase()))
        .collect();
    let installed = modrinth::versions_by_hash(client, &hashes).await?;
    let found = drop_older(found, &instance.mods, &installed);
    Ok(drop_pinned(found, &instance.mods, &installed))
}

/// The latest release can be older than an installed beta/alpha (common in packs): no downgrades.
fn drop_older(
    mut found: Vec<(usize, Version)>,
    mods: &[Mod],
    installed: &HashMap<String, Version>,
) -> Vec<(usize, Version)> {
    found.retain(|(i, v)| {
        let now = mods[*i].sha1.as_ref().and_then(|h| installed.get(&h.to_ascii_lowercase()));
        now.is_none_or(|now| now.date_published.is_empty() || v.date_published > now.date_published)
    });
    found
}

/// `owner` requires `target`'s project in exactly another version than `target`.
fn pins_other(owner: &Version, target: &Version) -> bool {
    owner.project_id != target.project_id
        && owner.dependencies.iter().any(|d| {
            d.dependency_type == "required"
                && d.project_id.as_ref() == Some(&target.project_id)
                && d.version_id.as_ref().is_some_and(|id| id != &target.id)
        })
}

/// Drops updates that would fail dependency resolution because of an exact-version pin, in either
/// direction, against the planned set (updated versions win over installed ones). Repeats until
/// stable, since dropping one update can invalidate another.
/// ponytail: pins without project_id (version_id only) are not recognised.
fn drop_pinned(
    mut found: Vec<(usize, Version)>,
    mods: &[Mod],
    installed: &HashMap<String, Version>,
) -> Vec<(usize, Version)> {
    loop {
        let mut planned: HashMap<&str, &Version> = mods
            .iter()
            .filter(|m| m.enabled)
            .filter_map(|m| installed.get(&m.sha1.as_ref()?.to_ascii_lowercase()))
            .map(|v| (v.project_id.as_str(), v))
            .collect();
        for (_, v) in &found {
            planned.insert(&v.project_id, v);
        }
        let clashing: Vec<String> = found
            .iter()
            .filter(|(_, v)| planned.values().any(|p| pins_other(p, v) || pins_other(v, p)))
            .map(|(_, v)| v.id.clone())
            .collect();
        if clashing.is_empty() {
            return found;
        }
        found.retain(|(_, v)| !clashing.contains(&v.id));
    }
}

/// Speichert `mods` als neue Inhaltsliste der Instanz und liefert die gespeicherte Instanz.
pub(crate) fn commit_mods(state: &AppState, id: &str, mods: Vec<Mod>) -> AppResult<Instance> {
    state.instances.modify(id, |current| current.mods = mods)
}

/// Jede der `mod_ids` muss ein Eintrag der Instanz sein.
pub(crate) fn ensure_known(instance: &Instance, mod_ids: &[String]) -> AppResult<()> {
    match mod_ids.iter().find(|id| !instance.mods.iter().any(|m| &m.id == *id)) {
        Some(unknown) => Err(AppError::invalid(format!("Unbekannte Mod {unknown}"))),
        None => Ok(()),
    }
}

pub async fn update_mods(
    state: &AppState,
    id: &str,
    mod_ids: &[String],
    progress: ProgressFn<'_>,
) -> AppResult<Instance> {
    let instance = state.instances.get(id)?;
    ensure_known(&instance, mod_ids)?;
    let client = modrinth::client()?;
    progress(Phase::Resolve, 0, 1);
    let updates: Vec<_> = check_updates(&client, &instance)
        .await?
        .into_iter()
        .filter(|(i, _)| mod_ids.contains(&instance.mods[*i].id))
        .collect();
    let mut mods = instance.mods.clone();
    let mut names: HashSet<String> = mods.iter().map(|m| m.file_name.to_lowercase()).collect();
    let mut downloads = Vec::new();
    let mut old = Vec::new();
    for (i, v) in &updates {
        let m = &mut mods[*i];
        let file = modrinth::primary(v, m.kind.extension())?;
        // Same name as the old file: prefix with the version id instead of replacing it.
        let file_name = [file.filename.clone(), format!("{}-{}", v.id, file.filename)]
            .into_iter()
            .find(|n| names.insert(n.to_lowercase()))
            .ok_or_else(|| AppError::invalid("Mod-Dateinamen kollidieren"))?;
        old.push(Mod { enabled: false, ..m.clone() });
        m.source = ModSource::Modrinth { project_id: v.project_id.clone(), version_id: v.id.clone() };
        m.version = v.version_number.clone();
        m.file_name = file_name;
        downloads.push((*i, file));
    }
    // New required dependencies of enabled mods; every other enabled mod stays pinned.
    let mut selected = HashMap::new();
    let mut fresh = HashSet::new();
    let root = updates
        .iter()
        .find(|(i, _)| mods[*i].kind == ModKind::Mod && mods[*i].enabled);
    if let Some((_, root)) = root {
        let planned = Instance { mods: mods.clone(), ..instance.clone() };
        for v in modrinth::resolve(&client, &root.id, &planned).await? {
            modrinth::select(&mut selected, v)?;
        }
        let mut deps: Vec<_> = selected.values().collect();
        deps.sort_by(|a, b| a.project_id.cmp(&b.project_id));
        for v in deps {
            if let Some(existing) = mods.iter().find(|m| project_of(m) == Some(&v.project_id)) {
                if !existing.enabled {
                    return Err(AppError::invalid("Benötigte vorhandene Mod ist deaktiviert"));
                }
                continue;
            }
            let file = modrinth::primary(v, ".jar")?;
            if !names.insert(file.filename.to_lowercase()) {
                return Err(AppError::invalid("Mod-Dateinamen kollidieren"));
            }
            fresh.insert(v.project_id.clone());
            mods.push(Mod {
                id: v.project_id.clone(),
                name: v.name.clone(),
                version: v.version_number.clone(),
                source: ModSource::Modrinth { project_id: v.project_id.clone(), version_id: v.id.clone() },
                file_name: file.filename.clone(),
                sha1: None,
                enabled: true,
                kind: ModKind::Mod,
                required_by: Vec::new(),
            });
            downloads.push((mods.len() - 1, file));
        }
    }
    budget(downloads.iter().map(|(_, f)| f.size))?;
    let total = downloads.len() as u64;
    for (n, (i, file)) in downloads.iter().enumerate() {
        progress(Phase::Download, n as u64, total);
        let data = modrinth::download(&client, file).await?;
        mods[*i].sha1 = Some(super::mods::cache_bytes(&state.dirs, &data)?);
    }
    mark_dependencies(&mut mods, &selected, &fresh);
    // sync places the new files and removes the old ones in one journal; metadata commits last.
    let desired: Vec<Mod> = mods.iter().cloned().chain(old).collect();
    let commit = |_| commit_mods(state, id, mods);
    let result = super::mods::sync_commit(&state.dirs, id, &desired, commit)?;
    progress(Phase::Complete, total, total);
    Ok(result)
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Index {
    format_version: u32,
    game: String,
    files: Vec<PackFile>,
    dependencies: BTreeMap<String, String>,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct PackFile {
    path: String,
    hashes: BTreeMap<String, String>,
    downloads: Vec<String>,
    file_size: u64,
    env: Option<BTreeMap<String, String>>,
}
/// Woher eine Pack-Datei kommt: Modrinth-CDN (SHA-1 und SHA-512) oder ein Anbieter ohne Schlüssel.
pub(crate) enum Fetch {
    Modrinth(File),
    Remote(RemoteFile),
}
impl Fetch {
    async fn download(&self, client: &reqwest::Client) -> AppResult<Vec<u8>> {
        match self {
            Self::Modrinth(file) => modrinth::download(client, file).await,
            Self::Remote(file) => file.download(client).await,
        }
    }
}
/// Inhalt einer Datei im Plan: im Speicher (`.mrpack`) oder bei Bedarf aus einem geöffneten Zip auf der
/// Platte (Technic), damit große Packs nicht ganz im Arbeitsspeicher liegen müssen.
pub(crate) enum Blob {
    Mem(Vec<u8>),
    Zip { archive: Arc<Mutex<zip::ZipArchive<fs::File>>>, index: usize },
}
impl Blob {
    pub(crate) fn bytes(&self) -> AppResult<Cow<'_, [u8]>> {
        match self {
            Self::Mem(data) => Ok(Cow::Borrowed(data)),
            Self::Zip { archive, index } => {
                let mut zip = archive.lock().map_err(|_| AppError::invalid("Zip nicht lesbar"))?;
                let data = read_entry(&mut zip.by_index(*index)?, FILE_LIMIT)?;
                Ok(Cow::Owned(data))
            }
        }
    }
}
/// Temporäre Datei, die beim Verwerfen verschwindet (auch bei Abbruch des Vorgangs).
pub(crate) struct TempFile(pub PathBuf);
impl TempFile {
    /// Pfad einer neuen `.zip` im Zwischenspeicher der App (`cache/tmp`, wird angelegt); die Datei entsteht erst beim Schreiben.
    pub(crate) fn in_cache(dirs: &super::Dirs) -> AppResult<Self> {
        let tmp = dirs.root.join("cache").join("tmp");
        fs::create_dir_all(&tmp)?;
        Ok(Self(tmp.join(format!("{}.zip", crate::models::new_id()))))
    }
}
impl Drop for TempFile {
    fn drop(&mut self) {
        remove_logged(&self.0);
    }
}
pub(crate) struct Pack {
    pub(crate) instance: Instance,
    pub(crate) downloads: Vec<(PathBuf, Fetch)>,
    pub(crate) overrides: Vec<(PathBuf, Blob)>,
    /// Aus `pumpkin.json` eigener Vorlagen: Dateiname -> `required_by`.
    pub(crate) required_by: HashMap<String, Vec<String>>,
    /// Dateiname -> (CurseForge-Projekt, Datei), für Mods, die das Pack von CurseForge bezieht.
    pub(crate) origins: HashMap<String, (u32, u32)>,
    /// Zuletzt: wird nach `overrides` verworfen, damit das Zip vor dem Löschen geschlossen ist.
    pub(crate) temp: Option<TempFile>,
}
/// Installationsplan eines Anbieters: nur Dateien zum Laden, relativ zum Spielordner.
/// Gleiche Regeln wie beim `.mrpack`: sichere Pfade, keine Doppelten, Größenlimits.
pub(crate) fn plan_pack(instance: Instance, files: Vec<(String, RemoteFile)>) -> AppResult<Pack> {
    if files.len() > PLAN_FILES {
        return Err(AppError::invalid("Zu viele Pack-Dateien"));
    }
    let mut paths = HashSet::new();
    let mut downloads = Vec::new();
    let mut expanded = ExpandedSize::new(PLAN_LIMIT);
    for (name, file) in files {
        let path = safe_path(&name)?;
        expanded.add_file(file.size)?;
        if !paths.insert(name.to_lowercase()) {
            return Err(AppError::invalid("Doppelte Pack-Zieldatei"));
        }
        downloads.push((path, Fetch::Remote(file)));
    }
    ensure_no_file_dir_conflict(&paths)?;
    Ok(Pack { instance, downloads, overrides: Vec::new(), required_by: HashMap::new(), origins: HashMap::new(), temp: None })
}
/// Eigene Zusatzdatei in Vorlagen-`.mrpack`s; andere Launcher ignorieren sie.
pub const PUMPKIN_FILE: &str = "pumpkin.json";
#[derive(Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct PumpkinMeta {
    #[serde(default)]
    required_by: HashMap<String, Vec<String>>,
}
fn unpack(data: &[u8], name: &str) -> AppResult<Pack> {
    let name = instance_name(name)?;
    if data.len() as u64 > FILE_LIMIT {
        return Err(AppError::invalid("Pack zu groß"));
    }
    let mut zip = zip::ZipArchive::new(Cursor::new(data))?;
    check_entry_count(zip.len(), MRPACK_ENTRIES)?;
    let mut expanded = ExpandedSize::new(MRPACK_EXPANDED_LIMIT);
    let mut entries = HashSet::new();
    let mut overrides = Vec::new();
    let mut manifest = None;
    let mut meta = PumpkinMeta::default();
    let mut canonical_meta = false;
    for i in 0..zip.len() {
        let mut entry = zip.by_index(i)?;
        let name = entry.name().to_string();
        let clean = name.strip_suffix('/').unwrap_or(&name);
        safe_path(clean)?;
        if !entries.insert(clean.to_lowercase()) {
            return Err(AppError::invalid("Doppelter ZIP-Pfad"));
        }
        reject_special(&entry)?;
        expanded.add_entry(&entry)?;
        if entry.is_dir() {
            continue;
        }
        let is_index = name == "modrinth.index.json";
        // Ältere eigene Vorlagen haben denselben Inhalt unter einem anderen Markennamen.
        // Nur JSON direkt im Archivwurzelverzeichnis kommt als Zusatzdatei infrage.
        let is_meta = !is_index && !name.contains('/') && name.ends_with(".json");
        let target = name
            .strip_prefix("client-overrides/")
            .or_else(|| name.strip_prefix("overrides/"));
        if !is_index && !is_meta && target.is_none() {
            continue;
        }
        let limit = if is_index || is_meta { ZIP_JSON_LIMIT } else { FILE_LIMIT };
        let bytes = read_entry(&mut entry, limit)?;
        if is_index {
            manifest = Some(serde_json::from_slice::<Index>(&bytes)?);
        } else if is_meta {
            let value = serde_json::from_slice::<serde_json::Value>(&bytes);
            if name == PUMPKIN_FILE {
                meta = serde_json::from_value(value?)?;
                canonical_meta = true;
            } else if let Ok(value) = value {
                if !canonical_meta && value.get("requiredBy").is_some() && meta.required_by.is_empty() {
                    if let Ok(compatible) = serde_json::from_value(value) {
                        meta = compatible;
                    }
                }
            }
        } else if let Some(target) = target {
            overrides.push((
                safe_path(target)?,
                bytes,
                name.starts_with("client-overrides/"),
            ));
        }
    }
    let index = manifest.ok_or_else(|| AppError::invalid("modrinth.index.json fehlt"))?;
    if index.format_version != 1 || index.game != "minecraft" || index.files.len() > MRPACK_INDEX_FILES {
        return Err(AppError::invalid("Nicht unterstütztes Packformat"));
    }
    let loaders: Vec<(ModLoader, String)> = ModLoader::PACK_KEYS
        .iter()
        .filter_map(|(l, k)| index.dependencies.get(*k).map(|v| (*l, v.clone())))
        .collect();
    if loaders.len() > 1 || index.dependencies.len() > loaders.len() + 1 {
        return Err(AppError::invalid("Das Pack braucht einen Loader, den Pumpkin Launcher nicht kennt"));
    }
    let mc = index
        .dependencies
        .get("minecraft")
        .ok_or_else(|| AppError::invalid("Minecraft-Version fehlt"))?
        .clone();
    modrinth::identifier(&mc)?;
    let (loader, loader_version) = loaders.into_iter().next().map_or((ModLoader::Vanilla, None), |(l, v)| (l, Some(v)));
    if let Some(v) = &loader_version {
        modrinth::identifier(v)?;
    }
    // Vor dem Download ablehnen, was Pumpkin Launcher nicht starten kann (z. B. Forge vor 1.17).
    crate::services::forge::check_loader(loader, &mc)?;
    let instance = Instance::from_new(NewInstance {
        name: name.into(),
        minecraft_version: mc,
        loader,
        loader_version,
    });
    let mut paths = HashSet::new();
    let mut downloads = Vec::new();
    for f in index.files {
        let path = safe_path(&f.path)?;
        if let Some(env) = &f.env {
            if env
                .values()
                .any(|v| !matches!(v.as_str(), "required" | "optional" | "unsupported"))
            {
                return Err(AppError::invalid("Unbekannte Pack-Umgebung"));
            }
            if env
                .get("client")
                .is_some_and(|v| v == "unsupported" || v == "optional")
            {
                continue;
            }
        }
        expanded.add_file(f.file_size)?;
        for url in &f.downloads {
            modrinth::download_url(url)?;
        }
        let url = f
            .downloads
            .first()
            .ok_or_else(|| AppError::invalid("Download-URL fehlt"))?
            .clone();
        if !paths.insert(f.path.to_lowercase()) {
            return Err(AppError::invalid("Doppelte Pack-Zieldatei"));
        }
        downloads.push((
            path,
            Fetch::Modrinth(File {
                filename: f.path,
                hashes: f.hashes,
                url,
                size: f.file_size,
                primary: true,
            }),
        ));
    }
    // Client overrides win over generic overrides only inside this fresh staging plan.
    overrides.sort_by_key(|(_, _, client)| *client);
    let mut merged = BTreeMap::new();
    for (path, data, _) in overrides {
        merged.insert(path.to_string_lossy().to_lowercase(), (path, data));
    }
    let overrides: Vec<(PathBuf, Blob)> = merged.into_values().map(|(path, data)| (path, Blob::Mem(data))).collect();
    for (path, _) in &overrides {
        if !paths.insert(path.to_string_lossy().to_lowercase()) {
            return Err(AppError::invalid("Overrides kollidieren mit Pack-Dateien"));
        }
    }
    ensure_no_file_dir_conflict(&paths)?;
    Ok(Pack {
        instance,
        downloads,
        overrides,
        required_by: meta.required_by,
        origins: HashMap::new(),
        temp: None,
    })
}
pub async fn import(
    state: &AppState,
    data: &[u8],
    name: &str,
    origin: Option<crate::models::ModpackOrigin>,
    progress: ProgressFn<'_>,
) -> AppResult<Instance> {
    progress(Phase::Validate, 0, 1);
    import_plan(state, unpack(data, name)?, origin, progress).await
}
/// Legt die Instanz aus einem fertigen Plan an: laden, prüfen, ablegen; bei Fehler oder Abbruch restlos zurück.
pub(crate) async fn import_plan(
    state: &AppState,
    mut pack: Pack,
    origin: Option<crate::models::ModpackOrigin>,
    progress: ProgressFn<'_>,
) -> AppResult<Instance> {
    pack.instance.modpack = origin;
    let root = state.dirs.instance(&pack.instance.id);
    regular_parents(&state.dirs.root, &root)?;
    fs::create_dir_all(state.dirs.root.join("instances"))?;
    fs::create_dir(&root)?;
    // Abbruch (Future verworfen) räumt die halbe Instanz weg; Fehler räumt unten `match` auf.
    let guard = RemoveOnDrop::new(root.clone());
    let result = async {
        let client = modrinth::client()?;
        let downloader = modrinth::download_client()?;
        let total = (pack.downloads.len() + pack.overrides.len()) as u64;
        let mut done = 0;
        // (kind, file name, sha1) of every staged content file; bytes go to the cache right away.
        let mut content = Vec::new();
        let mut stage = |path: &Path, data: &[u8]| -> AppResult<()> {
            write_new(&state.dirs.root, &state.dirs.game_dir(&pack.instance.id).join(path), data)?;
            if let Some((kind, name)) = content_file(path) {
                content.push((kind, name, super::mods::cache_bytes(&state.dirs, data)?));
            }
            Ok(())
        };
        // `buffered` liefert in Plan-Reihenfolge, auch wenn spätere Dateien früher fertig sind (FTB-Packs haben über tausend).
        let mut fetched = futures::stream::iter(pack.downloads.into_iter().map(|(path, file)| {
            let client = &downloader;
            async move { Ok::<_, AppError>((path, file.download(client).await?)) }
        }))
        .buffered(DOWNLOAD_CONCURRENCY);
        while let Some(item) = fetched.next().await {
            let (path, data) = item?;
            progress(Phase::Download, done, total);
            stage(&path, &data)?;
            done += 1;
        }
        drop(fetched);
        for (path, blob) in std::mem::take(&mut pack.overrides) {
            stage(&path, &blob.bytes()?)?;
            done += 1;
            progress(Phase::Extract, done, total);
        }
        let hashes: Vec<String> = content.iter().map(|(_, _, sha1)| sha1.clone()).collect();
        let (known, titles) = identify_or_local(&client, &hashes).await;
        for (kind, file_name, sha1) in content {
            let mut m = entry(kind, file_name, sha1, &known, &titles, &pack.instance.mods);
            apply_origin(&mut m, &pack.origins, &pack.instance.mods);
            pack.instance.mods.push(m);
        }
        if pack.required_by.is_empty() {
            derive_required_by(&mut pack.instance.mods, &known);
        } else {
            for m in &mut pack.instance.mods {
                m.required_by = pack.required_by.remove(&m.file_name).unwrap_or_default();
            }
        }
        let instance = state.instances.insert(pack.instance)?;
        progress(Phase::Complete, total, total);
        Ok(instance)
    }
    .await;
    guard.disarm();
    match result {
        Err(e) => {
            if let Err(cleanup) = fs::remove_dir_all(&root) {
                return Err(AppError::invalid(format!("{e}; Rollback: {cleanup}")));
            }
            Err(e)
        }
        Ok(i) => Ok(i),
    }
}
/// Legt den Ordner einer neuen Instanz an und befüllt ihn im Thread mit `work`, das `stop` regelmäßig prüft. Der
/// Wächter räumt den Ordner weg, bis der Aufrufer ihn nach dem Eintragen der Instanz mit `disarm` entschärft.
/// Er lebt im Thread: bei Abbruch räumt er erst weg, wenn dort nichts mehr geschrieben wird.
pub(crate) async fn populate_new_dir<T: Send + 'static>(
    dirs: &super::Dirs,
    dir: PathBuf,
    work: impl FnOnce(&CancellationToken) -> AppResult<T> + Send + 'static,
) -> AppResult<(RemoveOnDrop, T)> {
    regular_parents(&dirs.root, &dir)?;
    super::blocking(move |stop| {
        let guard = RemoveOnDrop::new(dir.clone());
        fs::create_dir_all(&dir)?;
        Ok((guard, work(stop)?))
    })
    .await
}

/// Testhilfe: startet `run` mit einem Fortschrittsrückruf, der beim Schritt `step` anhält, bricht dann ab und gibt
/// das Ergebnis zurück, sobald der Thread zu Ende ist und der Wächter den neuen Instanzordner weggeräumt hat.
#[cfg(test)]
pub(crate) async fn cancel_at_step<T, F: std::future::Future<Output = AppResult<T>>>(
    state: &AppState,
    step: u64,
    run: impl FnOnce(super::progress::SharedProgress) -> F,
) -> AppResult<T> {
    let instances = state.dirs.root.join("instances");
    let folders = || fs::read_dir(&instances).map_or(0, Iterator::count);
    let before = folders();
    let (reached, started) = std::sync::mpsc::channel();
    let (resume, hold) = std::sync::mpsc::channel::<()>();
    let hold = std::sync::Mutex::new(hold);
    let progress = move |_: Phase, done: u64, _: u64| {
        if done == step {
            reached.send(()).unwrap();
            hold.lock().unwrap().recv().ok();
        }
    };
    let work = state.cancellable("op", run(std::sync::Arc::new(progress)));
    let (result, ()) = tokio::join!(work, async {
        started.recv().unwrap();
        state.cancel("op");
    });
    drop(resume);
    // Endet der Thread, schließt sich `started`; der Wächter räumt gleich danach auf.
    assert!(started.recv().is_err());
    for _ in 0..500 {
        if folders() == before {
            break;
        }
        std::thread::sleep(std::time::Duration::from_millis(10));
    }
    result
}

/// `mods/*.jar`, `resourcepacks/*.zip`, `shaderpacks/*.zip` directly in the folder, else None.
fn content_file(path: &Path) -> Option<(ModKind, String)> {
    let (folder, name) = path.to_str()?.split_once('/')?;
    ModKind::ALL
        .into_iter()
        .find(|k| k.folder() == folder && !name.contains('/') && name.ends_with(k.extension()))
        .map(|k| (k, name.to_string()))
}

/// Wie [`identify`], aber ohne Netz leer: die Inhalte gelten dann als lokal.
pub(crate) async fn identify_or_local(
    client: &reqwest::Client,
    hashes: &[String],
) -> (HashMap<String, Version>, HashMap<String, String>) {
    identify(client, hashes).await.unwrap_or_else(|err| {
        tracing::warn!(%err, "Inhalte nicht bei Modrinth erkannt; als lokal erfasst");
        Default::default()
    })
}

/// sha1 -> Modrinth version plus project id -> title (titles best effort), two requests at most.
pub(crate) async fn identify(
    client: &reqwest::Client,
    hashes: &[String],
) -> AppResult<(HashMap<String, Version>, HashMap<String, String>)> {
    // Tests stay offline and exercise the fallback path.
    if cfg!(test) {
        return Err(AppError::invalid("Kein Netzwerk in Tests"));
    }
    let known = modrinth::versions_by_hash(client, hashes).await?;
    let mut ids: Vec<String> = known.values().map(|v| v.project_id.clone()).collect();
    ids.sort();
    ids.dedup();
    let titles = match modrinth::projects(client, &ids).await {
        Ok(projects) => projects.into_iter().map(|p| (p.id, p.title)).collect(),
        Err(err) => {
            tracing::warn!(%err, "Projekttitel nicht geladen");
            HashMap::new()
        }
    };
    Ok((known, titles))
}

/// Fremde Packs: `required_by` aus den Pflicht-Abhängigkeiten der erkannten Modrinth-Versionen.
/// Was keine andere enthaltene Mod braucht, gilt als direkt hinzugefügt.
fn derive_required_by(mods: &mut [Mod], known: &HashMap<String, Version>) {
    let selected: HashMap<String, Version> =
        known.values().map(|v| (v.project_id.clone(), v.clone())).collect();
    let fresh: HashSet<String> = selected
        .values()
        .flat_map(|v| &v.dependencies)
        .filter(|d| d.dependency_type == "required")
        .filter_map(|d| {
            d.project_id.clone().or_else(|| {
                let id = d.version_id.as_ref()?;
                selected.values().find(|o| &o.id == id).map(|o| o.project_id.clone())
            })
        })
        .filter(|p| selected.contains_key(p))
        .collect();
    mark_dependencies(mods, &selected, &fresh);
}

/// Inhalt im Spielordner, der nicht in `instance.mods` steht.
struct UntrackedFile {
    kind: ModKind,
    file_name: String,
    enabled: bool,
    path: PathBuf,
}

/// Inhalte im Spielordner, die nicht in `instance.mods` stehen. `name.jar.disabled` zählt als deaktiviertes `name.jar`.
fn untracked(dirs: &super::Dirs, instance: &Instance) -> AppResult<Vec<UntrackedFile>> {
    let mut found: Vec<UntrackedFile> = Vec::new();
    for kind in ModKind::ALL {
        let mut listing = super::entries(&dirs.game_dir(&instance.id).join(kind.folder()))?;
        // read_dir liefert je Dateisystem eine andere Reihenfolge (NTFS sortiert, ext4/APFS nicht).
        listing.sort_by_key(|e| e.file_name());
        for e in listing {
            let Some(raw) = e.file_name().to_str().map(str::to_owned) else { continue };
            let (name, enabled) = match raw.strip_suffix(".disabled") {
                Some(name) => (name.to_owned(), false),
                None => (raw, true),
            };
            let seen = instance.mods.iter().any(|m| m.kind == kind && m.file_name.eq_ignore_ascii_case(&name))
                || found.iter().any(|f| f.kind == kind && f.file_name.eq_ignore_ascii_case(&name));
            if seen || !e.file_type()?.is_file() || !name.ends_with(kind.extension()) || safe_path(&name).is_err() {
                continue;
            }
            found.push(UntrackedFile { kind, file_name: name, enabled, path: e.path() });
        }
    }
    Ok(found)
}

/// Nachpflege nach dem Start für Packs, die vor der Inhalts-Liste importiert wurden: Instanzen ganz ohne Inhalts-Liste
/// bekommen die Dateien aus `mods/`, `resourcepacks/`, `shaderpacks/` gecacht eingetragen;
/// erkannt per Modrinth-Sammelabfrage, ohne Netz als lokal. Liefert die Anzahl neuer Einträge.
/// Nur leere Listen: sonst kämen vom Nutzer entfernte Mods zurück, deren Datei nicht löschbar war.
/// Läuft unter dem Operations-Lock; ist er belegt, entfällt der Lauf bis zum nächsten Start.
pub async fn adopt_untracked(state: &AppState) -> AppResult<usize> {
    let Ok(_guard) = state.begin_operation() else {
        tracing::info!("Nachtragen übersprungen: ein anderer Vorgang läuft");
        return Ok(0);
    };
    let mut plan = Vec::new();
    for instance in state.instances.list().into_iter().filter(|i| i.mods.is_empty()) {
        let found = cached_untracked(&state.dirs, &instance, &|_, _, _| {}, &CancellationToken::new())?;
        if !found.is_empty() {
            plan.push((instance.id, found));
        }
    }
    if plan.is_empty() {
        return Ok(0);
    }
    let mut hashes: Vec<String> = plan.iter().flat_map(|(_, found)| found.iter().map(|f| f.sha1.clone())).collect();
    hashes.sort();
    hashes.dedup();
    let (known, titles) = identify_or_local(&modrinth::client()?, &hashes).await;
    let mut added = 0;
    for (id, found) in plan {
        let adopted = state.instances.modify(&id, |current| record(&mut current.mods, &found, &known, &titles, &HashMap::new()));
        match adopted {
            Ok(_) => added += found.len(),
            // Inzwischen gelöscht: nichts nachzutragen.
            Err(AppError::NotFound { .. }) => {}
            Err(err) => return Err(err),
        }
    }
    Ok(added)
}

/// Import aus einem anderen Launcher: trägt die gecachten Inhalte des kopierten Spielordners ein, erkannt per
/// Modrinth-Sammelabfrage; ohne Netz als lokal, mit `origins` (Dateiname -> CurseForge-Projekt, Datei) als CurseForge.
pub(crate) async fn record_untracked(mods: &mut Vec<Mod>, found: &[CachedFile], origins: &HashMap<String, (u32, u32)>) -> AppResult<()> {
    let hashes: Vec<String> = found.iter().map(|f| f.sha1.clone()).collect();
    let (known, titles) = identify_or_local(&modrinth::client()?, &hashes).await;
    record(mods, found, &known, &titles, origins);
    Ok(())
}

/// Inhaltsdatei, die im Mod-Cache liegt und unter `file_name` im Spielordner steht (oder dorthin kommt).
pub(crate) struct CachedFile {
    pub kind: ModKind,
    pub file_name: String,
    pub enabled: bool,
    pub sha1: String,
}

/// `untracked` in den Mod-Cache legen; Fortschritt als Phase `hash` (Dateien). Liest jede Datei ganz, beim Import
/// deshalb im Kopier-Thread. Ist `stop` abgebrochen, endet es vor der nächsten Datei mit `AppError::Cancelled`.
pub(crate) fn cached_untracked(
    dirs: &super::Dirs,
    instance: &Instance,
    progress: ProgressFn<'_>,
    stop: &CancellationToken,
) -> AppResult<Vec<CachedFile>> {
    let files = untracked(dirs, instance)?;
    let total = files.len() as u64;
    let mut found = Vec::with_capacity(files.len());
    for (done, file) in (1..).zip(files) {
        super::check_cancelled(stop)?;
        let sha1 = super::mods::cache_file(dirs, &file.path)?;
        found.push(CachedFile { kind: file.kind, file_name: file.file_name, enabled: file.enabled, sha1 });
        progress(Phase::Hash, done, total);
    }
    Ok(found)
}

fn record(
    mods: &mut Vec<Mod>,
    found: &[CachedFile],
    known: &HashMap<String, Version>,
    titles: &HashMap<String, String>,
    origins: &HashMap<String, (u32, u32)>,
) {
    for file in found {
        let mut m = entry(file.kind, file.file_name.clone(), file.sha1.clone(), known, titles, mods);
        apply_origin(&mut m, origins, mods);
        mods.push(Mod { enabled: file.enabled, ..m });
    }
    derive_required_by(mods, known);
}

/// Von CurseForge bezogen und nicht bei Modrinth erkannt: Herkunft merken statt „lokal“.
fn apply_origin(m: &mut Mod, origins: &HashMap<String, (u32, u32)>, existing: &[Mod]) {
    let Some(&(project_id, file_id)) = origins.get(&m.file_name).filter(|_| m.source == ModSource::Local) else { return };
    let id = format!("cf-{project_id}");
    // Zwei Dateien desselben Projekts behalten verschiedene IDs.
    if !existing.iter().any(|x| x.id == id) {
        m.id = id;
    }
    m.source = ModSource::CurseForge { project_id, file_id };
}

pub(crate) fn entry(
    kind: ModKind,
    file_name: String,
    sha1: String,
    known: &HashMap<String, Version>,
    titles: &HashMap<String, String>,
    existing: &[Mod],
) -> Mod {
    let stem = file_name.strip_suffix(kind.extension()).unwrap_or(&file_name).to_string();
    let (id, name, version, source) = match known.get(&sha1) {
        Some(v) => (
            // Two files of one project keep distinct ids.
            Some(v.project_id.clone()).filter(|p| !existing.iter().any(|m| &m.id == p)),
            titles.get(&v.project_id).cloned().unwrap_or(stem),
            v.version_number.clone(),
            ModSource::Modrinth { project_id: v.project_id.clone(), version_id: v.id.clone() },
        ),
        None => (None, stem, String::new(), ModSource::Local),
    };
    Mod {
        id: id.unwrap_or_else(crate::models::new_id),
        name,
        version,
        source,
        file_name,
        sha1: Some(sha1),
        enabled: true,
        kind,
        required_by: Vec::new(),
    }
}
pub fn local_pack(path: &Path) -> AppResult<Vec<u8>> {
    if !path.is_absolute() || path.extension().and_then(|s| s.to_str()) != Some("mrpack") {
        return Err(AppError::invalid("Absoluter .mrpack-Pfad erforderlich"));
    }
    let file = fs::File::open(path)?;
    if !file.metadata()?.is_file() {
        return Err(AppError::invalid("Keine reguläre Datei"));
    }
    read_capped_io(file, FILE_LIMIT, "Pack zu groß")
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Symlinks anlegen darf unter Windows nicht jeder Benutzer; geprüft wird daher unter Unix.
    #[cfg(unix)]
    #[test]
    fn only_symlinks_below_the_data_root_count() {
        let base = std::env::temp_dir().join(crate::models::new_id());
        let real = base.join("real");
        fs::create_dir_all(real.join("mods")).unwrap();
        let linked_root = base.join("data");
        std::os::unix::fs::symlink(&real, &linked_root).unwrap();
        assert!(regular_parents(&linked_root, &linked_root.join("mods/a.jar")).is_ok());
        assert!(regular_parents(&base, &linked_root.join("mods/a.jar")).is_err());
        fs::remove_dir_all(base).unwrap();
    }

    fn modrinth_mod(project: &str, required_by: &[&str]) -> Mod {
        Mod {
            id: project.into(),
            name: project.into(),
            version: "1".into(),
            source: ModSource::Modrinth { project_id: project.into(), version_id: format!("{project}1") },
            file_name: format!("{project}.jar"),
            sha1: Some(format!("{:0>40}", project.len())),
            enabled: true,
            kind: ModKind::Mod,
            required_by: required_by.iter().map(|s| s.to_string()).collect(),
        }
    }
    fn graph(edges: &[(&str, &[&str])]) -> HashMap<String, Version> {
        edges
            .iter()
            .map(|(p, deps)| {
                let v: Version = serde_json::from_value(serde_json::json!({
                    "id": format!("{p}1"), "project_id": p, "name": p, "version_number": "1",
                    "game_versions": ["1.21.1"], "loaders": ["fabric"], "files": [],
                    "dependencies": deps.iter().map(|d| serde_json::json!({
                        "version_id": null, "project_id": d, "file_name": null, "dependency_type": "required"
                    })).collect::<Vec<_>>()
                }))
                .unwrap();
                (p.to_string(), v)
            })
            .collect()
    }
    #[test]
    fn required_by_marks_owners_and_keeps_direct_mods() {
        // x (direct) -> y, x -> z (direct); install a -> b -> c, a -> y, a -> z.
        let selected = graph(&[
            ("x", &["y", "z"]),
            ("y", &[]),
            ("z", &[]),
            ("a", &["b", "y", "z"]),
            ("b", &["c"]),
            ("c", &[]),
        ]);
        let mut mods = vec![
            modrinth_mod("x", &[]),
            modrinth_mod("y", &["x"]),
            modrinth_mod("z", &[]),
            modrinth_mod("a", &[]),
            modrinth_mod("b", &[]),
            modrinth_mod("c", &[]),
        ];
        let fresh = HashSet::from(["b".to_string(), "c".to_string()]);
        mark_dependencies(&mut mods, &selected, &fresh);
        let by: Vec<_> = mods.iter().map(|m| m.required_by.join(",")).collect();
        assert_eq!(by, ["", "a,x", "", "", "a", "a"]);
    }
    #[test]
    fn older_release_is_no_update() {
        let at = |id: &str, date: &str| -> Version {
            serde_json::from_value(serde_json::json!({
                "id": id, "project_id": "lux", "name": id, "version_number": id, "game_versions": ["1.21.1"],
                "loaders": ["fabric"], "files": [], "dependencies": [], "date_published": date
            }))
            .unwrap()
        };
        let mods = [modrinth_mod("lux", &[])];
        let installed = HashMap::from([(mods[0].sha1.clone().unwrap(), at("alpha", "2026-09-01T10:00:00Z"))]);
        assert!(drop_older(vec![(0, at("old", "2026-08-01T10:00:00Z"))], &mods, &installed).is_empty());
        assert_eq!(drop_older(vec![(0, at("new", "2026-09-20T10:00:00Z"))], &mods, &installed).len(), 1);
        assert_eq!(drop_older(vec![(0, at("new", ""))], &mods, &HashMap::new()).len(), 1);
    }
    #[test]
    fn pinned_dependency_blocks_lonely_update() {
        let v = |id: &str, project: &str, pin: Option<(&str, &str)>| -> Version {
            serde_json::from_value(serde_json::json!({
                "id": id, "project_id": project, "name": id, "version_number": id,
                "game_versions": ["1.21.1"], "loaders": ["fabric"], "files": [],
                "dependencies": pin.map(|(p, vid)| vec![serde_json::json!({
                    "version_id": vid, "project_id": p, "file_name": null, "dependency_type": "required"
                })]).unwrap_or_default()
            }))
            .unwrap()
        };
        let mods = [modrinth_mod("iris", &[]), modrinth_mod("sodium", &["iris"])];
        let installed: HashMap<String, Version> = mods
            .iter()
            .zip([v("iris1", "iris", Some(("sodium", "sodium1"))), v("sodium1", "sodium", None)])
            .map(|(m, v)| (m.sha1.clone().unwrap(), v))
            .collect();
        // Sodium alone: iris1 pins sodium1, so the update would not resolve.
        assert!(drop_pinned(vec![(1, v("sodium2", "sodium", None))], &mods, &installed).is_empty());
        // Together with an Iris update that pins sodium2 both stay.
        let both = vec![(0, v("iris2", "iris", Some(("sodium", "sodium2")))), (1, v("sodium2", "sodium", None))];
        assert_eq!(drop_pinned(both, &mods, &installed).len(), 2);
        // Iris update pinning a Sodium version that is not planned drops Iris.
        let iris_only = vec![(0, v("iris2", "iris", Some(("sodium", "sodium2"))))];
        assert!(drop_pinned(iris_only, &mods, &installed).is_empty());
    }
    #[test]
    fn update_check_picks_only_other_versions_of_same_project() {
        let mut stale = modrinth_mod("sodium", &[]);
        stale.sha1 = Some("A".repeat(40));
        let mut current = modrinth_mod("lithium", &[]);
        current.sha1 = Some("b".repeat(40));
        let mut foreign = modrinth_mod("iris", &[]);
        foreign.sha1 = Some("c".repeat(40));
        let local = Mod { source: ModSource::Local, sha1: Some("d".repeat(40)), ..modrinth_mod("own", &[]) };
        let version = |id: &str, project: &str, mc: &str| {
            serde_json::json!({"id": id, "project_id": project, "name": "n", "version_number": id,
                "game_versions": [mc], "loaders": ["fabric"], "files": [], "dependencies": []})
        };
        // Shape of POST /v2/version_files/update: sent hash -> latest version.
        let answer: HashMap<String, Version> = serde_json::from_value(serde_json::json!({
            "a".repeat(40): version("sodium2", "sodium", "1.21.1"),
            "b".repeat(40): version("lithium1", "lithium", "1.21.1"),
            "c".repeat(40): version("other2", "not-iris", "1.21.1"),
            "d".repeat(40): version("own2", "own", "1.21.1"),
        }))
        .unwrap();
        let found = newer(&[stale.clone(), current, foreign, local], &answer, "1.21.1");
        assert_eq!(found.iter().map(|(i, v)| (*i, v.id.as_str())).collect::<Vec<_>>(), [(0, "sodium2")]);
        assert!(newer(&[stale], &answer, "1.20.1").is_empty());
    }
    #[test]
    fn sync_places_content_kinds_in_their_folders() {
        let dirs = crate::services::Dirs::new(std::env::temp_dir().join(crate::models::new_id()));
        let sha1 = crate::services::mods::cache_bytes(&dirs, b"pack").unwrap();
        let pack = Mod {
            kind: ModKind::ResourcePack,
            file_name: "pack.zip".into(),
            sha1: Some(sha1),
            ..modrinth_mod("pack", &[])
        };
        crate::services::mods::sync(&dirs, "i", std::slice::from_ref(&pack)).unwrap();
        assert_eq!(fs::read(dirs.game_dir("i").join("resourcepacks/pack.zip")).unwrap(), b"pack");
        let wrong = Mod { file_name: "pack.jar".into(), ..pack };
        assert!(crate::services::mods::sync(&dirs, "i", &[wrong]).is_err());
        fs::remove_dir_all(&dirs.root).unwrap();
    }
    #[test]
    fn recorded_entry_uses_modrinth_hit() {
        let sha1 = "a".repeat(40);
        let known = graph(&[("sodium", &[])])
            .into_values()
            .map(|v| (sha1.clone(), v))
            .collect();
        let titles = HashMap::from([("sodium".to_string(), "Sodium".to_string())]);
        let m = entry(ModKind::Mod, "sodium-1.jar".into(), sha1.clone(), &known, &titles, &[]);
        assert_eq!((m.id.as_str(), m.name.as_str(), m.version.as_str()), ("sodium", "Sodium", "1"));
        assert_eq!(m.source, ModSource::Modrinth { project_id: "sodium".into(), version_id: "sodium1".into() });
        // Second file of the same project gets its own id, missing title falls back to the stem.
        let again = entry(ModKind::Mod, "sodium-2.jar".into(), sha1, &known, &HashMap::new(), &[m]);
        assert_ne!(again.id, "sodium");
        assert_eq!(again.name, "sodium-2");
        assert_eq!(content_file(Path::new("shaderpacks/x.zip")).map(|(k, _)| k), Some(ModKind::Shader));
        assert!(content_file(Path::new("mods/x.zip")).is_none() && content_file(Path::new("x.jar")).is_none());
    }
    #[test]
    fn foreign_pack_derives_required_by() {
        // a -> b -> c, d alone; Schlüssel wie bei `identify`: sha1 -> Version.
        let known: HashMap<String, Version> = graph(&[("a", &["b"]), ("b", &["c"]), ("c", &[]), ("d", &[])])
            .into_iter()
            .map(|(p, v)| (format!("{p:0>40}"), v))
            .collect();
        let mut mods: Vec<Mod> = ["a", "b", "c", "d"]
            .iter()
            .map(|p| entry(ModKind::Mod, format!("{p}.jar"), format!("{p:0>40}"), &known, &HashMap::new(), &[]))
            .collect();
        derive_required_by(&mut mods, &known);
        let by: Vec<_> = mods.iter().map(|m| m.required_by.join(",")).collect();
        assert_eq!(by, ["", "a", "a", ""]);
    }
    #[tokio::test]
    async fn adopts_untracked_files_once() {
        let root = std::env::temp_dir().join(crate::models::new_id());
        let state = AppState::load(&root).unwrap();
        let i = state
            .instances
            .insert(Instance::from_new(NewInstance {
                name: "Alt".into(),
                minecraft_version: "1.21.1".into(),
                loader: ModLoader::Fabric,
                loader_version: None,
            }))
            .unwrap();
        let game = state.dirs.game_dir(&i.id);
        for (path, data) in [
            ("mods/a.jar", "a"),
            ("mods/off.jar.disabled", "off"),
            ("mods/notes.txt", "n"),
            ("resourcepacks/r.zip", "r"),
            ("shaderpacks/s.zip", "s"),
        ] {
            fs::create_dir_all(game.join(path).parent().unwrap()).unwrap();
            fs::write(game.join(path), data).unwrap();
        }
        assert_eq!(adopt_untracked(&state).await.unwrap(), 4);
        let mods = state.instances.get(&i.id).unwrap().mods;
        let got: Vec<_> = mods.iter().map(|m| (m.kind, m.file_name.as_str(), m.enabled)).collect();
        assert_eq!(
            got,
            [
                (ModKind::Mod, "a.jar", true),
                (ModKind::Mod, "off.jar", false),
                (ModKind::ResourcePack, "r.zip", true),
                (ModKind::Shader, "s.zip", true),
            ]
        );
        assert!(mods.iter().all(|m| m.source == ModSource::Local));
        // Gecacht: Aktivieren legt die deaktivierte Mod aus dem Cache ab.
        let on: Vec<_> = mods.iter().map(|m| Mod { enabled: true, ..m.clone() }).collect();
        crate::services::mods::sync(&state.dirs, &i.id, &on).unwrap();
        assert_eq!(fs::read(game.join("mods/off.jar")).unwrap(), b"off");
        // Zweiter Lauf trägt nichts doppelt ein; Instanzen mit Liste bleiben unberührt,
        // auch wenn eine entfernte Mod-Datei noch im Ordner liegt.
        fs::write(game.join("mods/entfernt.jar"), "x").unwrap();
        assert_eq!(adopt_untracked(&state).await.unwrap(), 0);
        // Belegter Operations-Lock: Lauf entfällt.
        let empty = state
            .instances
            .insert(Instance::from_new(NewInstance {
                name: "Leer".into(),
                minecraft_version: "1.21.1".into(),
                loader: ModLoader::Fabric,
                loader_version: None,
            }))
            .unwrap();
        let empty_mods = state.dirs.game_dir(&empty.id).join("mods");
        fs::create_dir_all(&empty_mods).unwrap();
        fs::write(empty_mods.join("b.jar"), "b").unwrap();
        let busy = state.begin_operation().unwrap();
        assert_eq!(adopt_untracked(&state).await.unwrap(), 0);
        drop(busy);
        assert_eq!(adopt_untracked(&state).await.unwrap(), 1);
        fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn security_boundaries() {
        for p in [
            "../x",
            "/x",
            "C:/x",
            "a\\b",
            "CON.jar",
            "mods/NUL",
            "a.",
            "a ",
            "x:y",
            "a//b",
            "LPT¹.txt",
        ] {
            assert!(safe_path(p).is_err(), "{p}");
        }
        assert!(safe_path("mods/good.jar").is_ok());
        for url in [
            "http://cdn.modrinth.com/a",
            "https://localhost/a",
            "https://cdn.modrinth.com.evil/a",
            "https://cdn.modrinth.com:444/a",
            "https://user@cdn.modrinth.com/a",
        ] {
            assert!(modrinth::download_url(url).is_err());
        }
    }
    #[test]
    fn windows_device_names_are_reserved_with_or_without_extension() {
        for name in ["CON", "con.txt", "Nul", "COM1", "lpt9.log", "COM¹", "CONIN$", "aux.tar.gz"] {
            assert!(is_reserved_windows_name(name), "{name}");
        }
        for name in ["COM0", "COM10", "console", "LPT", "a.CON"] {
            assert!(!is_reserved_windows_name(name), "{name}");
        }
    }

    #[test]
    fn characters_windows_cannot_store_are_unsafe() {
        for name in ["a:b", "a*", "a\tb", "a|b", "a?", "a\"b", "<a>"] {
            assert!(has_unsafe_chars(name), "{name:?}");
        }
        assert!(!has_unsafe_chars("sodium-fabric-0.5.8+mc1.20.4.jar"));
    }

    #[test]
    fn only_a_missing_path_is_free() {
        let dir = std::env::temp_dir().join(crate::models::new_id());
        fs::create_dir_all(&dir).unwrap();
        fs::write(dir.join("file"), "x").unwrap();

        assert!(!is_occupied(&dir.join("missing")).unwrap());
        assert!(is_occupied(&dir.join("file")).unwrap());
        assert!(is_occupied(&dir).unwrap());
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn temp_files_live_in_the_cache_and_vanish_on_drop() {
        let dirs = crate::services::Dirs::new(std::env::temp_dir().join(crate::models::new_id()));
        let temp = TempFile::in_cache(&dirs).unwrap();
        let path = temp.0.clone();
        assert!(path.starts_with(dirs.root.join("cache").join("tmp")) && path.extension().is_some_and(|e| e == "zip"));

        fs::write(&path, "x").unwrap();
        drop(temp);

        assert!(!path.exists());
        fs::remove_dir_all(&dirs.root).unwrap();
    }

    #[test]
    fn the_download_budget_names_the_file_limit() {
        assert!(budget([FILE_LIMIT].into_iter()).is_ok());
        let err = budget([FILE_LIMIT, 1].into_iter()).unwrap_err();
        assert_eq!(err.to_string(), "Gesamtbudget für Mod-Download überschritten (256 MiB)");
        assert!(budget([u64::MAX, 1].into_iter()).is_err());
    }

    fn archive(entries: &[(&str, &[u8])]) -> Vec<u8> {
        let mut w = zip::ZipWriter::new(Cursor::new(Vec::new()));
        for (name, data) in entries {
            w.start_file(*name, zip::write::SimpleFileOptions::default())
                .unwrap();
            w.write_all(data).unwrap();
        }
        w.finish().unwrap().into_inner()
    }
    #[test]
    fn import_validation() {
        let index=br#"{"formatVersion":1,"game":"minecraft","files":[],"dependencies":{"minecraft":"1.21.1","fabric-loader":"0.16.10"}}"#;
        let data = archive(&[
            ("modrinth.index.json", index),
            ("overrides/config/example.txt", b"ok"),
        ]);
        let pack = unpack(&data, "test").unwrap();
        let metadata = br#"{"requiredBy":{"library.jar":["owner"]}}"#;
        for filename in [PUMPKIN_FILE, "previous-brand.json"] {
            let pack = unpack(&archive(&[("modrinth.index.json", index), (filename, metadata)]), "test").unwrap();
            assert_eq!(pack.required_by["library.jar"], ["owner"]);
        }
        for entries in [
            vec![("modrinth.index.json", index.as_slice()), (PUMPKIN_FILE, b"{}".as_slice()), ("previous-brand.json", metadata.as_slice())],
            vec![("modrinth.index.json", index.as_slice()), ("previous-brand.json", metadata.as_slice()), (PUMPKIN_FILE, b"{}".as_slice())],
        ] {
            assert!(unpack(&archive(&entries), "test").unwrap().required_by.is_empty());
        }
        assert!(unpack(&archive(&[("modrinth.index.json", index), ("other.json", b"not metadata")]), "test").is_ok());
        assert!(unpack(&archive(&[("modrinth.index.json", index), (PUMPKIN_FILE, b"broken")]), "test").is_err());
        assert_eq!(pack.instance.loader, ModLoader::Fabric);
        assert_eq!(pack.overrides.len(), 1);
        let neo = br#"{"formatVersion":1,"game":"minecraft","files":[],"dependencies":{"minecraft":"1.21.1","neoforge":"21.1.252"}}"#;
        let pack = unpack(&archive(&[("modrinth.index.json", neo)]), "neo").unwrap();
        assert_eq!((pack.instance.loader, pack.instance.loader_version.as_deref()), (ModLoader::NeoForge, Some("21.1.252")));
        let two = br#"{"formatVersion":1,"game":"minecraft","files":[],"dependencies":{"minecraft":"1.21.1","forge":"1","neoforge":"2"}}"#;
        assert!(unpack(&archive(&[("modrinth.index.json", two)]), "x").is_err());
        for bad in ["../evil", "overrides/CON", "overrides/../evil"] {
            assert!(unpack(
                &archive(&[("modrinth.index.json", index), (bad, b"bad")]),
                "test"
            )
            .is_err());
        }
        let merged = unpack(
            &archive(&[
                ("modrinth.index.json", index),
                ("client-overrides/a", b"y"),
                ("overrides/a", b"x"),
            ]),
            "test",
        )
        .unwrap();
        let got: Vec<_> = merged.overrides.iter().map(|(p, b)| (p.clone(), b.bytes().unwrap().into_owned())).collect();
        assert_eq!(got, vec![(PathBuf::from("a"), b"y".to_vec())]);
    }
    #[tokio::test]
    async fn fresh_import_and_rollback() {
        let root = std::env::temp_dir().join(crate::models::new_id());
        let state = AppState::load(&root).unwrap();
        let index=br#"{"formatVersion":1,"game":"minecraft","files":[],"dependencies":{"minecraft":"1.21.1"}}"#;
        let data = archive(&[
            ("modrinth.index.json", index),
            ("overrides/config/test.txt", b"ok"),
            ("overrides/mods/a.jar", b"a"),
            ("overrides/mods/sub/b.jar", b"b"),
            ("overrides/mods/notes.txt", b"n"),
            ("overrides/resourcepacks/r.zip", b"r"),
            ("client-overrides/shaderpacks/s.zip", b"s"),
        ]);
        let i = import(&state, &data, "test", None, &|_, _, _| {})
            .await
            .unwrap();
        assert_eq!(
            fs::read(state.dirs.game_dir(&i.id).join("config/test.txt")).unwrap(),
            b"ok"
        );
        // Lookup fails offline: every direct content file is recorded as local and cached.
        let got: Vec<_> = i.mods.iter().map(|m| (m.kind, m.file_name.as_str(), m.name.as_str(), m.version.as_str())).collect();
        assert_eq!(
            got,
            [
                (ModKind::Mod, "a.jar", "a", ""),
                (ModKind::ResourcePack, "r.zip", "r", ""),
                (ModKind::Shader, "s.zip", "s", ""),
            ]
        );
        assert!(i.mods.iter().all(|m| m.source == ModSource::Local && m.enabled && m.required_by.is_empty()));
        assert_eq!(state.instances.get(&i.id).unwrap().mods, i.mods);
        // Files and cache are already in place: sync is a no-op, toggling round-trips.
        let game = state.dirs.game_dir(&i.id);
        let before: Vec<_> = fs::read_dir(game.join("mods")).unwrap().map(|e| e.unwrap().path()).collect();
        assert_eq!(crate::services::mods::sync(&state.dirs, &i.id, &i.mods).unwrap(), 3);
        let after: Vec<_> = fs::read_dir(game.join("mods")).unwrap().map(|e| e.unwrap().path()).collect();
        assert_eq!(before, after);
        let off: Vec<_> = i.mods.iter().map(|m| Mod { enabled: false, ..m.clone() }).collect();
        assert_eq!(crate::services::mods::sync(&state.dirs, &i.id, &off).unwrap(), 0);
        assert!(!game.join("mods/a.jar").exists() && game.join("mods/notes.txt").exists());
        crate::services::mods::sync(&state.dirs, &i.id, &i.mods).unwrap();
        assert_eq!(fs::read(game.join("mods/a.jar")).unwrap(), b"a");
        assert!(import(&state, b"broken", "bad", None, &|_, _, _| {})
            .await
            .is_err());
        assert_eq!(state.instances.list().len(), 1);
        fs::remove_dir_all(root).unwrap();
    }
}
