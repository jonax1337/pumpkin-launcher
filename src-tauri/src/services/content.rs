//! Transaktionaler Content-Import. Ziele werden exklusiv neu angelegt, niemals ersetzt.
use super::{
    download::sha1_hex,
    modrinth::{self, invalid, File},
};
use crate::{
    error::AppResult,
    models::{Instance, Mod, ModLoader, ModSource, NewInstance},
    state::AppState,
};
use serde::Deserialize;
use std::{
    collections::{BTreeMap, HashSet},
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
    // Existing Modrinth roots also enter the graph, so incompatibilities work in both directions.
    let mut selected = std::collections::HashMap::new();
    for v in modrinth::resolve(&client, version, &instance).await? {
        modrinth::select(&mut selected, v)?;
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
    let mut names: HashSet<String> = instance
        .mods
        .iter()
        .map(|m| m.file_name.to_lowercase())
        .collect();
    for v in selected.into_values() {
        if let Some(existing) = instance.mods.iter().find(
            |m| matches!(&m.source,ModSource::Modrinth{project_id,..} if project_id==&v.project_id),
        ) {
            if !existing.enabled {
                return Err(invalid("Benötigte vorhandene Mod ist deaktiviert"));
            }
            continue;
        }
        let file = modrinth::primary(&v, ".jar")?;
        if !names.insert(file.filename.to_lowercase()) {
            return Err(invalid("Mod-Dateinamen kollidieren"));
        }
        let target = state.dirs.mods_dir(id).join(&file.filename);
        regular_parents(&target)?;
        match fs::symlink_metadata(&target) {
            Ok(_) => return Err(invalid("Mod-Zieldatei existiert bereits")),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
            Err(e) => return Err(e.into()),
        }
        files.push((v, file, target));
    }
    if files
        .iter()
        .map(|(_, f, _)| f.size)
        .try_fold(0u64, |a, b| a.checked_add(b))
        .is_none_or(|n| n > modrinth::FILE_LIMIT)
    {
        return Err(invalid(
            "Gesamtbudget für Mod-Download überschritten (256 MiB)",
        ));
    }
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
            });
            // Cache is populated from the fully verified target; failures roll back targets only.
            super::mods::cache_file(&state.dirs, created.last().unwrap())?;
        }
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
