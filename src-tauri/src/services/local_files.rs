//! Eigene Dateien des Nutzers (Ziehen und Ablegen, Dateiauswahl) als Inhalte einer Instanz. Was Modrinth
//! per SHA-1 kennt, wird als Modrinth-Inhalt eingetragen, damit Updates greifen; der Rest bleibt lokal.
use std::{
    fs,
    path::{Path, PathBuf},
};

use serde::{Deserialize, Serialize};

use super::progress::{Phase, ProgressFn, SharedProgress};
use super::{
    blocking,
    content::{self, CachedFile, ContentFile, Recognition},
    download::sha1_file,
    free_name,
    limits::{FILE_LIMIT, MIB},
    mods, Dirs,
};
use crate::{
    coded,
    error::{AppError, AppResult},
    models::{Instance, Mod, ModKind, ModSource},
    state::AppState,
};

/// Vorab-Prüfung einer Datei: Art (`None` = Zip ohne eindeutiges Merkmal, die Oberfläche fragt nach),
/// der Name des Eintrags, falls die Instanz dieselbe Datei schon hat, oder warum die Datei nicht passt.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileCheck {
    path: String,
    kind: Option<ModKind>,
    duplicate_of: Option<String>,
    error: Option<String>,
}

/// Datei zum Hinzufügen mit ihrer erkannten oder vom Nutzer gewählten Art.
#[derive(Deserialize)]
pub struct LocalFile {
    path: String,
    kind: ModKind,
}

/// Prüft jede Datei für sich, damit eine unpassende die übrigen nicht aufhält.
pub async fn check(state: &AppState, instance_id: &str, paths: Vec<String>) -> AppResult<Vec<FileCheck>> {
    let mods = state.instances.get(instance_id)?.mods;
    blocking(move |_| Ok(paths.into_iter().map(|path| check_file(path, &mods)).collect())).await
}

fn check_file(path: String, mods: &[Mod]) -> FileCheck {
    let found = source(&path).and_then(|(file, name)| Ok((detect_kind(&file, &name)?, sha1_file(&file)?)));
    match found {
        Ok((kind, sha1)) => FileCheck { path, kind, duplicate_of: holder(mods, &sha1).map(|m| m.name.clone()), error: None },
        Err(e) => FileCheck { path, kind: None, duplicate_of: None, error: Some(e.to_string()) },
    }
}

/// Legt die Dateien in den Cache, trägt sie ein (von Modrinth erkannt oder lokal) und legt sie im Spielordner ab.
pub async fn add(
    state: &AppState,
    instance_id: &str,
    files: Vec<LocalFile>,
    progress: SharedProgress,
) -> AppResult<Instance> {
    let instance = state.instances.get(instance_id)?;
    let total = files.len() as u64;
    let staged = {
        let (dirs, instance, progress) = (state.dirs.clone(), instance.clone(), progress.clone());
        blocking(move |_| stage(&dirs, &instance, &files, &*progress)).await?
    };
    progress(Phase::Resolve, 0, 1);
    let hashes: Vec<String> = staged.iter().map(|s| s.sha1.clone()).collect();
    let recognition = content::identify_or_local(&content::catalog()?, &hashes).await;
    let mods = with_entries(&instance.mods, staged, &recognition)?;
    let result = mods::sync_commit(&state.dirs, instance_id, &mods, |_| content::commit_mods(state, instance_id, mods.clone()))?;
    progress(Phase::Complete, total, total);
    Ok(result)
}

/// Prüft und cacht jede Datei; dieselbe Datei zweimal im Auftrag zählt einmal, schon vorhandene sind ein Fehler.
fn stage(
    dirs: &Dirs,
    instance: &Instance,
    files: &[LocalFile],
    progress: ProgressFn<'_>,
) -> AppResult<Vec<CachedFile>> {
    let mut staged: Vec<CachedFile> = Vec::new();
    for (done, file) in files.iter().enumerate() {
        progress(Phase::Copy, done as u64, files.len() as u64);
        let (path, name) = source(&file.path)?;
        let stem = stem_for(&name, file.kind)?;
        let sha1 = mods::cache_file(dirs, &path)?;
        if let Some(m) = holder(&instance.mods, &sha1) {
            return Err(AppError::invalid(coded!("errors.packs.local.alreadyInInstance", name = name, holder = m.name)));
        }
        if staged.iter().any(|s| s.sha1 == sha1) {
            continue;
        }
        let folder = dirs.game_dir(&instance.id).join(file.kind.folder());
        // Die Endung immer klein, weil `mods::sync` sie so erwartet.
        let file_name = free_name(stem, file.kind.extension(), |n| {
            instance.mods.iter().any(|m| m.file_name.eq_ignore_ascii_case(n))
                || staged.iter().any(|s| s.file.file_name.eq_ignore_ascii_case(n))
                || foreign(&folder.join(n), &sha1)
        });
        staged.push(CachedFile { file: ContentFile { kind: file.kind, file_name, enabled: true }, sha1 });
    }
    Ok(staged)
}

/// Liegt unter `path` eine andere Datei? Dieselbe, nur nicht erfasste Datei wird einfach übernommen,
/// statt ein zweites Mal daneben zu landen.
fn foreign(path: &Path, sha1: &str) -> bool {
    path.exists() && !sha1_file(path).is_ok_and(|s| s.eq_ignore_ascii_case(sha1))
}

/// `mods` plus je ein Eintrag pro Datei, von Modrinth erkannt oder lokal.
fn with_entries(
    mods: &[Mod],
    staged: Vec<CachedFile>,
    recognition: &Recognition,
) -> AppResult<Vec<Mod>> {
    let mut all = mods.to_vec();
    for file in staged {
        let m = recognition.mod_from_file(&file, &all);
        ensure_new_project(&all, &m)?;
        all.push(m);
    }
    Ok(all)
}

/// Ein Projekt nur einmal pro Instanz: sonst lägen zwei Versionen derselben Mod im Spielordner.
fn ensure_new_project(mods: &[Mod], m: &Mod) -> AppResult<()> {
    let Some(project) = content::project_of(m) else { return Ok(()) };
    match mods.iter().find(|o| content::project_of(o) == Some(project)) {
        Some(have) => Err(AppError::invalid(coded!("errors.packs.local.sameProject", file = m.file_name, project = have.name))),
        None => Ok(()),
    }
}

/// Gleicht lokale Einträge per SHA-1 mit Modrinth ab; erkannte werden zu Modrinth-Einträgen.
/// Anders als beim Hinzufügen ist ein Netzfehler hier ein Fehler: der Nutzer hat ausdrücklich gefragt.
pub async fn identify_local(state: &AppState, instance_id: &str, mod_ids: &[String]) -> AppResult<Instance> {
    let mut instance = state.instances.get(instance_id)?;
    content::ensure_known(&instance, mod_ids)?;
    let picked = |m: &Mod| m.source == ModSource::Local && mod_ids.contains(&m.id);
    let hashes: Vec<String> = instance.mods.iter().filter(|m| picked(m)).filter_map(|m| m.sha1.clone()).collect();
    let recognition = content::identify(&content::catalog()?, &hashes).await?;
    for i in 0..instance.mods.len() {
        if !picked(&instance.mods[i]) {
            continue;
        }
        if let Some(m) = recognized(&instance.mods[i], &recognition, &instance.mods) {
            ensure_new_project(&instance.mods, &m)?;
            instance.mods[i] = m;
        }
    }
    content::commit_mods(state, instance_id, instance.mods)
}

/// Von Modrinth erkannter Eintrag anstelle von `m`; Schalter, Abhängigkeiten, Festhalten und Herkunft vom Pack bleiben.
fn recognized(m: &Mod, recognition: &Recognition, mods: &[Mod]) -> Option<Mod> {
    let file = ContentFile { kind: m.kind, file_name: m.file_name.clone(), enabled: m.enabled };
    let found = recognition.mod_from_file(&CachedFile { file, sha1: m.sha1.clone()? }, mods);
    (found.source != ModSource::Local)
        .then(|| Mod { required_by: m.required_by.clone(), pinned: m.pinned, pack_managed: m.pack_managed, ..found })
}

/// Absoluter Pfad einer normalen .jar- oder .zip-Datei mit brauchbarem Namen und sinnvoller Größe.
pub(crate) fn source(path: &str) -> AppResult<(PathBuf, String)> {
    let path = PathBuf::from(path);
    let name = path
        .file_name()
        .and_then(|n| n.to_str())
        .filter(|_| path.is_absolute())
        .ok_or_else(|| AppError::invalid(coded!("errors.packs.fullPathRequired")))?
        .to_string();
    let lower = name.to_ascii_lowercase();
    if !lower.ends_with(".jar") && !lower.ends_with(".zip") {
        return Err(AppError::invalid(coded!("errors.packs.local.notJarOrZip", name = name)));
    }
    content::safe_path(&name)?;
    let meta = fs::symlink_metadata(&path).map_err(|_| AppError::invalid(coded!("errors.packs.unreadableFile", name = name)))?;
    if !meta.is_file() {
        return Err(AppError::invalid(coded!("errors.packs.notNormalFile", name = name)));
    }
    if meta.len() == 0 || meta.len() > FILE_LIMIT {
        return Err(AppError::invalid(coded!("errors.packs.local.emptyOrTooLarge", name = name, mib = FILE_LIMIT / MIB)));
    }
    Ok((path, name))
}

/// `.jar` ist eine Mod; bei `.zip` entscheidet der Inhalt.
fn detect_kind(path: &Path, name: &str) -> AppResult<Option<ModKind>> {
    if name.to_ascii_lowercase().ends_with(".jar") {
        return Ok(Some(ModKind::Mod));
    }
    let zip = zip::ZipArchive::new(fs::File::open(path)?)
        .map_err(|_| AppError::invalid(coded!("errors.packs.unreadableZip", name = name)))?;
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
        return Err(AppError::invalid(coded!("errors.packs.local.wrongKind", name = name)));
    }
    Ok(&name[..name.len() - ext.len()])
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::{ModLoader, NewInstance};
    use crate::services::modrinth::Version;
    use std::collections::HashMap;
    use crate::services::progress::ignored;
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

    /// Modrinth-Antwort, in der jede der Dateien eine Version von Sodium ist.
    fn sodium(sha1s: &[&str]) -> HashMap<String, Version> {
        let versions = sha1s.iter().map(|sha1| {
            let v = serde_json::json!({"id": format!("v-{sha1}"), "project_id": "sodium", "name": "n", "version_number": "1.0",
                "game_versions": ["1.21.1"], "loaders": ["fabric"], "files": [], "dependencies": []});
            (sha1.to_string(), serde_json::from_value(v).unwrap())
        });
        versions.collect()
    }

    fn staged(sha1: &str) -> CachedFile {
        CachedFile { file: ContentFile { kind: ModKind::Mod, file_name: format!("{sha1}.jar"), enabled: true }, sha1: sha1.into() }
    }

    #[test]
    fn recognized_keeps_switch_and_skips_unknown() {
        let titles = HashMap::from([("sodium".to_string(), "Sodium".to_string())]);
        let recognition = Recognition { versions: sodium(&["a"]), titles };
        let off = Mod { enabled: false, ..Recognition::default().mod_from_file(&staged("a"), &[]) };
        let m = recognized(&off, &recognition, &[]).unwrap();
        assert_eq!((m.id.as_str(), m.name.as_str(), m.enabled), ("sodium", "Sodium", false));
        assert_eq!(m.source, ModSource::Modrinth { project_id: "sodium".into(), version_id: "v-a".into() });
        let other = Mod { sha1: Some("b".into()), ..off };
        assert!(recognized(&other, &recognition, &[]).is_none());
    }

    #[test]
    fn with_entries_allows_each_project_once() {
        let recognition = Recognition { versions: sodium(&["a", "b"]), titles: HashMap::new() };
        let have = with_entries(&[], vec![staged("a"), staged("local")], &recognition).unwrap();
        assert_eq!(have[0].id, "sodium");
        // Eine andere Sodium-Version, ob schon in der Instanz oder im selben Auftrag, käme doppelt in den Spielordner.
        assert!(with_entries(&have, vec![staged("b")], &recognition).is_err());
        assert!(with_entries(&[], vec![staged("a"), staged("b")], &recognition).is_err());
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
        fs::write(drop.join("Same.jar"), "same").unwrap();
        fs::write(drop.join("broken.zip"), "kein zip").unwrap();
        // Im Mods-Ordner liegen schon eine fremde Datei gleichen Namens und dieselbe Datei, nur nicht erfasst.
        // Die fremde Datei trägt die Endung schon klein: auf Linux sind `tool.jar` und `Tool.jar` zwei Dateien.
        let mods_dir = state.dirs.mods_dir(&i.id);
        fs::create_dir_all(&mods_dir).unwrap();
        fs::write(mods_dir.join("Tool.jar"), "fremd").unwrap();
        fs::write(mods_dir.join("Same.jar"), "same").unwrap();

        let paths: Vec<String> =
            ["Tool.JAR", "look.zip", "Same.jar", "broken.zip"].iter().map(|n| drop.join(n).to_string_lossy().into_owned()).collect();
        let checks = check(&state, &i.id, paths.clone()).await.unwrap();
        let kinds: Vec<_> = checks.iter().map(|c| (c.kind, c.error.is_some())).collect();
        assert_eq!(kinds, [(Some(ModKind::Mod), false), (Some(ModKind::ResourcePack), false), (Some(ModKind::Mod), false), (None, true)]);

        let files = vec![
            local(&drop.join("Tool.JAR"), ModKind::Mod),
            local(&drop.join("look.zip"), ModKind::ResourcePack),
            local(&drop.join("Same.jar"), ModKind::Mod),
        ];
        let added = add(&state, &i.id, files, ignored()).await.unwrap();
        let got: Vec<_> = added.mods.iter().map(|m| (m.kind, m.file_name.as_str(), m.name.as_str())).collect();
        assert_eq!(
            got,
            [(ModKind::Mod, "Tool (2).jar", "Tool (2)"), (ModKind::ResourcePack, "look.zip", "look"), (ModKind::Mod, "Same.jar", "Same")]
        );
        assert!(added.mods.iter().all(|m| m.source == ModSource::Local));
        assert_eq!(fs::read(mods_dir.join("Tool (2).jar")).unwrap(), b"tool");
        assert_eq!(fs::read(mods_dir.join("Tool.jar")).unwrap(), b"fremd");
        assert!(!mods_dir.join("Same (2).jar").exists());

        // Dieselbe Datei noch einmal: Vorab-Prüfung nennt den Eintrag, Hinzufügen lehnt ab.
        assert_eq!(check(&state, &i.id, paths[..1].to_vec()).await.unwrap()[0].duplicate_of.as_deref(), Some("Tool (2)"));
        assert!(add(&state, &i.id, vec![local(&drop.join("Tool.JAR"), ModKind::Mod)], ignored()).await.is_err());
        assert_eq!(state.instances.get(&i.id).unwrap().mods.len(), 3);
        fs::remove_dir_all(root).unwrap();
    }
}
