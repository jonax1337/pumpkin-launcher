//! Mod, Ressourcenpaket oder Shader von CurseForge samt benötigten Abhängigkeiten in eine Instanz legen: erst alles
//! auflösen und laden, dann gemeinsam ablegen.
use super::{
    codes::{loader_types, mod_kind},
    dto::{CfFile, CfMod, INCOMPATIBLE, RELEASE},
    parse_cf_id,
    proxy::{file_of, files_by_id, mod_of, mods_by_id},
};
use crate::{
    coded,
    error::{AppError, AppResult},
    models::{new_id, Instance, Mod, ModKind, ModSource},
    services::{
        content::{self, StagedInstall},
        modrinth, mods,
        progress::{Phase, ProgressFn},
        providers::RemoteFile,
    },
    state::AppState,
};
use std::{
    cmp::Reverse,
    collections::{HashMap, HashSet},
    path::{Path, PathBuf},
};

const MAX_DEPENDENCIES: usize = 64;

/// Eine Datei der Installation mit ihrem Projekt und der Art, in deren Ordner sie kommt.
pub(super) struct Planned {
    pub(super) project: CfMod,
    pub(super) file: CfFile,
    pub(super) kind: ModKind,
}

impl Planned {
    /// Eintrag der Instanz für die geladene, geprüfte Datei.
    pub(super) fn mod_entry(&self, sha1: String, required_by: Vec<String>, existing: &[Mod]) -> AppResult<Mod> {
        let id = format!("cf-{}", self.project.id);
        let too_large = |_| AppError::invalid(coded!("errors.providers.invalidCurseForgeId"));
        Ok(Mod {
            // Zwei Dateien desselben Projekts behalten verschiedene IDs.
            id: if existing.iter().any(|x| x.id == id) { new_id() } else { id },
            name: self.project.name.clone(),
            version: self.file.title().to_string(),
            source: ModSource::CurseForge {
                project_id: u32::try_from(self.project.id).map_err(too_large)?,
                file_id: u32::try_from(self.file.id).map_err(too_large)?,
            },
            file_name: self.file.file_name.clone(),
            sha1: Some(sha1),
            enabled: true,
            kind: self.kind,
            required_by,
            pinned: false,
            pack_managed: false,
        })
    }

    pub(super) fn target(&self, game_dir: &Path) -> PathBuf {
        game_dir.join(self.kind.folder()).join(&self.file.file_name)
    }
}

/// Die gewählte Datei und die Abhängigkeiten, die sie mitbringt.
struct Plan {
    root: Planned,
    dependencies: Vec<Planned>,
}

impl Plan {
    fn all(&self) -> impl Iterator<Item = &Planned> {
        std::iter::once(&self.root).chain(&self.dependencies)
    }

    /// Schlüssel, unter dem die Abhängigkeiten die gewählte Datei als Besitzer führen.
    fn root_key(&self) -> String {
        format!("cf-{}", self.root.project.id)
    }

    /// Nur die gewählte Datei steht direkt in der Instanz, alle anderen gehören zu ihr.
    fn required_by(&self, planned: &Planned) -> Vec<String> {
        if planned.project.id == self.root.project.id { Vec::new() } else { vec![self.root_key()] }
    }

    /// Unverträglichkeiten gegen das, was schon drin ist oder jetzt dazukommt.
    fn ensure_compatible(&self, instance: &Instance) -> AppResult<()> {
        let installed = curseforge_projects(instance);
        for planned in self.all() {
            let clash = planned
                .file
                .dependencies
                .iter()
                .find(|d| d.relation_type == INCOMPATIBLE && (installed.contains(&d.mod_id) || self.all().any(|p| p.project.id == d.mod_id)));
            if let Some(d) = clash {
                return Err(AppError::invalid(coded!(
                    "errors.providers.incompatibleMod",
                    name = planned.file.display_name,
                    project = d.mod_id
                )));
            }
        }
        Ok(())
    }

    /// Schon vorhandene Abhängigkeiten merken den neuen Besitzer, sofern sie selbst Abhängigkeit sind.
    fn credit_owner(&self, mods: &mut [Mod]) {
        let root_key = self.root_key();
        for dependency in &self.dependencies {
            let key = format!("cf-{}", dependency.project.id);
            let owned = |x: &&mut Mod| x.id == key && !x.required_by.is_empty() && !x.required_by.contains(&root_key);
            for existing in mods.iter_mut().filter(owned) {
                existing.required_by.push(root_key.clone());
            }
        }
    }
}

/// Eine Datei, deren Ziel geprüft und reserviert ist und die jetzt geladen wird.
struct Download<'a> {
    planned: &'a Planned,
    target: PathBuf,
    remote: RemoteFile,
}

/// Installiert eine Datei samt benötigten Abhängigkeiten (nur bei Mods) in eine Instanz.
pub async fn install_mod(
    state: &AppState,
    instance_id: &str,
    project_id: &str,
    file_id: &str,
    progress: ProgressFn<'_>,
) -> AppResult<Instance> {
    let (project, file_no) = (parse_cf_id(project_id)?, parse_cf_id(file_id)?);
    let mut instance = state.instances.get(instance_id)?;
    let client = modrinth::client()?;
    progress(Phase::Resolve, 0, 1);
    let plan = plan_install(&client, &instance, project, file_no).await?;
    let staged = StagedInstall::new(&state.dirs.root);
    let downloads = reserve_targets(&plan, &instance, &state.dirs.game_dir(instance_id), &staged)?;
    content::budget(downloads.iter().map(|download| download.planned.file.file_length))?;
    let total = downloads.len() as u64;
    let data = download_all(&downloads, progress).await?;
    let installed = staged.commit_or_rollback(|staged| {
        for (download, data) in downloads.into_iter().zip(data) {
            staged.write_file(download.target, &data)?;
            let sha1 = mods::cache_bytes(&state.dirs, &data)?;
            let entry = download.planned.mod_entry(sha1, plan.required_by(download.planned), &instance.mods)?;
            instance.mods.push(entry);
        }
        plan.credit_owner(&mut instance.mods);
        content::commit_mods(state, instance_id, instance.mods)
    })?;
    progress(Phase::Complete, total, total);
    Ok(installed)
}

/// Löst die gewählte Datei und bei Mods ihre benötigten Abhängigkeiten auf.
async fn plan_install(client: &reqwest::Client, instance: &Instance, project: u32, file_no: u32) -> AppResult<Plan> {
    let root_mod = mod_of(client, project).await?;
    let kind = mod_kind(root_mod.class_id)?;
    let root_file = file_of(client, project, file_no).await?;
    if !runs(instance, kind, &root_file) {
        return Err(AppError::invalid(coded!("errors.providers.fileNotForInstance", name = root_file.display_name, version = instance.minecraft_version)));
    }
    let root = Planned { project: root_mod, file: root_file, kind };
    if kind != ModKind::Mod {
        return Ok(Plan { root, dependencies: Vec::new() });
    }
    let dependencies = resolve_dependencies(client, instance, &root.file)
        .await?
        .into_iter()
        .map(|(project, file)| Planned { project, file, kind: ModKind::Mod })
        .collect();
    let plan = Plan { root, dependencies };
    plan.ensure_compatible(instance)?;
    Ok(plan)
}

/// Prüft die Ziele aller Dateien und reserviert sie, bevor etwas geladen wird.
fn reserve_targets<'a>(plan: &'a Plan, instance: &Instance, game_dir: &Path, staged: &StagedInstall) -> AppResult<Vec<Download<'a>>> {
    let mut names: HashSet<String> = instance.mods.iter().map(|m| m.file_name.to_lowercase()).collect();
    let mut downloads = Vec::new();
    for planned in plan.all() {
        check_file_name(&planned.file.file_name, planned.kind)?;
        if !names.insert(planned.file.file_name.to_lowercase()) {
            return Err(AppError::invalid(coded!("errors.providers.modFileNameClash")));
        }
        let target = planned.target(game_dir);
        staged.reserve(&target)?;
        let remote = planned.file.remote_file().map_err(|e| AppError::invalid(coded!("errors.providers.projectFileFailed", name = planned.project.name, reason = e)))?;
        downloads.push(Download { planned, target, remote });
    }
    Ok(downloads)
}

/// Lädt die Dateien nacheinander und meldet vor jeder den Fortschritt.
async fn download_all(downloads: &[Download<'_>], progress: ProgressFn<'_>) -> AppResult<Vec<Vec<u8>>> {
    let client = modrinth::download_client()?;
    let total = downloads.len() as u64;
    let mut loaded = Vec::with_capacity(downloads.len());
    for (done, download) in (0..).zip(downloads) {
        progress(Phase::Download, done, total);
        loaded.push(download.remote.download(&client).await?);
    }
    Ok(loaded)
}

pub(super) fn check_file_name(name: &str, kind: ModKind) -> AppResult<()> {
    content::safe_path(name)?;
    if name.contains('/') || !name.ends_with(kind.extension()) {
        return Err(AppError::invalid(coded!("errors.providers.unexpectedFileName", name = name)));
    }
    Ok(())
}

/// Name ohne Sonderzeichen und Schreibweise, um dieselbe Mod bei Modrinth und CurseForge zu erkennen.
fn norm(name: &str) -> String {
    name.chars().filter(|c| c.is_alphanumeric()).flat_map(char::to_lowercase).collect()
}

/// Läuft die Datei in dieser Instanz? Minecraft-Version muss passen, bei Mods auch der Loader (Quilt lädt Fabric mit).
fn runs(instance: &Instance, kind: ModKind, file: &CfFile) -> bool {
    file.game_versions.iter().any(|v| v == &instance.minecraft_version)
        && (kind != ModKind::Mod || {
            let loaders = file.loaders();
            instance.loader.modrinth_loaders().iter().any(|l| loaders.iter().any(|f| f == l))
        })
}

/// Neueste Datei laut Index, die zur Instanz passt; Release vor Beta und Alpha. Datei-Nummern wachsen mit der Zeit.
fn indexed_file(m: &CfMod, instance: &Instance) -> Option<u64> {
    loader_types(instance.loader).find_map(|t| {
        m.latest_files_indexes
            .iter()
            .filter(|i| i.game_version == instance.minecraft_version && i.mod_loader == Some(t))
            .min_by_key(|i| (i.release_type != RELEASE, Reverse(i.file_id)))
            .map(|i| i.file_id)
    })
}

/// CurseForge-Projekte, die schon in der Instanz stecken.
fn curseforge_projects(instance: &Instance) -> HashSet<u64> {
    instance
        .mods
        .iter()
        .filter_map(|m| match m.source {
            ModSource::CurseForge { project_id, .. } => Some(u64::from(project_id)),
            _ => None,
        })
        .collect()
}

fn no_matching_file(m: &CfMod) -> AppError {
    AppError::invalid(coded!("errors.providers.noMatchingVersion", name = m.name))
}

/// Wählt für die Projekte einer Ebene die Datei-Nummer aus dem Index. Dieselbe Mod, die schon von Modrinth stammt,
/// wird nicht noch einmal geholt.
fn pick_files(ids: &[u64], mut mods: HashMap<u64, CfMod>, instance: &Instance) -> AppResult<Vec<(CfMod, u64)>> {
    let installed: HashSet<String> = instance.mods.iter().map(|m| norm(&m.name)).collect();
    let mut picks = Vec::new();
    for id in ids {
        let m = mods.remove(id).ok_or_else(|| AppError::invalid(coded!("errors.providers.dependencyGone", id = id)))?;
        if installed.contains(&norm(&m.name)) {
            continue;
        }
        let file = indexed_file(&m, instance).ok_or_else(|| no_matching_file(&m))?;
        picks.push((m, file));
    }
    Ok(picks)
}

/// Ordnet den gewählten Projekten ihre Dateien zu; eine Datei, die doch nicht in der Instanz läuft, ist ein Fehler.
fn attach_files(picks: Vec<(CfMod, u64)>, mut files: HashMap<u64, CfFile>, instance: &Instance) -> AppResult<Vec<(CfMod, CfFile)>> {
    picks
        .into_iter()
        .map(|(m, file_id)| match files.remove(&file_id).filter(|f| runs(instance, ModKind::Mod, f)) {
            Some(f) => Ok((m, f)),
            None => Err(no_matching_file(&m)),
        })
        .collect()
}

/// Benötigte Abhängigkeiten Ebene für Ebene, mit je einer Sammelabfrage für Projekte und für Dateien. Einzeln (Projekt
/// plus Dateiliste je Mod) sprengten große Bäume das Minutenlimit des Workers.
async fn resolve_dependencies(client: &reqwest::Client, instance: &Instance, root: &CfFile) -> AppResult<Vec<(CfMod, CfFile)>> {
    let installed = curseforge_projects(instance);
    let mut seen = HashSet::from([root.mod_id]);
    let mut found = Vec::new();
    let mut level: Vec<u64> = root.required().collect();
    while !level.is_empty() {
        level.retain(|id| !installed.contains(id) && seen.insert(*id));
        if found.len() + level.len() > MAX_DEPENDENCIES {
            return Err(AppError::invalid(coded!("errors.providers.dependencyLimit")));
        }
        let picks = pick_files(&level, mods_by_id(client, &level).await?, instance)?;
        let file_ids: Vec<u64> = picks.iter().map(|(_, file_id)| *file_id).collect();
        let resolved = attach_files(picks, files_by_id(client, &file_ids).await?, instance)?;
        level = resolved.iter().flat_map(|(_, f)| f.required()).collect();
        found.extend(resolved);
    }
    Ok(found)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::ModLoader;
    use crate::services::providers::curseforge::dto::{
        fixtures::{file, instance, jei},
        Page,
    };
    use serde_json::json;

    /// Antwort von `POST /v1/mods` in der Form der API (gekürzt, ohne gespeicherte Katalogdaten).
    fn mods_response() -> HashMap<u64, CfMod> {
        let index = |mc: &str, file: u64, release: u8, loader: u8| json!({"gameVersion": mc, "fileId": file, "filename": "x.jar", "releaseType": release, "gameVersionTypeId": 1, "modLoader": loader});
        let page: Page<CfMod> = serde_json::from_value(json!({"data": [
            {"id": 10, "name": "Sodium", "classId": 6, "latestFilesIndexes": [
                index("1.20.1", 500, 1, 4), index("1.20.1", 600, 2, 4), index("1.20.1", 700, 1, 6), index("1.20.4", 800, 1, 4)
            ]},
            {"id": 20, "name": "Fabric API", "classId": 6, "latestFilesIndexes": [index("1.20.1", 300, 2, 4), index("1.20.1", 200, 3, 4)]}
        ], "pagination": {"totalCount": 2}}))
        .unwrap();
        page.data.into_iter().map(|m| (m.id, m)).collect()
    }

    #[test]
    fn a_dependency_level_picks_files_from_the_index() {
        let picks = pick_files(&[10, 20], mods_response(), &instance(ModLoader::Fabric, "1.20.1")).unwrap();
        // Release vor der neueren Beta; ohne Release die neueste Datei.
        assert_eq!(picks.iter().map(|(m, f)| (m.id, *f)).collect::<Vec<_>>(), [(10, 500), (20, 300)]);
        // Quilt nimmt Fabric-Dateien, NeoForge nur die eigenen.
        assert_eq!(pick_files(&[10], mods_response(), &instance(ModLoader::Quilt, "1.20.1")).unwrap()[0].1, 500);
        assert_eq!(pick_files(&[10], mods_response(), &instance(ModLoader::NeoForge, "1.20.1")).unwrap()[0].1, 700);
        assert!(pick_files(&[20], mods_response(), &instance(ModLoader::Forge, "1.20.1")).is_err());
        assert!(pick_files(&[99], mods_response(), &instance(ModLoader::Fabric, "1.20.1")).is_err(), "fehlendes Projekt");
    }

    #[test]
    fn mods_already_installed_from_modrinth_are_skipped() {
        let mut instance = instance(ModLoader::Fabric, "1.20.1");
        instance.mods.push(Mod {
            id: "m".into(),
            name: "fabric-api".into(),
            version: "1".into(),
            source: ModSource::Local,
            file_name: "fabric-api.jar".into(),
            sha1: None,
            enabled: true,
            kind: ModKind::Mod,
            required_by: Vec::new(),
            pinned: false,
            pack_managed: false,
        });
        let picks = pick_files(&[10, 20], mods_response(), &instance).unwrap();
        assert_eq!(picks.iter().map(|(m, _)| m.id).collect::<Vec<_>>(), [10]);
    }

    #[test]
    fn picked_files_are_attached_and_checked() {
        let instance = instance(ModLoader::Fabric, "1.20.1");
        let picks = || pick_files(&[10, 20], mods_response(), &instance).unwrap();
        // Antwort von `POST /v1/mods/files` für die gewählten Nummern.
        let files = |sodium_mc: &str| -> HashMap<u64, CfFile> {
            [
                file(json!({"id": 500, "modId": 10, "gameVersions": ["Fabric", sodium_mc], "dependencies": [{"modId": 20, "relationType": 3}]})),
                file(json!({"id": 300, "modId": 20, "gameVersions": ["Fabric", "1.20.1"]})),
            ]
            .into_iter()
            .map(|f| (f.id, f))
            .collect()
        };
        let resolved = attach_files(picks(), files("1.20.1"), &instance).unwrap();
        assert_eq!(resolved.iter().map(|(m, f)| (m.id, f.id)).collect::<Vec<_>>(), [(10, 500), (20, 300)]);
        assert_eq!(resolved[0].1.required().collect::<Vec<_>>(), [20]);
        // Passt die Datei trotz Index nicht zur Instanz oder fehlt sie in der Antwort, wird nichts installiert.
        assert!(attach_files(picks(), files("1.19.2"), &instance).is_err());
        assert!(attach_files(picks(), HashMap::new(), &instance).is_err());
    }

    #[test]
    fn instance_compatibility_follows_minecraft_and_loader() {
        let f = jei();
        assert!(runs(&instance(ModLoader::NeoForge, "26.3"), ModKind::Mod, &f));
        assert!(!runs(&instance(ModLoader::Fabric, "26.3"), ModKind::Mod, &f));
        assert!(!runs(&instance(ModLoader::NeoForge, "1.21.1"), ModKind::Mod, &f));
        // Ressourcenpakete brauchen keinen Loader.
        assert!(runs(&instance(ModLoader::Vanilla, "26.3"), ModKind::ResourcePack, &f));
        // Quilt lädt Fabric-Mods mit.
        let fabric = file(json!({"id": 1, "gameVersions": ["Fabric", "1.20.1"]}));
        assert!(runs(&instance(ModLoader::Quilt, "1.20.1"), ModKind::Mod, &fabric));
    }

    #[test]
    fn the_same_mod_is_recognised_across_platforms() {
        assert_eq!(norm("Fabric API"), norm("fabric-api"));
        assert_ne!(norm("Sodium"), norm("Sodium Extra"));
    }

    #[test]
    fn recorded_numbers_must_fit_the_instance_format() {
        let planned = |project: u64, file_id: u64| {
            let project = serde_json::from_value::<CfMod>(json!({"id": project, "name": "Sodium"})).unwrap();
            Planned { project, file: file(json!({"id": file_id, "modId": 10, "fileName": "s.jar"})), kind: ModKind::Mod }
        };
        let record = |planned: &Planned| planned.mod_entry("sha".into(), Vec::new(), &[]);

        let ok = record(&planned(10, 500)).unwrap();
        assert_eq!((ok.id.as_str(), ok.source), ("cf-10", ModSource::CurseForge { project_id: 10, file_id: 500 }));
        let too_large = u64::from(u32::MAX) + 1;
        assert!(record(&planned(too_large, 500)).is_err());
        assert!(record(&planned(10, too_large)).is_err());
    }

    /// Installation gegen die echte API in eine temporäre Instanz: eine Mod mit benötigter Abhängigkeit (Sodium Extra -> Sodium).
    /// `cargo test live_install_mod -- --ignored --nocapture`
    #[tokio::test]
    #[ignore = "braucht Netzwerk und den Worker"]
    async fn live_install_mod_with_dependencies() {
        use crate::{
            models::NewInstance,
            services::providers::{curseforge, ProjectType, SearchQuery, VersionFilter},
        };
        let client = modrinth::client().unwrap();
        let fabric_1_20_1 = SearchQuery {
            mc: Some("1.20.1".into()),
            loader: Some("fabric".into()),
            ..SearchQuery::of("sodium extra", ProjectType::Mod)
        };
        let hits = curseforge::search(&client, &fabric_1_20_1).await.unwrap();
        let extra = hits.hits.iter().find(|h| h.slug == "sodium-extra").expect("Sodium Extra fehlt");
        let filter = VersionFilter { mc: Some("1.20.1".into()), loader: Some("fabric".into()) };
        let v = curseforge::versions(&client, &extra.project_id, &filter).await.unwrap();
        let file = v.iter().find(|v| v.version_type == "release").unwrap_or(&v[0]);
        let root = std::env::temp_dir().join(new_id());
        let state = AppState::load(&root).unwrap();
        let instance = state
            .instances
            .insert(Instance::from_new(NewInstance { name: "Live".into(), minecraft_version: "1.20.1".into(), loader: ModLoader::Fabric, loader_version: None }))
            .unwrap();
        let done = install_mod(&state, &instance.id, &extra.project_id, &file.id, &|p, d, t| eprintln!("{p:?}: {d}/{t}")).await.unwrap();
        for m in &done.mods {
            eprintln!("{} {} ({}) von {:?} für {:?}", m.name, m.version, m.file_name, m.source, m.required_by);
        }
        assert!(done.mods.len() >= 2, "Abhängigkeit fehlt");
        assert!(done.mods[0].required_by.is_empty() && done.mods.iter().skip(1).all(|m| m.required_by == [format!("cf-{}", extra.project_id)]));
        for m in &done.mods {
            assert!(state.dirs.game_dir(&instance.id).join("mods").join(&m.file_name).is_file(), "{} fehlt auf der Platte", m.file_name);
        }
        // Zweites Mal: nichts doppelt.
        assert!(install_mod(&state, &instance.id, &extra.project_id, &file.id, &|_, _, _| {}).await.is_err());
        std::fs::remove_dir_all(root).unwrap();
    }
}
