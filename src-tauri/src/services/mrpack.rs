//! `.mrpack` einer Instanz (Modrinth-Format): Modrinth-Inhalte stehen als Download im Index, alles andere
//! liegt unter `overrides/`. Vorlagen und „Exportieren…“ schreiben darüber; der Pack-Import liest es wieder.
use std::{
    fs,
    io::Write,
    path::{Path, PathBuf},
};

use serde_json::{json, Value};
use tokio_util::sync::CancellationToken;

use super::{
    add_zip_file, blocking, check_cancelled, content, modrinth, mods, write_zip_atomic, Dirs,
};
use crate::{
    error::{AppError, AppResult},
    models::{Instance, Mod, ModLoader, ModSource},
    state::AppState,
};

/// Unter der ZIP-Grenze des Imports (4096).
const MAX_ENTRIES: usize = 4000;

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
        if files.len() > MAX_ENTRIES {
            return Err(AppError::invalid(format!("Zu viele Dateien für ein Pack (höchstens {MAX_ENTRIES})")));
        }
        let mut total = 0;
        for (name, source) in files {
            total += fs::metadata(source).map_err(|e| AppError::invalid(format!("{name} nicht lesbar: {e}")))?.len();
            if total > modrinth::FILE_LIMIT {
                return Err(AppError::invalid("Das Pack wäre größer als 256 MiB und ließe sich nicht wieder importieren"));
            }
        }
        Ok(())
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
pub async fn export(state: &AppState, instance_id: &str, include: Vec<String>, path: &Path) -> AppResult<()> {
    if !path.is_absolute() || path.extension().and_then(|e| e.to_str()) != Some("mrpack") {
        return Err(AppError::invalid("Bitte einen Speicherort für die .mrpack-Datei wählen"));
    }
    let instance = state.instances.get(instance_id)?;
    let available = entries(&state.dirs, &instance)?;
    if let Some(unknown) = include.iter().find(|n| !available.contains(n)) {
        return Err(AppError::invalid(format!("„{unknown}“ gibt es im Spielordner nicht")));
    }
    write(&state.dirs, instance, include, path, PackLimit::Unlimited).await
}

/// Schreibt das Pack mit den Einträgen `include` des Spielordners nach `path`.
/// Deaktivierte Inhalte bleiben draußen: der Import kennt kein „deaktiviert“.
pub async fn write(dirs: &Dirs, instance: Instance, include: Vec<String>, path: &Path, limit: PackLimit) -> AppResult<()> {
    let remote = remote_files(&modrinth::client()?, &instance, &include).await?;
    let (dirs, path) = (dirs.clone(), path.to_owned());
    blocking(move |stop| {
        let files = overrides(&dirs, &instance, &include, &remote)?;
        limit.check(&files)?;
        write_zip(&path, &index(&instance, &remote)?, &pumpkin_meta(&instance), files, stop)
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

/// Index-Einträge für Modrinth-Inhalte, deren installierte Datei (sha1) Modrinth kennt; eine Sammelabfrage.
/// Alles ohne Treffer landet als Override aus dem Cache im Pack, auch ohne Netz: die Dateien liegen ja schon da.
async fn remote_files(client: &reqwest::Client, instance: &Instance, include: &[String]) -> AppResult<Vec<Value>> {
    let candidates: Vec<(&Mod, &str)> = active_content(instance)
        .filter(|(m, _)| included(include, m) && matches!(m.source, ModSource::Modrinth { .. }))
        .collect();
    let hashes: Vec<String> = candidates.iter().map(|(_, sha1)| sha1.to_string()).collect();
    let known = modrinth::versions_by_hash(client, &hashes).await.unwrap_or_else(|err| {
        tracing::warn!(%err, "Modrinth nicht erreichbar; die Inhalte kommen als Overrides ins Pack");
        Default::default()
    });
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
            let key = loader.pack_key().ok_or_else(|| AppError::invalid("Loader ohne Pack-Schlüssel"))?;
            dependencies[key] = json!(v);
        }
        (_, None) => return Err(AppError::invalid("Instanz ohne Loader-Version: bitte erst einmal starten")),
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
            let mut file = fs::File::open(&source).map_err(|e| AppError::invalid(format!("{name} nicht lesbar: {e}")))?;
            add_zip_file(zip, &entry, &mut file)?;
        }
        // Ein Abbruch während der letzten Datei darf kein fertiges Pack am Ziel hinterlassen.
        check_cancelled(stop)
    })
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

    #[tokio::test]
    async fn without_network_modrinth_content_goes_into_the_pack_as_overrides() {
        let modrinth = Mod {
            id: "sodium".into(),
            name: "Sodium".into(),
            version: "1".into(),
            source: ModSource::Modrinth { project_id: "sodium".into(), version_id: "v1".into() },
            file_name: "sodium.jar".into(),
            sha1: Some("a".repeat(40)),
            enabled: true,
            kind: ModKind::Mod,
            required_by: Vec::new(),
        };
        let mut instance = Instance::from_new(NewInstance {
            name: "Offline".into(),
            minecraft_version: "1.21.1".into(),
            loader: ModLoader::Fabric,
            loader_version: Some("0.16.10".into()),
        });
        instance.mods = vec![modrinth];
        // Ein Proxy, bei dem nichts lauscht: jede Anfrage scheitert sofort.
        let offline = reqwest::Client::builder().proxy(reqwest::Proxy::all("http://127.0.0.1:9").unwrap()).build().unwrap();

        let remote = remote_files(&offline, &instance, &["mods".to_string()]).await.unwrap();

        assert!(remote.is_empty());
    }

    #[test]
    fn only_importable_packs_are_limited() {
        let file = std::env::temp_dir().join(format!("{}.txt", new_id()));
        fs::write(&file, "x").unwrap();
        let files = vec![("a.txt".to_string(), file.clone()); MAX_ENTRIES + 1];

        assert!(PackLimit::Importable.check(&files).is_err());
        assert!(PackLimit::Importable.check(&files[..MAX_ENTRIES]).is_ok());
        assert!(PackLimit::Unlimited.check(&files).is_ok());
        fs::remove_file(file).unwrap();
    }
}
