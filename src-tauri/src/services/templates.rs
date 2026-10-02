//! Vorlagen: Schnappschuss einer Instanz als lokales `.mrpack` unter `templates/<id>.mrpack`.
//! Geschrieben wird es über `mrpack` (Modrinth-Inhalte im Index, alles andere unter `overrides/`).
//! Neue Instanzen entstehen über den normalen Pack-Import (`content::import`).
use std::{
    fs,
    path::{Path, PathBuf},
};

use super::progress::ProgressFn;
use super::{content, mrpack::{self, PackSpec}, remove_logged, write_atomic, Dirs};
use crate::{
    coded,
    error::{AppError, AppResult},
    models::{new_id, now_ms, require_name, Instance, Template, MAX_TEMPLATE_NAME_LEN},
    state::AppState,
};

/// Was eine Vorlage aus dem Spielordner mitnimmt; Welten, Logs und Screenshots bleiben draußen.
const CONTENT: [&str; 5] = ["mods", "resourcepacks", "shaderpacks", "config", "options.txt"];

fn pack_path(dirs: &Dirs, id: &str) -> PathBuf {
    dirs.templates().join(format!("{id}.mrpack"))
}

pub async fn save(state: &AppState, instance_id: &str, name: &str) -> AppResult<Template> {
    let name = require_name(name, MAX_TEMPLATE_NAME_LEN, coded!("errors.app.template.nameLength", max = MAX_TEMPLATE_NAME_LEN))?;
    let instance = state.instances.get(instance_id)?;
    let template = Template {
        id: new_id(),
        name: name.into(),
        minecraft_version: instance.minecraft_version.clone(),
        loader: instance.loader,
        mod_count: instance.mods.iter().filter(|m| m.enabled && m.sha1.is_some()).count(),
        created_at: now_ms(),
    };
    let path = pack_path(&state.dirs, &template.id);
    fs::create_dir_all(state.dirs.templates())?;
    let spec = PackSpec::template(&instance, CONTENT.map(String::from).to_vec());
    mrpack::write(&state.dirs, instance, spec, &path).await?;
    state.templates.insert(template).inspect_err(|_| remove_logged(&path))
}

/// Legt die Vorlage als `.mrpack` nach `path`: so lässt sie sich weitergeben und mit [`import_file`] wieder aufnehmen.
pub async fn export_file(state: &AppState, id: &str, path: &Path) -> AppResult<()> {
    mrpack::require_pack_target(path)?;
    let template = state.templates.get(id)?;
    let path = path.to_owned();
    state.blocking_with_dirs(move |dirs| write_atomic(&path, &read_template(dirs, &template)?)).await
}

/// Nimmt eine `.mrpack`-Datei als Vorlage auf; sie wird wie beim Import einer Instanz geprüft.
pub async fn import_file(state: &AppState, path: &Path) -> AppResult<Template> {
    let path = path.to_owned();
    let (template, target) = state.blocking_with_dirs(move |dirs| store_pack(dirs, &path)).await?;
    state.templates.insert(template).inspect_err(|_| remove_logged(&target))
}

/// Liest und prüft die `.mrpack`-Datei `path` und legt sie unter einer neuen Vorlagen-ID ab.
fn store_pack(dirs: &Dirs, path: &Path) -> AppResult<(Template, PathBuf)> {
    let data = content::local_pack(path)?;
    let info = content::inspect(&data, dirs)?;
    let template = Template {
        id: new_id(),
        name: imported_name(&info.name, path),
        minecraft_version: info.minecraft_version,
        loader: info.loader,
        mod_count: info.content_count,
        created_at: now_ms(),
    };
    let target = pack_path(dirs, &template.id);
    fs::create_dir_all(dirs.templates())?;
    write_atomic(&target, &data)?;
    Ok((template, target))
}

/// Der Name aus dem Pack, sonst der Dateiname; auf die Länge eines Vorlagennamens gekürzt.
fn imported_name(pack_name: &str, path: &Path) -> String {
    let stem = path.file_stem().and_then(|s| s.to_str()).unwrap_or_default();
    [pack_name, stem]
        .into_iter()
        .map(|name| name.trim().chars().take(MAX_TEMPLATE_NAME_LEN).collect::<String>())
        .find(|name| !name.is_empty())
        .unwrap_or_else(|| "Importierte Vorlage".into())
}

fn read_template(dirs: &Dirs, template: &Template) -> AppResult<Vec<u8>> {
    content::local_pack(&pack_path(dirs, &template.id)).map_err(|e| {
        if e.is_not_found() { AppError::invalid(coded!("errors.app.template.fileMissing")) } else { e }
    })
}

pub fn delete(state: &AppState, id: &str) -> AppResult<()> {
    // Erst der Store-Eintrag: nur eine existierende Id wird zum Pfad.
    state.templates.remove(id)?;
    remove_logged(&pack_path(&state.dirs, id));
    Ok(())
}

pub async fn create_instance(
    state: &AppState,
    template_id: &str,
    name: &str,
    progress: ProgressFn<'_>,
) -> AppResult<Instance> {
    let template = state.templates.get(template_id)?;
    let data = state.blocking_with_dirs(move |dirs| read_template(dirs, &template)).await?;
    content::import(state, &data, name, None, progress).await
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::{Mod, ModKind, ModLoader, ModSource, NewInstance};
    use crate::services::mods;

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
            pinned: false,
            pack_managed: false,
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

        let shared = root.join("Vorlage.mrpack");
        export_file(&state, &t.id, &shared).await.unwrap();
        assert!(export_file(&state, &t.id, Path::new("Vorlage.mrpack")).await.is_err());
        let imported = import_file(&state, &shared).await.unwrap();
        assert_eq!((imported.name.as_str(), imported.mod_count, imported.loader), ("Quelle", 2, ModLoader::Fabric));
        assert_eq!(imported.minecraft_version, "1.21.1");
        let again = create_instance(&state, &imported.id, "Aus Datei", &|_, _, _| {}).await.unwrap();
        assert_eq!(fs::read(state.dirs.game_dir(&again.id).join("mods/own.jar")).unwrap(), b"own");
        assert!(import_file(&state, &root.join("fehlt.mrpack")).await.is_err());

        delete(&state, &t.id).unwrap();
        assert!(!pack_path(&state.dirs, &t.id).exists() && state.templates.list() == vec![imported]);
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn imported_templates_fall_back_to_the_file_name() {
        let path = Path::new("/packs/Mein Pack.mrpack");

        assert_eq!(imported_name(" Aus dem Pack ", path), "Aus dem Pack");
        assert_eq!(imported_name("  ", path), "Mein Pack");
        assert_eq!(imported_name(&"x".repeat(MAX_TEMPLATE_NAME_LEN + 5), path).chars().count(), MAX_TEMPLATE_NAME_LEN);
    }
}
