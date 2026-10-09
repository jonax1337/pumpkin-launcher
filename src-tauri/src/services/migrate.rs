//! Minecraft-Version und Loader einer Instanz nachträglich ändern. Nur eine andere Loader-Version lässt die Inhalte,
//! wie sie sind. Bei neuer Minecraft-Version oder neuem Loader hebt die Update-Abfrage von Modrinth jeden
//! Modrinth-Inhalt auf eine passende Version; Mods ohne passende Version (auch eigene Dateien, die sich nicht prüfen
//! lassen) werden ausgeschaltet, fehlende Pflicht-Abhängigkeiten kommen dazu. Vorher werden alle Welten gesichert.
//! Pack-Instanzen und ältere Minecraft-Versionen mit Welten gehen nur als Kopie („Duplizieren und migrieren“):
//! das Original bleibt unberührt.
use std::{
    collections::{HashMap, HashSet},
    future::Future,
};

use serde::{Deserialize, Serialize};

use crate::{
    coded,
    error::{AppError, AppResult},
    models::{Instance, Mod, ModKind, ModLoader, ModSource},
    services::{
        blocking,
        content::{project_of, UpdatePlan},
        download, duplicate, forge,
        limits::PLAN_LIMIT,
        loader,
        mod_profiles,
        modrinth::{self, Version},
        mods,
        mojang::{VersionEntry, VersionManifest, MANIFEST_URL},
        pack_update::backup_worlds,
        progress::{Phase, ProgressFn, SharedProgress},
        remove_logged, worlds,
    },
    state::AppState,
};

/// Neue Abhängigkeiten, die ein Wechsel höchstens hinzufügt.
const MAX_ADDED: usize = 32;
/// Runden der Abhängigkeitsklärung: jede fügt hinzu oder schaltet aus, irgendwann ist nichts mehr offen.
const MAX_ROUNDS: usize = 64;

/// Wohin die Instanz wechselt; ohne Loader-Version nimmt die nächste Installation die neueste stabile.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MigrationTarget {
    pub minecraft_version: String,
    pub loader: ModLoader,
    pub loader_version: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Outcome {
    Update,
    Add,
    Disable,
}

/// Was der Wechsel mit einem Inhalt tut; Unverändertes fehlt.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ModChange {
    /// ID des Eintrags, bei neuen Abhängigkeiten ihr Modrinth-Projekt.
    pub mod_id: String,
    pub name: String,
    pub outcome: Outcome,
    /// Neue Version bei `update` und `add`.
    pub version: Option<String>,
}

/// Vorschau eines Wechsels.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MigrationCheck {
    pub changes: Vec<ModChange>,
    /// Ältere Minecraft-Version als bisher.
    pub downgrade: bool,
    pub worlds: usize,
    /// Warum der Wechsel nur als Kopie geht; `None` = auch in dieser Instanz.
    pub blocked: Option<MigrationBlock>,
}

/// Grund, warum ein Wechsel die Instanz selbst nicht treffen darf; die Oberfläche übersetzt ihn.
#[derive(Debug, Clone, Copy, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum MigrationBlock {
    PackInstance,
    DowngradeWithWorlds,
}

impl MigrationBlock {
    fn into_error(self) -> AppError {
        AppError::invalid(match self {
            Self::PackInstance => coded!("errors.game.migrate.packInstance"),
            Self::DowngradeWithWorlds => coded!("errors.game.migrate.downgradeWithWorlds"),
        })
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MigrationOutcome {
    pub instance: Instance,
    pub changes: Vec<ModChange>,
    /// Welten, die vorher gesichert wurden (bei einer Kopie keine: das Original bleibt).
    pub world_backups: usize,
}

/// Prüft den Wechsel, ohne etwas zu ändern.
pub async fn check(state: &AppState, id: &str, target: &MigrationTarget) -> AppResult<MigrationCheck> {
    let instance = state.instances.get(id)?;
    let situation = Situation::assess(state, &instance, target).await?;
    let plan = plan(&modrinth::client()?, &instance, target).await?;
    Ok(MigrationCheck {
        changes: plan.changes(&instance.mods),
        downgrade: situation.downgrade,
        worlds: situation.worlds,
        blocked: situation.blocker(&instance, target),
    })
}

/// Wechselt die Instanz selbst, nachdem ihre Welten gesichert sind.
pub async fn migrate(state: &AppState, id: &str, target: &MigrationTarget, progress: SharedProgress) -> AppResult<MigrationOutcome> {
    let instance = state.instances.get(id)?;
    if let Some(block) = Situation::assess(state, &instance, target).await?.blocker(&instance, target) {
        return Err(block.into_error());
    }
    progress(Phase::Resolve, 0, 1);
    let plan = plan(&modrinth::client()?, &instance, target).await?;
    let world_backups = if changes_game(&instance, target) { backup_worlds(state, id, progress.clone()).await? } else { 0 };
    let changes = plan.changes(&instance.mods);
    let instance = finish(state, &instance, target, &plan, &*progress).await?;
    tracing::info!(instance = %id, mc = %instance.minecraft_version, loader = ?instance.loader, "Instanz migriert");
    Ok(MigrationOutcome { instance, changes, world_backups })
}

/// Legt eine Kopie an und wechselt nur sie; scheitert der Wechsel, verschwindet die Kopie wieder.
pub async fn duplicate_and_migrate(
    state: &AppState,
    id: &str,
    target: &MigrationTarget,
    progress: SharedProgress,
) -> AppResult<MigrationOutcome> {
    let original = state.instances.get(id)?;
    Situation::assess(state, &original, target).await?;
    progress(Phase::Resolve, 0, 1);
    let plan = plan(&modrinth::client()?, &original, target).await?;
    let copy = duplicate::duplicate(state, id, progress.clone()).await?;
    let unfinished = UnfinishedCopy { state, id: Some(copy.id.clone()) };
    let instance = finish(state, &copy, target, &plan, &*progress).await?;
    unfinished.keep();
    tracing::info!(original = %id, copy = %instance.id, mc = %instance.minecraft_version, "Kopie migriert");
    Ok(MigrationOutcome { instance, changes: plan.changes(&original.mods), world_backups: 0 })
}

/// Entfernt die Kopie samt Ordner, solange ihr Wechsel nicht gelungen ist: bei einem Fehler und beim Abbruch.
struct UnfinishedCopy<'a> {
    state: &'a AppState,
    id: Option<String>,
}

impl UnfinishedCopy<'_> {
    fn keep(mut self) {
        self.id = None;
    }
}

impl Drop for UnfinishedCopy<'_> {
    fn drop(&mut self) {
        let Some(id) = self.id.take() else { return };
        if let Err(err) = self.state.instances.remove(&id) {
            tracing::warn!(instance = %id, %err, "Halbe Kopie nicht aus der Liste entfernt");
        }
        remove_logged(&self.state.dirs.instance(&id));
    }
}

/// Ändern sich Minecraft-Version oder Loader (nicht nur die Loader-Version)?
fn changes_game(instance: &Instance, target: &MigrationTarget) -> bool {
    instance.minecraft_version != target.minecraft_version || instance.loader != target.loader
}

/// Was über den Wechsel feststeht, bevor Inhalte geprüft werden.
struct Situation {
    downgrade: bool,
    worlds: usize,
}

impl Situation {
    /// Prüft das Ziel (bekannte Minecraft-Version, Loader dafür verfügbar) und sieht nach, was auf dem Spiel steht.
    async fn assess(state: &AppState, instance: &Instance, target: &MigrationTarget) -> AppResult<Self> {
        modrinth::identifier(&target.minecraft_version)?;
        forge::check_loader(target.loader, &target.minecraft_version)?;
        let manifest: VersionManifest = download::get_json(&state.http, MANIFEST_URL).await?;
        let downgrade = is_downgrade(&manifest.versions, &instance.minecraft_version, &target.minecraft_version)?;
        ensure_loader(&loader::versions(&state.http, target.loader, &target.minecraft_version).await?, target)?;
        let (dirs, id) = (state.dirs.clone(), instance.id.clone());
        let worlds = blocking(move |_| worlds::list(&dirs, &id)).await?.len();
        Ok(Self { downgrade, worlds })
    }

    /// Warum der Wechsel diese Instanz nicht selbst treffen darf.
    fn blocker(&self, instance: &Instance, target: &MigrationTarget) -> Option<MigrationBlock> {
        if !changes_game(instance, target) {
            return None;
        }
        if instance.modpack.is_some() {
            return Some(MigrationBlock::PackInstance);
        }
        (self.downgrade && self.worlds > 0).then_some(MigrationBlock::DowngradeWithWorlds)
    }
}

/// Liegt `to` vor `from`? Mojangs Liste ist neueste zuerst; eine unbekannte Zielversion ist ein Fehler.
fn is_downgrade(versions: &[VersionEntry], from: &str, to: &str) -> AppResult<bool> {
    let position = |id: &str| versions.iter().position(|v| v.id == id);
    let to_at = position(to).ok_or_else(|| AppError::invalid(coded!("errors.game.unknownMinecraftVersion", version = to)))?;
    Ok(position(from).is_some_and(|from_at| to_at > from_at))
}

/// Einen Mod-Loader muss es für die Zielversion geben, eine gewählte Loader-Version auch.
fn ensure_loader(available: &[loader::LoaderVersion], target: &MigrationTarget) -> AppResult<()> {
    let name = target.loader.display_name();
    match &target.loader_version {
        Some(wanted) if target.loader == ModLoader::Vanilla => {
            Err(AppError::invalid(coded!("errors.game.vanillaNoLoaderVersion", version = wanted)))
        }
        Some(wanted) if !available.iter().any(|v| &v.version == wanted) => {
            Err(AppError::invalid(coded!(
                "errors.game.loaderVersionUnavailable",
                loader = name,
                version = wanted,
                mc = target.minecraft_version
            )))
        }
        None if target.loader != ModLoader::Vanilla && available.is_empty() => {
            Err(AppError::invalid(coded!("errors.game.loaderUnavailable", mc = target.minecraft_version, loader = name)))
        }
        _ => Ok(()),
    }
}

/// Was mit einem Eintrag der Instanz passiert.
#[derive(Debug, Clone)]
enum Planned {
    /// Bleibt, wie er ist; bei Modrinth-Inhalten mit ihrer (passenden) Version.
    Keep(Option<Version>),
    Update(Version),
    Disable,
}

/// Der Wechsel je Eintrag (gleiche Reihenfolge wie `instance.mods`) und die neuen Abhängigkeiten.
#[derive(Debug)]
struct Plan {
    entries: Vec<Planned>,
    added: Vec<Version>,
}

/// Plant den Wechsel; ohne neue Minecraft-Version und ohne neuen Loader bleibt jeder Inhalt.
async fn plan(client: &reqwest::Client, instance: &Instance, target: &MigrationTarget) -> AppResult<Plan> {
    if !changes_game(instance, target) {
        return Ok(Plan { entries: vec![Planned::Keep(None); instance.mods.len()], added: Vec::new() });
    }
    let latest = latest_versions(client, &instance.mods, target).await?;
    let mut plan = Plan::from_latest(&instance.mods, &latest);
    plan.complete_dependencies(&instance.mods, |project| runnable_version(client, project, target)).await?;
    Ok(plan)
}

/// Neueste Release-Version je SHA-1 der Modrinth-Inhalte für das Ziel. Mods ohne Loader (Vanilla) fragen nicht.
async fn latest_versions(client: &reqwest::Client, mods: &[Mod], target: &MigrationTarget) -> AppResult<HashMap<String, Version>> {
    let mut found = HashMap::new();
    for kind in ModKind::ALL {
        let loaders = kind.update_loaders(target.loader);
        if loaders.is_empty() {
            continue;
        }
        let hashes: Vec<String> = mods
            .iter()
            .filter(|m| m.kind == kind && project_of(m).is_some())
            .filter_map(|m| m.sha1.as_ref().map(|h| h.to_ascii_lowercase()))
            .collect();
        found.extend(modrinth::latest_by_hash(client, &hashes, loaders, &target.minecraft_version).await?);
    }
    Ok(found)
}

/// Neueste Version des Projekts, die mit dem Ziel läuft; ein Release vor Betas.
async fn runnable_version(client: &reqwest::Client, project: String, target: &MigrationTarget) -> AppResult<Option<Version>> {
    let all = modrinth::versions(client, &project, Some(&target.minecraft_version), None).await?;
    let runs = |v: &&Version| target.loader.runs(&v.loaders);
    let release = all.iter().filter(runs).find(|v| v.version_type == "release");
    Ok(release.or_else(|| all.iter().find(runs)).cloned())
}

impl Plan {
    /// Modrinth-Inhalte mit passender Version bleiben oder werden aktualisiert; Mods ohne passende Version und
    /// Mods, die sich nicht prüfen lassen, gehen aus. Ressourcenpakete und Shader ohne Treffer bleiben.
    fn from_latest(mods: &[Mod], latest: &HashMap<String, Version>) -> Self {
        let entries = mods
            .iter()
            .map(|m| {
                let found = m.sha1.as_ref().and_then(|h| latest.get(&h.to_ascii_lowercase()));
                match (&m.source, found) {
                    (ModSource::Modrinth { project_id, version_id }, Some(v)) if &v.project_id == project_id => {
                        if &v.id == version_id { Planned::Keep(Some(v.clone())) } else { Planned::Update(v.clone()) }
                    }
                    _ if m.kind == ModKind::Mod => Planned::Disable,
                    _ => Planned::Keep(None),
                }
            })
            .collect();
        Self { entries, added: Vec::new() }
    }

    /// Modrinth-Versionen aller Mods, die nach dem Wechsel laufen.
    fn active<'a>(&'a self, mods: &'a [Mod]) -> Vec<&'a Version> {
        let kept = self.entries.iter().zip(mods).filter_map(|(planned, m)| match planned {
            Planned::Keep(Some(v)) | Planned::Update(v) if m.enabled && m.kind == ModKind::Mod => Some(v),
            _ => None,
        });
        kept.chain(&self.added).collect()
    }

    /// (Projekt, fehlendes Pflicht-Projekt) für jede Abhängigkeit, die nach dem Wechsel fehlt.
    /// ponytail: Abhängigkeiten ohne `project_id` (nur `version_id`) werden nicht erkannt.
    fn missing_dependencies(&self, mods: &[Mod]) -> Vec<(String, String)> {
        let active = self.active(mods);
        let present: HashSet<&str> = active.iter().map(|v| v.project_id.as_str()).collect();
        active
            .iter()
            .flat_map(|v| {
                v.dependencies
                    .iter()
                    .filter(|d| d.dependency_type == "required")
                    .filter_map(|d| d.project_id.clone())
                    .filter(|p| !present.contains(p.as_str()))
                    .map(|p| (v.project_id.clone(), p))
            })
            .collect()
    }

    /// Ergänzt fehlende Pflicht-Abhängigkeiten über `find`; was sich nicht finden lässt (oder als Eintrag schon
    /// da, aber aus ist), schaltet die Mods aus, die es brauchen. Das kann weitere treffen, daher in Runden.
    async fn complete_dependencies<F, Fut>(&mut self, mods: &[Mod], find: F) -> AppResult<()>
    where
        F: Fn(String) -> Fut,
        Fut: Future<Output = AppResult<Option<Version>>>,
    {
        let mut unavailable: HashSet<String> = HashSet::new();
        for _ in 0..MAX_ROUNDS {
            let missing = self.missing_dependencies(mods);
            if missing.is_empty() {
                return Ok(());
            }
            let mut wanted: Vec<String> = missing.iter().map(|(_, dep)| dep.clone()).collect();
            wanted.sort();
            wanted.dedup();
            wanted.retain(|dep| !unavailable.contains(dep));
            for dep in wanted {
                let listed = mods.iter().any(|m| project_of(m) == Some(&dep));
                let found = if listed || self.added.len() >= MAX_ADDED { None } else { find(dep.clone()).await? };
                match found.filter(|v| v.project_id == dep) {
                    Some(v) => self.added.push(v),
                    None => {
                        unavailable.insert(dep);
                    }
                }
            }
            for (owner, dep) in &missing {
                if unavailable.contains(dep) {
                    self.drop_project(owner, mods);
                }
            }
        }
        Err(AppError::invalid(coded!("errors.game.modDependenciesUnresolved")))
    }

    fn drop_project(&mut self, project: &str, mods: &[Mod]) {
        for (planned, m) in self.entries.iter_mut().zip(mods) {
            if project_of(m).is_some_and(|p| p == project) {
                *planned = Planned::Disable;
            }
        }
        self.added.retain(|v| v.project_id != project);
    }

    /// Projekte der laufenden Mods, die `project` brauchen.
    fn owners_of(&self, project: &str, mods: &[Mod]) -> Vec<String> {
        let mut owners: Vec<String> = self
            .active(mods)
            .into_iter()
            .filter(|v| v.dependencies.iter().any(|d| d.dependency_type == "required" && d.project_id.as_deref() == Some(project)))
            .map(|v| v.project_id.clone())
            .collect();
        owners.sort();
        owners.dedup();
        owners
    }

    fn changes(&self, mods: &[Mod]) -> Vec<ModChange> {
        let entries = self.entries.iter().zip(mods).filter_map(|(planned, m)| {
            let change = |outcome, version| ModChange { mod_id: m.id.clone(), name: m.name.clone(), outcome, version };
            match planned {
                Planned::Update(v) => Some(change(Outcome::Update, Some(v.version_number.clone()))),
                Planned::Disable if m.enabled => Some(change(Outcome::Disable, None)),
                _ => None,
            }
        });
        let added = self.added.iter().map(|v| ModChange {
            mod_id: v.project_id.clone(),
            name: v.name.clone(),
            outcome: Outcome::Add,
            version: Some(v.version_number.clone()),
        });
        entries.chain(added).collect()
    }
}

/// Lädt die neuen Dateien und speichert Inhaltsliste, Minecraft-Version und Loader; `sync` legt dabei ab und räumt
/// weg, und scheitert das Speichern, ist alles wie vorher. Eine Instanz mit neuem Spiel gehört zu keinem Pack mehr, und
/// ihre Profile der Inhalte beschreiben das alte Spiel.
async fn finish(
    state: &AppState,
    instance: &Instance,
    target: &MigrationTarget,
    plan: &Plan,
    progress: ProgressFn<'_>,
) -> AppResult<Instance> {
    let mut rebuild = rebuild(plan, &instance.mods)?;
    ensure_download_size(&rebuild)?;
    rebuild.download(&state.dirs, progress).await?;
    let UpdatePlan { mods, replaced, .. } = rebuild;
    let desired: Vec<Mod> = mods.iter().cloned().chain(replaced).collect();
    let game_changed = changes_game(instance, target);
    mods::sync_commit(&state.dirs, &instance.id, &desired, |_| {
        state.instances.modify(&instance.id, |i| {
            i.minecraft_version = target.minecraft_version.clone();
            i.loader = target.loader;
            i.loader_version = target.loader_version.clone();
            i.mods = mods;
            if game_changed {
                mod_profiles::forget_all(i);
            }
            if game_changed && i.modpack.take().is_some() {
                i.mods.iter_mut().for_each(|m| m.pack_managed = false);
            }
        })
    })
}

/// Die neue Inhaltsliste: aktualisierte Einträge mit neuer Datei, ausgeschaltete aus, neue Abhängigkeiten dazu. Die
/// alten Einträge aktualisierter Inhalte stehen ausgeschaltet daneben, damit `sync` ihre Dateien wegräumt.
fn rebuild(plan: &Plan, old: &[Mod]) -> AppResult<UpdatePlan> {
    let mut rebuild = UpdatePlan::new(old);
    for (i, planned) in plan.entries.iter().enumerate() {
        match planned {
            Planned::Update(v) => rebuild.update(i, v)?,
            Planned::Disable => rebuild.mods[i].enabled = false,
            Planned::Keep(_) => {}
        }
    }
    for v in &plan.added {
        rebuild.add(v, plan.owners_of(&v.project_id, old))?;
    }
    Ok(rebuild)
}

fn ensure_download_size(rebuild: &UpdatePlan) -> AppResult<()> {
    let size = rebuild.downloads.iter().try_fold(0u64, |sum, (_, f)| sum.checked_add(f.size));
    if size.is_none_or(|total| total > PLAN_LIMIT) {
        return Err(AppError::invalid(coded!("errors.game.modUpdatesTooBig")));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{
        models::{new_id, ModpackOrigin, NewInstance},
        services::content::fixtures::{graph, modrinth_mod},
    };

    fn target(mc: &str, loader: ModLoader) -> MigrationTarget {
        MigrationTarget { minecraft_version: mc.into(), loader, loader_version: None }
    }

    fn instance(mods: Vec<Mod>) -> Instance {
        let new = NewInstance { name: "Alt".into(), minecraft_version: "1.21.1".into(), loader: ModLoader::Fabric, loader_version: None };
        Instance { mods, ..Instance::from_new(new) }
    }

    /// Modrinth-Mod `project` mit eigenem SHA-1.
    fn installed(project: &str) -> Mod {
        Mod { sha1: Some(format!("{project:0>40}")), ..modrinth_mod(project, &[]) }
    }

    fn version(project: &str, id: &str, deps: &[&str]) -> Version {
        Version { id: id.into(), ..graph(&[(project, deps)]).remove(project).unwrap() }
    }

    fn outcomes(changes: &[ModChange]) -> Vec<(&str, Outcome)> {
        changes.iter().map(|c| (c.mod_id.as_str(), c.outcome)).collect()
    }

    #[test]
    fn content_is_lifted_kept_or_switched_off() {
        let own = Mod { source: ModSource::Local, ..installed("own") };
        let pack = Mod { kind: ModKind::ResourcePack, file_name: "pack.zip".into(), ..installed("pack") };
        let off = Mod { enabled: false, ..installed("off") };
        let mods = vec![installed("sodium"), installed("lithium"), installed("gone"), own, pack, off];
        let latest = HashMap::from([
            (format!("{:0>40}", "sodium"), version("sodium", "sodium2", &[])),
            (format!("{:0>40}", "lithium"), version("lithium", "lithium1", &[])),
        ]);

        let plan = Plan::from_latest(&mods, &latest);

        assert!(matches!(&plan.entries[0], Planned::Update(v) if v.id == "sodium2"));
        assert!(matches!(&plan.entries[1], Planned::Keep(Some(v)) if v.id == "lithium1"));
        assert!(matches!(plan.entries[2], Planned::Disable));
        assert!(matches!(plan.entries[3], Planned::Disable), "eigene Mods lassen sich nicht prüfen");
        assert!(matches!(plan.entries[4], Planned::Keep(None)), "Ressourcenpakete laufen weiter");
        // Schon ausgeschaltete Mods tauchen in der Liste der Änderungen nicht auf.
        let changes = plan.changes(&mods);
        assert_eq!(outcomes(&changes), [("sodium", Outcome::Update), ("gone", Outcome::Disable), ("own", Outcome::Disable)]);
    }

    #[tokio::test]
    async fn missing_dependencies_are_added_or_switch_their_mods_off() {
        // a braucht lib (findbar), b braucht weg (nicht findbar), c braucht b und fällt mit ihm.
        let mods = vec![installed("a"), installed("b"), installed("c")];
        let mut plan = Plan {
            entries: vec![
                Planned::Update(version("a", "a2", &["lib"])),
                Planned::Keep(Some(version("b", "b1", &["weg"]))),
                Planned::Keep(Some(version("c", "c1", &["b"]))),
            ],
            added: Vec::new(),
        };
        let asked = std::sync::Mutex::new(Vec::new());
        let find = |project: String| {
            asked.lock().unwrap().push(project.clone());
            let found = (project == "lib").then(|| version("lib", "lib1", &[]));
            async move { Ok(found) }
        };

        plan.complete_dependencies(&mods, find).await.unwrap();

        let changes = plan.changes(&mods);
        let expected = [("a", Outcome::Update), ("b", Outcome::Disable), ("c", Outcome::Disable), ("lib", Outcome::Add)];
        assert_eq!(outcomes(&changes), expected);
        assert_eq!(plan.owners_of("lib", &mods), ["a"]);
        assert_eq!(*asked.lock().unwrap(), ["lib", "weg"], "jedes Projekt wird einmal gesucht");
    }

    #[tokio::test]
    async fn a_dependency_the_player_switched_off_is_not_added_twice() {
        let mods = vec![installed("a"), Mod { enabled: false, ..installed("lib") }];
        let entries = vec![Planned::Keep(Some(version("a", "a1", &["lib"]))), Planned::Keep(None)];
        let mut plan = Plan { entries, added: Vec::new() };

        plan.complete_dependencies(&mods, |_| async { Ok(Some(version("lib", "lib1", &[]))) }).await.unwrap();

        assert!(plan.added.is_empty());
        assert!(matches!(plan.entries[0], Planned::Disable));
    }

    #[test]
    fn downgrades_follow_mojangs_order() {
        let entry = |id: &str| VersionEntry {
            id: id.into(),
            kind: "release".into(),
            url: String::new(),
            sha1: String::new(),
            release_time: String::new(),
        };
        let versions = ["1.21.4", "1.21.1", "1.20.1"].map(entry);

        assert!(is_downgrade(&versions, "1.21.4", "1.20.1").unwrap());
        assert!(!is_downgrade(&versions, "1.20.1", "1.21.4").unwrap());
        assert!(!is_downgrade(&versions, "uralt", "1.21.1").unwrap());
        assert!(is_downgrade(&versions, "1.21.1", "2.0").is_err());
    }

    #[test]
    fn the_loader_has_to_exist_for_the_target() {
        let available = [loader::LoaderVersion { version: "0.16.10".into(), stable: true }];
        let with = |loader, version: Option<&str>| MigrationTarget {
            loader_version: version.map(Into::into),
            ..target("1.21.4", loader)
        };

        assert!(ensure_loader(&available, &with(ModLoader::Fabric, Some("0.16.10"))).is_ok());
        assert!(ensure_loader(&available, &with(ModLoader::Fabric, None)).is_ok());
        assert!(ensure_loader(&available, &with(ModLoader::Fabric, Some("0.1"))).is_err());
        assert!(ensure_loader(&[], &with(ModLoader::Fabric, None)).is_err());
        assert!(ensure_loader(&[], &with(ModLoader::Vanilla, None)).is_ok());
        assert!(ensure_loader(&[], &with(ModLoader::Vanilla, Some("1"))).is_err());
    }

    #[test]
    fn pack_instances_and_downgrades_with_worlds_only_change_as_a_copy() {
        let plain = instance(Vec::new());
        let origin = ModpackOrigin::Modrinth { project_id: "p".into(), version_id: "v".into() };
        let pack = Instance { modpack: Some(origin), ..plain.clone() };
        let newer = Situation { downgrade: false, worlds: 2 };
        let older = Situation { downgrade: true, worlds: 2 };
        let same_game = MigrationTarget { loader_version: Some("0.16.10".into()), ..target("1.21.1", ModLoader::Fabric) };

        assert!(newer.blocker(&plain, &target("1.21.4", ModLoader::Fabric)).is_none());
        assert_eq!(newer.blocker(&pack, &target("1.21.4", ModLoader::Fabric)), Some(MigrationBlock::PackInstance));
        assert!(newer.blocker(&pack, &same_game).is_none(), "die Loader-Version darf auch ein Pack wechseln");
        assert_eq!(older.blocker(&plain, &target("1.20.1", ModLoader::Fabric)), Some(MigrationBlock::DowngradeWithWorlds));
        assert!(Situation { downgrade: true, worlds: 0 }.blocker(&plain, &target("1.20.1", ModLoader::Fabric)).is_none());
    }

    #[test]
    fn an_unfinished_copy_disappears_and_a_finished_one_stays() {
        let root = std::env::temp_dir().join(new_id());
        let state = AppState::load(&root).unwrap();
        let copy = |state: &AppState| {
            let id = state.instances.insert(instance(Vec::new())).unwrap().id;
            std::fs::create_dir_all(state.dirs.game_dir(&id)).unwrap();
            id
        };
        let (dropped, kept) = (copy(&state), copy(&state));

        drop(UnfinishedCopy { state: &state, id: Some(dropped.clone()) });
        UnfinishedCopy { state: &state, id: Some(kept.clone()) }.keep();

        assert!(state.instances.get(&dropped).is_err() && !state.dirs.instance(&dropped).exists());
        assert!(state.instances.get(&kept).is_ok() && state.dirs.instance(&kept).exists());
        std::fs::remove_dir_all(root).unwrap();
    }

    #[tokio::test]
    async fn switched_off_mods_leave_the_folder_and_the_instance_takes_the_new_game() {
        let root = std::env::temp_dir().join(new_id());
        let state = AppState::load(&root).unwrap();
        let cached = |name: &str| Mod { sha1: Some(mods::cache_bytes(&state.dirs, name.as_bytes()).unwrap()), ..installed(name) };
        let origin = ModpackOrigin::Modrinth { project_id: "p".into(), version_id: "v".into() };
        let old = Instance { modpack: Some(origin), ..instance(vec![cached("bleibt"), cached("geht")]) };
        let old = state.instances.insert(old).unwrap();
        mods::sync(&state.dirs, &old.id, &old.mods).unwrap();
        let plan = Plan { entries: vec![Planned::Keep(None), Planned::Disable], added: Vec::new() };

        let moved = finish(&state, &old, &target("1.21.4", ModLoader::Quilt), &plan, &|_, _, _| {}).await.unwrap();

        let mods_dir = state.dirs.mods_dir(&old.id);
        assert!(mods_dir.join("bleibt.jar").exists() && !mods_dir.join("geht.jar").exists());
        assert_eq!((moved.minecraft_version.as_str(), moved.loader, moved.modpack.as_ref()), ("1.21.4", ModLoader::Quilt, None));
        assert_eq!(moved.mods.iter().map(|m| m.enabled).collect::<Vec<_>>(), [true, false]);
        assert_eq!(state.instances.get(&old.id).unwrap(), moved);
        std::fs::remove_dir_all(root).unwrap();
    }
}

