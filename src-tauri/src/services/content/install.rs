//! Modrinth-Inhalt in eine Instanz installieren: die Version samt Pflicht-Abhängigkeiten auflösen, alles laden und
//! erst dann gemeinsam ablegen. Dazu die Buchführung, welche Mod welche braucht (`required_by`).
use std::collections::{HashMap, HashSet};

use super::{commit_mods, mod_from_version, project_of, StagedInstall};
use crate::{
    coded,
    error::{AppError, AppResult},
    models::{Instance, Mod, ModKind},
    services::{
        limits::{FILE_LIMIT, MIB},
        modrinth::{self, Dependency, File, Project, Version},
        mods,
        progress::{Phase, ProgressFn},
    },
    state::AppState,
};

/// Installiert die Modrinth-Version `version` in die Instanz `id`; bei Mods samt Pflicht-Abhängigkeiten.
pub async fn install_mod(state: &AppState, id: &str, version: &str, progress: ProgressFn<'_>) -> AppResult<Instance> {
    let mut instance = state.instances.get(id)?;
    let client = modrinth::client()?;
    progress(Phase::Resolve, 0, 1);
    let Resolved { kind, root_project, selected } = resolve_install(&client, version, &instance).await?;
    keep_present(&mut instance.mods, &selected, &root_project)?;
    let planned = new_files(&instance.mods, &selected, kind)?;
    let staged = StagedInstall::new(&state.dirs.root);
    let folder = state.dirs.game_dir(id).join(kind.folder());
    for planned in &planned {
        staged.reserve(&folder.join(&planned.file.filename))?;
    }
    budget(planned.iter().map(|planned| planned.file.size))?;
    let fresh: HashSet<String> =
        planned.iter().map(|planned| planned.version.project_id.clone()).filter(|p| p != &root_project).collect();
    let total = planned.len() as u64;
    let data = download_all(&client, planned.iter().map(|planned| &planned.file), progress).await?;
    let instance = staged.commit_or_rollback(|staged| {
        for (planned, data) in planned.into_iter().zip(data) {
            staged.write_file(folder.join(&planned.file.filename), &data)?;
            // Cache aus den verifizierten Bytes; Fehler rollen nur die Ziele zurück.
            let sha1 = mods::cache_bytes(&state.dirs, &data)?;
            instance.mods.push(Mod { sha1: Some(sha1), ..mod_from_version(&planned.version, planned.file.filename, kind) });
        }
        mark_dependencies(&mut instance.mods, &selected, &fresh);
        commit_mods(state, id, instance.mods)
    })?;
    progress(Phase::Complete, total, total);
    Ok(instance)
}

/// Was eine Installation hinzufügt: die Art des Projekts und alle beteiligten Versionen nach Projekt.
struct Resolved {
    kind: ModKind,
    root_project: String,
    selected: HashMap<String, Version>,
}

async fn resolve_install(client: &reqwest::Client, version: &str, instance: &Instance) -> AppResult<Resolved> {
    let root = modrinth::version(client, version).await?;
    let project = modrinth::project(client, &root.project_id).await?;
    let kind = kind_of(&project)?;
    let root_project = root.project_id.clone();
    let selected = match kind {
        ModKind::Mod => resolve_mods(client, version, instance).await?,
        _ => lone_version(root, &project, instance)?,
    };
    if modrinth::has_incompatibility(&selected) {
        return Err(AppError::invalid(coded!("errors.modrinth.incompatibleExistingMod")));
    }
    Ok(Resolved { kind, root_project, selected })
}

fn kind_of(project: &Project) -> AppResult<ModKind> {
    match project.project_type.as_str() {
        "mod" => Ok(ModKind::Mod),
        "resourcepack" => Ok(ModKind::ResourcePack),
        "shader" => Ok(ModKind::Shader),
        _ => Err(AppError::invalid(coded!("errors.modrinth.unsupportedProjectType"))),
    }
}

/// Die aufgelösten Versionen nach Projekt. Vorhandene Modrinth-Wurzeln kommen mit in den Graphen, damit
/// Unverträglichkeiten in beide Richtungen greifen.
async fn resolve_mods(client: &reqwest::Client, version: &str, instance: &Instance) -> AppResult<HashMap<String, Version>> {
    let mut selected = HashMap::new();
    for v in modrinth::resolve(client, version, instance).await? {
        modrinth::insert_if_consistent(&mut selected, v)?;
    }
    Ok(selected)
}

/// Ressourcenpakete und Shader haben keinen Loader-Graphen: nur die Minecraft-Version zählt, keine Abhängigkeiten.
fn lone_version(root: Version, project: &Project, instance: &Instance) -> AppResult<HashMap<String, Version>> {
    if project.id != root.project_id || !root.game_versions.contains(&instance.minecraft_version) {
        return Err(AppError::invalid(coded!("errors.modrinth.incompatibleVersion", version = root.id)));
    }
    Ok(HashMap::from([(root.project_id.clone(), root)]))
}

/// Schon vorhandene Projekte bleiben und müssen aktiv sein. Installiert der Nutzer eine vorhandene Abhängigkeit
/// direkt, wird sie direkt.
fn keep_present(mods: &mut [Mod], selected: &HashMap<String, Version>, root_project: &str) -> AppResult<()> {
    for v in selected.values() {
        let Some(existing) = mods.iter_mut().find(|m| project_of(m) == Some(&v.project_id)) else { continue };
        if !existing.enabled {
            return Err(AppError::invalid(coded!("errors.modrinth.requiredModDisabled")));
        }
        if v.project_id == root_project {
            existing.required_by.clear();
        }
    }
    Ok(())
}

/// Datei, die eine Installation neu lädt.
struct PlannedFile {
    version: Version,
    file: File,
}

/// Die primären Dateien der Projekte, die die Instanz noch nicht hat; ihre Namen kollidieren mit keiner anderen.
fn new_files(mods: &[Mod], selected: &HashMap<String, Version>, kind: ModKind) -> AppResult<Vec<PlannedFile>> {
    let mut names: HashSet<String> = mods.iter().map(|m| m.file_name.to_lowercase()).collect();
    let mut planned = Vec::new();
    for v in selected.values().filter(|v| !mods.iter().any(|m| project_of(m) == Some(&v.project_id))) {
        let file = modrinth::primary(v, kind.extension())?;
        if !names.insert(file.filename.to_lowercase()) {
            return Err(AppError::invalid(coded!("errors.modrinth.fileNamesCollide")));
        }
        planned.push(PlannedFile { version: v.clone(), file });
    }
    Ok(planned)
}

/// Lädt `files` nacheinander und meldet vor jeder Datei den Fortschritt.
pub(super) async fn download_all<'f>(
    client: &reqwest::Client,
    files: impl ExactSizeIterator<Item = &'f File>,
    progress: ProgressFn<'_>,
) -> AppResult<Vec<Vec<u8>>> {
    let total = files.len() as u64;
    let mut loaded = Vec::with_capacity(files.len());
    for (done, file) in (0..).zip(files) {
        progress(Phase::Download, done, total);
        loaded.push(modrinth::download(client, file).await?);
    }
    Ok(loaded)
}

pub(crate) fn budget(mut sizes: impl Iterator<Item = u64>) -> AppResult<()> {
    if sizes.try_fold(0u64, |a, b| a.checked_add(b)).is_none_or(|n| n > FILE_LIMIT) {
        return Err(AppError::invalid(coded!("errors.modrinth.downloadBudgetExceeded", limit = FILE_LIMIT / MIB)));
    }
    Ok(())
}

/// `required_by` = direkte Modrinth-Mods (leeres `required_by`), deren Pflicht-Graph die Mod erreicht. Direkte
/// bleiben direkt; `fresh` sind Abhängigkeiten, die dieser Vorgang installiert, schon vorhandene bekommen weitere
/// Besitzer. Entfernen des Besitzers P: P überall streichen, leer gewordene Listen dürfen gehen.
pub(super) fn mark_dependencies(mods: &mut [Mod], selected: &HashMap<String, Version>, fresh: &HashSet<String>) {
    let owners: Vec<(String, HashSet<String>)> = mods
        .iter()
        .filter(|m| m.required_by.is_empty())
        .filter_map(project_of)
        .filter(|p| !fresh.contains(*p))
        .map(|p| (p.clone(), reachable(p, selected)))
        .collect();
    for m in mods.iter_mut() {
        let Some(p) = project_of(m).cloned() else { continue };
        if m.required_by.is_empty() && !fresh.contains(&p) {
            continue;
        }
        for (owner, reach) in &owners {
            if owner != &p && reach.contains(&p) && !m.required_by.contains(owner) {
                m.required_by.push(owner.clone());
            }
        }
        m.required_by.sort();
    }
}

/// Projekte, die `root` im aufgelösten Graphen über Pflicht-Abhängigkeiten erreicht.
fn reachable(root: &str, selected: &HashMap<String, Version>) -> HashSet<String> {
    let mut seen = HashSet::new();
    let mut stack = vec![root.to_string()];
    while let Some(p) = stack.pop() {
        let Some(v) = selected.get(&p) else { continue };
        for d in v.dependencies.iter().filter(|d| d.dependency_type == "required") {
            if let Some(t) = dependency_project(d, selected).filter(|t| seen.insert(t.clone())) {
                stack.push(t);
            }
        }
    }
    seen
}

/// Projekt, das `d` verlangt: das der exakt genannten Version, falls sie in `selected` ist, sonst das genannte.
pub(super) fn dependency_project(d: &Dependency, selected: &HashMap<String, Version>) -> Option<String> {
    d.version_id
        .as_ref()
        .and_then(|id| selected.values().find(|o| &o.id == id))
        .map(|o| o.project_id.clone())
        .or_else(|| d.project_id.clone())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::services::content::fixtures::{graph, modrinth_mod};

    #[test]
    fn required_by_marks_owners_and_keeps_direct_mods() {
        // x (direkt) -> y, x -> z (direkt); installiert wird a -> b -> c, a -> y, a -> z.
        let selected = graph(&[
            ("x", &["y", "z"]),
            ("y", &[]),
            ("z", &[]),
            ("a", &["b", "y", "z"]),
            ("b", &["c"]),
            ("c", &[]),
        ]);
        let mut mods = vec![
            modrinth_mod("x", &[]),
            modrinth_mod("y", &["x"]),
            modrinth_mod("z", &[]),
            modrinth_mod("a", &[]),
            modrinth_mod("b", &[]),
            modrinth_mod("c", &[]),
        ];
        let fresh = HashSet::from(["b".to_string(), "c".to_string()]);
        mark_dependencies(&mut mods, &selected, &fresh);
        let by: Vec<_> = mods.iter().map(|m| m.required_by.join(",")).collect();
        assert_eq!(by, ["", "a,x", "", "", "a", "a"]);
    }

    #[test]
    fn the_download_budget_names_the_file_limit() {
        assert!(budget([FILE_LIMIT].into_iter()).is_ok());
        let err = budget([FILE_LIMIT, 1].into_iter()).unwrap_err();
        assert_eq!(err.to_string(), "Gesamtbudget für Mod-Download überschritten (256 MiB)");
        assert!(budget([u64::MAX, 1].into_iter()).is_err());
    }
}
