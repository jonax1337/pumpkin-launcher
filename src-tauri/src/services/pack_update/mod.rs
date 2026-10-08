//! Pack-Updates ohne Weltverlust. Vorher werden alle Welten gesichert; ersetzt oder entfernt wird nur, was das alte
//! Pack genau so abgelegt hat ([`diff`]), was der Spieler hinzugefügt, geändert oder ausgeschaltet hat, bleibt. Erst
//! wird alles geladen, dann wechseln die Dateien in einer [`transaction`], die bei einem Fehler, auch beim Speichern,
//! zurückgenommen wird. Der Wechsel läuft abseits des Async-Kontexts (siehe `services::blocking`). Welten (`saves/`)
//! fasst ein Update nie an.
mod diff;
mod mod_list;
mod pack_files;
mod source;
mod stage;
mod transaction;

use std::{
    borrow::Cow,
    collections::{BTreeMap, HashMap, HashSet},
    fs,
    path::Path,
    sync::Arc,
};

use serde::{Deserialize, Serialize};
use tokio_util::sync::CancellationToken;

pub use pack_files::PackFiles;

use self::{
    diff::{Action, OnDisk, Step},
    mod_list::PackContent,
    source::{Body, NewFile, Release},
    stage::Stage,
    transaction::Transaction,
};
use crate::{
    coded,
    error::{AppError, AppResult},
    models::{Instance, Mod, ModpackOrigin},
    services::{
        blocking, check_cancelled,
        content::{self, regular_parents, safe_path, Recognition},
        download::{sha1_file, RemoveOnDrop},
        modrinth, mods, none_if_missing,
        progress::{Phase, ProgressFn, SharedProgress},
        providers::ftb,
        store::JsonStore,
        worlds, write_atomic, Dirs,
    },
    state::AppState,
};

/// Arbeitsordner eines laufenden Updates in der Instanz, neben dem Spielordner.
const WORK_DIR: &str = "pack-update";
/// Im Arbeitsordner: die Herkunft (JSON), auf die das Update die Instanz bringt, nur wenn sie sich ändert. Trägt die
/// gespeicherte Instanz sie schon, war das Update fertig gespeichert und es gibt nichts zurückzuholen.
const TARGET: &str = "target";
/// Im Arbeitsordner: entsteht, sobald die Instanz das Update gespeichert hat; entscheidet auch bei gleicher Herkunft.
const SAVED: &str = "saved";
/// Im Arbeitsordner: die Dateiliste von vor dem Update (JSON, `null` ohne Liste), bis die Instanz gespeichert ist.
const PREVIOUS_FILES: &str = "previous-files";

/// Wohin ein Update führt.
#[derive(Debug, Clone, Deserialize)]
#[serde(tag = "type", rename_all = "lowercase", rename_all_fields = "camelCase")]
pub enum PackTarget {
    /// Eine Version derselben Quelle, aus der die Instanz stammt.
    Version { version_id: String },
    /// Eine neuere `.mrpack`-Datei (absoluter Pfad), für Instanzen aus einer Datei.
    File { path: String },
}

/// Was das Update geändert hat, je als Pfad im Spielordner.
#[derive(Debug, Default, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PackChanges {
    pub added: Vec<String>,
    pub updated: Vec<String>,
    pub removed: Vec<String>,
    /// Vom Spieler geändert oder angelegt: das Update hat sie stehen lassen.
    pub kept: Vec<String>,
}

impl PackChanges {
    fn of(steps: &[Step]) -> Self {
        let mut changes = Self::default();
        for step in steps {
            let list = match step.action {
                Action::Place => &mut changes.added,
                Action::Replace | Action::Stash => &mut changes.updated,
                Action::Remove | Action::Drop => &mut changes.removed,
                Action::Keep => &mut changes.kept,
                Action::Leave => continue,
            };
            list.push(step.path.clone());
        }
        changes
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PackUpdateOutcome {
    pub instance: Instance,
    pub changes: PackChanges,
    /// Welten, die vorher gesichert wurden.
    pub world_backups: usize,
}

/// Änderungsprotokoll einer Pack-Version (Markdown), soweit die Quelle eins führt: Modrinth und FTB.
pub async fn changelog(client: &reqwest::Client, instance: &Instance, version_id: &str) -> AppResult<Option<String>> {
    match &instance.modpack {
        Some(ModpackOrigin::Modrinth { .. }) => modrinth::changelog(client, version_id).await,
        Some(ModpackOrigin::Provider { source, project_id, .. }) if source == "ftb" => {
            ftb::changelog(client, project_id, version_id).await
        }
        _ => Ok(None),
    }
}

/// Beim Start: holt in allen Instanzen die alten Dateien eines Updates zurück, das ein Absturz vor dem Speichern der
/// Instanz unterbrochen hat. Läuft schon ein anderer Vorgang, bleibt alles bis zum nächsten Start (oder Update). Liefert die Zahl
/// der wiederhergestellten Instanzen; was sich nicht zurückholen lässt, bleibt für den nächsten Versuch liegen.
pub async fn recover_interrupted(state: &AppState) -> AppResult<usize> {
    let Ok(_guard) = state.begin_operation() else { return Ok(0) };
    let instances = state.instances.list();
    state
        .blocking_with_dirs(move |dirs| {
            let mut recovered = 0;
            for instance in instances {
                match recover_instance(dirs, &instance) {
                    Ok(true) => recovered += 1,
                    Ok(false) => {}
                    Err(err) => {
                        tracing::warn!(instance = %instance.id, %err, "Unterbrochenes Pack-Update nicht zurückgeholt")
                    }
                }
            }
            Ok(recovered)
        })
        .await
}

/// Stellt den Stand vor einem unterbrochenen Pack-Update der Instanz wieder her; `false`, wenn keins unterbrochen war
/// oder es schon gespeichert war und nur Reste liegen. Der Start einer Instanz ruft es auf: sonst liefe das Spiel mit
/// Mods aus alter und neuer Pack-Version.
pub(crate) fn recover_instance(dirs: &Dirs, instance: &Instance) -> AppResult<bool> {
    if !interrupted(&dirs.instance(&instance.id).join(WORK_DIR)) {
        return Ok(false);
    }
    recover_work(dirs, instance)
}

/// Liegt im Arbeitsordner noch etwas, das [`recover_work`] zurückholen oder wegräumen muss?
fn interrupted(work: &Path) -> bool {
    transaction::left_behind(work) || work.join(PREVIOUS_FILES).exists()
}

/// Räumt den Arbeitsordner der Instanz weg und holt dabei die alten Dateien samt Dateiliste zurück, es sei denn, das
/// Update war gespeichert; `true`, wenn es zurückgeholt hat.
fn recover_work(dirs: &Dirs, instance: &Instance) -> AppResult<bool> {
    let work = dirs.instance(&instance.id).join(WORK_DIR);
    let committed = work.join(SAVED).exists()
        || saved_target(&work).is_some_and(|target| instance.modpack.as_ref() == Some(&target));
    if !committed {
        restore_previous_files(dirs, &instance.id, &work)?;
    }
    transaction::recover(&dirs.instances_dir(), &dirs.game_dir(&instance.id), &work, committed)?;
    Ok(!committed)
}

/// Die Herkunft, auf die das unterbrochene Update führte; `None`, wenn es sie nicht mehr festhielt.
fn saved_target(work: &Path) -> Option<ModpackOrigin> {
    serde_json::from_slice(&fs::read(work.join(TARGET)).ok()?).ok()
}

/// Bringt die Pack-Instanz `id` auf die Version `target`. Fortschritt: `resolve`, `download`, `backup`, `copy`.
pub async fn update(state: &AppState, id: &str, target: PackTarget, progress: SharedProgress) -> AppResult<PackUpdateOutcome> {
    let instance = state.instances.get(id)?;
    let work = state.dirs.instance(id).join(WORK_DIR);
    recover_work(&state.dirs, &instance)?;
    progress(Phase::Resolve, 0, 1);
    // Bei Fehler oder Abbruch verschwindet, was schon geladen ist; nach dem Update der leere Arbeitsordner.
    let cleanup = RemoveOnDrop::new(work.clone());
    let mut stage = Stage::new(&state.dirs, &work);
    let mut plan = plan(state, &instance, &target, &mut stage, &*progress).await?;
    let world_backups = backup_worlds(state, id, progress.clone()).await?;
    let wanted = to_download(&plan.steps, &plan.release.files);
    stage.fetch(&mut plan.release.files, wanted, &*progress).await?;
    let changes = PackChanges::of(&plan.steps);
    let apply = Apply { dirs: state.dirs.clone(), instances: state.instances.clone(), instance, plan, progress };
    // Der Wechsel gehört dem eigenen Thread samt Aufräumen: ein Abbruch verwirft nur das Warten auf ihn.
    let updated = blocking(move |stop| {
        let applied = apply.run(stop);
        if applied.is_err() && interrupted(&work) {
            cleanup.disarm();
        }
        applied
    })
    .await?;
    tracing::info!(instance = %id, origin = ?updated.modpack, "Pack aktualisiert");
    Ok(PackUpdateOutcome { instance: updated, changes, world_backups })
}

/// Die neue Version mit den Prüfsummen aller Dateien und je Datei, was das Update mit ihr tut.
struct Plan {
    release: Release,
    steps: Vec<Step>,
    recognition: Recognition,
}

async fn plan(
    state: &AppState,
    instance: &Instance,
    target: &PackTarget,
    stage: &mut Stage<'_>,
    progress: ProgressFn<'_>,
) -> AppResult<Plan> {
    let client = modrinth::client()?;
    let mut release = source::release(&client, &state.dirs, instance, target, progress).await?;
    let installed = source::installed(&client, &state.dirs, instance, progress).await?;
    let unknown = release.files.iter().enumerate().filter(|(_, f)| f.sha1.is_none()).map(|(i, _)| i).collect();
    stage.fetch(&mut release.files, unknown, progress).await?;
    let (game, mods) = (state.dirs.game_dir(&instance.id), instance.mods.clone());
    let (release, mut steps) = blocking(move |_| {
        let steps = plan_steps(&game, installed, &release.files, &mods)?;
        Ok((release, steps))
    })
    .await?;
    let recognition = content::identify_or_local(&content::catalog()?, &content_hashes(&steps)).await;
    let project_of = |sha1: &str| recognition.versions.get(sha1).map(|v| v.project_id.clone());
    diff::respect_switched_off(&mut steps, project_of);
    diff::respect_pinned(&mut steps, &pinned_content(&instance.mods), project_of);
    Ok(Plan { release, steps, recognition })
}

/// Sichert alle Welten der Instanz; liefert ihre Zahl. Fortschritt als Phase `backup`, je Welt von vorn. Bricht der
/// Nutzer ab, endet die Sicherung vor der nächsten Datei, damit sie nicht neben dem Vorgang weiterläuft, der die
/// Sperre der Instanz danach freigibt.
pub(crate) async fn backup_worlds(state: &AppState, id: &str, progress: SharedProgress) -> AppResult<usize> {
    let (id, dirs) = (id.to_owned(), state.dirs.clone());
    blocking(move |stop| {
        let found = worlds::list(&dirs, &id)?;
        for world in &found {
            worlds::backup_cancellable(&dirs, &id, &world.id, &*progress, stop)?;
        }
        Ok(found.len())
    })
    .await
}

/// Welten gehören dem Spieler; ein Pack-Update legt dort nichts ab und nimmt nichts weg.
fn is_world_data(path: &str) -> bool {
    path.split('/').next().is_some_and(|first| first.eq_ignore_ascii_case("saves"))
}

/// Je Pfad des alten oder neuen Packs (ohne Welten) die drei Stände und was das Update tut.
fn plan_steps(game: &Path, installed: Vec<(String, String)>, files: &[NewFile], mods: &[Mod]) -> AppResult<Vec<Step>> {
    let mut paths: BTreeMap<String, (String, Option<String>, Option<String>)> = BTreeMap::new();
    for (path, sha1) in installed.into_iter().filter(|(path, _)| !is_world_data(path)) {
        paths.entry(path.to_lowercase()).or_insert_with(|| (path, None, None)).1 = Some(sha1);
    }
    for file in files.iter().filter(|f| !is_world_data(&f.path)) {
        let sha1 = file.sha1.clone().ok_or_else(|| AppError::invalid(coded!("errors.packs.update.checksumMissing", path = file.path)))?;
        let entry = paths.entry(file.path.to_lowercase()).or_insert_with(|| (file.path.clone(), None, None));
        (entry.0, entry.2) = (file.path.clone(), Some(sha1));
    }
    let disabled = disabled_content(mods);
    paths
        .into_iter()
        .map(|(key, (path, old, new))| {
            let disk = on_disk(game, &path, disabled.get(&key))?;
            Ok(Step::new(path, old, new, disk))
        })
        .collect()
}

/// Festgehaltene Inhalte: Pfad im Spielordner (kleingeschrieben).
fn pinned_content(mods: &[Mod]) -> HashSet<String> {
    mods.iter().filter(|m| m.pinned).map(|m| mods::game_path(m).to_lowercase()).collect()
}

/// Ausgeschaltete Inhalte: Pfad im Spielordner (kleingeschrieben) → SHA-1.
fn disabled_content(mods: &[Mod]) -> HashMap<String, String> {
    mods.iter()
        .filter(|m| !m.enabled)
        .filter_map(|m| Some((mods::game_path(m).to_lowercase(), m.sha1.as_ref()?.to_ascii_lowercase())))
        .collect()
}

fn on_disk(game: &Path, path: &str, disabled: Option<&String>) -> AppResult<OnDisk> {
    let target = game.join(safe_path(path)?);
    Ok(match none_if_missing(fs::symlink_metadata(&target))? {
        Some(meta) if meta.is_file() => OnDisk::Present(sha1_file(&target)?),
        Some(_) => OnDisk::Other,
        None => disabled.map_or(OnDisk::Absent, |sha1| OnDisk::Disabled(sha1.clone())),
    })
}

/// SHA-1 der alten und neuen Inhaltsdateien, für die Erkennung bei Modrinth.
fn content_hashes(steps: &[Step]) -> Vec<String> {
    let mut hashes: Vec<String> = steps
        .iter()
        .filter(|s| content::content_file(Path::new(&s.path)).is_some())
        .flat_map(|s| s.old.iter().chain(&s.new).cloned())
        .collect();
    hashes.sort();
    hashes.dedup();
    hashes
}

/// Index der neuen Dateien nach Pfad (kleingeschrieben).
fn file_index(files: &[NewFile]) -> HashMap<String, usize> {
    files.iter().enumerate().map(|(i, f)| (f.path.to_lowercase(), i)).collect()
}

/// Was das Update braucht und noch bei der Quelle liegt.
fn to_download(steps: &[Step], files: &[NewFile]) -> Vec<usize> {
    let index = file_index(files);
    steps
        .iter()
        .filter(|s| matches!(s.action, Action::Place | Action::Replace | Action::Stash))
        .filter_map(|s| index.get(&s.path.to_lowercase()).copied())
        .filter(|&i| matches!(files[i].body, Body::Fetch(_)))
        .collect()
}

/// Der Dateiwechsel eines Updates samt allem, was er braucht, um auf einem eigenen Thread zu laufen.
struct Apply {
    dirs: Dirs,
    instances: Arc<JsonStore<Instance>>,
    instance: Instance,
    plan: Plan,
    progress: SharedProgress,
}

impl Apply {
    /// Wechselt die Dateien und speichert die Instanz samt neuer Dateiliste; scheitert etwas, auch ein Abbruch vor
    /// einer Datei, ist alles wie vorher.
    fn run(&self, stop: &CancellationToken) -> AppResult<Instance> {
        let Plan { release, steps, recognition } = &self.plan;
        let id = &self.instance.id;
        let index = file_index(&release.files);
        let new_file = |step: &Step| index.get(&step.path.to_lowercase()).map(|&i| &release.files[i]);
        let fresh = only_new(recognition, steps);
        let pack = PackContent { recognition: &fresh, required_by: &release.required_by, origins: &release.origins };
        let changing: Vec<&Step> =
            steps.iter().filter(|s| !matches!(s.action, Action::Keep | Action::Leave | Action::Drop)).collect();
        let total = changing.len() as u64;
        let work = self.dirs.instance(id).join(WORK_DIR);
        Transaction::new(&self.dirs.instances_dir(), self.dirs.game_dir(id), &work).run(|tx| {
            self.note_target(&work)?;
            for (done, step) in (1..).zip(changing) {
                check_cancelled(stop)?;
                apply_step(tx, &self.dirs, step, new_file(step))?;
                (self.progress)(Phase::Copy, done, total);
            }
            let mods = mod_list::reconcile(&self.instance.mods, steps, &pack);
            self.commit(&work, mods)
        })
    }

    /// Hält fest, wohin das Update führt, bevor sich etwas ändert: so erkennt [`recover_work`] ein Update, das
    /// gespeichert wurde und nur noch aufräumen musste. Bleibt die Herkunft gleich, sagt sie darüber nichts.
    fn note_target(&self, work: &Path) -> AppResult<()> {
        let target = work.join(TARGET);
        regular_parents(&self.dirs.instances_dir(), &target)?;
        fs::create_dir_all(work)?;
        let origin = &self.plan.release.origin;
        if self.instance.modpack.as_ref() == Some(origin) {
            return Ok(());
        }
        write_atomic(&target, &serde_json::to_vec(origin)?)
    }

    /// Speichert erst die neue Dateiliste, dann die Instanz. Die alte Liste liegt bis dahin im Arbeitsordner: scheitert
    /// die Instanz oder bricht der Prozess vorher ab, gilt wieder sie.
    fn commit(&self, work: &Path, mods: Vec<Mod>) -> AppResult<Instance> {
        let id = &self.instance.id;
        let release = &self.plan.release;
        write_atomic(&work.join(PREVIOUS_FILES), &serde_json::to_vec(&PackFiles::load(&self.dirs, id)?)?)?;
        placed_files(release, &self.plan.steps).save(&self.dirs, id)?;
        let game = &release.game;
        let saved = self.instances.modify(id, |i| {
            i.minecraft_version = game.minecraft_version.clone();
            i.loader = game.loader;
            i.loader_version = game.loader_version.clone();
            i.modpack = Some(release.origin.clone());
            i.mods = mods;
        });
        match &saved {
            Ok(_) => note_saved(work),
            Err(_) => restore_previous_files(&self.dirs, id, work)
                .unwrap_or_else(|err| tracing::warn!(instance = %id, %err, "Alte Pack-Dateiliste nicht zurückgeschrieben")),
        }
        saved
    }
}

/// Hält fest, dass die Instanz das Update trägt, und gibt die alte Dateiliste frei. Misslingt das Festhalten,
/// entscheidet beim Zurückholen die Herkunft ([`TARGET`]).
fn note_saved(work: &Path) {
    let noted = fs::write(work.join(SAVED), b"").and_then(|()| fs::remove_file(work.join(PREVIOUS_FILES)));
    if let Err(err) = noted {
        tracing::warn!(%err, "Gespeichertes Pack-Update nicht vermerkt");
    }
}

/// Schreibt die Dateiliste von vor dem Update zurück, falls das Update sie schon ersetzt hatte.
fn restore_previous_files(dirs: &Dirs, id: &str, work: &Path) -> AppResult<()> {
    let backup = work.join(PREVIOUS_FILES);
    let Some(bytes) = none_if_missing(fs::read(&backup))? else { return Ok(()) };
    match serde_json::from_slice::<Option<PackFiles>>(&bytes)? {
        Some(files) => files.save(dirs, id)?,
        None => none_if_missing(fs::remove_file(PackFiles::path_of(dirs, id))).map(drop)?,
    }
    Ok(fs::remove_file(backup)?)
}

/// Die Erkennung nur der neuen Stände: aus ihnen leitet die Liste ab, wer wen braucht.
fn only_new(recognition: &Recognition, steps: &[Step]) -> Recognition {
    let versions = steps
        .iter()
        .filter_map(|s| s.new.as_ref())
        .filter_map(|sha1| Some((sha1.clone(), recognition.versions.get(sha1)?.clone())))
        .collect();
    Recognition { versions, titles: recognition.titles.clone() }
}

fn apply_step(tx: &mut Transaction, dirs: &Dirs, step: &Step, file: Option<&NewFile>) -> AppResult<()> {
    match step.action {
        Action::Place => tx.place(&step.path, &bytes_of(dirs, step, file)?),
        Action::Replace => tx.replace(&step.path, &bytes_of(dirs, step, file)?),
        Action::Remove => tx.remove(&step.path),
        Action::Stash => bytes_of(dirs, step, file).map(drop),
        Action::Drop | Action::Keep | Action::Leave => Ok(()),
    }
}

/// Die Bytes der neuen Datei; Inhalte liegen danach auch im Mod-Cache, damit ihr Eintrag sie wiederfindet.
fn bytes_of<'f>(dirs: &Dirs, step: &Step, file: Option<&'f NewFile>) -> AppResult<Cow<'f, [u8]>> {
    let file = file.ok_or_else(|| AppError::invalid(coded!("errors.packs.update.fileMissing", path = step.path)))?;
    let data = file.bytes(dirs)?;
    if content::content_file(Path::new(&step.path)).is_some() {
        mods::cache_bytes(dirs, &data)?;
    }
    Ok(data)
}

/// Die Dateien des neuen Packs, wie das nächste Update sie als alten Stand liest; festgehaltene mit dem Stand, der
/// noch daliegt, damit ein späteres Update sie ersetzt, sobald sie nicht mehr festgehalten sind.
fn placed_files(release: &Release, steps: &[Step]) -> PackFiles {
    let held: HashMap<String, &str> = steps.iter().filter_map(|s| Some((s.path.to_lowercase(), s.held_old()?))).collect();
    let mut placed = PackFiles::default();
    for file in release.files.iter().filter(|f| !is_world_data(&f.path)) {
        if let Some(sha1) = held.get(&file.path.to_lowercase()).copied().or(file.sha1.as_deref()) {
            placed.record(Path::new(&file.path), sha1.to_owned());
        }
    }
    placed
}

#[cfg(test)]
mod tests;
