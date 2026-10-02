//! Transaktionaler Content-Import. Ziele werden exklusiv neu angelegt, niemals ersetzt.
mod adopt;
mod analysis;
pub(crate) mod fs_safety;
mod install;
mod jar_meta;
mod pack;
mod update;
mod version_range;

use std::{fs, path::PathBuf};

use tokio_util::sync::CancellationToken;

pub use adopt::adopt_untracked;
pub use analysis::{analyze, ContentAnalysis};
pub(crate) use adopt::{
    cached_untracked, catalog, identify, identify_or_local, record_untracked, CachedFile, ContentFile, Recognition,
};
pub use fs_safety::safe_path;
pub(crate) use fs_safety::{regular_parents, rollback, write_new, StagedInstall};
pub use install::install_mod;
pub(crate) use install::budget;
pub use pack::{import, import_file, inspect, install_modrinth_pack, local_pack, PackInfo, PUMPKIN_FILE};
pub(crate) use pack::{
    content_file, file_origin, import_plan, modrinth_pack, plan_pack, unpack, Blob, Fetch, Pack, TempFile,
};
pub use update::{check_updates, switch_version, update_mods, ModUpdate};
pub(crate) use update::UpdatePlan;

use crate::{
    coded,
    error::{AppError, AppResult},
    models::{Instance, Mod, ModKind, ModSource},
    services::{blocking, download::RemoveOnDrop, modrinth::Version, Dirs},
    state::AppState,
};

/// Speichert `mods` als neue Inhaltsliste der Instanz und liefert die gespeicherte Instanz.
pub(crate) fn commit_mods(state: &AppState, id: &str, mods: Vec<Mod>) -> AppResult<Instance> {
    state.instances.modify(id, |current| current.mods = mods)
}

/// Jede der `mod_ids` muss ein Eintrag der Instanz sein.
pub(crate) fn ensure_known(instance: &Instance, mod_ids: &[String]) -> AppResult<()> {
    match mod_ids.iter().find(|id| !instance.mods.iter().any(|m| &m.id == *id)) {
        Some(unknown) => Err(AppError::invalid(coded!("errors.modrinth.unknownModId", id = unknown))),
        None => Ok(()),
    }
}

pub(crate) fn project_of(m: &Mod) -> Option<&String> {
    match &m.source {
        ModSource::Modrinth { project_id, .. } => Some(project_id),
        _ => None,
    }
}

/// Neuer, aktiver Eintrag für die Datei `file_name` der Modrinth-Version `v`, den noch keine andere Mod braucht;
/// die SHA-1 kommt nach dem Laden.
pub(crate) fn mod_from_version(v: &Version, file_name: String, kind: ModKind) -> Mod {
    Mod {
        id: v.project_id.clone(),
        name: v.name.clone(),
        version: v.version_number.clone(),
        source: ModSource::Modrinth { project_id: v.project_id.clone(), version_id: v.id.clone() },
        file_name,
        sha1: None,
        enabled: true,
        kind,
        required_by: Vec::new(),
        pinned: false,
        pack_managed: false,
    }
}

/// Legt den Ordner einer neuen Instanz an und befüllt ihn im Thread mit `work`, das `stop` regelmäßig prüft. Der
/// Wächter räumt den Ordner weg, bis der Aufrufer ihn nach dem Eintragen der Instanz mit `disarm` entschärft.
/// Er lebt im Thread: bei Abbruch räumt er erst weg, wenn dort nichts mehr geschrieben wird.
pub(crate) async fn populate_new_dir<T: Send + 'static>(
    dirs: &Dirs,
    dir: PathBuf,
    work: impl FnOnce(&CancellationToken) -> AppResult<T> + Send + 'static,
) -> AppResult<(RemoveOnDrop, T)> {
    regular_parents(&dirs.root, &dir)?;
    blocking(move |stop| {
        let guard = RemoveOnDrop::new(dir.clone());
        fs::create_dir_all(&dir)?;
        Ok((guard, work(stop)?))
    })
    .await
}

/// Testhilfe: startet `run` mit einem Fortschrittsrückruf, der beim Schritt `step` anhält, bricht dann ab und gibt
/// das Ergebnis zurück, sobald der Thread zu Ende ist und der Wächter den neuen Instanzordner weggeräumt hat.
#[cfg(test)]
pub(crate) async fn cancel_at_step<T, F: std::future::Future<Output = AppResult<T>>>(
    state: &AppState,
    step: u64,
    run: impl FnOnce(crate::services::progress::SharedProgress) -> F,
) -> AppResult<T> {
    const CLEANUP_POLLS: usize = 500;
    const POLL_INTERVAL: std::time::Duration = std::time::Duration::from_millis(10);
    let instances = state.dirs.root.join("instances");
    let folders = || fs::read_dir(&instances).map_or(0, Iterator::count);
    let before = folders();
    let (reached, started) = std::sync::mpsc::channel();
    let (resume, hold) = std::sync::mpsc::channel::<()>();
    let hold = std::sync::Mutex::new(hold);
    let progress = move |_: crate::services::progress::Phase, done: u64, _: u64| {
        if done == step {
            reached.send(()).unwrap();
            hold.lock().unwrap().recv().ok();
        }
    };
    let work = state.cancellable("op", run(std::sync::Arc::new(progress)));
    // Erst nach dem Abbruch geht der Thread weiter: `cancellable` wartet, bis er am nächsten Prüfpunkt endet.
    let (result, ()) = tokio::join!(work, async {
        started.recv().unwrap();
        state.cancel("op");
        drop(resume);
    });
    // Endet der Thread, schließt sich `started`; bis dahin darf der Rückruf noch einmal melden. Der Wächter räumt gleich danach auf.
    for _ in started {}
    for _ in 0..CLEANUP_POLLS {
        if folders() == before {
            break;
        }
        std::thread::sleep(POLL_INTERVAL);
    }
    result
}

/// Gemeinsame Testdaten der Inhaltsmodule.
#[cfg(test)]
pub(crate) mod fixtures {
    use std::collections::HashMap;

    use crate::{
        models::{Mod, ModKind, ModSource},
        services::modrinth::Version,
    };

    /// Aktive Modrinth-Mod `project`, die von `required_by` gebraucht wird.
    pub(crate) fn modrinth_mod(project: &str, required_by: &[&str]) -> Mod {
        Mod {
            id: project.into(),
            name: project.into(),
            version: "1".into(),
            source: ModSource::Modrinth { project_id: project.into(), version_id: format!("{project}1") },
            file_name: format!("{project}.jar"),
            sha1: Some(format!("{:0>40}", project.len())),
            enabled: true,
            kind: ModKind::Mod,
            required_by: required_by.iter().map(|s| s.to_string()).collect(),
            pinned: false,
            pack_managed: false,
        }
    }

    /// Je Projekt die Version `<projekt>1` mit den Pflicht-Abhängigkeiten aus `edges`.
    pub(crate) fn graph(edges: &[(&str, &[&str])]) -> HashMap<String, Version> {
        edges
            .iter()
            .map(|(p, deps)| {
                let v: Version = serde_json::from_value(serde_json::json!({
                    "id": format!("{p}1"), "project_id": p, "name": p, "version_number": "1",
                    "game_versions": ["1.21.1"], "loaders": ["fabric"], "files": [],
                    "dependencies": deps.iter().map(|d| serde_json::json!({
                        "version_id": null, "project_id": d, "file_name": null, "dependency_type": "required"
                    })).collect::<Vec<_>>()
                }))
                .unwrap();
                (p.to_string(), v)
            })
            .collect()
    }
}

#[cfg(test)]
mod tests {
    use super::{fixtures::modrinth_mod, *};
    use crate::services::mods;

    #[test]
    fn sync_places_content_kinds_in_their_folders() {
        let dirs = Dirs::new(std::env::temp_dir().join(crate::models::new_id()));
        let sha1 = mods::cache_bytes(&dirs, b"pack").unwrap();
        let pack = Mod { kind: ModKind::ResourcePack, file_name: "pack.zip".into(), sha1: Some(sha1), ..modrinth_mod("pack", &[]) };
        mods::sync(&dirs, "i", std::slice::from_ref(&pack)).unwrap();
        assert_eq!(fs::read(dirs.game_dir("i").join("resourcepacks/pack.zip")).unwrap(), b"pack");
        let wrong = Mod { file_name: "pack.jar".into(), ..pack };
        assert!(mods::sync(&dirs, "i", &[wrong]).is_err());
        fs::remove_dir_all(&dirs.root).unwrap();
    }
}
