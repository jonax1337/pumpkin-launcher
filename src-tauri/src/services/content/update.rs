//! Updates von Modrinth-Inhalten: finden, was es Neueres gibt, ohne Downgrades und ohne festgelegte Abhängigkeiten
//! zu brechen, und die gewählten samt neuer Pflicht-Abhängigkeiten in einem Zug ablegen.
use std::collections::{HashMap, HashSet};

use futures::StreamExt;
use serde::Serialize;

use super::{
    commit_mods, ensure_known,
    install::{budget, mark_dependencies},
    mod_from_version, project_of,
};
use crate::{
    coded,
    error::{AppError, AppResult},
    models::{Instance, Mod, ModKind, ModSource},
    services::{
        limits::DOWNLOAD_CONCURRENCY,
        modrinth::{self, File, Version},
        mods,
        progress::{Phase, ProgressFn},
        Dirs,
    },
    state::AppState,
};

/// Ein verfügbares Update, so wie das Frontend es listet.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ModUpdate {
    mod_id: String,
    current_version: String,
    version_id: String,
    version_number: String,
}

impl ModUpdate {
    fn new(installed: &Mod, newer: Version) -> Self {
        Self {
            mod_id: installed.id.clone(),
            current_version: installed.version.clone(),
            version_id: newer.id,
            version_number: newer.version_number,
        }
    }
}

/// Updates der Modrinth-Inhalte der Instanz.
pub async fn check_updates(client: &reqwest::Client, instance: &Instance) -> AppResult<Vec<ModUpdate>> {
    let found = find_updates(client, instance).await?;
    Ok(found.into_iter().map(|(i, newer)| ModUpdate::new(&instance.mods[i], newer)).collect())
}

/// Updates der Modrinth-Inhalte als (Index in `instance.mods`, neue Version). Festgehaltene (`Mod::pinned`) prüft
/// niemand; ihre Versionen zählen nur als installierter Stand (nicht zu verwechseln mit `drop_pinned`: dort legt eine
/// andere Mod eine Version fest).
async fn find_updates(client: &reqwest::Client, instance: &Instance) -> AppResult<Vec<(usize, Version)>> {
    let mut found = Vec::new();
    for kind in ModKind::ALL {
        let hashes = hashes_of(&instance.mods, |m| m.kind == kind && !m.pinned);
        let loaders = kind.update_loaders(instance.loader);
        let latest = modrinth::latest_by_hash(client, &hashes, loaders, &instance.minecraft_version).await?;
        found.extend(
            candidate_updates(&instance.mods, &latest, &instance.minecraft_version)
                .into_iter()
                .filter(|(i, _)| instance.mods[*i].kind == kind),
        );
    }
    if found.is_empty() {
        return Ok(found);
    }
    let installed = modrinth::versions_by_hash(client, &hashes_of(&instance.mods, |m| m.enabled)).await?;
    let found = drop_older(found, &instance.mods, &installed);
    Ok(drop_pinned(found, &instance.mods, &installed))
}

/// Kleingeschriebene SHA-1 der Modrinth-Einträge, auf die `pred` zutrifft.
fn hashes_of(mods: &[Mod], pred: impl Fn(&Mod) -> bool) -> Vec<String> {
    mods.iter()
        .filter(|m| pred(m) && project_of(m).is_some())
        .filter_map(|m| m.sha1.as_ref().map(|h| h.to_ascii_lowercase()))
        .collect()
}

/// Version zur Datei von `m` in einer Antwort, deren Schlüssel kleingeschriebene SHA-1 sind.
fn by_hash<'v>(m: &Mod, versions: &'v HashMap<String, Version>) -> Option<&'v Version> {
    versions.get(&m.sha1.as_ref()?.to_ascii_lowercase())
}

/// Index in `mods` samt der anderen Version aus einer `version_files/update`-Antwort; ob sie wirklich neuer ist,
/// entscheidet `drop_older`, sobald die installierten Versionen bekannt sind.
fn candidate_updates(mods: &[Mod], latest: &HashMap<String, Version>, mc: &str) -> Vec<(usize, Version)> {
    mods.iter()
        .enumerate()
        .filter(|(_, m)| !m.pinned)
        .filter_map(|(i, m)| {
            let ModSource::Modrinth { project_id, version_id } = &m.source else {
                return None;
            };
            let v = by_hash(m, latest)?;
            (&v.project_id == project_id && &v.id != version_id && v.game_versions.iter().any(|g| g == mc))
                .then(|| (i, v.clone()))
        })
        .collect()
}

/// Das neueste Release kann älter sein als eine installierte Beta oder Alpha (in Packs üblich): keine Downgrades.
fn drop_older(mut found: Vec<(usize, Version)>, mods: &[Mod], installed: &HashMap<String, Version>) -> Vec<(usize, Version)> {
    found.retain(|(i, v)| {
        by_hash(&mods[*i], installed).is_none_or(|now| now.date_published.is_empty() || v.date_published > now.date_published)
    });
    found
}

/// `owner` verlangt das Projekt von `target` in genau einer anderen Version als `target`.
fn pins_other(owner: &Version, target: &Version) -> bool {
    owner.project_id != target.project_id
        && owner.dependencies.iter().any(|d| {
            d.dependency_type == "required"
                && d.project_id.as_ref() == Some(&target.project_id)
                && d.version_id.as_ref().is_some_and(|id| id != &target.id)
        })
}

/// Verwirft Updates, an denen die Auflösung wegen einer exakt festgelegten Version scheitern würde, in beide
/// Richtungen gegen den geplanten Stand (aktualisierte Versionen schlagen installierte). Wiederholt, bis nichts mehr
/// wegfällt, denn ein verworfenes Update kann ein anderes ungültig machen.
/// ponytail: Festlegungen ohne `project_id` (nur `version_id`) werden nicht erkannt.
fn drop_pinned(mut found: Vec<(usize, Version)>, mods: &[Mod], installed: &HashMap<String, Version>) -> Vec<(usize, Version)> {
    loop {
        let mut planned: HashMap<&str, &Version> = mods
            .iter()
            .filter(|m| m.enabled)
            .filter_map(|m| by_hash(m, installed))
            .map(|v| (v.project_id.as_str(), v))
            .collect();
        for (_, v) in &found {
            planned.insert(&v.project_id, v);
        }
        let clashing: Vec<String> = found
            .iter()
            .filter(|(_, v)| planned.values().any(|p| pins_other(p, v) || pins_other(v, p)))
            .map(|(_, v)| v.id.clone())
            .collect();
        if clashing.is_empty() {
            return found;
        }
        found.retain(|(_, v)| !clashing.contains(&v.id));
    }
}

/// Aktualisiert die Einträge `mod_ids` der Instanz `id`, für die es ein Update gibt, samt neuer Pflicht-Abhängigkeiten.
pub async fn update_mods(state: &AppState, id: &str, mod_ids: &[String], progress: ProgressFn<'_>) -> AppResult<Instance> {
    let instance = state.instances.get(id)?;
    ensure_known(&instance, mod_ids)?;
    let client = modrinth::client()?;
    progress(Phase::Resolve, 0, 1);
    let updates: Vec<_> = find_updates(&client, &instance)
        .await?
        .into_iter()
        .filter(|(i, _)| mod_ids.contains(&instance.mods[*i].id))
        .collect();
    apply_versions(state, &client, &instance, updates, progress).await
}

/// Setzt den Eintrag `mod_id` der Instanz `id` auf die Modrinth-Version `version_id`, neuer oder älter, samt neuer
/// Pflicht-Abhängigkeiten. Ein festgehaltener Eintrag bleibt festgehalten, jetzt auf der gewählten Version.
pub async fn switch_version(
    state: &AppState,
    id: &str,
    mod_id: &str,
    version_id: &str,
    progress: ProgressFn<'_>,
) -> AppResult<Instance> {
    let instance = state.instances.get(id)?;
    let client = modrinth::client()?;
    progress(Phase::Resolve, 0, 1);
    let version = modrinth::version(&client, version_id).await?;
    let i = switch_target(&instance, mod_id, &version)?;
    apply_versions(state, &client, &instance, vec![(i, version)], progress).await
}

/// Index des Eintrags `mod_id`, wenn er auf `version` wechseln darf: gleiches Projekt, andere Version, passend zu
/// Minecraft-Version und Loader der Instanz.
fn switch_target(instance: &Instance, mod_id: &str, version: &Version) -> AppResult<usize> {
    let i = instance
        .mods
        .iter()
        .position(|m| m.id == mod_id)
        .ok_or_else(|| AppError::invalid(coded!("errors.modrinth.unknownMod")))?;
    let m = &instance.mods[i];
    let ModSource::Modrinth { project_id, version_id } = &m.source else {
        return Err(AppError::invalid(coded!("errors.modrinth.notFromModrinth")));
    };
    if &version.project_id != project_id {
        return Err(AppError::invalid(coded!("errors.modrinth.versionOfOtherProject")));
    }
    if &version.id == version_id {
        return Err(AppError::invalid(coded!("errors.modrinth.versionAlreadyInstalled")));
    }
    let loaders = m.kind.update_loaders(instance.loader);
    let fits = version.game_versions.iter().any(|g| g == &instance.minecraft_version)
        && version.loaders.iter().any(|l| loaders.contains(&l.as_str()));
    if !fits {
        return Err(AppError::invalid(coded!("errors.modrinth.versionDoesNotFitInstance")));
    }
    Ok(i)
}

/// Legt die Einträge `updates` (Index in `instance.mods`, neue Version) samt neuer Pflicht-Abhängigkeiten in einem Zug ab.
async fn apply_versions(
    state: &AppState,
    client: &reqwest::Client,
    instance: &Instance,
    updates: Vec<(usize, Version)>,
    progress: ProgressFn<'_>,
) -> AppResult<Instance> {
    let id = instance.id.as_str();
    let mut plan = UpdatePlan::new(&instance.mods);
    for (i, v) in &updates {
        plan.update(*i, v)?;
    }
    // Neue Pflicht-Abhängigkeiten aktiver Mods; jede andere aktive Mod bleibt festgelegt.
    if let Some(root) = plan.first_active_mod(&updates) {
        let planned = Instance { mods: plan.mods.clone(), ..instance.clone() };
        plan.add_dependencies(modrinth::resolve(client, &root.id, &planned).await?)?;
    }
    budget(plan.downloads.iter().map(|(_, file)| file.size))?;
    let total = plan.downloads.len() as u64;
    plan.download(&state.dirs, progress).await?;
    let result = plan.commit(state, id)?;
    progress(Phase::Complete, total, total);
    Ok(result)
}

/// Neue Inhaltsliste eines Updates: aktualisierte und neu nötige Einträge, die alten Einträge der aktualisierten
/// (deaktiviert, damit `sync` ihre Dateien entfernt) und die Dateien, die dafür zu laden sind.
pub(crate) struct UpdatePlan {
    pub(crate) mods: Vec<Mod>,
    names: HashSet<String>,
    pub(crate) replaced: Vec<Mod>,
    pub(crate) downloads: Vec<(usize, File)>,
    selected: HashMap<String, Version>,
    fresh: HashSet<String>,
}

impl UpdatePlan {
    pub(crate) fn new(mods: &[Mod]) -> Self {
        Self {
            mods: mods.to_vec(),
            names: mods.iter().map(|m| m.file_name.to_lowercase()).collect(),
            replaced: Vec::new(),
            downloads: Vec::new(),
            selected: HashMap::new(),
            fresh: HashSet::new(),
        }
    }

    /// Setzt den Eintrag `i` auf die Version `v`.
    pub(crate) fn update(&mut self, i: usize, v: &Version) -> AppResult<()> {
        let file = modrinth::primary(v, self.mods[i].kind.extension())?;
        // Gleicher Name wie die alte Datei: mit der Versions-ID davor statt sie zu ersetzen.
        let file_name = [file.filename.clone(), format!("{}-{}", v.id, file.filename)]
            .into_iter()
            .find(|n| self.names.insert(n.to_lowercase()))
            .ok_or_else(names_collide)?;
        self.replaced.push(Mod { enabled: false, ..self.mods[i].clone() });
        let m = &mut self.mods[i];
        m.source = ModSource::Modrinth { project_id: v.project_id.clone(), version_id: v.id.clone() };
        m.version = v.version_number.clone();
        m.file_name = file_name;
        self.downloads.push((i, file));
        Ok(())
    }

    /// Die erste aktualisierte, aktive Mod: von ihr aus wird der Abhängigkeitsgraph aufgelöst.
    fn first_active_mod<'u>(&self, updates: &'u [(usize, Version)]) -> Option<&'u Version> {
        updates.iter().find(|(i, _)| self.mods[*i].kind == ModKind::Mod && self.mods[*i].enabled).map(|(_, v)| v)
    }

    /// Nimmt die Projekte aus `resolved` auf, die die Instanz noch nicht hat.
    fn add_dependencies(&mut self, resolved: Vec<Version>) -> AppResult<()> {
        for v in resolved {
            modrinth::insert_if_consistent(&mut self.selected, v)?;
        }
        let mut deps: Vec<Version> = self.selected.values().cloned().collect();
        deps.sort_by(|a, b| a.project_id.cmp(&b.project_id));
        for v in &deps {
            if let Some(existing) = self.mods.iter().find(|m| project_of(m) == Some(&v.project_id)) {
                if !existing.enabled {
                    return Err(AppError::invalid(coded!("errors.modrinth.requiredModDisabled")));
                }
                continue;
            }
            self.add(v, Vec::new())?;
        }
        Ok(())
    }

    /// Hängt die Mod `v` neu an; `required_by` nennt, wer sie braucht.
    pub(crate) fn add(&mut self, v: &Version, required_by: Vec<String>) -> AppResult<()> {
        let file = modrinth::primary(v, ModKind::Mod.extension())?;
        if !self.names.insert(file.filename.to_lowercase()) {
            return Err(names_collide());
        }
        self.fresh.insert(v.project_id.clone());
        self.mods.push(Mod { required_by, ..mod_from_version(v, file.filename.clone(), ModKind::Mod) });
        self.downloads.push((self.mods.len() - 1, file));
        Ok(())
    }

    /// Lädt die neuen Dateien in den Mod-Cache und trägt ihren SHA-1 ein; die Größe prüft der Aufrufer vorher.
    pub(crate) async fn download(&mut self, dirs: &Dirs, progress: ProgressFn<'_>) -> AppResult<()> {
        let client = modrinth::download_client()?;
        let total = self.downloads.len() as u64;
        let mut loaded = futures::stream::iter(std::mem::take(&mut self.downloads).into_iter().map(|(i, file)| {
            let client = &client;
            async move { Ok::<_, AppError>((i, modrinth::download(client, &file).await?)) }
        }))
        .buffer_unordered(DOWNLOAD_CONCURRENCY);
        let mut hashes = Vec::new();
        while let Some(item) = loaded.next().await {
            let (i, data) = item?;
            hashes.push((i, mods::cache_bytes(dirs, &data)?));
            progress(Phase::Download, hashes.len() as u64, total);
        }
        drop(loaded);
        for (i, sha1) in hashes {
            self.mods[i].sha1 = Some(sha1);
        }
        Ok(())
    }

    /// `sync` legt die neuen Dateien ab und entfernt die alten in einem Journal; die Inhaltsliste wird zuletzt gespeichert.
    fn commit(mut self, state: &AppState, id: &str) -> AppResult<Instance> {
        mark_dependencies(&mut self.mods, &self.selected, &self.fresh);
        let desired: Vec<Mod> = self.mods.iter().cloned().chain(self.replaced).collect();
        mods::sync_commit(&state.dirs, id, &desired, |_| commit_mods(state, id, self.mods))
    }
}

fn names_collide() -> AppError {
    AppError::invalid(coded!("errors.modrinth.fileNamesCollide"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{models::{ModLoader, NewInstance}, services::content::fixtures::modrinth_mod};

    #[test]
    fn older_release_is_no_update() {
        let at = |id: &str, date: &str| -> Version {
            serde_json::from_value(serde_json::json!({
                "id": id, "project_id": "lux", "name": id, "version_number": id, "game_versions": ["1.21.1"],
                "loaders": ["fabric"], "files": [], "dependencies": [], "date_published": date
            }))
            .unwrap()
        };
        let mods = [modrinth_mod("lux", &[])];
        let installed = HashMap::from([(mods[0].sha1.clone().unwrap(), at("alpha", "2026-09-01T10:00:00Z"))]);
        assert!(drop_older(vec![(0, at("old", "2026-08-01T10:00:00Z"))], &mods, &installed).is_empty());
        assert_eq!(drop_older(vec![(0, at("new", "2026-09-20T10:00:00Z"))], &mods, &installed).len(), 1);
        assert_eq!(drop_older(vec![(0, at("new", ""))], &mods, &HashMap::new()).len(), 1);
    }

    #[test]
    fn pinned_dependency_blocks_lonely_update() {
        let v = |id: &str, project: &str, pin: Option<(&str, &str)>| -> Version {
            serde_json::from_value(serde_json::json!({
                "id": id, "project_id": project, "name": id, "version_number": id,
                "game_versions": ["1.21.1"], "loaders": ["fabric"], "files": [],
                "dependencies": pin.map(|(p, vid)| vec![serde_json::json!({
                    "version_id": vid, "project_id": p, "file_name": null, "dependency_type": "required"
                })]).unwrap_or_default()
            }))
            .unwrap()
        };
        let mods = [modrinth_mod("iris", &[]), modrinth_mod("sodium", &["iris"])];
        let installed: HashMap<String, Version> = mods
            .iter()
            .zip([v("iris1", "iris", Some(("sodium", "sodium1"))), v("sodium1", "sodium", None)])
            .map(|(m, v)| (m.sha1.clone().unwrap(), v))
            .collect();
        // Sodium allein: iris1 legt sodium1 fest, das Update ließe sich nicht auflösen.
        assert!(drop_pinned(vec![(1, v("sodium2", "sodium", None))], &mods, &installed).is_empty());
        // Zusammen mit einem Iris-Update, das sodium2 festlegt, bleiben beide.
        let both = vec![(0, v("iris2", "iris", Some(("sodium", "sodium2")))), (1, v("sodium2", "sodium", None))];
        assert_eq!(drop_pinned(both, &mods, &installed).len(), 2);
        // Ein Iris-Update, das eine nicht geplante Sodium-Version festlegt, fällt weg.
        let iris_only = vec![(0, v("iris2", "iris", Some(("sodium", "sodium2"))))];
        assert!(drop_pinned(iris_only, &mods, &installed).is_empty());
    }

    #[test]
    fn update_check_picks_only_other_versions_of_same_project() {
        let mut stale = modrinth_mod("sodium", &[]);
        stale.sha1 = Some("A".repeat(40));
        let mut current = modrinth_mod("lithium", &[]);
        current.sha1 = Some("b".repeat(40));
        let mut foreign = modrinth_mod("iris", &[]);
        foreign.sha1 = Some("c".repeat(40));
        let local = Mod { source: ModSource::Local, sha1: Some("d".repeat(40)), ..modrinth_mod("own", &[]) };
        let version = |id: &str, project: &str, mc: &str| {
            serde_json::json!({"id": id, "project_id": project, "name": "n", "version_number": id,
                "game_versions": [mc], "loaders": ["fabric"], "files": [], "dependencies": []})
        };
        // Form von POST /v2/version_files/update: gesendeter Hash -> neueste Version.
        let answer: HashMap<String, Version> = serde_json::from_value(serde_json::json!({
            "a".repeat(40): version("sodium2", "sodium", "1.21.1"),
            "b".repeat(40): version("lithium1", "lithium", "1.21.1"),
            "c".repeat(40): version("other2", "not-iris", "1.21.1"),
            "d".repeat(40): version("own2", "own", "1.21.1"),
        }))
        .unwrap();
        let found = candidate_updates(&[stale.clone(), current, foreign, local], &answer, "1.21.1");
        assert_eq!(found.iter().map(|(i, v)| (*i, v.id.as_str())).collect::<Vec<_>>(), [(0, "sodium2")]);
        assert!(candidate_updates(&[stale], &answer, "1.20.1").is_empty());
    }

    fn version_json(id: &str, project: &str, mc: &str, loader: &str) -> Version {
        serde_json::from_value(serde_json::json!({
            "id": id, "project_id": project, "name": id, "version_number": id,
            "game_versions": [mc], "loaders": [loader], "files": [], "dependencies": []
        }))
        .unwrap()
    }

    #[test]
    fn pinned_entries_are_left_out_of_the_update_check() {
        let pinned = Mod { sha1: Some("a".repeat(40)), pinned: true, ..modrinth_mod("sodium", &[]) };
        let answer = HashMap::from([("a".repeat(40), version_json("sodium2", "sodium", "1.21.1", "fabric"))]);

        assert!(candidate_updates(std::slice::from_ref(&pinned), &answer, "1.21.1").is_empty());
        let loose = Mod { pinned: false, ..pinned };
        assert_eq!(candidate_updates(&[loose], &answer, "1.21.1").len(), 1);
    }

    #[test]
    fn switching_needs_another_version_of_the_same_project_that_fits() {
        let mut instance = Instance::from_new(NewInstance {
            name: "i".into(),
            minecraft_version: "1.21.1".into(),
            loader: ModLoader::Fabric,
            loader_version: None,
        });
        instance.mods = vec![modrinth_mod("sodium", &[]), Mod { source: ModSource::Local, ..modrinth_mod("own", &[]) }];
        let target = |mod_id: &str, version: &Version| switch_target(&instance, mod_id, version).map_err(|e| e.to_string());

        assert_eq!(target("sodium", &version_json("sodium2", "sodium", "1.21.1", "fabric")), Ok(0));
        assert!(target("sodium", &version_json("sodium1", "sodium", "1.21.1", "fabric")).unwrap_err().contains("schon installiert"));
        assert!(target("sodium", &version_json("x", "lithium", "1.21.1", "fabric")).unwrap_err().contains("anderen Projekt"));
        assert!(target("sodium", &version_json("sodium2", "sodium", "1.20.1", "fabric")).unwrap_err().contains("passt nicht"));
        assert!(target("sodium", &version_json("sodium2", "sodium", "1.21.1", "forge")).unwrap_err().contains("passt nicht"));
        assert!(target("own", &version_json("own2", "own", "1.21.1", "fabric")).unwrap_err().contains("nicht von Modrinth"));
        assert!(target("missing", &version_json("v", "p", "1.21.1", "fabric")).unwrap_err().contains("Unbekannte Mod"));
    }

    #[test]
    fn hashes_cover_only_modrinth_entries_in_lower_case() {
        let mut upper = modrinth_mod("sodium", &[]);
        upper.sha1 = Some("A".repeat(40));
        let local = Mod { source: ModSource::Local, ..modrinth_mod("own", &[]) };
        let off = Mod { enabled: false, ..modrinth_mod("iris", &[]) };

        let hashes = hashes_of(&[upper, local, off.clone()], |m| m.enabled);

        assert_eq!(hashes, ["a".repeat(40)]);
        assert_eq!(hashes_of(&[off], |_| true).len(), 1);
    }
}
