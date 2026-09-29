//! Vorlagen: Schnappschuss einer Instanz als lokales `.mrpack` unter `templates/<id>.mrpack`.
//! Modrinth-Inhalte stehen als Download im Index, alles andere liegt unter `overrides/`.
//! Neue Instanzen entstehen über den normalen Pack-Import (`content::import`).
use std::{
    fs,
    io::{Cursor, Write},
    path::{Path, PathBuf},
};

use serde_json::{json, Value};

use super::{content, modrinth::{self, invalid}, mods, Dirs};
use crate::{
    error::{AppError, AppResult},
    models::{new_id, now_ms, Instance, ModLoader, ModSource, Template},
    state::AppState,
};

/// Unter der ZIP-Grenze des Imports (4096), damit jede Vorlage wieder importierbar ist.
const MAX_ENTRIES: usize = 4000;

fn file(dirs: &Dirs, id: &str) -> PathBuf {
    dirs.root.join("templates").join(format!("{id}.mrpack"))
}

/// Index-Einträge für aktive Modrinth-Inhalte, deren installierte Datei (sha1) Modrinth kennt.
/// Alles ohne Treffer landet später als Override aus dem Cache.
// ponytail: eine Anfrage pro Mod; bei großen Instanzen auf POST /version_files bündeln.
async fn remote_files(client: &reqwest::Client, instance: &Instance) -> AppResult<Vec<Value>> {
    let mut files = Vec::new();
    for m in instance.mods.iter().filter(|m| m.enabled) {
        let (ModSource::Modrinth { version_id, .. }, Some(sha1)) = (&m.source, &m.sha1) else { continue };
        let version = modrinth::version(client, version_id).await?;
        let found = version.files.into_iter().find(|f| {
            f.hashes.get("sha1").is_some_and(|h| h.eq_ignore_ascii_case(sha1))
                && f.hashes.contains_key("sha512")
                && modrinth::download_url(&f.url).is_ok()
        });
        if let Some(f) = found {
            files.push(json!({
                "path": format!("{}/{}", m.kind.folder(), m.file_name),
                "hashes": { "sha1": f.hashes["sha1"], "sha512": f.hashes["sha512"] },
                "downloads": [f.url],
                "fileSize": f.size,
            }));
        }
    }
    Ok(files)
}

/// Dateien unter `dir` (rekursiv, ohne Symlinks/Junctions) als (Pfad relativ zu `base`, Pfad).
fn walk(base: &Path, dir: &Path, out: &mut Vec<(String, PathBuf)>) -> AppResult<()> {
    let entries = match fs::read_dir(dir) {
        Ok(entries) => entries,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(()),
        Err(e) => return Err(e.into()),
    };
    for entry in entries {
        let entry = entry?;
        let kind = entry.file_type()?;
        if kind.is_dir() {
            walk(base, &entry.path(), out)?;
        } else if kind.is_file() {
            let rel = entry.path().strip_prefix(base).map_err(|_| invalid("Pfad außerhalb des Spielordners"))?.to_owned();
            let rel = rel.to_str().ok_or_else(|| invalid("Dateiname ist kein gültiger Text"))?.replace('\\', "/");
            out.push((rel, entry.path()));
        }
    }
    Ok(())
}

/// Baut das `.mrpack`: Index mit `remote`, aktive Inhalte ohne Index-Eintrag aus dem Cache,
/// dazu `config/` und `options.txt`. Welten, Logs und Screenshots bleiben draußen.
/// Deaktivierte Inhalte werden weggelassen: der Import kennt kein „deaktiviert“.
fn write_pack(dirs: &Dirs, instance: &Instance, remote: &[Value]) -> AppResult<Vec<u8>> {
    let mut dependencies = json!({ "minecraft": instance.minecraft_version });
    match (instance.loader, &instance.loader_version) {
        (ModLoader::Vanilla, _) => {}
        (loader, Some(v)) => {
            let key = loader.pack_key().ok_or_else(|| invalid("Loader ohne Pack-Schlüssel"))?;
            dependencies[key] = json!(v);
        }
        (_, None) => return Err(invalid("Instanz ohne Loader-Version: bitte erst einmal starten")),
    }
    let index = json!({
        "formatVersion": 1, "game": "minecraft", "versionId": "1", "name": instance.name,
        "files": remote, "dependencies": dependencies,
    });
    let covered: Vec<&str> = remote.iter().filter_map(|f| f["path"].as_str()).collect();
    let mut files = Vec::new();
    for m in instance.mods.iter().filter(|m| m.enabled) {
        let Some(sha1) = &m.sha1 else { continue };
        let path = format!("{}/{}", m.kind.folder(), m.file_name);
        if !covered.contains(&path.as_str()) {
            files.push((path, mods::cached(dirs, sha1)?));
        }
    }
    let game = dirs.game_dir(&instance.id);
    walk(&game, &game.join("config"), &mut files)?;
    if game.join("options.txt").is_file() {
        files.push(("options.txt".into(), game.join("options.txt")));
    }
    if files.len() > MAX_ENTRIES {
        return Err(invalid(format!("Zu viele Dateien für eine Vorlage (höchstens {MAX_ENTRIES})")));
    }
    let mut zip = zip::ZipWriter::new(Cursor::new(Vec::new()));
    let options = zip::write::SimpleFileOptions::default();
    zip.start_file("modrinth.index.json", options)?;
    zip.write_all(&serde_json::to_vec_pretty(&index)?)?;
    // „benötigt von“ kennt das mrpack-Format nicht: eigene Datei, die der Import auswertet.
    let required_by: serde_json::Map<String, Value> = instance
        .mods
        .iter()
        .filter(|m| m.enabled && m.sha1.is_some() && !m.required_by.is_empty())
        .map(|m| (m.file_name.clone(), json!(m.required_by)))
        .collect();
    zip.start_file(content::VOXLET_FILE, options)?;
    zip.write_all(&serde_json::to_vec_pretty(&json!({ "requiredBy": required_by }))?)?;
    let mut total = 0u64;
    for (path, source) in files {
        content::safe_path(&path)?;
        let data = fs::read(&source).map_err(|e| invalid(format!("{path} nicht lesbar: {e}")))?;
        // Der Import nimmt höchstens FILE_LIMIT pro Pack; unkomprimiert gezählt ist das die sichere Seite.
        total += data.len() as u64;
        if total > modrinth::FILE_LIMIT {
            return Err(invalid("Vorlage wäre größer als 256 MiB"));
        }
        zip.start_file(format!("overrides/{path}"), options)?;
        zip.write_all(&data)?;
    }
    Ok(zip.finish()?.into_inner())
}

pub async fn save(state: &AppState, instance_id: &str, name: &str) -> AppResult<Template> {
    let name = name.trim();
    if name.is_empty() || name.chars().count() > 100 {
        return Err(invalid("Der Name der Vorlage muss 1 bis 100 Zeichen lang sein"));
    }
    let instance = state.instances.get(instance_id)?;
    let remote = remote_files(&modrinth::client()?, &instance).await?;
    let data = write_pack(&state.dirs, &instance, &remote)?;
    let template = Template {
        id: new_id(),
        name: name.into(),
        minecraft_version: instance.minecraft_version.clone(),
        loader: instance.loader,
        mod_count: instance.mods.iter().filter(|m| m.enabled && m.sha1.is_some()).count(),
        created_at: now_ms(),
    };
    let path = file(&state.dirs, &template.id);
    fs::create_dir_all(state.dirs.root.join("templates"))?;
    let tmp = path.with_extension("mrpack.part");
    fs::write(&tmp, &data)?;
    fs::rename(&tmp, &path)?;
    state.templates.insert(template).inspect_err(|_| {
        if let Err(err) = fs::remove_file(&path) {
            tracing::warn!(%err, path = %path.display(), "Vorlagendatei nach Fehler nicht entfernt");
        }
    })
}

pub fn delete(state: &AppState, id: &str) -> AppResult<()> {
    // Erst der Store-Eintrag: nur eine existierende Id wird zum Pfad.
    state.templates.remove(id)?;
    match fs::remove_file(file(&state.dirs, id)) {
        Err(err) if err.kind() != std::io::ErrorKind::NotFound => {
            tracing::warn!(%id, %err, "Vorlagendatei nicht gelöscht")
        }
        _ => {}
    }
    Ok(())
}

pub async fn create_instance(
    state: &AppState,
    template_id: &str,
    name: &str,
    progress: &(dyn Fn(&str, u64, u64) + Send + Sync),
) -> AppResult<Instance> {
    let template = state.templates.get(template_id)?;
    let data = content::local_pack(&file(&state.dirs, &template.id)).map_err(|e| match e {
        AppError::Io(e) if e.kind() == std::io::ErrorKind::NotFound => invalid("Die Vorlagendatei fehlt"),
        e => e,
    })?;
    content::import(state, &data, name, None, progress).await
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::{Mod, ModKind, NewInstance};

    #[tokio::test]
    async fn template_roundtrip_without_network() {
        let root = std::env::temp_dir().join(new_id());
        let state = AppState::load(&root).unwrap();
        let local = |name: &str, enabled| Mod {
            id: name.into(),
            name: name.into(),
            version: "1".into(),
            source: ModSource::Local,
            file_name: format!("{name}.jar"),
            sha1: Some(mods::cache_bytes(&state.dirs, name.as_bytes()).unwrap()),
            enabled,
            kind: ModKind::Mod,
            required_by: Vec::new(),
        };
        let mut source = Instance::from_new(NewInstance {
            name: "Quelle".into(),
            minecraft_version: "1.21.1".into(),
            loader: ModLoader::Fabric,
            loader_version: Some("0.16.10".into()),
        });
        source.mods = vec![local("own", true), local("off", false), Mod { required_by: vec!["own".into()], ..local("dep", true) }];
        let source = state.instances.insert(source).unwrap();
        let game = state.dirs.game_dir(&source.id);
        for (path, data) in [("config/sub/a.toml", "x=1"), ("options.txt", "fov:1"), ("saves/w/level.dat", "welt")] {
            fs::create_dir_all(game.join(path).parent().unwrap()).unwrap();
            fs::write(game.join(path), data).unwrap();
        }

        assert!(save(&state, &source.id, "  ").await.is_err());
        let t = save(&state, &source.id, "Meine Vorlage").await.unwrap();
        assert_eq!((t.mod_count, t.loader), (2, ModLoader::Fabric));
        assert_eq!(state.templates.list(), vec![t.clone()]);

        let copy = create_instance(&state, &t.id, "Kopie", &|_, _, _| {}).await.unwrap();
        let new = state.dirs.game_dir(&copy.id);
        assert_eq!(fs::read(new.join("mods/own.jar")).unwrap(), b"own");
        let mut got: Vec<_> = copy.mods.iter().map(|m| (m.file_name.as_str(), m.enabled, m.required_by.clone())).collect();
        got.sort();
        assert_eq!(got, [("dep.jar", true, vec!["own".to_string()]), ("own.jar", true, vec![])]);
        assert!(copy.mods.iter().any(|m| m.sha1 == source.mods[0].sha1));
        assert_eq!(fs::read(new.join("config/sub/a.toml")).unwrap(), b"x=1");
        assert_eq!(fs::read(new.join("options.txt")).unwrap(), b"fov:1");
        assert!(!new.join("mods/off.jar").exists() && !new.join("saves").exists());
        assert_eq!((copy.loader, copy.loader_version.as_deref()), (ModLoader::Fabric, Some("0.16.10")));

        delete(&state, &t.id).unwrap();
        assert!(!file(&state.dirs, &t.id).exists() && state.templates.list().is_empty());
        fs::remove_dir_all(root).unwrap();
    }
}
