//! `.mrpack` einer Instanz (Modrinth-Format): Modrinth-Inhalte stehen als Download im Index, alles andere
//! liegt unter `overrides/`. Vorlagen und „Exportieren…“ schreiben darüber; der Pack-Import liest es wieder.
use std::{
    collections::{HashMap, HashSet},
    ffi::OsStr,
    fs,
    io::Write,
    path::{Path, PathBuf},
};

use serde::Serialize;
use serde_json::{json, Value};
use tokio_util::sync::CancellationToken;

use super::{
    add_zip_file, blocking, check_cancelled, content,
    limits::{FILE_LIMIT, MIB, MRPACK_EXPORT_ENTRIES},
    modrinth, mods, write_zip_atomic, Dirs,
};
use crate::{
    coded,
    error::{AppError, AppResult},
    models::{require_name, Instance, Mod, ModLoader, ModSource, MAX_NAME_LEN},
    state::AppState,
};

const MAX_VERSION_LEN: usize = 64;
const MAX_SUMMARY_LEN: usize = 500;
/// Projekte je Anfrage bei der Abfrage der Server-Umgebung; deutlich unter dem Limit der API.
const PROJECT_BATCH: usize = 100;

/// Name, Version und Beschreibung, die ein Pack im Index trägt.
#[derive(Debug, Clone, PartialEq)]
pub struct PackMeta {
    name: String,
    version_id: String,
    summary: Option<String>,
}

impl PackMeta {
    /// Prüft die Angaben des Nutzers; eine leere Beschreibung entfällt.
    pub fn new(name: &str, version_id: &str, summary: Option<&str>) -> AppResult<Self> {
        let name = require_name(name, MAX_NAME_LEN, coded!("errors.packs.export.nameLength", max = MAX_NAME_LEN))?;
        let version_id =
            require_name(version_id, MAX_VERSION_LEN, coded!("errors.packs.export.versionLength", max = MAX_VERSION_LEN))?;
        let summary = summary.map(str::trim).filter(|s| !s.is_empty());
        if summary.is_some_and(|s| s.chars().count() > MAX_SUMMARY_LEN) {
            return Err(AppError::invalid(coded!("errors.packs.export.summaryLength", max = MAX_SUMMARY_LEN)));
        }
        Ok(Self { name: name.into(), version_id: version_id.into(), summary: summary.map(Into::into) })
    }

    /// Die Angaben einer Vorlage: Name der Instanz, Version „1“, keine Beschreibung.
    fn of_template(instance: &Instance) -> Self {
        Self { name: instance.name.clone(), version_id: "1".into(), summary: None }
    }
}

/// Grenzen eines Packs. Vorlagen werden über den eigenen Import wieder zu Instanzen und müssen dessen
/// Sicherheitsgrenzen einhalten; ein Export ist für den Nutzer und andere Launcher und hat keine.
#[derive(Clone, Copy)]
pub enum PackLimit {
    Importable,
    Unlimited,
}

impl PackLimit {
    /// Prüft vor dem Schreiben, ob die Dateien unter die Grenzen passen. Der Import nimmt höchstens
    /// `FILE_LIMIT` pro Pack; unkomprimiert gezählt ist das die sichere Seite.
    fn check(self, files: &[(String, PathBuf)]) -> AppResult<()> {
        if matches!(self, PackLimit::Unlimited) {
            return Ok(());
        }
        if files.len() > MRPACK_EXPORT_ENTRIES {
            return Err(AppError::invalid(coded!("errors.packs.export.tooManyFiles", max = MRPACK_EXPORT_ENTRIES)));
        }
        let mut total = 0;
        for (name, source) in files {
            total += fs::metadata(source).map_err(|e| AppError::invalid(coded!("errors.packs.export.fileUnreadable", name = name, reason = e)))?.len();
            if total > FILE_LIMIT {
                return Err(AppError::invalid(coded!("errors.packs.export.tooLarge", mib = FILE_LIMIT / MIB)));
            }
        }
        Ok(())
    }
}

/// Was in ein Pack kommt: die Einträge `include` des Spielordners, die Angaben für den Index und die Grenzen.
pub struct PackSpec {
    pub include: Vec<String>,
    pub meta: PackMeta,
    pub limit: PackLimit,
}

impl PackSpec {
    /// Vorlagen heißen wie die Instanz und halten die Grenzen des Imports ein.
    pub fn template(instance: &Instance, include: Vec<String>) -> Self {
        Self { include, meta: PackMeta::of_template(instance), limit: PackLimit::Importable }
    }
}

/// Was „Exportieren…“ zur Auswahl stellt: die Einträge im Spielordner, dazu die Ordner aktiver
/// Inhalte, auch wenn sie noch nicht auf der Platte liegen (die Dateien kommen aus dem Cache).
pub fn entries(dirs: &Dirs, instance: &Instance) -> AppResult<Vec<String>> {
    let mut names = dirs.game_entries(&instance.id)?;
    for (m, _) in active_content(instance) {
        let folder = m.kind.folder();
        if !names.iter().any(|n| n == folder) {
            names.push(folder.to_owned());
        }
    }
    names.sort();
    Ok(names)
}

/// Exportiert die Instanz nach `path`; `include` sind Einträge aus [`entries`].
pub async fn export(state: &AppState, instance_id: &str, include: Vec<String>, meta: PackMeta, path: &Path) -> AppResult<()> {
    require_pack_target(path)?;
    let instance = state.instances.get(instance_id)?;
    check_available(&state.dirs, &instance, &include)?;
    write(&state.dirs, instance, PackSpec { include, meta, limit: PackLimit::Unlimited }, path).await
}

/// Ziel einer `.mrpack`-Datei, die der Nutzer gewählt hat: absolut und mit der Endung `.mrpack`.
pub fn require_pack_target(path: &Path) -> AppResult<()> {
    if !path.is_absolute() || path.extension().and_then(|e| e.to_str()) != Some("mrpack") {
        return Err(AppError::invalid(coded!("errors.export.chooseTarget")));
    }
    Ok(())
}

/// Zielpfade für mehrere Packs in `folder`: der gewünschte Dateiname, bei einer vorhandenen oder früher vergebenen
/// Datei (ohne Rücksicht auf Groß-/Kleinschreibung) „Name (2).mrpack“, „Name (3).mrpack“, … So überschreibt ein
/// Mehrfach-Export nichts, was schon im Ordner liegt.
pub fn free_targets(folder: &Path, file_names: &[String]) -> AppResult<Vec<PathBuf>> {
    if !folder.is_absolute() {
        return Err(AppError::invalid(coded!("errors.export.chooseTarget")));
    }
    let mut taken = HashSet::new();
    file_names
        .iter()
        .map(|name| {
            let wanted = Path::new(name);
            if wanted.file_name() != Some(OsStr::new(name)) {
                return Err(AppError::invalid(coded!("errors.export.chooseTarget")));
            }
            let stem = wanted.file_stem().unwrap_or_default().to_string_lossy();
            let extension = wanted.extension().map(|e| format!(".{}", e.to_string_lossy())).unwrap_or_default();
            let candidates = std::iter::once(name.clone()).chain((2..).map(|n| format!("{stem} ({n}){extension}")));
            let free = candidates
                .map(|candidate| folder.join(candidate))
                .find(|path| !path.exists() && !taken.contains(&path.to_string_lossy().to_lowercase()))
                .expect("unendlich viele Kandidaten");
            taken.insert(free.to_string_lossy().to_lowercase());
            Ok(free)
        })
        .collect()
}

fn check_available(dirs: &Dirs, instance: &Instance, include: &[String]) -> AppResult<()> {
    let available = entries(dirs, instance)?;
    match include.iter().find(|n| !available.contains(n)) {
        Some(unknown) => Err(AppError::invalid(coded!("errors.packs.export.unknownEntry", name = unknown))),
        None => Ok(()),
    }
}

/// Wie ein Export mit einer Auswahl die Inhalte (Mods, Ressourcen- und Shaderpakete) verteilt.
#[derive(Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportSummary {
    /// Als Download von Modrinth im Index.
    pub linked: usize,
    /// Als Datei im Pack, weil Modrinth sie nicht kennt oder nicht erreichbar war.
    pub embedded: usize,
    /// Ausgeschaltet und deshalb nicht im Pack.
    pub skipped_disabled: usize,
}

/// Wie [`export`] die Inhalte verteilen würde, ohne zu schreiben; fragt dafür Modrinth, was es kennt.
pub async fn summary(state: &AppState, instance_id: &str, include: &[String]) -> AppResult<ExportSummary> {
    let instance = state.instances.get(instance_id)?;
    let linked = linked_files(&modrinth::client()?, &instance, include).await;
    Ok(summarize(&instance, include, linked.len()))
}

fn summarize(instance: &Instance, include: &[String], linked: usize) -> ExportSummary {
    let active = active_content(instance).filter(|(m, _)| included(include, m)).count();
    let skipped_disabled = instance.mods.iter().filter(|m| !m.enabled && included(include, m)).count();
    ExportSummary { linked, embedded: active - linked, skipped_disabled }
}

/// Schreibt das Pack nach `path`. Deaktivierte Inhalte bleiben draußen: der Import kennt kein „deaktiviert“.
pub async fn write(dirs: &Dirs, instance: Instance, spec: PackSpec, path: &Path) -> AppResult<()> {
    let PackSpec { include, meta, limit } = spec;
    let remote = remote_files(&modrinth::client()?, &instance, &include).await;
    let (dirs, path) = (dirs.clone(), path.to_owned());
    blocking(move |stop| {
        let files = overrides(&dirs, &instance, &include, &remote)?;
        limit.check(&files)?;
        write_zip(&path, &index(&instance, &meta, &remote)?, &pumpkin_meta(&instance), files, stop)
    })
    .await
}

/// Aktive Inhalte samt SHA-1 (Schlüssel im Mod-Cache).
fn active_content(instance: &Instance) -> impl Iterator<Item = (&Mod, &str)> {
    instance.mods.iter().filter(|m| m.enabled).filter_map(|m| Some((m, m.sha1.as_deref()?)))
}

fn included(include: &[String], m: &Mod) -> bool {
    include.iter().any(|name| name == m.kind.folder())
}

/// Eintrag unter `files` im `modrinth.index.json`: eine Datei, die der Import von Modrinth lädt statt aus `overrides/`.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct IndexFile {
    path: String,
    hashes: IndexHashes,
    downloads: Vec<String>,
    file_size: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    env: Option<IndexEnv>,
}

#[derive(Serialize)]
struct IndexHashes {
    sha1: String,
    sha512: String,
}

/// Wo die Datei gebraucht wird. Sie liegt im Client dieser Instanz, ist dort also nötig; für den Server gilt,
/// was Modrinth für das Projekt angibt.
#[derive(Serialize)]
struct IndexEnv {
    client: &'static str,
    server: String,
}

/// Modrinth-Inhalt, den der Index als Download führt.
struct Linked {
    path: String,
    project_id: String,
    file: modrinth::File,
}

/// Inhalte, deren installierte Datei (sha1) Modrinth kennt; eine Sammelabfrage.
/// Alles ohne Treffer landet als Override aus dem Cache im Pack, auch ohne Netz: die Dateien liegen ja schon da.
async fn linked_files(client: &reqwest::Client, instance: &Instance, include: &[String]) -> Vec<Linked> {
    let candidates: Vec<(&Mod, &str)> = active_content(instance)
        .filter(|(m, _)| included(include, m) && matches!(m.source, ModSource::Modrinth { .. }))
        .collect();
    let hashes: Vec<String> = candidates.iter().map(|(_, sha1)| sha1.to_string()).collect();
    let known = modrinth::versions_by_hash(client, &hashes).await.unwrap_or_else(|err| {
        tracing::warn!(%err, "Modrinth nicht erreichbar; die Inhalte kommen als Overrides ins Pack");
        Default::default()
    });
    candidates
        .into_iter()
        .filter_map(|(m, sha1)| {
            let version = known.get(&sha1.to_ascii_lowercase())?;
            let file = version.files.iter().find(|f| {
                f.hashes.get("sha1").is_some_and(|h| h.eq_ignore_ascii_case(sha1))
                    && f.hashes.contains_key("sha512")
                    && modrinth::download_url(&f.url).is_ok()
            })?;
            Some(Linked { path: mods::game_path(m), project_id: version.project_id.clone(), file: file.clone() })
        })
        .collect()
}

/// Index-Einträge für die verlinkten Inhalte, mit der Server-Umgebung ihrer Projekte.
async fn remote_files(client: &reqwest::Client, instance: &Instance, include: &[String]) -> Vec<IndexFile> {
    let linked = linked_files(client, instance, include).await;
    let sides = server_sides(client, &linked).await;
    linked.into_iter().map(|l| index_file(l, &sides)).collect()
}

fn index_file(linked: Linked, server_sides: &HashMap<String, String>) -> IndexFile {
    let Linked { path, project_id, file } = linked;
    IndexFile {
        path,
        hashes: IndexHashes { sha1: file.hashes["sha1"].clone(), sha512: file.hashes["sha512"].clone() },
        downloads: vec![file.url],
        file_size: file.size,
        env: server_sides.get(&project_id).map(|server| IndexEnv { client: "required", server: server.clone() }),
    }
}

/// `server_side` je Projekt-Id. Was fehlt oder nicht zu den drei Werten des Formats passt, bleibt ohne Angabe
/// im Index (es gilt „required“): ein unbekannter Wert ließe den Import scheitern.
async fn server_sides(client: &reqwest::Client, linked: &[Linked]) -> HashMap<String, String> {
    let mut ids: Vec<String> = linked.iter().map(|l| l.project_id.clone()).collect();
    ids.sort();
    ids.dedup();
    let mut sides = HashMap::new();
    for batch in ids.chunks(PROJECT_BATCH) {
        match modrinth::projects(client, batch).await {
            Ok(projects) => sides.extend(
                projects
                    .into_iter()
                    .filter(|p| matches!(p.server_side.as_str(), "required" | "optional" | "unsupported"))
                    .map(|p| (p.id, p.server_side)),
            ),
            Err(err) => tracing::warn!(%err, "Server-Umgebung der Projekte nicht abgefragt; das Pack nennt sie nicht"),
        }
    }
    sides
}

fn index(instance: &Instance, meta: &PackMeta, remote: &[IndexFile]) -> AppResult<Value> {
    let mut dependencies = json!({ "minecraft": instance.minecraft_version });
    match (instance.loader, &instance.loader_version) {
        (ModLoader::Vanilla, _) => {}
        (loader, Some(v)) => {
            let key = loader.pack_key().ok_or_else(|| AppError::invalid(coded!("errors.packs.export.loaderWithoutPackKey")))?;
            dependencies[key] = json!(v);
        }
        (_, None) => return Err(AppError::invalid(coded!("errors.export.loaderVersionMissing"))),
    }
    let mut index = json!({
        "formatVersion": 1, "game": "minecraft", "versionId": meta.version_id, "name": meta.name,
        "files": remote, "dependencies": dependencies,
    });
    if let Some(summary) = &meta.summary {
        index["summary"] = json!(summary);
    }
    Ok(index)
}

/// „Benötigt von“, Icon und Szene kennt das mrpack-Format nicht: eigene Datei, die der Import auswertet.
fn pumpkin_meta(instance: &Instance) -> Value {
    let required_by: serde_json::Map<String, Value> = active_content(instance)
        .filter(|(m, _)| !m.required_by.is_empty())
        .map(|(m, _)| (m.file_name.clone(), json!(m.required_by)))
        .collect();
    json!({ "requiredBy": required_by, "icon": instance.icon, "scene": instance.scene })
}

/// Dateien für `overrides/`: gewählte aktive Inhalte ohne Index-Eintrag aus dem Cache, dazu die gewählten
/// Einträge des Spielordners ohne die Dateien verwalteter Inhalte (die kommen aus Index bzw. Cache).
fn overrides(dirs: &Dirs, instance: &Instance, include: &[String], remote: &[IndexFile]) -> AppResult<Vec<(String, PathBuf)>> {
    let covered: Vec<&str> = remote.iter().map(|f| f.path.as_str()).collect();
    mods::recache(dirs, &instance.id, &instance.mods)?;
    let mut files = Vec::new();
    for (m, sha1) in active_content(instance).filter(|(m, _)| included(include, m)) {
        let path = mods::game_path(m);
        if !covered.contains(&path.as_str()) {
            files.push((path, mods::cache_path(dirs, sha1)?));
        }
    }
    files.extend(mods::unmanaged_files(dirs, &instance.id, include, &instance.mods)?);
    Ok(files)
}

/// Schreibt das Archiv über `<path>.part`; bei einem Fehler oder Abbruch bleibt am Ziel nichts Halbes liegen.
fn write_zip(path: &Path, index: &Value, meta: &Value, files: Vec<(String, PathBuf)>, stop: &CancellationToken) -> AppResult<()> {
    write_zip_atomic(path, "mrpack.part", |zip| {
        let options = zip::write::SimpleFileOptions::default();
        zip.start_file("modrinth.index.json", options)?;
        zip.write_all(&serde_json::to_vec_pretty(index)?)?;
        zip.start_file(content::PUMPKIN_FILE, options)?;
        zip.write_all(&serde_json::to_vec_pretty(meta)?)?;
        for (name, source) in files {
            check_cancelled(stop)?;
            // Gleiche Prüfung wie der Import, der den ganzen Eintragsnamen samt `overrides/` sieht.
            let entry = format!("overrides/{name}");
            content::safe_path(&entry)?;
            let mut file = fs::File::open(&source).map_err(|e| AppError::invalid(coded!("errors.packs.export.fileUnreadable", name = name, reason = e)))?;
            add_zip_file(zip, &entry, &mut file)?;
        }
        // Ein Abbruch während der letzten Datei darf kein fertiges Pack am Ziel hinterlassen.
        check_cancelled(stop)
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::{new_id, InstanceIcon, InstanceScene, ModKind, NewInstance};

    fn meta(name: &str) -> PackMeta {
        PackMeta::new(name, "1.0.0", Some("Mein Pack")).unwrap()
    }

    fn local_mod(name: &str, enabled: bool) -> Mod {
        Mod {
            id: name.into(),
            name: name.into(),
            version: "1".into(),
            source: ModSource::Local,
            file_name: format!("{name}.jar"),
            sha1: Some("a".repeat(40)),
            enabled,
            kind: ModKind::Mod,
            required_by: Vec::new(),
            pinned: false,
            pack_managed: false,
        }
    }

    fn fabric_instance(name: &str) -> Instance {
        Instance::from_new(NewInstance {
            name: name.into(),
            minecraft_version: "1.21.1".into(),
            loader: ModLoader::Fabric,
            loader_version: Some("0.16.10".into()),
        })
    }

    #[test]
    fn free_targets_avoid_existing_and_repeated_names() {
        let folder = std::env::temp_dir().join(new_id());
        fs::create_dir_all(&folder).unwrap();
        fs::write(folder.join("A.mrpack"), "x").unwrap();
        fs::write(folder.join("A (2).mrpack"), "x").unwrap();
        let names: Vec<String> = ["A.mrpack", "B.mrpack", "b.mrpack"].map(String::from).to_vec();
        let targets = free_targets(&folder, &names).unwrap();
        let file_names: Vec<_> = targets.iter().map(|p| p.file_name().unwrap().to_string_lossy().into_owned()).collect();
        assert_eq!(file_names, ["A (3).mrpack", "B.mrpack", "b (2).mrpack"]);
        assert!(free_targets(Path::new("relativ"), &names).is_err());
        assert!(free_targets(&folder, &["../A.mrpack".to_string()]).is_err());
    }

    #[tokio::test]
    async fn export_roundtrips_through_import() {
        let root = std::env::temp_dir().join(new_id());
        let state = AppState::load(&root).unwrap();
        let own = Mod { sha1: Some(mods::cache_bytes(&state.dirs, b"own").unwrap()), ..local_mod("own", true) };
        let mut source = fabric_instance("Quelle");
        source.mods = vec![own];
        source.icon = Some(InstanceIcon::Glyph { glyph: "hammer".into(), palette: "teal".into() });
        source.scene = Some(InstanceScene { biome: "nether".into(), seed: 7 });
        let source = state.instances.insert(source).unwrap();
        mods::sync(&state.dirs, &source.id, &source.mods).unwrap();
        // Geleerter Cache: der Export greift auf die abgelegte Datei zurück.
        fs::remove_dir_all(state.dirs.mod_cache()).unwrap();
        let game = state.dirs.game_dir(&source.id);
        for (path, data) in [("mods/extra.jar", "eigene"), ("saves/w/level.dat", "welt"), ("options.txt", "fov:1"), ("logs/latest.log", "log")] {
            fs::create_dir_all(game.join(path).parent().unwrap()).unwrap();
            fs::write(game.join(path), data).unwrap();
        }
        assert_eq!(entries(&state.dirs, &source).unwrap(), ["mods", "options.txt", "saves"]);
        let target = root.join("Export.mrpack");
        let include = |names: &[&str]| names.iter().map(|n| n.to_string()).collect::<Vec<_>>();

        assert!(export(&state, &source.id, include(&["logs"]), meta("Pack"), &target).await.is_err());
        assert!(export(&state, &source.id, include(&["mods"]), meta("Pack"), Path::new("Export.mrpack")).await.is_err());
        export(&state, &source.id, include(&["mods", "saves"]), meta("Pack"), &target).await.unwrap();
        assert!(!target.with_extension("mrpack.part").exists());

        let data = content::local_pack(&target).unwrap();
        let info = content::inspect(&data, &state.dirs).unwrap();
        assert_eq!((info.name.as_str(), info.content_count), ("Pack", 2));
        let copy = content::import(&state, &data, "Kopie", None, &|_, _, _| {}).await.unwrap();
        let new = state.dirs.game_dir(&copy.id);
        assert_eq!(fs::read(new.join("mods/own.jar")).unwrap(), b"own");
        assert_eq!(fs::read(new.join("mods/extra.jar")).unwrap(), b"eigene");
        assert_eq!(fs::read(new.join("saves/w/level.dat")).unwrap(), b"welt");
        assert!(!new.join("options.txt").exists());
        let mut files: Vec<_> = copy.mods.iter().map(|m| m.file_name.as_str()).collect();
        files.sort();
        assert_eq!(files, ["extra.jar", "own.jar"]);
        assert_eq!((copy.loader, copy.loader_version.as_deref()), (ModLoader::Fabric, Some("0.16.10")));
        assert_eq!((copy.icon, copy.scene), (source.icon, source.scene));
        fs::remove_dir_all(root).unwrap();
    }

    #[tokio::test]
    async fn without_network_modrinth_content_goes_into_the_pack_as_overrides() {
        let modrinth = Mod {
            source: ModSource::Modrinth { project_id: "sodium".into(), version_id: "v1".into() },
            ..local_mod("sodium", true)
        };
        let mut instance = fabric_instance("Offline");
        instance.mods = vec![modrinth];
        // Ein Proxy, bei dem nichts lauscht: jede Anfrage scheitert sofort.
        let offline = reqwest::Client::builder().proxy(reqwest::Proxy::all("http://127.0.0.1:9").unwrap()).build().unwrap();

        let remote = remote_files(&offline, &instance, &["mods".to_string()]).await;

        assert!(remote.is_empty());
    }

    #[test]
    fn index_lists_modrinth_files_in_the_mrpack_format() {
        let instance = fabric_instance("Pack");
        let file = |env| IndexFile {
            path: "mods/sodium.jar".into(),
            hashes: IndexHashes { sha1: "a".into(), sha512: "b".into() },
            downloads: vec!["https://cdn.modrinth.com/s.jar".into()],
            file_size: 7,
            env,
        };

        let plain = serde_json::to_string(&index(&instance, &meta("Pack"), &[file(None)]).unwrap()).unwrap();
        let with_env = serde_json::to_string(&index(&instance, &meta("Pack"), &[file(Some(IndexEnv { client: "required", server: "optional".into() }))]).unwrap()).unwrap();

        let files = r#""files":[{"downloads":["https://cdn.modrinth.com/s.jar"],"fileSize":7,"hashes":{"sha1":"a","sha512":"b"},"path":"mods/sodium.jar"}]"#;
        assert!(plain.contains(files), "{plain}");
        assert!(with_env.contains(r#""env":{"client":"required","server":"optional"}"#), "{with_env}");
    }

    #[test]
    fn index_carries_name_version_and_summary_of_the_pack() {
        let instance = fabric_instance("Instanz");

        let with = index(&instance, &meta("Mein Pack"), &[]).unwrap();
        let without = index(&instance, &PackMeta::new("Mein Pack", "2", Some("  ")).unwrap(), &[]).unwrap();

        assert_eq!((&with["name"], &with["versionId"], &with["summary"]), (&json!("Mein Pack"), &json!("1.0.0"), &json!("Mein Pack")));
        assert_eq!((&without["versionId"], without.get("summary")), (&json!("2"), None));
    }

    #[test]
    fn pack_meta_rejects_blank_and_overlong_fields() {
        assert!(PackMeta::new(" ", "1", None).is_err());
        assert!(PackMeta::new("Pack", "", None).is_err());
        assert!(PackMeta::new("Pack", &"v".repeat(MAX_VERSION_LEN + 1), None).is_err());
        assert!(PackMeta::new("Pack", "1", Some(&"s".repeat(MAX_SUMMARY_LEN + 1))).is_err());
        assert_eq!(PackMeta::new("  Pack ", " 1 ", None).unwrap(), PackMeta { name: "Pack".into(), version_id: "1".into(), summary: None });
    }

    #[test]
    fn summary_splits_linked_embedded_and_skipped_content() {
        let mut instance = fabric_instance("Pack");
        let shader = Mod { kind: ModKind::Shader, file_name: "s.zip".into(), ..local_mod("s", true) };
        instance.mods = vec![local_mod("a", true), local_mod("b", true), local_mod("off", false), shader];
        let mods_only = vec!["mods".to_string()];

        assert_eq!(summarize(&instance, &mods_only, 1), ExportSummary { linked: 1, embedded: 1, skipped_disabled: 1 });
        assert_eq!(summarize(&instance, &[], 0), ExportSummary { linked: 0, embedded: 0, skipped_disabled: 0 });
    }

    #[test]
    fn only_importable_packs_are_limited() {
        let file = std::env::temp_dir().join(format!("{}.txt", new_id()));
        fs::write(&file, "x").unwrap();
        let files = vec![("a.txt".to_string(), file.clone()); MRPACK_EXPORT_ENTRIES + 1];

        assert!(PackLimit::Importable.check(&files).is_err());
        assert!(PackLimit::Importable.check(&files[..MRPACK_EXPORT_ENTRIES]).is_ok());
        assert!(PackLimit::Unlimited.check(&files).is_ok());
        fs::remove_file(file).unwrap();
    }
}
