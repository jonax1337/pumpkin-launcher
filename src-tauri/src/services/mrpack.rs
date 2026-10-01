//! `.mrpack` einer Instanz (Modrinth-Format): Modrinth-Inhalte stehen als Download im Index, alles andere
//! liegt unter `overrides/`. Vorlagen und „Exportieren…“ schreiben darüber; der Pack-Import liest es wieder.
use std::{
    fs,
    io::{self, Write},
    path::{Path, PathBuf},
};

use serde_json::{json, Value};

use super::{
    content,
    download::RemoveOnDrop,
    modrinth::{self, invalid},
    mods, Dirs,
};
use crate::{
    error::AppResult,
    models::{Instance, Mod, ModLoader, ModSource},
    state::AppState,
};

/// Unter der ZIP-Grenze des Imports (4096), damit jedes Pack wieder importierbar ist.
const MAX_ENTRIES: usize = 4000;

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
pub async fn export(state: &AppState, instance_id: &str, include: Vec<String>, path: &Path) -> AppResult<()> {
    if !path.is_absolute() || path.extension().and_then(|e| e.to_str()) != Some("mrpack") {
        return Err(invalid("Absoluter .mrpack-Pfad erforderlich"));
    }
    let instance = state.instances.get(instance_id)?;
    let available = entries(&state.dirs, &instance)?;
    if let Some(unknown) = include.iter().find(|n| !available.contains(n)) {
        return Err(invalid(format!("„{unknown}“ gibt es im Spielordner nicht")));
    }
    write(&state.dirs, instance, include, path).await
}

/// Schreibt das Pack mit den Einträgen `include` des Spielordners nach `path`.
/// Deaktivierte Inhalte bleiben draußen: der Import kennt kein „deaktiviert“.
pub async fn write(dirs: &Dirs, instance: Instance, include: Vec<String>, path: &Path) -> AppResult<()> {
    let remote = remote_files(&modrinth::client()?, &instance, &include).await?;
    let (dirs, path) = (dirs.clone(), path.to_owned());
    tokio::task::spawn_blocking(move || {
        let files = overrides(&dirs, &instance, &include, &remote)?;
        write_zip(&path, &index(&instance, &remote)?, &pumpkin_meta(&instance), files)
    })
    .await
    .map_err(|e| invalid(format!("Pack schreiben abgebrochen: {e}")))?
}

/// Aktive Inhalte samt SHA-1 (Schlüssel im Mod-Cache).
fn active_content(instance: &Instance) -> impl Iterator<Item = (&Mod, &str)> {
    instance.mods.iter().filter(|m| m.enabled).filter_map(|m| Some((m, m.sha1.as_deref()?)))
}

fn included(include: &[String], m: &Mod) -> bool {
    include.iter().any(|name| name == m.kind.folder())
}

/// Index-Einträge für Modrinth-Inhalte, deren installierte Datei (sha1) Modrinth kennt; eine Sammelabfrage.
/// Alles ohne Treffer landet als Override aus dem Cache im Pack.
async fn remote_files(client: &reqwest::Client, instance: &Instance, include: &[String]) -> AppResult<Vec<Value>> {
    let candidates: Vec<(&Mod, &str)> = active_content(instance)
        .filter(|(m, _)| included(include, m) && matches!(m.source, ModSource::Modrinth { .. }))
        .collect();
    let hashes: Vec<String> = candidates.iter().map(|(_, sha1)| sha1.to_string()).collect();
    let known = modrinth::versions_by_hash(client, &hashes).await?;
    Ok(candidates
        .into_iter()
        .filter_map(|(m, sha1)| {
            let file = known.get(&sha1.to_ascii_lowercase())?.files.iter().find(|f| {
                f.hashes.get("sha1").is_some_and(|h| h.eq_ignore_ascii_case(sha1))
                    && f.hashes.contains_key("sha512")
                    && modrinth::download_url(&f.url).is_ok()
            })?;
            Some(json!({
                "path": mods::game_path(m),
                "hashes": { "sha1": file.hashes["sha1"], "sha512": file.hashes["sha512"] },
                "downloads": [file.url],
                "fileSize": file.size,
            }))
        })
        .collect())
}

fn index(instance: &Instance, remote: &[Value]) -> AppResult<Value> {
    let mut dependencies = json!({ "minecraft": instance.minecraft_version });
    match (instance.loader, &instance.loader_version) {
        (ModLoader::Vanilla, _) => {}
        (loader, Some(v)) => {
            let key = loader.pack_key().ok_or_else(|| invalid("Loader ohne Pack-Schlüssel"))?;
            dependencies[key] = json!(v);
        }
        (_, None) => return Err(invalid("Instanz ohne Loader-Version: bitte erst einmal starten")),
    }
    Ok(json!({
        "formatVersion": 1, "game": "minecraft", "versionId": "1", "name": instance.name,
        "files": remote, "dependencies": dependencies,
    }))
}

/// „Benötigt von“ kennt das mrpack-Format nicht: eigene Datei, die der Import auswertet.
fn pumpkin_meta(instance: &Instance) -> Value {
    let required_by: serde_json::Map<String, Value> = active_content(instance)
        .filter(|(m, _)| !m.required_by.is_empty())
        .map(|(m, _)| (m.file_name.clone(), json!(m.required_by)))
        .collect();
    json!({ "requiredBy": required_by })
}

/// Dateien für `overrides/`: gewählte aktive Inhalte ohne Index-Eintrag aus dem Cache, dazu die gewählten
/// Einträge des Spielordners ohne die Dateien verwalteter Inhalte (die kommen aus Index bzw. Cache).
fn overrides(dirs: &Dirs, instance: &Instance, include: &[String], remote: &[Value]) -> AppResult<Vec<(String, PathBuf)>> {
    let covered: Vec<&str> = remote.iter().filter_map(|f| f["path"].as_str()).collect();
    mods::recache(dirs, &instance.id, &instance.mods)?;
    let mut files = Vec::new();
    for (m, sha1) in active_content(instance).filter(|(m, _)| included(include, m)) {
        let path = mods::game_path(m);
        if !covered.contains(&path.as_str()) {
            files.push((path, mods::cached(dirs, sha1)?));
        }
    }
    files.extend(mods::unmanaged_files(dirs, &instance.id, include, &instance.mods)?);
    Ok(files)
}

/// Schreibt das Archiv über `<path>.part`; bei einem Fehler bleibt am Ziel nichts Halbes liegen.
fn write_zip(path: &Path, index: &Value, meta: &Value, files: Vec<(String, PathBuf)>) -> AppResult<()> {
    if files.len() > MAX_ENTRIES {
        return Err(invalid(format!("Zu viele Dateien für ein Pack (höchstens {MAX_ENTRIES})")));
    }
    let tmp = path.with_extension("mrpack.part");
    let mut guard = RemoveOnDrop(Some(tmp.clone()));
    let mut zip = zip::ZipWriter::new(fs::File::create(&tmp)?);
    let options = zip::write::SimpleFileOptions::default();
    zip.start_file("modrinth.index.json", options)?;
    zip.write_all(&serde_json::to_vec_pretty(index)?)?;
    zip.start_file(content::PUMPKIN_FILE, options)?;
    zip.write_all(&serde_json::to_vec_pretty(meta)?)?;
    let mut total = 0u64;
    for (name, source) in files {
        // Gleiche Prüfung wie der Import, der den ganzen Eintragsnamen samt `overrides/` sieht.
        let entry = format!("overrides/{name}");
        content::safe_path(&entry)?;
        let mut file = fs::File::open(&source).map_err(|e| invalid(format!("{name} nicht lesbar: {e}")))?;
        // Der Import nimmt höchstens FILE_LIMIT pro Pack; unkomprimiert gezählt ist das die sichere Seite.
        total += file.metadata()?.len();
        if total > modrinth::FILE_LIMIT {
            return Err(invalid("Das Pack wäre größer als 256 MiB und ließe sich nicht wieder importieren"));
        }
        zip.start_file(entry, options)?;
        io::copy(&mut file, &mut zip)?;
    }
    // Erst schließen, dann umbenennen: Windows verschiebt keine offene Datei.
    drop(zip.finish()?);
    fs::rename(&tmp, path)?;
    guard.0 = None;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::{new_id, ModKind, NewInstance};

    #[tokio::test]
    async fn export_roundtrips_through_import() {
        let root = std::env::temp_dir().join(new_id());
        let state = AppState::load(&root).unwrap();
        let own = Mod {
            id: "own".into(),
            name: "own".into(),
            version: "1".into(),
            source: ModSource::Local,
            file_name: "own.jar".into(),
            sha1: Some(mods::cache_bytes(&state.dirs, b"own").unwrap()),
            enabled: true,
            kind: ModKind::Mod,
            required_by: Vec::new(),
        };
        let mut source = Instance::from_new(NewInstance {
            name: "Quelle".into(),
            minecraft_version: "1.21.1".into(),
            loader: ModLoader::Fabric,
            loader_version: Some("0.16.10".into()),
        });
        source.mods = vec![own];
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

        assert!(export(&state, &source.id, include(&["logs"]), &target).await.is_err());
        assert!(export(&state, &source.id, include(&["mods"]), Path::new("Export.mrpack")).await.is_err());
        export(&state, &source.id, include(&["mods", "saves"]), &target).await.unwrap();
        assert!(!target.with_extension("mrpack.part").exists());

        let data = content::local_pack(&target).unwrap();
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
        fs::remove_dir_all(root).unwrap();
    }
}
