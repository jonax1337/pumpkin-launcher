//! Transaktionaler Content-Import. Ziele werden exklusiv neu angelegt, niemals ersetzt.
use super::{
    download::sha1_hex,
    modrinth::{self, invalid, File, Version},
};
use crate::{
    error::AppResult,
    models::{Instance, Mod, ModKind, ModLoader, ModSource, NewInstance},
    state::AppState,
};
use serde::Deserialize;
use std::{
    collections::{BTreeMap, HashMap, HashSet},
    fs,
    io::{Cursor, Read, Write},
    path::{Path, PathBuf},
};

pub fn safe_path(value: &str) -> AppResult<PathBuf> {
    if value.is_empty() || value.len() > 240 || value.contains('\\') {
        return Err(invalid("Unsicherer Pfad"));
    }
    for part in value.split('/') {
        let base = part.split('.').next().unwrap_or("").to_ascii_uppercase();
        if part.is_empty()
            || part == "."
            || part == ".."
            || part.ends_with(['.', ' '])
            || part
                .chars()
                .any(|c| c.is_control() || "<>:\"|?*".contains(c))
            || matches!(
                base.as_str(),
                "CON" | "PRN" | "AUX" | "NUL" | "CONIN$" | "CONOUT$"
            )
            || (base.starts_with("COM") || base.starts_with("LPT"))
                && matches!(
                    &base[3..],
                    "1" | "2" | "3" | "4" | "5" | "6" | "7" | "8" | "9" | "¹" | "²" | "³"
                )
        {
            return Err(invalid(format!("Unsicherer Windows-Pfad: {value}")));
        }
    }
    Ok(PathBuf::from(value))
}
pub(crate) fn regular_parents(path: &Path) -> AppResult<()> {
    for ancestor in path.ancestors() {
        match fs::symlink_metadata(ancestor) {
            Ok(m) if m.file_type().is_symlink() => return Err(invalid("Symlink im Zielpfad")),
            Ok(m) => {
                #[cfg(windows)]
                {
                    use std::os::windows::fs::MetadataExt;
                    if m.file_attributes() & 0x400 != 0 {
                        return Err(invalid("Reparse-Point im Zielpfad"));
                    }
                }
            }
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
            Err(e) => return Err(e.into()),
        }
    }
    Ok(())
}
fn write_new(path: &Path, data: &[u8]) -> AppResult<()> {
    regular_parents(path)?;
    let parent = path
        .parent()
        .ok_or_else(|| invalid("Fehlender Elternpfad"))?;
    fs::create_dir_all(parent)?;
    let mut file = fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(path)?;
    if let Err(e) = file.write_all(data).and_then(|()| file.sync_all()) {
        drop(file);
        fs::remove_file(path)?;
        return Err(e.into());
    }
    Ok(())
}
fn rollback(paths: &[PathBuf], original: crate::error::AppError) -> crate::error::AppError {
    let mut errors = Vec::new();
    for path in paths.iter().rev() {
        if let Err(e) = fs::remove_file(path) {
            errors.push(format!("{}: {e}", path.display()));
        }
    }
    if errors.is_empty() {
        original
    } else {
        invalid(format!("{original}; Rollback: {}", errors.join("; ")))
    }
}
pub async fn install_mod(
    state: &AppState,
    id: &str,
    version: &str,
    progress: &(dyn Fn(&str, u64, u64) + Send + Sync),
) -> AppResult<Instance> {
    let mut instance = state.instances.get(id)?;
    let client = modrinth::client()?;
    progress("resolve", 0, 1);
    let root = modrinth::version(&client, version).await?;
    let project = modrinth::project(&client, &root.project_id).await?;
    let kind = match project.project_type.as_str() {
        "mod" => ModKind::Mod,
        "resourcepack" => ModKind::ResourcePack,
        "shader" => ModKind::Shader,
        _ => return Err(invalid("Projekt ist keine Mod, kein Ressourcenpaket und kein Shader")),
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
            return Err(invalid(format!("Inkompatible Version {}", root.id)));
        }
        selected.insert(root_project.clone(), root);
    }
    for v in selected.values() {
        for d in &v.dependencies {
            if d.dependency_type == "incompatible"
                && selected.values().any(|o| {
                    d.version_id.as_ref().map_or_else(
                        || d.project_id.as_ref() == Some(&o.project_id),
                        |id| id == &o.id,
                    )
                })
            {
                return Err(invalid("Inkompatible vorhandene Mod"));
            }
        }
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
                return Err(invalid("Benötigte vorhandene Mod ist deaktiviert"));
            }
            // Installing a present dependency directly makes it direct.
            if v.project_id == root_project {
                existing.required_by.clear();
            }
            continue;
        }
        let file = modrinth::primary(v, kind.extension())?;
        if !names.insert(file.filename.to_lowercase()) {
            return Err(invalid("Mod-Dateinamen kollidieren"));
        }
        let target = state.dirs.game_dir(id).join(kind.folder()).join(&file.filename);
        regular_parents(&target)?;
        match fs::symlink_metadata(&target) {
            Ok(_) => return Err(invalid("Mod-Zieldatei existiert bereits")),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
            Err(e) => return Err(e.into()),
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
        progress("download", ready.len() as u64, total);
        let data = modrinth::download(&client, &file).await?;
        ready.push((v, file, target, data));
    }
    let mut created = Vec::new();
    let result = (|| {
        for (v, file, target, data) in ready {
            write_new(&target, &data)?;
            created.push(target);
            instance.mods.push(Mod {
                id: v.project_id.clone(),
                name: v.name,
                version: v.version_number,
                source: ModSource::Modrinth {
                    project_id: v.project_id,
                    version_id: v.id,
                },
                file_name: file.filename,
                sha1: Some(sha1_hex(&data)),
                enabled: true,
                kind,
                required_by: Vec::new(),
            });
            // Cache is populated from the fully verified target; failures roll back targets only.
            super::mods::cache_file(&state.dirs, created.last().unwrap())?;
        }
        mark_dependencies(&mut instance.mods, &selected, &fresh);
        state.instances.update(instance)
    })();
    match result {
        Err(e) => Err(rollback(&created, e)),
        Ok(i) => {
            progress("complete", total, total);
            Ok(i)
        }
    }
}

fn budget(mut sizes: impl Iterator<Item = u64>) -> AppResult<()> {
    if sizes
        .try_fold(0u64, |a, b| a.checked_add(b))
        .is_none_or(|n| n > modrinth::FILE_LIMIT)
    {
        return Err(invalid(
            "Gesamtbudget für Mod-Download überschritten (256 MiB)",
        ));
    }
    Ok(())
}

fn project_of(m: &Mod) -> Option<&String> {
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

/// Index into `mods` plus the newer version from a `version_files/update` answer.
/// ponytail: "newer" = different version id of the same project; no date comparison, so a
/// manually installed beta newer than the latest filtered release would be offered a "downgrade".
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
    let loader = serde_json::to_value(instance.loader)?;
    let mut found = Vec::new();
    for kind in [ModKind::Mod, ModKind::ResourcePack, ModKind::Shader] {
        let hashes: Vec<String> = instance
            .mods
            .iter()
            .filter(|m| m.kind == kind && project_of(m).is_some())
            .filter_map(|m| m.sha1.as_ref().map(|h| h.to_ascii_lowercase()))
            .collect();
        let loaders = match kind {
            ModKind::Mod => vec![loader.as_str().unwrap_or_default()],
            ModKind::ResourcePack => vec!["minecraft"],
            ModKind::Shader => vec!["iris", "optifine", "canvas", "vanilla"],
        };
        let latest =
            modrinth::latest_by_hash(client, &hashes, &loaders, &instance.minecraft_version).await?;
        found.extend(
            newer(&instance.mods, &latest, &instance.minecraft_version)
                .into_iter()
                .filter(|(i, _)| instance.mods[*i].kind == kind),
        );
    }
    Ok(found)
}

pub async fn update_mods(
    state: &AppState,
    id: &str,
    mod_ids: &[String],
    progress: &(dyn Fn(&str, u64, u64) + Send + Sync),
) -> AppResult<Instance> {
    let instance = state.instances.get(id)?;
    if let Some(unknown) = mod_ids.iter().find(|m| !instance.mods.iter().any(|x| &x.id == *m)) {
        return Err(invalid(format!("Unbekannte Mod {unknown}")));
    }
    let client = modrinth::client()?;
    progress("resolve", 0, 1);
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
            .ok_or_else(|| invalid("Mod-Dateinamen kollidieren"))?;
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
                    return Err(invalid("Benötigte vorhandene Mod ist deaktiviert"));
                }
                continue;
            }
            let file = modrinth::primary(v, ".jar")?;
            if !names.insert(file.filename.to_lowercase()) {
                return Err(invalid("Mod-Dateinamen kollidieren"));
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
        progress("download", n as u64, total);
        let data = modrinth::download(&client, file).await?;
        mods[*i].sha1 = Some(super::mods::cache_bytes(&state.dirs, &data)?);
    }
    mark_dependencies(&mut mods, &selected, &fresh);
    // sync places the new files and removes the old ones in one journal; metadata commits last.
    let desired: Vec<Mod> = mods.iter().cloned().chain(old).collect();
    let updated = Instance { mods, ..instance };
    let result =
        super::mods::sync_commit(&state.dirs, id, &desired, |_| state.instances.update(updated))?;
    progress("complete", total, total);
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
struct Pack {
    instance: Instance,
    downloads: Vec<(PathBuf, File)>,
    overrides: Vec<(PathBuf, Vec<u8>)>,
}
const PACK_LIMIT: u64 = 1024 * 1024 * 1024;
fn unpack(data: &[u8], name: &str) -> AppResult<Pack> {
    if name.trim().is_empty() || name.len() > 200 {
        return Err(invalid("Ungültiger Instanzname"));
    }
    if data.len() as u64 > modrinth::FILE_LIMIT {
        return Err(invalid("Pack zu groß"));
    }
    let mut zip = zip::ZipArchive::new(Cursor::new(data))?;
    if zip.len() > 4096 {
        return Err(invalid("Zu viele ZIP-Einträge"));
    }
    let mut expanded = 0u64;
    let mut entries = HashSet::new();
    let mut overrides = Vec::new();
    let mut manifest = None;
    for i in 0..zip.len() {
        let mut entry = zip.by_index(i)?;
        let name = entry.name().to_string();
        let clean = name.strip_suffix('/').unwrap_or(&name);
        safe_path(clean)?;
        if !entries.insert(clean.to_lowercase()) {
            return Err(invalid("Doppelter ZIP-Pfad"));
        }
        if entry.unix_mode().is_some_and(|m| {
            matches!(
                m & 0o170000,
                0o120000 | 0o060000 | 0o020000 | 0o010000 | 0o140000
            )
        }) {
            return Err(invalid("ZIP-Symlink/Spezialdatei"));
        }
        expanded = expanded
            .checked_add(entry.size())
            .ok_or_else(|| invalid("ZIP-Größenüberlauf"))?;
        if expanded > PACK_LIMIT
            || entry.size() > modrinth::FILE_LIMIT
            || entry.size()
                > entry
                    .compressed_size()
                    .saturating_mul(200)
                    .saturating_add(1024 * 1024)
        {
            return Err(invalid("ZIP-Limit überschritten"));
        }
        if entry.is_dir() {
            continue;
        }
        let is_index = name == "modrinth.index.json";
        let target = name
            .strip_prefix("client-overrides/")
            .or_else(|| name.strip_prefix("overrides/"));
        if !is_index && target.is_none() {
            continue;
        }
        let limit = if is_index {
            8 * 1024 * 1024
        } else {
            modrinth::FILE_LIMIT
        };
        let mut bytes = Vec::new();
        entry.by_ref().take(limit + 1).read_to_end(&mut bytes)?;
        if bytes.len() as u64 > limit || bytes.len() as u64 != entry.size() {
            return Err(invalid("ZIP-Dateigröße ungültig"));
        }
        if is_index {
            manifest = Some(serde_json::from_slice::<Index>(&bytes)?);
        } else if let Some(target) = target {
            overrides.push((
                safe_path(target)?,
                bytes,
                name.starts_with("client-overrides/"),
            ));
        }
    }
    let index = manifest.ok_or_else(|| invalid("modrinth.index.json fehlt"))?;
    if index.format_version != 1 || index.game != "minecraft" || index.files.len() > 2048 {
        return Err(invalid("Nicht unterstütztes Packformat"));
    }
    if index
        .dependencies
        .keys()
        .any(|k| k != "minecraft" && k != "fabric-loader")
    {
        return Err(invalid("Nur Vanilla/Fabric-Packs unterstützt"));
    }
    let mc = index
        .dependencies
        .get("minecraft")
        .ok_or_else(|| invalid("Minecraft-Version fehlt"))?
        .clone();
    modrinth::identifier(&mc)?;
    let loader_version = index.dependencies.get("fabric-loader").cloned();
    if let Some(v) = &loader_version {
        modrinth::identifier(v)?;
    }
    let instance = Instance::from_new(NewInstance {
        name: name.trim().into(),
        minecraft_version: mc,
        loader: if loader_version.is_some() {
            ModLoader::Fabric
        } else {
            ModLoader::Vanilla
        },
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
                return Err(invalid("Unbekannte Pack-Umgebung"));
            }
            if env
                .get("client")
                .is_some_and(|v| v == "unsupported" || v == "optional")
            {
                continue;
            }
        }
        expanded = expanded
            .checked_add(f.file_size)
            .ok_or_else(|| invalid("Pack-Größenüberlauf"))?;
        if expanded > PACK_LIMIT || f.file_size > modrinth::FILE_LIMIT {
            return Err(invalid("Pack-Dateilimit überschritten"));
        }
        for url in &f.downloads {
            modrinth::download_url(url)?;
        }
        let url = f
            .downloads
            .first()
            .ok_or_else(|| invalid("Download-URL fehlt"))?
            .clone();
        if !paths.insert(f.path.to_lowercase()) {
            return Err(invalid("Doppelte Pack-Zieldatei"));
        }
        downloads.push((
            path,
            File {
                filename: f.path,
                hashes: f.hashes,
                url,
                size: f.file_size,
                primary: true,
            },
        ));
    }
    // Client overrides win over generic overrides only inside this fresh staging plan.
    overrides.sort_by_key(|(_, _, client)| *client);
    let mut merged = BTreeMap::new();
    for (path, data, _) in overrides {
        merged.insert(path.to_string_lossy().to_lowercase(), (path, data));
    }
    let overrides: Vec<_> = merged.into_values().collect();
    for (path, _) in &overrides {
        if !paths.insert(path.to_string_lossy().to_lowercase()) {
            return Err(invalid("Overrides kollidieren mit Pack-Dateien"));
        }
    }
    // A file must never also be another file's parent (case insensitive on Windows).
    for path in &paths {
        for (at, _) in path.match_indices('/') {
            if paths.contains(&path[..at]) {
                return Err(invalid("Datei/Verzeichnis-Konflikt"));
            }
        }
    }
    Ok(Pack {
        instance,
        downloads,
        overrides,
    })
}
pub async fn import(
    state: &AppState,
    data: &[u8],
    name: &str,
    origin: Option<crate::models::ModpackOrigin>,
    progress: &(dyn Fn(&str, u64, u64) + Send + Sync),
) -> AppResult<Instance> {
    progress("validate", 0, 1);
    let mut pack = unpack(data, name)?;
    pack.instance.modpack = origin;
    let root = state.dirs.instance(&pack.instance.id);
    regular_parents(&root)?;
    fs::create_dir_all(root.parent().unwrap())?;
    fs::create_dir(&root)?;
    let result = async {
        let client = modrinth::client()?;
        let total = (pack.downloads.len() + pack.overrides.len()) as u64;
        let mut done = 0;
        for (path, file) in pack.downloads {
            progress("download", done, total);
            let data = modrinth::download(&client, &file).await?;
            write_new(&state.dirs.game_dir(&pack.instance.id).join(path), &data)?;
            done += 1;
        }
        for (path, data) in pack.overrides {
            write_new(&state.dirs.game_dir(&pack.instance.id).join(path), &data)?;
            done += 1;
            progress("extract", done, total);
        }
        let instance = state.instances.insert(pack.instance)?;
        progress("complete", total, total);
        Ok(instance)
    }
    .await;
    match result {
        Err(e) => {
            if let Err(cleanup) = fs::remove_dir_all(&root) {
                return Err(invalid(format!("{e}; Rollback: {cleanup}")));
            }
            Err(e)
        }
        Ok(i) => Ok(i),
    }
}
pub fn local_pack(path: &Path) -> AppResult<Vec<u8>> {
    if !path.is_absolute() || path.extension().and_then(|s| s.to_str()) != Some("mrpack") {
        return Err(invalid("Absoluter .mrpack-Pfad erforderlich"));
    }
    let mut file = fs::File::open(path)?;
    if !file.metadata()?.is_file() {
        return Err(invalid("Keine reguläre Datei"));
    }
    let mut data = Vec::new();
    Read::by_ref(&mut file)
        .take(modrinth::FILE_LIMIT + 1)
        .read_to_end(&mut data)?;
    if data.len() as u64 > modrinth::FILE_LIMIT {
        return Err(invalid("Pack zu groß"));
    }
    Ok(data)
}

#[cfg(test)]
mod tests {
    use super::*;
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
        assert_eq!(pack.instance.loader, ModLoader::Fabric);
        assert_eq!(pack.overrides.len(), 1);
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
        assert_eq!(merged.overrides, vec![(PathBuf::from("a"), b"y".to_vec())]);
    }
    #[tokio::test]
    async fn fresh_import_and_rollback() {
        let root = std::env::temp_dir().join(crate::models::new_id());
        let state = AppState::load(&root).unwrap();
        let index=br#"{"formatVersion":1,"game":"minecraft","files":[],"dependencies":{"minecraft":"1.21.1"}}"#;
        let data = archive(&[
            ("modrinth.index.json", index),
            ("overrides/config/test.txt", b"ok"),
        ]);
        let i = import(&state, &data, "test", None, &|_, _, _| {})
            .await
            .unwrap();
        assert_eq!(
            fs::read(state.dirs.game_dir(&i.id).join("config/test.txt")).unwrap(),
            b"ok"
        );
        assert!(import(&state, b"broken", "bad", None, &|_, _, _| {})
            .await
            .is_err());
        assert_eq!(state.instances.list().len(), 1);
        fs::remove_dir_all(root).unwrap();
    }
}
