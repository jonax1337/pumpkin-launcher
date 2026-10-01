//! Modpacks als neue Instanz: `.mrpack` entpacken oder den Plan eines Anbieters übernehmen, alles laden und ablegen;
//! bei Fehler oder Abbruch bleibt nichts zurück.
use std::{
    borrow::Cow,
    collections::{BTreeMap, HashMap, HashSet},
    fs,
    io::Cursor,
    path::{Path, PathBuf},
    sync::{Arc, Mutex},
};

use futures::StreamExt;
use serde::Deserialize;

use super::{
    adopt::{catalog, identify_or_local, CachedFile, ContentFile, Recognition},
    fs_safety::{regular_parents, safe_path, write_new},
};
use crate::{
    error::{AppError, AppResult},
    models::{instance_name, new_id, Instance, ModKind, ModLoader, ModpackOrigin, NewInstance},
    services::{
        download::RemoveOnDrop,
        forge,
        limits::{
            DOWNLOAD_CONCURRENCY, FILE_LIMIT, MRPACK_ENTRIES, MRPACK_EXPANDED_LIMIT, MRPACK_INDEX_FILES, PLAN_FILES,
            PLAN_LIMIT, ZIP_JSON_LIMIT,
        },
        modrinth::{self, File},
        mods,
        progress::{Phase, ProgressFn},
        providers::RemoteFile,
        remove_logged,
        transport::read_capped_io,
        zip_guard::{check_entry_count, ensure_no_file_dir_conflict, read_entry, reject_special, ExpandedSize},
        Dirs,
    },
    state::AppState,
};

/// Eigene Zusatzdatei in Vorlagen-`.mrpack`s; andere Launcher ignorieren sie.
pub const PUMPKIN_FILE: &str = "pumpkin.json";
const INDEX_FILE: &str = "modrinth.index.json";
/// Die einzige Version des `.mrpack`-Formats.
const SUPPORTED_FORMAT: u32 = 1;

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

#[derive(Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct PumpkinMeta {
    #[serde(default)]
    required_by: HashMap<String, Vec<String>>,
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
    pub(crate) fn in_cache(dirs: &Dirs) -> AppResult<Self> {
        let tmp = dirs.root.join("cache").join("tmp");
        fs::create_dir_all(&tmp)?;
        Ok(Self(tmp.join(format!("{}.zip", new_id()))))
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
            return Err(duplicate_target());
        }
        downloads.push((path, Fetch::Remote(file)));
    }
    ensure_no_file_dir_conflict(&paths)?;
    Ok(Pack { instance, downloads, overrides: Vec::new(), required_by: HashMap::new(), origins: HashMap::new(), temp: None })
}

fn duplicate_target() -> AppError {
    AppError::invalid("Doppelte Pack-Zieldatei")
}

pub async fn import(
    state: &AppState,
    data: &[u8],
    name: &str,
    origin: Option<ModpackOrigin>,
    progress: ProgressFn<'_>,
) -> AppResult<Instance> {
    progress(Phase::Validate, 0, 1);
    import_plan(state, unpack(data, name)?, origin, progress).await
}

/// Plan aus einem `.mrpack`: Index-Dateien zum Laden, Overrides aus dem Archiv, `required_by` aus der Zusatzdatei.
fn unpack(data: &[u8], name: &str) -> AppResult<Pack> {
    let name = instance_name(name)?;
    if data.len() as u64 > FILE_LIMIT {
        return Err(AppError::invalid("Pack zu groß"));
    }
    let Archive { index, meta, overrides, mut expanded } = scan_archive(data)?;
    if index.format_version != SUPPORTED_FORMAT || index.game != "minecraft" || index.files.len() > MRPACK_INDEX_FILES {
        return Err(AppError::invalid("Nicht unterstütztes Packformat"));
    }
    let instance = new_instance(name, &index.dependencies)?;
    let downloads = plan_index_files(index.files, &mut expanded)?;
    let overrides = merge_overrides(overrides);
    check_targets(&downloads, &overrides)?;
    Ok(Pack { instance, downloads, overrides, required_by: meta.required_by, origins: HashMap::new(), temp: None })
}

/// Was die Einträge eines `.mrpack` enthalten; jeder ist dabei auf Pfad, Eindeutigkeit, Art und Größe geprüft.
struct Archive {
    index: Index,
    meta: PumpkinMeta,
    overrides: Vec<Override>,
    /// Entpackte Größe bisher; die Index-Dateien zählen noch dazu.
    expanded: ExpandedSize,
}

/// Datei unter `overrides/` oder `client-overrides/`.
struct Override {
    path: PathBuf,
    data: Vec<u8>,
    client: bool,
}

/// Wofür ein Eintrag des `.mrpack` steht.
enum Role<'a> {
    Index,
    Meta,
    Override { target: &'a str, client: bool },
    Ignored,
}

impl<'a> Role<'a> {
    fn of(name: &'a str) -> Self {
        if name == INDEX_FILE {
            return Self::Index;
        }
        // Nur JSON direkt im Archivwurzelverzeichnis kommt als Zusatzdatei infrage.
        if !name.contains('/') && name.ends_with(".json") {
            return Self::Meta;
        }
        if let Some(target) = name.strip_prefix("client-overrides/") {
            return Self::Override { target, client: true };
        }
        match name.strip_prefix("overrides/") {
            Some(target) => Self::Override { target, client: false },
            None => Self::Ignored,
        }
    }
}

fn scan_archive(data: &[u8]) -> AppResult<Archive> {
    let mut zip = zip::ZipArchive::new(Cursor::new(data))?;
    check_entry_count(zip.len(), MRPACK_ENTRIES)?;
    let mut expanded = ExpandedSize::new(MRPACK_EXPANDED_LIMIT);
    let mut seen = HashSet::new();
    let (mut index, mut meta, mut overrides) = (None, MetaSearch::default(), Vec::new());
    for i in 0..zip.len() {
        let mut entry = zip.by_index(i)?;
        let name = entry.name().to_string();
        let clean = name.strip_suffix('/').unwrap_or(&name);
        safe_path(clean)?;
        if !seen.insert(clean.to_lowercase()) {
            return Err(AppError::invalid("Doppelter ZIP-Pfad"));
        }
        reject_special(&entry)?;
        expanded.add_entry(&entry)?;
        if entry.is_dir() {
            continue;
        }
        match Role::of(&name) {
            Role::Index => index = Some(serde_json::from_slice::<Index>(&read_entry(&mut entry, ZIP_JSON_LIMIT)?)?),
            Role::Meta => meta.offer(&name, &read_entry(&mut entry, ZIP_JSON_LIMIT)?)?,
            Role::Override { target, client } => {
                let data = read_entry(&mut entry, FILE_LIMIT)?;
                overrides.push(Override { path: safe_path(target)?, data, client });
            }
            Role::Ignored => {}
        }
    }
    let index = index.ok_or_else(|| AppError::invalid("modrinth.index.json fehlt"))?;
    Ok(Archive { index, meta: meta.meta, overrides, expanded })
}

/// Sucht die Zusatzdatei: `pumpkin.json` gilt immer. Ältere eigene Vorlagen haben denselben Inhalt unter einem
/// anderen Markennamen; der zählt nur ohne `pumpkin.json` und nur, solange noch nichts gefunden ist.
#[derive(Default)]
struct MetaSearch {
    meta: PumpkinMeta,
    canonical: bool,
}

impl MetaSearch {
    fn offer(&mut self, name: &str, bytes: &[u8]) -> AppResult<()> {
        let value = serde_json::from_slice::<serde_json::Value>(bytes);
        if name == PUMPKIN_FILE {
            self.meta = serde_json::from_value(value?)?;
            self.canonical = true;
        } else if let Some(compatible) =
            value.ok().filter(|v| self.takes_legacy(v)).and_then(|v| serde_json::from_value(v).ok())
        {
            self.meta = compatible;
        }
        Ok(())
    }

    fn takes_legacy(&self, value: &serde_json::Value) -> bool {
        !self.canonical && value.get("requiredBy").is_some() && self.meta.required_by.is_empty()
    }
}

/// Neue Instanz für den Index; vor dem Download abgelehnt wird, was Pumpkin Launcher nicht starten kann
/// (z. B. Forge vor 1.17).
fn new_instance(name: &str, dependencies: &BTreeMap<String, String>) -> AppResult<Instance> {
    let (loader, loader_version) = loader_of(dependencies)?;
    let minecraft_version =
        dependencies.get("minecraft").ok_or_else(|| AppError::invalid("Minecraft-Version fehlt"))?.clone();
    modrinth::identifier(&minecraft_version)?;
    if let Some(v) = &loader_version {
        modrinth::identifier(v)?;
    }
    forge::check_loader(loader, &minecraft_version)?;
    Ok(Instance::from_new(NewInstance { name: name.into(), minecraft_version, loader, loader_version }))
}

/// Höchstens ein bekannter Loader und neben ihm nur `minecraft`; ohne Loader Vanilla.
fn loader_of(dependencies: &BTreeMap<String, String>) -> AppResult<(ModLoader, Option<String>)> {
    let loaders: Vec<(ModLoader, String)> = ModLoader::PACK_KEYS
        .iter()
        .filter_map(|(l, k)| dependencies.get(*k).map(|v| (*l, v.clone())))
        .collect();
    if loaders.len() > 1 || dependencies.len() > loaders.len() + 1 {
        return Err(AppError::invalid("Das Pack braucht einen Loader, den Pumpkin Launcher nicht kennt"));
    }
    Ok(loaders.into_iter().next().map_or((ModLoader::Vanilla, None), |(l, v)| (l, Some(v))))
}

/// Die Index-Dateien, die der Client braucht, als Downloads vom Modrinth-CDN.
fn plan_index_files(files: Vec<PackFile>, expanded: &mut ExpandedSize) -> AppResult<Vec<(PathBuf, Fetch)>> {
    let mut paths = HashSet::new();
    let mut downloads = Vec::new();
    for f in files {
        let path = safe_path(&f.path)?;
        if !needed_on_client(f.env.as_ref())? {
            continue;
        }
        expanded.add_file(f.file_size)?;
        for url in &f.downloads {
            modrinth::download_url(url)?;
        }
        let url = f.downloads.first().ok_or_else(|| AppError::invalid("Download-URL fehlt"))?.clone();
        if !paths.insert(f.path.to_lowercase()) {
            return Err(duplicate_target());
        }
        let file = File { filename: f.path, hashes: f.hashes, url, size: f.file_size, primary: true };
        downloads.push((path, Fetch::Modrinth(file)));
    }
    Ok(downloads)
}

/// Braucht der Client die Datei? Ohne `env` ja; unbekannte Angaben sind ein Fehler.
fn needed_on_client(env: Option<&BTreeMap<String, String>>) -> AppResult<bool> {
    let Some(env) = env else { return Ok(true) };
    if env.values().any(|v| !matches!(v.as_str(), "required" | "optional" | "unsupported")) {
        return Err(AppError::invalid("Unbekannte Pack-Umgebung"));
    }
    Ok(!env.get("client").is_some_and(|v| v == "unsupported" || v == "optional"))
}

/// Client-Overrides schlagen allgemeine, aber nur innerhalb dieses frischen Plans.
fn merge_overrides(mut overrides: Vec<Override>) -> Vec<(PathBuf, Blob)> {
    overrides.sort_by_key(|o| o.client);
    let mut merged = BTreeMap::new();
    for o in overrides {
        merged.insert(lowercase(&o.path), (o.path, o.data));
    }
    merged.into_values().map(|(path, data)| (path, Blob::Mem(data))).collect()
}

/// Overrides dürfen keine Pack-Datei treffen, und keine Datei darf zugleich Ordner einer anderen sein.
fn check_targets(downloads: &[(PathBuf, Fetch)], overrides: &[(PathBuf, Blob)]) -> AppResult<()> {
    let mut paths: HashSet<String> = downloads.iter().map(|(path, _)| lowercase(path)).collect();
    for (path, _) in overrides {
        if !paths.insert(lowercase(path)) {
            return Err(AppError::invalid("Overrides kollidieren mit Pack-Dateien"));
        }
    }
    ensure_no_file_dir_conflict(&paths)
}

fn lowercase(path: &Path) -> String {
    path.to_string_lossy().to_lowercase()
}

/// Legt die Instanz aus einem fertigen Plan an: laden, prüfen, ablegen; bei Fehler oder Abbruch restlos zurück.
pub(crate) async fn import_plan(
    state: &AppState,
    mut pack: Pack,
    origin: Option<ModpackOrigin>,
    progress: ProgressFn<'_>,
) -> AppResult<Instance> {
    pack.instance.modpack = origin;
    let root = state.dirs.instance(&pack.instance.id);
    regular_parents(&state.dirs.root, &root)?;
    fs::create_dir_all(state.dirs.root.join("instances"))?;
    fs::create_dir(&root)?;
    // Bei Fehler oder Abbruch (Future verworfen) räumt der Wächter die halbe Instanz weg.
    let guard = RemoveOnDrop::new(root);
    let instance = fill_instance(state, pack, progress).await?;
    guard.disarm();
    Ok(instance)
}

async fn fill_instance(state: &AppState, mut pack: Pack, progress: ProgressFn<'_>) -> AppResult<Instance> {
    let catalog = catalog()?;
    let mut staging = Staging {
        dirs: &state.dirs,
        game_dir: state.dirs.game_dir(&pack.instance.id),
        progress,
        total: (pack.downloads.len() + pack.overrides.len()) as u64,
        done: 0,
        content: Vec::new(),
    };
    staging.download_all(std::mem::take(&mut pack.downloads)).await?;
    staging.extract_overrides(std::mem::take(&mut pack.overrides))?;
    let hashes: Vec<String> = staging.content.iter().map(|f| f.sha1.clone()).collect();
    let recognition = identify_or_local(&catalog, &hashes).await;
    build_mod_list(&mut pack, &staging.content, &recognition);
    let instance = state.instances.insert(pack.instance)?;
    progress(Phase::Complete, staging.total, staging.total);
    Ok(instance)
}

/// Legt die Dateien eines Plans im Spielordner der neuen Instanz ab, meldet den Fortschritt und merkt sich die
/// Inhaltsdateien samt Cache-SHA-1; ihre Bytes kommen gleich in den Mod-Cache.
struct Staging<'a> {
    dirs: &'a Dirs,
    game_dir: PathBuf,
    progress: ProgressFn<'a>,
    total: u64,
    done: u64,
    content: Vec<CachedFile>,
}

impl Staging<'_> {
    async fn download_all(&mut self, downloads: Vec<(PathBuf, Fetch)>) -> AppResult<()> {
        let downloader = modrinth::download_client()?;
        // `buffered` liefert in Plan-Reihenfolge, auch wenn spätere Dateien früher fertig sind (FTB-Packs haben über tausend).
        let mut fetched = futures::stream::iter(downloads.into_iter().map(|(path, file)| {
            let client = &downloader;
            async move { Ok::<_, AppError>((path, file.download(client).await?)) }
        }))
        .buffered(DOWNLOAD_CONCURRENCY);
        while let Some(item) = fetched.next().await {
            let (path, data) = item?;
            (self.progress)(Phase::Download, self.done, self.total);
            self.put(&path, &data)?;
        }
        Ok(())
    }

    fn extract_overrides(&mut self, overrides: Vec<(PathBuf, Blob)>) -> AppResult<()> {
        for (path, blob) in overrides {
            self.put(&path, &blob.bytes()?)?;
            (self.progress)(Phase::Extract, self.done, self.total);
        }
        Ok(())
    }

    fn put(&mut self, path: &Path, data: &[u8]) -> AppResult<()> {
        write_new(&self.dirs.root, &self.game_dir.join(path), data)?;
        if let Some(file) = content_file(path) {
            self.content.push(CachedFile { file, sha1: mods::cache_bytes(self.dirs, data)? });
        }
        self.done += 1;
        Ok(())
    }
}

/// `mods/*.jar`, `resourcepacks/*.zip`, `shaderpacks/*.zip` direkt im Ordner, sonst `None`.
fn content_file(path: &Path) -> Option<ContentFile> {
    let (folder, name) = path.to_str()?.split_once('/')?;
    ModKind::ALL
        .into_iter()
        .find(|k| k.folder() == folder && !name.contains('/') && name.ends_with(k.extension()))
        .map(|kind| ContentFile { kind, file_name: name.to_string(), enabled: true })
}

/// Trägt die Inhaltsdateien ein; `required_by` aus `pumpkin.json` eigener Vorlagen, sonst aus den erkannten Versionen.
fn build_mod_list(pack: &mut Pack, content: &[CachedFile], recognition: &Recognition) {
    let mods = &mut pack.instance.mods;
    if pack.required_by.is_empty() {
        recognition.append_recorded(mods, content, &pack.origins);
        return;
    }
    recognition.append_entries(mods, content, &pack.origins);
    for m in mods.iter_mut() {
        m.required_by = pack.required_by.remove(&m.file_name).unwrap_or_default();
    }
}

/// Liest ein `.mrpack` von der Platte.
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
    use crate::models::{Mod, ModSource};
    use std::io::Write;

    #[test]
    fn temp_files_live_in_the_cache_and_vanish_on_drop() {
        let dirs = Dirs::new(std::env::temp_dir().join(new_id()));
        let temp = TempFile::in_cache(&dirs).unwrap();
        let path = temp.0.clone();
        assert!(path.starts_with(dirs.root.join("cache").join("tmp")) && path.extension().is_some_and(|e| e == "zip"));

        fs::write(&path, "x").unwrap();
        drop(temp);

        assert!(!path.exists());
        fs::remove_dir_all(&dirs.root).unwrap();
    }

    #[test]
    fn only_direct_files_of_a_content_folder_are_content() {
        assert_eq!(content_file(Path::new("shaderpacks/x.zip")).map(|f| f.kind), Some(ModKind::Shader));
        assert!(content_file(Path::new("mods/x.zip")).is_none() && content_file(Path::new("x.jar")).is_none());
    }

    fn archive(entries: &[(&str, &[u8])]) -> Vec<u8> {
        let mut w = zip::ZipWriter::new(Cursor::new(Vec::new()));
        for (name, data) in entries {
            w.start_file(*name, zip::write::SimpleFileOptions::default()).unwrap();
            w.write_all(data).unwrap();
        }
        w.finish().unwrap().into_inner()
    }

    #[test]
    fn import_validation() {
        let index = br#"{"formatVersion":1,"game":"minecraft","files":[],"dependencies":{"minecraft":"1.21.1","fabric-loader":"0.16.10"}}"#;
        let data = archive(&[("modrinth.index.json", index), ("overrides/config/example.txt", b"ok")]);
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
            assert!(unpack(&archive(&[("modrinth.index.json", index), (bad, b"bad")]), "test").is_err());
        }
        let merged = unpack(
            &archive(&[("modrinth.index.json", index), ("client-overrides/a", b"y"), ("overrides/a", b"x")]),
            "test",
        )
        .unwrap();
        let got: Vec<_> = merged.overrides.iter().map(|(p, b)| (p.clone(), b.bytes().unwrap().into_owned())).collect();
        assert_eq!(got, vec![(PathBuf::from("a"), b"y".to_vec())]);
    }

    #[test]
    fn index_files_for_the_server_only_are_skipped_and_unknown_environments_rejected() {
        let env = |pairs: &[(&str, &str)]| pairs.iter().map(|(k, v)| (k.to_string(), v.to_string())).collect::<BTreeMap<_, _>>();

        assert!(needed_on_client(None).unwrap());
        assert!(needed_on_client(Some(&env(&[("client", "required"), ("server", "unsupported")]))).unwrap());
        assert!(!needed_on_client(Some(&env(&[("client", "optional")]))).unwrap());
        assert!(!needed_on_client(Some(&env(&[("client", "unsupported")]))).unwrap());
        assert!(needed_on_client(Some(&env(&[("client", "sometimes")]))).is_err());
    }

    #[tokio::test]
    async fn fresh_import_and_rollback() {
        let root = std::env::temp_dir().join(new_id());
        let state = AppState::load(&root).unwrap();
        let index = br#"{"formatVersion":1,"game":"minecraft","files":[],"dependencies":{"minecraft":"1.21.1"}}"#;
        let data = archive(&[
            ("modrinth.index.json", index),
            ("overrides/config/test.txt", b"ok"),
            ("overrides/mods/a.jar", b"a"),
            ("overrides/mods/sub/b.jar", b"b"),
            ("overrides/mods/notes.txt", b"n"),
            ("overrides/resourcepacks/r.zip", b"r"),
            ("client-overrides/shaderpacks/s.zip", b"s"),
        ]);
        let i = import(&state, &data, "test", None, &|_, _, _| {}).await.unwrap();
        assert_eq!(fs::read(state.dirs.game_dir(&i.id).join("config/test.txt")).unwrap(), b"ok");
        // Ohne Netz scheitert die Erkennung: Jede direkte Inhaltsdatei wird lokal eingetragen und gecacht.
        let got: Vec<_> = i.mods.iter().map(|m| (m.kind, m.file_name.as_str(), m.name.as_str(), m.version.as_str())).collect();
        assert_eq!(
            got,
            [(ModKind::Mod, "a.jar", "a", ""), (ModKind::ResourcePack, "r.zip", "r", ""), (ModKind::Shader, "s.zip", "s", "")]
        );
        assert!(i.mods.iter().all(|m| m.source == ModSource::Local && m.enabled && m.required_by.is_empty()));
        assert_eq!(state.instances.get(&i.id).unwrap().mods, i.mods);
        // Dateien und Cache liegen schon: `sync` hat nichts zu tun, Aus- und wieder Einschalten klappt.
        let game = state.dirs.game_dir(&i.id);
        let before: Vec<_> = fs::read_dir(game.join("mods")).unwrap().map(|e| e.unwrap().path()).collect();
        assert_eq!(mods::sync(&state.dirs, &i.id, &i.mods).unwrap(), 3);
        let after: Vec<_> = fs::read_dir(game.join("mods")).unwrap().map(|e| e.unwrap().path()).collect();
        assert_eq!(before, after);
        let off: Vec<_> = i.mods.iter().map(|m| Mod { enabled: false, ..m.clone() }).collect();
        assert_eq!(mods::sync(&state.dirs, &i.id, &off).unwrap(), 0);
        assert!(!game.join("mods/a.jar").exists() && game.join("mods/notes.txt").exists());
        mods::sync(&state.dirs, &i.id, &i.mods).unwrap();
        assert_eq!(fs::read(game.join("mods/a.jar")).unwrap(), b"a");
        assert!(import(&state, b"broken", "bad", None, &|_, _, _| {}).await.is_err());
        assert_eq!(state.instances.list().len(), 1);
        fs::remove_dir_all(root).unwrap();
    }
}
