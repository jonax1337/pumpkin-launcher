//! Eigene Dateien des Nutzers (Ziehen und Ablegen, Dateiauswahl) als Inhalte einer Instanz. Was Modrinth
//! per SHA-1 kennt, wird als Modrinth-Inhalt eingetragen, damit Updates greifen; der Rest bleibt lokal.
use std::{
    collections::HashMap,
    fs,
    path::{Path, PathBuf},
};

use serde::{Deserialize, Serialize};

use super::{
    content,
    download::sha1_file,
    modrinth::{self, invalid, Version},
    mods,
};
use crate::{
    error::AppResult,
    models::{Instance, Mod, ModKind, ModSource},
    state::AppState,
};

/// Vorab-Prüfung einer Datei: Art (`None` = Zip ohne eindeutiges Merkmal, die Oberfläche fragt nach)
/// und der Name des Eintrags, falls die Instanz dieselbe Datei schon hat.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileCheck {
    path: String,
    kind: Option<ModKind>,
    duplicate_of: Option<String>,
}

/// Datei zum Hinzufügen mit ihrer erkannten oder vom Nutzer gewählten Art.
#[derive(Deserialize)]
pub struct LocalFile {
    path: String,
    kind: ModKind,
}

/// Im Cache liegende Datei, die unter `file_name` in die Instanz kommt.
struct Staged {
    kind: ModKind,
    file_name: String,
    sha1: String,
}

pub fn check(state: &AppState, instance_id: &str, paths: &[String]) -> AppResult<Vec<FileCheck>> {
    let instance = state.instances.get(instance_id)?;
    paths
        .iter()
        .map(|path| {
            let (source, name) = source(path)?;
            let sha1 = sha1_file(&source)?;
            Ok(FileCheck {
                path: path.clone(),
                kind: detect_kind(&source, &name)?,
                duplicate_of: holder(&instance.mods, &sha1).map(|m| m.name.clone()),
            })
        })
        .collect()
}

/// Legt die Dateien in den Cache, trägt sie ein (von Modrinth erkannt oder lokal) und legt sie im Spielordner ab.
pub async fn add(
    state: &AppState,
    instance_id: &str,
    files: &[LocalFile],
    progress: &(dyn Fn(&str, u64, u64) + Send + Sync),
) -> AppResult<Instance> {
    let mut instance = state.instances.get(instance_id)?;
    let staged = stage(state, &instance, files, progress)?;
    progress("resolve", 0, 1);
    let hashes: Vec<String> = staged.iter().map(|s| s.sha1.clone()).collect();
    let (known, titles) = content::identify_or_local(&modrinth::client()?, &hashes).await;
    for s in staged {
        let m = content::entry(s.kind, s.file_name, s.sha1, &known, &titles, &instance.mods);
        instance.mods.push(m);
    }
    let mods = instance.mods.clone();
    let result = mods::sync_commit(&state.dirs, instance_id, &mods, |_| state.instances.update(instance))?;
    let total = files.len() as u64;
    progress("complete", total, total);
    Ok(result)
}

/// Prüft und cacht jede Datei; dieselbe Datei zweimal im Auftrag zählt einmal, schon vorhandene sind ein Fehler.
fn stage(
    state: &AppState,
    instance: &Instance,
    files: &[LocalFile],
    progress: &(dyn Fn(&str, u64, u64) + Send + Sync),
) -> AppResult<Vec<Staged>> {
    let mut staged: Vec<Staged> = Vec::new();
    for (done, file) in files.iter().enumerate() {
        progress("copy", done as u64, files.len() as u64);
        let (path, name) = source(&file.path)?;
        let stem = stem_for(&name, file.kind)?;
        let sha1 = mods::cache_file(&state.dirs, &path)?;
        if let Some(m) = holder(&instance.mods, &sha1) {
            return Err(invalid(format!("„{name}“ ist schon in dieser Instanz ({})", m.name)));
        }
        if staged.iter().any(|s| s.sha1 == sha1) {
            continue;
        }
        let folder = state.dirs.game_dir(&instance.id).join(file.kind.folder());
        let file_name = free_name(stem, file.kind.extension(), |n| {
            instance.mods.iter().any(|m| m.file_name.eq_ignore_ascii_case(n))
                || staged.iter().any(|s| s.file_name.eq_ignore_ascii_case(n))
                || folder.join(n).exists()
        });
        staged.push(Staged { kind: file.kind, file_name, sha1 });
    }
    Ok(staged)
}

/// Gleicht lokale Einträge per SHA-1 mit Modrinth ab; erkannte werden zu Modrinth-Einträgen.
/// Anders als beim Hinzufügen ist ein Netzfehler hier ein Fehler: der Nutzer hat ausdrücklich gefragt.
pub async fn identify(state: &AppState, instance_id: &str, mod_ids: &[String]) -> AppResult<Instance> {
    let mut instance = state.instances.get(instance_id)?;
    if let Some(unknown) = mod_ids.iter().find(|id| !instance.mods.iter().any(|m| &m.id == *id)) {
        return Err(invalid(format!("Unbekannte Mod {unknown}")));
    }
    let picked = |m: &Mod| m.source == ModSource::Local && mod_ids.contains(&m.id);
    let hashes: Vec<String> = instance.mods.iter().filter(|m| picked(m)).filter_map(|m| m.sha1.clone()).collect();
    let (known, titles) = content::identify(&modrinth::client()?, &hashes).await?;
    for i in 0..instance.mods.len() {
        if !picked(&instance.mods[i]) {
            continue;
        }
        if let Some(m) = recognized(&instance.mods[i], &known, &titles, &instance.mods) {
            instance.mods[i] = m;
        }
    }
    state.instances.update(instance)
}

/// Von Modrinth erkannter Eintrag anstelle von `m`; Schalter und Abhängigkeiten bleiben.
fn recognized(
    m: &Mod,
    known: &HashMap<String, Version>,
    titles: &HashMap<String, String>,
    mods: &[Mod],
) -> Option<Mod> {
    let found = content::entry(m.kind, m.file_name.clone(), m.sha1.clone()?, known, titles, mods);
    (found.source != ModSource::Local).then(|| Mod { enabled: m.enabled, required_by: m.required_by.clone(), ..found })
}

/// Absoluter Pfad einer normalen .jar- oder .zip-Datei mit brauchbarem Namen und sinnvoller Größe.
fn source(path: &str) -> AppResult<(PathBuf, String)> {
    let path = PathBuf::from(path);
    let name = path
        .file_name()
        .and_then(|n| n.to_str())
        .filter(|_| path.is_absolute())
        .ok_or_else(|| invalid("Absoluter Dateipfad erforderlich"))?
        .to_string();
    let lower = name.to_ascii_lowercase();
    if !lower.ends_with(".jar") && !lower.ends_with(".zip") {
        return Err(invalid(format!("„{name}“ ist keine .jar- oder .zip-Datei")));
    }
    content::safe_path(&name)?;
    let meta = fs::symlink_metadata(&path)?;
    if !meta.is_file() {
        return Err(invalid(format!("„{name}“ ist keine normale Datei")));
    }
    if meta.len() == 0 || meta.len() > modrinth::FILE_LIMIT {
        return Err(invalid(format!("„{name}“ ist leer oder größer als 256 MiB")));
    }
    Ok((path, name))
}

/// `.jar` ist eine Mod; bei `.zip` entscheidet der Inhalt.
fn detect_kind(path: &Path, name: &str) -> AppResult<Option<ModKind>> {
    if name.to_ascii_lowercase().ends_with(".jar") {
        return Ok(Some(ModKind::Mod));
    }
    let zip = zip::ZipArchive::new(fs::File::open(path)?)
        .map_err(|_| invalid(format!("„{name}“ ist kein lesbares Zip-Archiv")))?;
    Ok(zip_kind(zip.file_names()))
}

/// Ressourcenpakete haben `pack.mcmeta` im Wurzelverzeichnis, Shaderpacks einen Ordner `shaders/`.
/// Beides oder keins: unklar.
fn zip_kind<'a>(names: impl Iterator<Item = &'a str>) -> Option<ModKind> {
    let (mut pack, mut shaders) = (false, false);
    for name in names {
        pack |= name == "pack.mcmeta";
        shaders |= name.starts_with("shaders/");
    }
    match (pack, shaders) {
        (true, false) => Some(ModKind::ResourcePack),
        (false, true) => Some(ModKind::Shader),
        _ => None,
    }
}

/// Eintrag der Instanz mit genau dieser Datei.
fn holder<'a>(mods: &'a [Mod], sha1: &str) -> Option<&'a Mod> {
    mods.iter().find(|m| m.sha1.as_deref().is_some_and(|s| s.eq_ignore_ascii_case(sha1)))
}

/// Dateiname ohne Endung; die Endung muss zur Art passen (eine .zip ist nie eine Mod).
fn stem_for(name: &str, kind: ModKind) -> AppResult<&str> {
    let ext = kind.extension();
    if !name.to_ascii_lowercase().ends_with(ext) {
        return Err(invalid(format!("„{name}“ passt nicht zur gewählten Art")));
    }
    Ok(&name[..name.len() - ext.len()])
}

/// Erster freier Name aus `stem.jar`, `stem (2).jar`, `stem (3).jar` …; die Endung immer klein,
/// weil `mods::sync` sie so erwartet.
fn free_name(stem: &str, ext: &str, taken: impl Fn(&str) -> bool) -> String {
    let mut name = format!("{stem}{ext}");
    let mut n = 1;
    while taken(&name) {
        n += 1;
        name = format!("{stem} ({n}){ext}");
    }
    name
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::{ModLoader, NewInstance};
    use std::io::Write;

    fn zip_with(names: &[&str]) -> Vec<u8> {
        let mut w = zip::ZipWriter::new(std::io::Cursor::new(Vec::new()));
        for name in names {
            w.start_file(*name, zip::write::SimpleFileOptions::default()).unwrap();
            w.write_all(b"x").unwrap();
        }
        w.finish().unwrap().into_inner()
    }

    fn local(path: &Path, kind: ModKind) -> LocalFile {
        LocalFile { path: path.to_string_lossy().into_owned(), kind }
    }

    #[test]
    fn zip_kind_follows_pack_layout() {
        assert_eq!(zip_kind(["pack.mcmeta", "assets/x.png"].into_iter()), Some(ModKind::ResourcePack));
        assert_eq!(zip_kind(["shaders/", "shaders/gbuffers.fsh"].into_iter()), Some(ModKind::Shader));
        // Verschachtelt zählt nicht; beides oder keins ist unklar.
        assert_eq!(zip_kind(["inner/pack.mcmeta"].into_iter()), None);
        assert_eq!(zip_kind(["pack.mcmeta", "shaders/a.fsh"].into_iter()), None);
    }

    #[test]
    fn free_name_counts_up_and_lowers_extension() {
        assert_eq!(free_name("Sodium", ".jar", |_| false), "Sodium.jar");
        let taken = ["sodium.jar", "sodium (2).jar"];
        assert_eq!(free_name("Sodium", ".jar", |n| taken.iter().any(|t| t.eq_ignore_ascii_case(n))), "Sodium (3).jar");
        assert_eq!(stem_for("Sodium.JAR", ModKind::Mod).unwrap(), "Sodium");
        assert!(stem_for("pack.zip", ModKind::Mod).is_err());
    }

    #[test]
    fn source_accepts_only_plain_content_files() {
        let dir = std::env::temp_dir().join(crate::models::new_id());
        fs::create_dir_all(dir.join("folder.jar")).unwrap();
        for (name, data) in [("ok.jar", &b"x"[..]), ("empty.jar", b""), ("notes.txt", b"x")] {
            fs::write(dir.join(name), data).unwrap();
        }
        assert!(source(&dir.join("ok.jar").to_string_lossy()).is_ok());
        for bad in ["empty.jar", "notes.txt", "folder.jar", "missing.jar"] {
            assert!(source(&dir.join(bad).to_string_lossy()).is_err(), "{bad}");
        }
        assert!(source("relative.jar").is_err());
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn recognized_keeps_switch_and_skips_unknown() {
        let sha1 = "a".repeat(40);
        let known: HashMap<String, Version> = serde_json::from_value(serde_json::json!({
            sha1.clone(): {"id": "v1", "project_id": "sodium", "name": "n", "version_number": "1.0",
                "game_versions": ["1.21.1"], "loaders": ["fabric"], "files": [], "dependencies": []}
        }))
        .unwrap();
        let titles = HashMap::from([("sodium".to_string(), "Sodium".to_string())]);
        let off = Mod { enabled: false, ..content::entry(ModKind::Mod, "s.jar".into(), sha1, &Default::default(), &titles, &[]) };
        let m = recognized(&off, &known, &titles, &[]).unwrap();
        assert_eq!((m.id.as_str(), m.name.as_str(), m.enabled), ("sodium", "Sodium", false));
        assert_eq!(m.source, ModSource::Modrinth { project_id: "sodium".into(), version_id: "v1".into() });
        let other = Mod { sha1: Some("b".repeat(40)), ..off };
        assert!(recognized(&other, &known, &titles, &[]).is_none());
    }

    #[tokio::test]
    async fn adds_files_with_free_names_and_rejects_duplicates() {
        let root = std::env::temp_dir().join(crate::models::new_id());
        let state = AppState::load(&root).unwrap();
        let i = state
            .instances
            .insert(Instance::from_new(NewInstance {
                name: "Eigen".into(),
                minecraft_version: "1.21.1".into(),
                loader: ModLoader::Fabric,
                loader_version: None,
            }))
            .unwrap();
        let drop = root.join("drop");
        fs::create_dir_all(&drop).unwrap();
        fs::write(drop.join("Tool.JAR"), "tool").unwrap();
        fs::write(drop.join("look.zip"), zip_with(&["pack.mcmeta"])).unwrap();
        // Eine fremde Datei gleichen Namens liegt schon im Mods-Ordner.
        fs::create_dir_all(state.dirs.mods_dir(&i.id)).unwrap();
        fs::write(state.dirs.mods_dir(&i.id).join("tool.jar"), "fremd").unwrap();

        let paths = [drop.join("Tool.JAR"), drop.join("look.zip")].map(|p| p.to_string_lossy().into_owned());
        let kinds: Vec<_> = check(&state, &i.id, &paths).unwrap().into_iter().map(|c| c.kind).collect();
        assert_eq!(kinds, [Some(ModKind::Mod), Some(ModKind::ResourcePack)]);

        let files = [local(&drop.join("Tool.JAR"), ModKind::Mod), local(&drop.join("look.zip"), ModKind::ResourcePack)];
        let added = add(&state, &i.id, &files, &|_, _, _| {}).await.unwrap();
        let got: Vec<_> = added.mods.iter().map(|m| (m.kind, m.file_name.as_str(), m.name.as_str())).collect();
        assert_eq!(got, [(ModKind::Mod, "Tool (2).jar", "Tool (2)"), (ModKind::ResourcePack, "look.zip", "look")]);
        assert!(added.mods.iter().all(|m| m.source == ModSource::Local));
        assert_eq!(fs::read(state.dirs.mods_dir(&i.id).join("Tool (2).jar")).unwrap(), b"tool");
        assert_eq!(fs::read(state.dirs.mods_dir(&i.id).join("tool.jar")).unwrap(), b"fremd");

        // Dieselbe Datei noch einmal: Vorab-Prüfung nennt den Eintrag, Hinzufügen lehnt ab.
        assert_eq!(check(&state, &i.id, &paths[..1]).unwrap()[0].duplicate_of.as_deref(), Some("Tool (2)"));
        assert!(add(&state, &i.id, &files[..1], &|_, _, _| {}).await.is_err());
        assert_eq!(state.instances.get(&i.id).unwrap().mods.len(), 2);
        fs::remove_dir_all(root).unwrap();
    }
}
