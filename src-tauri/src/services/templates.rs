//! Vorlagen: Schnappschuss einer Instanz als lokales `.mrpack` unter `templates/<id>.mrpack`.
//! Geschrieben wird es über `mrpack` (Modrinth-Inhalte im Index, alles andere unter `overrides/`).
//! Neue Instanzen entstehen über den normalen Pack-Import (`content::import`).
use std::{fs, path::PathBuf};

use super::progress::ProgressFn;
use super::{content, mrpack::{self, PackLimit}, remove_logged, Dirs};
use crate::{
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
    let name = require_name(name, MAX_TEMPLATE_NAME_LEN, format!("Der Name der Vorlage muss 1 bis {MAX_TEMPLATE_NAME_LEN} Zeichen lang sein"))?;
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
    mrpack::write(&state.dirs, instance, CONTENT.map(String::from).to_vec(), &path, PackLimit::Importable).await?;
    state.templates.insert(template).inspect_err(|_| remove_logged(&path))
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
    let data = content::local_pack(&pack_path(&state.dirs, &template.id)).map_err(|e| {
        if e.is_not_found() { AppError::invalid("Die Vorlagendatei fehlt") } else { e }
    })?;
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
        assert!(!pack_path(&state.dirs, &t.id).exists() && state.templates.list().is_empty());
        fs::remove_dir_all(root).unwrap();
    }
}
