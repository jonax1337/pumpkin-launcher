//! Was die Dateien einer Instanz hergeben: Größe und Datum je Eintrag (zum Sortieren) und, aus den Metadaten der
//! Mod-JARs, Hinweise auf fehlende Abhängigkeiten, doppelte Mods, falschen Loader und falsche Minecraft-Version.
use std::{
    collections::{HashMap, HashSet},
    fs,
    path::{Path, PathBuf},
    sync::{LazyLock, Mutex},
    time::UNIX_EPOCH,
};

use serde::Serialize;

use super::{
    jar_meta::{read_jar, Declared, JarInfo},
    version_range::{maven_matches, semver_matches},
};
use crate::{
    error::AppResult,
    models::{Instance, Mod, ModKind, ModLoader},
    services::{lock, mods, require_plain_name, Dirs},
};

/// Gelesene Metadaten je Datei-Hash. Dateien im Mod-Cache ändern sich nie: Schalten oder Aktualisieren eines Inhalts
/// liest so nicht alle JARs der Instanz neu.
static READ_JARS: LazyLock<Mutex<HashMap<String, JarInfo>>> = LazyLock::new(Mutex::default);
/// So viele Dateien merkt sich `READ_JARS`; darüber wird es geleert.
const MAX_READ_JARS: usize = 4096;

/// IDs, die der Loader selbst mitbringt und die keine Mod liefern muss.
const BUILT_IN: [&str; 12] = [
    "minecraft",
    "java",
    "fabricloader",
    "fabric-loader",
    "quilt_loader",
    "quilt-loader",
    "forge",
    "neoforge",
    "fml",
    "javafml",
    "lowcodefml",
    "mclanguage",
];

/// Größe und Änderungsdatum der Datei eines Eintrags.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileFacts {
    mod_id: String,
    size_bytes: u64,
    modified_ms: u64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum IssueKind {
    /// `subject` ist die ID der fehlenden Mod.
    MissingDependency,
    /// `subject` nennt die Dateien, die dieselbe Mod mitbringen.
    Duplicate,
    /// `subject` nennt die Loader, für die die Datei gebaut ist.
    WrongLoader,
    /// `subject` ist die Bedingung der Datei an die Minecraft-Version.
    WrongMinecraft,
}

/// Ein Hinweis zu einer aktiven Mod der Instanz.
#[derive(Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ContentIssue {
    mod_id: String,
    kind: IssueKind,
    subject: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ContentAnalysis {
    files: Vec<FileFacts>,
    issues: Vec<ContentIssue>,
}

pub fn analyze(dirs: &Dirs, instance: &Instance) -> ContentAnalysis {
    let paths: Vec<(&Mod, PathBuf)> = instance.mods.iter().filter_map(|m| Some((m, content_path(dirs, &instance.id, m)?))).collect();
    let files = paths.iter().filter_map(|(m, path)| file_facts(m, path)).collect();
    let jars: Vec<(&Mod, JarInfo)> = paths
        .iter()
        .filter(|(m, _)| m.enabled && m.kind == ModKind::Mod)
        .filter_map(|(m, path)| match read_jar_cached(dirs, m, path) {
            Ok(info) => Some((*m, info)),
            Err(err) => {
                tracing::warn!(file = %m.file_name, %err, "Metadaten der Mod nicht gelesen");
                None
            }
        })
        .collect();
    ContentAnalysis { files, issues: find_issues(instance, &jars) }
}

/// Wie `read_jar`; für die Datei im Mod-Cache aus dem Gedächtnis, falls sie schon gelesen ist.
fn read_jar_cached(dirs: &Dirs, m: &Mod, path: &Path) -> AppResult<JarInfo> {
    let key = m.sha1.as_deref().filter(|sha1| mods::cache_path(dirs, sha1).is_ok_and(|cached| cached == path));
    let Some(key) = key else { return read_jar(path) };
    if let Some(known) = lock(&READ_JARS).get(key) {
        return Ok(known.clone());
    }
    let info = read_jar(path)?;
    let mut read = lock(&READ_JARS);
    if read.len() >= MAX_READ_JARS {
        read.clear();
    }
    read.insert(key.to_owned(), info.clone());
    Ok(info)
}

/// Die Datei des Eintrags: der Cache-Eintrag (dort liegen auch ausgeschaltete Inhalte), sonst die im Spielordner.
fn content_path(dirs: &Dirs, instance_id: &str, m: &Mod) -> Option<PathBuf> {
    let cached = m.sha1.as_deref().and_then(|sha1| mods::cache_path(dirs, sha1).ok());
    let placed = require_plain_name(&m.file_name).ok().map(|name| dirs.game_dir(instance_id).join(m.kind.folder()).join(name));
    cached.into_iter().chain(placed).find(|path| fs::symlink_metadata(path).is_ok_and(|meta| meta.is_file()))
}

fn file_facts(m: &Mod, path: &Path) -> Option<FileFacts> {
    let meta = fs::metadata(path).ok()?;
    let modified = meta.modified().ok()?.duration_since(UNIX_EPOCH).ok()?;
    Some(FileFacts { mod_id: m.id.clone(), size_bytes: meta.len(), modified_ms: modified.as_millis() as u64 })
}

/// Die Hinweise zu den aktiven Mods `jars`; ohne Loader (Vanilla) läuft keine Mod und es gibt nichts zu prüfen.
fn find_issues(instance: &Instance, jars: &[(&Mod, JarInfo)]) -> Vec<ContentIssue> {
    if instance.loader == ModLoader::Vanilla {
        return Vec::new();
    }
    let running: Vec<(&Mod, &JarInfo, &Declared)> = jars
        .iter()
        .filter_map(|(m, info)| Some((*m, info, info.declared.iter().find(|d| loads(instance, d.loader))?)))
        .collect();
    let provided: HashSet<&str> = BUILT_IN
        .into_iter()
        .chain(running.iter().flat_map(|(_, info, declared)| {
            declared.ids.iter().chain(&info.nested_ids).map(String::as_str)
        }))
        .collect();
    let mut issues = Vec::new();
    for (m, info) in jars.iter().filter(|(_, info)| !info.declared.is_empty()) {
        match running.iter().find(|(other, ..)| std::ptr::eq(*other, *m)) {
            Some((_, _, declared)) => {
                issues.extend(missing_dependencies(m, declared, &provided));
                issues.extend(wrong_minecraft(instance, m, declared));
            }
            None => issues.push(wrong_loader(m, info)),
        }
    }
    issues.extend(duplicates(&running));
    issues
}

/// Läuft eine Mod, die für `loader` gebaut ist, in dieser Instanz? NeoForge für 1.20.1 lädt auch reine Forge-Mods.
fn loads(instance: &Instance, loader: ModLoader) -> bool {
    instance.loader.modrinth_loaders().contains(&loader.name())
        || (instance.loader == ModLoader::NeoForge && loader == ModLoader::Forge && instance.minecraft_version == "1.20.1")
}

fn issue(m: &Mod, kind: IssueKind, subject: String) -> ContentIssue {
    ContentIssue { mod_id: m.id.clone(), kind, subject }
}

fn missing_dependencies<'a>(m: &'a Mod, declared: &'a Declared, provided: &'a HashSet<&str>) -> impl Iterator<Item = ContentIssue> + 'a {
    declared
        .depends
        .iter()
        .filter(|d| d.required && !provided.contains(d.id.as_str()) && !declared.ids.contains(&d.id))
        .map(|d| issue(m, IssueKind::MissingDependency, d.id.clone()))
}

fn wrong_loader(m: &Mod, info: &JarInfo) -> ContentIssue {
    let loaders: Vec<&str> = info.declared.iter().map(|d| d.loader.display_name()).collect();
    issue(m, IssueKind::WrongLoader, loaders.join(", "))
}

fn wrong_minecraft(instance: &Instance, m: &Mod, declared: &Declared) -> Option<ContentIssue> {
    let wanted = declared.depends.iter().find(|d| d.id == "minecraft" && d.required)?;
    let matches = match declared.loader {
        ModLoader::Forge | ModLoader::NeoForge => wanted.ranges.first().and_then(|range| maven_matches(range, &instance.minecraft_version)),
        _ => semver_matches(&wanted.ranges, &instance.minecraft_version),
    };
    (matches == Some(false)).then(|| issue(m, IssueKind::WrongMinecraft, wanted.ranges.join(" || ")))
}

/// Mods, deren erste ID mehrere aktive Dateien tragen; je Datei die Namen der anderen.
fn duplicates(running: &[(&Mod, &JarInfo, &Declared)]) -> Vec<ContentIssue> {
    let mut by_id: HashMap<&str, Vec<&Mod>> = HashMap::new();
    for (m, _, declared) in running {
        by_id.entry(declared.ids[0].as_str()).or_default().push(m);
    }
    running
        .iter()
        .filter_map(|(m, _, declared)| {
            let same = &by_id[declared.ids[0].as_str()];
            let others: Vec<&str> = same.iter().filter(|other| !std::ptr::eq(**other, *m)).map(|other| other.file_name.as_str()).collect();
            (!others.is_empty()).then(|| issue(m, IssueKind::Duplicate, others.join(", ")))
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{
        models::NewInstance,
        services::content::{fixtures::modrinth_mod, jar_meta::Dependency},
    };

    fn instance(loader: ModLoader, mc: &str, mods: Vec<Mod>) -> Instance {
        let mut instance = Instance::from_new(NewInstance {
            name: "i".into(),
            minecraft_version: mc.into(),
            loader,
            loader_version: None,
        });
        instance.mods = mods;
        instance
    }

    fn dep(id: &str, required: bool, range: &str) -> Dependency {
        Dependency { id: id.into(), required, ranges: if range.is_empty() { vec![] } else { vec![range.into()] } }
    }

    fn jar(loader: ModLoader, ids: &[&str], depends: Vec<Dependency>) -> JarInfo {
        let declared = Declared { loader, ids: ids.iter().map(|id| id.to_string()).collect(), depends };
        JarInfo { declared: vec![declared], nested_ids: Vec::new() }
    }

    fn issues_of(instance: &Instance, jars: Vec<JarInfo>) -> Vec<(String, IssueKind, String)> {
        let pairs: Vec<(&Mod, JarInfo)> = instance.mods.iter().zip(jars).collect();
        find_issues(instance, &pairs).into_iter().map(|i| (i.mod_id, i.kind, i.subject)).collect()
    }

    #[test]
    fn a_missing_required_dependency_is_reported_unless_a_mod_or_an_embedded_jar_provides_it() {
        let mods = vec![modrinth_mod("a", &[]), modrinth_mod("b", &[]), modrinth_mod("fabric-api", &[])];
        let instance = instance(ModLoader::Fabric, "1.21.1", mods);
        let needs = vec![
            dep("fabricloader", true, ">=0.15"),
            dep("cloth-config", true, "*"),
            dep("fabric-api-base", true, "*"),
            dep("optional-thing", false, "*"),
        ];
        let api = JarInfo { nested_ids: vec!["fabric-api-base".into()], ..jar(ModLoader::Fabric, &["fabric-api"], vec![]) };

        let found = issues_of(&instance, vec![jar(ModLoader::Fabric, &["a"], needs), jar(ModLoader::Fabric, &["b"], vec![dep("a", true, "*")]), api]);

        assert_eq!(found, [("a".into(), IssueKind::MissingDependency, "cloth-config".into())]);
    }

    #[test]
    fn the_same_mod_twice_is_a_duplicate_for_both_files() {
        let mods = vec![modrinth_mod("sodium", &[]), Mod { file_name: "sodium-old.jar".into(), ..modrinth_mod("sodium", &[]) }];
        let instance = instance(ModLoader::Fabric, "1.21.1", mods);

        let found = issues_of(&instance, vec![jar(ModLoader::Fabric, &["sodium"], vec![]), jar(ModLoader::Fabric, &["sodium"], vec![])]);

        assert_eq!(
            found,
            [
                ("sodium".into(), IssueKind::Duplicate, "sodium-old.jar".into()),
                ("sodium".into(), IssueKind::Duplicate, "sodium.jar".into()),
            ]
        );
    }

    #[test]
    fn a_mod_for_another_loader_is_reported_and_provides_nothing() {
        let mods = vec![modrinth_mod("create", &[]), modrinth_mod("needs-create", &[])];
        let instance = instance(ModLoader::Fabric, "1.21.1", mods);

        let found = issues_of(
            &instance,
            vec![jar(ModLoader::Forge, &["create"], vec![]), jar(ModLoader::Fabric, &["needs-create"], vec![dep("create", true, "")])],
        );

        assert_eq!(
            found,
            [
                ("create".into(), IssueKind::WrongLoader, "Forge".into()),
                ("needs-create".into(), IssueKind::MissingDependency, "create".into()),
            ]
        );
    }

    #[test]
    fn quilt_runs_fabric_mods_and_neoforge_121_does_not_run_forge_mods() {
        let quilt = instance(ModLoader::Quilt, "1.21.1", vec![modrinth_mod("a", &[])]);
        assert!(issues_of(&quilt, vec![jar(ModLoader::Fabric, &["a"], vec![])]).is_empty());

        let neo_121 = instance(ModLoader::NeoForge, "1.21.1", vec![modrinth_mod("a", &[])]);
        assert_eq!(issues_of(&neo_121, vec![jar(ModLoader::Forge, &["a"], vec![])]).len(), 1);
        let neo_120 = instance(ModLoader::NeoForge, "1.20.1", vec![modrinth_mod("a", &[])]);
        assert!(issues_of(&neo_120, vec![jar(ModLoader::Forge, &["a"], vec![])]).is_empty());
    }

    #[test]
    fn the_minecraft_condition_of_the_matching_loader_decides() {
        let instance_fabric = instance(ModLoader::Fabric, "1.21.1", vec![modrinth_mod("a", &[]), modrinth_mod("b", &[])]);
        let found = issues_of(
            &instance_fabric,
            vec![
                jar(ModLoader::Fabric, &["a"], vec![dep("minecraft", true, "~1.20")]),
                jar(ModLoader::Fabric, &["b"], vec![dep("minecraft", true, ">=1.21")]),
            ],
        );
        assert_eq!(found, [("a".into(), IssueKind::WrongMinecraft, "~1.20".into())]);

        let forge = instance(ModLoader::Forge, "1.20.1", vec![modrinth_mod("a", &[])]);
        let found = issues_of(&forge, vec![jar(ModLoader::Forge, &["a"], vec![dep("minecraft", true, "[1.21,1.22)")])]);
        assert_eq!(found, [("a".into(), IssueKind::WrongMinecraft, "[1.21,1.22)".into())]);
    }

    #[test]
    fn jars_without_metadata_and_vanilla_instances_raise_nothing() {
        let loose = instance(ModLoader::Fabric, "1.21.1", vec![modrinth_mod("a", &[])]);
        assert!(issues_of(&loose, vec![JarInfo::default()]).is_empty());
        let vanilla = instance(ModLoader::Vanilla, "1.21.1", vec![modrinth_mod("a", &[])]);
        assert!(issues_of(&vanilla, vec![jar(ModLoader::Fabric, &["a"], vec![dep("x", true, "")])]).is_empty());
    }

    #[test]
    fn jars_in_the_mod_cache_are_read_once_and_reported() {
        use std::io::Write;
        let mut writer = zip::ZipWriter::new(std::io::Cursor::new(Vec::new()));
        writer.start_file("fabric.mod.json", zip::write::SimpleFileOptions::default()).unwrap();
        writer.write_all(br#"{"id":"hud","depends":{"cloth-config":"*"}}"#).unwrap();
        let bytes = writer.finish().unwrap().into_inner();
        let dirs = Dirs::new(std::env::temp_dir().join(crate::models::new_id()));
        let sha1 = mods::cache_bytes(&dirs, &bytes).unwrap();
        let hud = Mod { sha1: Some(sha1.clone()), ..modrinth_mod("hud", &[]) };
        let instance = instance(ModLoader::Fabric, "1.21.1", vec![hud]);

        let first = analyze(&dirs, &instance);

        assert_eq!(first.issues, [ContentIssue { mod_id: "hud".into(), kind: IssueKind::MissingDependency, subject: "cloth-config".into() }]);
        assert!(lock(&READ_JARS).contains_key(&sha1));
        assert_eq!(analyze(&dirs, &instance).issues, first.issues);
        fs::remove_dir_all(&dirs.root).unwrap();
    }

    #[test]
    fn files_come_from_the_cache_or_the_game_folder() {
        let dirs = Dirs::new(std::env::temp_dir().join(crate::models::new_id()));
        let sha1 = mods::cache_bytes(&dirs, b"cached").unwrap();
        let cached = Mod { sha1: Some(sha1), enabled: false, ..modrinth_mod("cached", &[]) };
        let placed = Mod { sha1: None, file_name: "placed.jar".into(), ..modrinth_mod("placed", &[]) };
        let gone = Mod { sha1: None, file_name: "gone.jar".into(), ..modrinth_mod("gone", &[]) };
        fs::create_dir_all(dirs.mods_dir("i")).unwrap();
        fs::write(dirs.mods_dir("i").join("placed.jar"), b"12345").unwrap();
        let mut instance = instance(ModLoader::Fabric, "1.21.1", vec![cached, placed, gone]);
        instance.id = "i".into();

        let analysis = analyze(&dirs, &instance);

        let sizes: Vec<_> = analysis.files.iter().map(|f| (f.mod_id.as_str(), f.size_bytes)).collect();
        assert_eq!(sizes, [("cached", 6), ("placed", 5)]);
        assert!(analysis.files.iter().all(|f| f.modified_ms > 0));
        fs::remove_dir_all(&dirs.root).unwrap();
    }
}
