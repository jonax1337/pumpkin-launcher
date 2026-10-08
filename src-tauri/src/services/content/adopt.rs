//! Inhaltsdateien eintragen, die ohne Inhaltsliste in einem Spielordner liegen (ältere Importe, andere Launcher), und
//! sie per SHA-1 bei Modrinth erkennen; ohne Netz gelten sie als lokal.
use std::{
    collections::{HashMap, HashSet},
    future::Future,
    path::PathBuf,
};

use tokio_util::sync::CancellationToken;

use super::{fs_safety::safe_path, install::dependency_project, install::mark_dependencies, mod_from_version};
use crate::{
    error::{AppError, AppResult},
    models::{new_id, Instance, Mod, ModKind, ModSource},
    services::{
        check_cancelled, entries,
        modrinth::{self, Project, Version},
        mods,
        progress::{Phase, ProgressFn},
        Dirs,
    },
    state::AppState,
};

/// Die Modrinth-Abfragen der Erkennung; Tests setzen ein Gegenstück ohne Netz ein.
pub(crate) trait Catalog {
    fn versions_by_hash(&self, hashes: &[String]) -> impl Future<Output = AppResult<HashMap<String, Version>>> + Send;
    fn projects(&self, ids: &[String]) -> impl Future<Output = AppResult<Vec<Project>>> + Send;
}

impl Catalog for reqwest::Client {
    async fn versions_by_hash(&self, hashes: &[String]) -> AppResult<HashMap<String, Version>> {
        modrinth::versions_by_hash(self, hashes).await
    }

    async fn projects(&self, ids: &[String]) -> AppResult<Vec<Project>> {
        modrinth::projects(self, ids).await
    }
}

/// Im Betrieb fragt die Erkennung Modrinth.
#[cfg(not(test))]
pub(crate) fn catalog() -> AppResult<impl Catalog> {
    modrinth::client()
}

/// Tests laufen ohne Netz: Die Erkennung scheitert, alle Inhalte gelten als lokal.
#[cfg(test)]
pub(crate) fn catalog() -> AppResult<impl Catalog> {
    Ok(Offline)
}

#[cfg(test)]
struct Offline;

#[cfg(test)]
impl Catalog for Offline {
    async fn versions_by_hash(&self, _: &[String]) -> AppResult<HashMap<String, Version>> {
        Err(AppError::invalid("Kein Netzwerk in Tests"))
    }

    async fn projects(&self, _: &[String]) -> AppResult<Vec<Project>> {
        Err(AppError::invalid("Kein Netzwerk in Tests"))
    }
}

/// Was Modrinth zu Inhaltsdateien kennt: Version je SHA-1 und Titel je Projekt.
#[derive(Default)]
pub(crate) struct Recognition {
    pub(crate) versions: HashMap<String, Version>,
    pub(crate) titles: HashMap<String, String>,
}

/// Dateiname -> (CurseForge-Projekt, Datei) der Inhalte, die von CurseForge stammen.
type Origins = HashMap<String, (u32, u32)>;

impl Recognition {
    /// Eintrag für `cached`: von Modrinth erkannt, sonst lokal mit dem Dateinamen ohne Endung als Namen.
    pub(crate) fn mod_from_file(&self, cached: &CachedFile, existing: &[Mod]) -> Mod {
        let ContentFile { kind, file_name, enabled } = &cached.file;
        let stem = file_name.strip_suffix(kind.extension()).unwrap_or(file_name).to_string();
        let entry = match self.versions.get(&cached.sha1) {
            Some(v) => Mod {
                // Zwei Dateien desselben Projekts behalten verschiedene IDs.
                id: if existing.iter().any(|m| m.id == v.project_id) { new_id() } else { v.project_id.clone() },
                name: self.titles.get(&v.project_id).cloned().unwrap_or(stem),
                ..mod_from_version(v, file_name.clone(), *kind)
            },
            None => Mod {
                id: new_id(),
                name: stem,
                version: String::new(),
                source: ModSource::Local,
                file_name: file_name.clone(),
                sha1: None,
                enabled: true,
                kind: *kind,
                required_by: Vec::new(),
                pinned: false,
                pack_managed: false,
            },
        };
        Mod { sha1: Some(cached.sha1.clone()), enabled: *enabled, ..entry }
    }

    /// Hängt je Datei einen Eintrag an `mods` an; was Modrinth nicht kennt, aber laut `origins` von CurseForge kommt,
    /// behält diese Herkunft.
    pub(crate) fn append_entries(&self, mods: &mut Vec<Mod>, found: &[CachedFile], origins: &Origins) {
        for file in found {
            let mut m = self.mod_from_file(file, mods);
            apply_origin(&mut m, origins, mods);
            mods.push(m);
        }
    }

    /// Wie [`Self::append_entries`], dazu `required_by` aus den erkannten Versionen.
    pub(crate) fn append_recorded(&self, mods: &mut Vec<Mod>, found: &[CachedFile], origins: &Origins) {
        self.append_entries(mods, found, origins);
        derive_required_by(mods, &self.versions);
    }
}

/// Wie [`identify`], aber ohne Netz leer: Die Inhalte gelten dann als lokal.
pub(crate) async fn identify_or_local(catalog: &impl Catalog, hashes: &[String]) -> Recognition {
    identify(catalog, hashes).await.unwrap_or_else(|err| {
        tracing::warn!(%err, "Inhalte nicht bei Modrinth erkannt; als lokal erfasst");
        Recognition::default()
    })
}

/// Erkennt die Dateien mit höchstens zwei Anfragen; die Titel nach bestem Bemühen.
pub(crate) async fn identify(catalog: &impl Catalog, hashes: &[String]) -> AppResult<Recognition> {
    let versions = catalog.versions_by_hash(hashes).await?;
    let mut ids: Vec<String> = versions.values().map(|v| v.project_id.clone()).collect();
    ids.sort();
    ids.dedup();
    let titles = match catalog.projects(&ids).await {
        Ok(projects) => projects.into_iter().map(|p| (p.id, p.title)).collect(),
        Err(err) => {
            tracing::warn!(%err, "Projekttitel nicht geladen");
            HashMap::new()
        }
    };
    Ok(Recognition { versions, titles })
}

/// Fremde Packs: `required_by` aus den Pflicht-Abhängigkeiten der erkannten Modrinth-Versionen.
/// Was keine andere enthaltene Mod braucht, gilt als direkt hinzugefügt.
pub(super) fn derive_required_by(mods: &mut [Mod], versions: &HashMap<String, Version>) {
    let selected: HashMap<String, Version> = versions.values().map(|v| (v.project_id.clone(), v.clone())).collect();
    let fresh: HashSet<String> = selected
        .values()
        .flat_map(|v| &v.dependencies)
        .filter(|d| d.dependency_type == "required")
        .filter_map(|d| dependency_project(d, &selected))
        .filter(|p| selected.contains_key(p))
        .collect();
    mark_dependencies(mods, &selected, &fresh);
}

/// Von CurseForge bezogen und nicht bei Modrinth erkannt: Herkunft merken statt „lokal“.
fn apply_origin(m: &mut Mod, origins: &Origins, existing: &[Mod]) {
    let Some(&(project_id, file_id)) = origins.get(&m.file_name).filter(|_| m.source == ModSource::Local) else { return };
    let id = format!("cf-{project_id}");
    // Zwei Dateien desselben Projekts behalten verschiedene IDs.
    if !existing.iter().any(|x| x.id == id) {
        m.id = id;
    }
    m.source = ModSource::CurseForge { project_id, file_id };
}

/// Inhaltsdatei der Art `kind` unter `file_name` im Spielordner; deaktiviert liegt sie dort als `<file_name>.disabled`.
pub(crate) struct ContentFile {
    pub(crate) kind: ModKind,
    pub(crate) file_name: String,
    pub(crate) enabled: bool,
}

impl ContentFile {
    /// Eintrag im Ordner der Art `kind`; `name.jar.disabled` zählt als deaktiviertes `name.jar`.
    fn named(kind: ModKind, raw: String) -> Self {
        match raw.strip_suffix(".disabled") {
            Some(name) => Self { kind, file_name: name.to_owned(), enabled: false },
            None => Self { kind, file_name: raw, enabled: true },
        }
    }

    fn is(&self, kind: ModKind, file_name: &str) -> bool {
        self.kind == kind && self.file_name.eq_ignore_ascii_case(file_name)
    }

    /// Endung der Art und ein Name, der sich sicher ablegen lässt.
    fn has_content_name(&self) -> bool {
        self.file_name.ends_with(self.kind.extension()) && safe_path(&self.file_name).is_ok()
    }
}

/// Inhaltsdatei, die im Mod-Cache unter `sha1` liegt und im Spielordner steht (oder dorthin kommt).
pub(crate) struct CachedFile {
    pub(crate) file: ContentFile,
    pub(crate) sha1: String,
}

/// Inhaltsdatei im Spielordner unter `path`, die nicht in `instance.mods` steht.
struct UntrackedFile {
    file: ContentFile,
    path: PathBuf,
}

/// Nachpflege nach dem Start für Packs, die vor der Inhaltsliste importiert wurden: Instanzen ganz ohne Inhaltsliste
/// bekommen die Dateien aus `mods/`, `resourcepacks/`, `shaderpacks/` gecacht eingetragen;
/// erkannt per Modrinth-Sammelabfrage, ohne Netz als lokal. Liefert die Anzahl neuer Einträge.
/// Nur leere Listen: sonst kämen vom Nutzer entfernte Mods zurück, deren Datei nicht löschbar war.
/// Läuft unter der Sperre der ganzen Bibliothek; läuft irgendein anderer Vorgang, entfällt der Lauf bis zum nächsten Start.
pub async fn adopt_untracked(state: &AppState) -> AppResult<usize> {
    let Ok(_guard) = state.begin_library_operation() else {
        tracing::info!("Nachtragen übersprungen: ein anderer Vorgang läuft");
        return Ok(0);
    };
    let plan = untracked_per_instance(state)?;
    if plan.is_empty() {
        return Ok(0);
    }
    let mut hashes: Vec<String> = plan.iter().flat_map(|(_, found)| found.iter().map(|f| f.sha1.clone())).collect();
    hashes.sort();
    hashes.dedup();
    let recognition = identify_or_local(&catalog()?, &hashes).await;
    let mut added = 0;
    for (id, found) in plan {
        let adopted = state
            .instances
            .modify(&id, |current| recognition.append_recorded(&mut current.mods, &found, &Origins::new()));
        match adopted {
            Ok(_) => added += found.len(),
            // Inzwischen gelöscht: nichts nachzutragen.
            Err(AppError::NotFound(_)) => {}
            Err(err) => return Err(err),
        }
    }
    Ok(added)
}

/// Gecachte, nicht eingetragene Dateien je Instanz ohne Inhaltsliste.
fn untracked_per_instance(state: &AppState) -> AppResult<Vec<(String, Vec<CachedFile>)>> {
    let mut plan = Vec::new();
    for instance in state.instances.list().into_iter().filter(|i| i.mods.is_empty()) {
        let found = cached_untracked(&state.dirs, &instance, &|_, _, _| {}, &CancellationToken::new())?;
        if !found.is_empty() {
            plan.push((instance.id, found));
        }
    }
    Ok(plan)
}

/// Import aus einem anderen Launcher: trägt die gecachten Inhalte des kopierten Spielordners ein, erkannt per
/// Modrinth-Sammelabfrage; ohne Netz als lokal, mit `origins` (Dateiname -> CurseForge-Projekt, Datei) als CurseForge.
pub(crate) async fn record_untracked(mods: &mut Vec<Mod>, found: &[CachedFile], origins: &Origins) -> AppResult<()> {
    let hashes: Vec<String> = found.iter().map(|f| f.sha1.clone()).collect();
    let recognition = identify_or_local(&catalog()?, &hashes).await;
    recognition.append_recorded(mods, found, origins);
    Ok(())
}

/// Nicht eingetragene Inhalte in den Mod-Cache legen; Fortschritt als Phase `hash` (Dateien). Liest jede Datei ganz,
/// beim Import deshalb im Kopier-Thread. Ist `stop` abgebrochen, endet es vor der nächsten Datei mit `AppError::Cancelled`.
pub(crate) fn cached_untracked(
    dirs: &Dirs,
    instance: &Instance,
    progress: ProgressFn<'_>,
    stop: &CancellationToken,
) -> AppResult<Vec<CachedFile>> {
    let files = untracked(dirs, instance)?;
    let total = files.len() as u64;
    let mut found = Vec::with_capacity(files.len());
    for (done, untracked) in (1..).zip(files) {
        check_cancelled(stop)?;
        let sha1 = mods::cache_file(dirs, &untracked.path)?;
        found.push(CachedFile { file: untracked.file, sha1 });
        progress(Phase::Hash, done, total);
    }
    Ok(found)
}

/// Inhalte im Spielordner, die nicht in `instance.mods` stehen.
fn untracked(dirs: &Dirs, instance: &Instance) -> AppResult<Vec<UntrackedFile>> {
    let mut found: Vec<UntrackedFile> = Vec::new();
    for kind in ModKind::ALL {
        let mut listing = entries(&dirs.game_dir(&instance.id).join(kind.folder()))?;
        // read_dir liefert je Dateisystem eine andere Reihenfolge (NTFS sortiert, ext4/APFS nicht).
        listing.sort_by_key(|e| e.file_name());
        for e in listing {
            let Some(raw) = e.file_name().to_str().map(str::to_owned) else { continue };
            let file = ContentFile::named(kind, raw);
            let listed = instance.mods.iter().any(|m| file.is(m.kind, &m.file_name))
                || found.iter().any(|f| file.is(f.file.kind, &f.file.file_name));
            if listed || !e.file_type()?.is_file() || !file.has_content_name() {
                continue;
            }
            found.push(UntrackedFile { file, path: e.path() });
        }
    }
    Ok(found)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{
        models::{ModLoader, NewInstance},
        services::content::fixtures::graph,
    };
    use std::fs;

    fn cached(file_name: &str, sha1: &str) -> CachedFile {
        CachedFile { file: ContentFile { kind: ModKind::Mod, file_name: file_name.into(), enabled: true }, sha1: sha1.into() }
    }

    #[test]
    fn recorded_entry_uses_modrinth_hit() {
        let sha1 = "a".repeat(40);
        let recognition = Recognition {
            versions: graph(&[("sodium", &[])]).into_values().map(|v| (sha1.clone(), v)).collect(),
            titles: HashMap::from([("sodium".to_string(), "Sodium".to_string())]),
        };
        let m = recognition.mod_from_file(&cached("sodium-1.jar", &sha1), &[]);
        assert_eq!((m.id.as_str(), m.name.as_str(), m.version.as_str()), ("sodium", "Sodium", "1"));
        assert_eq!(m.source, ModSource::Modrinth { project_id: "sodium".into(), version_id: "sodium1".into() });
        // Eine zweite Datei desselben Projekts bekommt eine eigene ID, ein fehlender Titel fällt auf den Dateinamen zurück.
        let untitled = Recognition { titles: HashMap::new(), ..recognition };
        let again = untitled.mod_from_file(&cached("sodium-2.jar", &sha1), &[m]);
        assert_ne!(again.id, "sodium");
        assert_eq!(again.name, "sodium-2");
    }

    #[test]
    fn foreign_pack_derives_required_by() {
        // a -> b -> c, d allein; Schlüssel wie bei `identify`: sha1 -> Version.
        let recognition = Recognition {
            versions: graph(&[("a", &["b"]), ("b", &["c"]), ("c", &[]), ("d", &[])])
                .into_iter()
                .map(|(p, v)| (format!("{p:0>40}"), v))
                .collect(),
            titles: HashMap::new(),
        };
        let mut mods: Vec<Mod> = ["a", "b", "c", "d"]
            .iter()
            .map(|p| recognition.mod_from_file(&cached(&format!("{p}.jar"), &format!("{p:0>40}")), &[]))
            .collect();
        derive_required_by(&mut mods, &recognition.versions);
        let by: Vec<_> = mods.iter().map(|m| m.required_by.join(",")).collect();
        assert_eq!(by, ["", "a", "a", ""]);
    }

    /// Antwortet mit einer Sodium-Version für jeden Hash; Titel liefert es nur, wenn `titled`.
    struct Answering {
        titled: bool,
    }

    impl Catalog for Answering {
        async fn versions_by_hash(&self, hashes: &[String]) -> AppResult<HashMap<String, Version>> {
            let sodium = graph(&[("sodium", &[])]).remove("sodium").unwrap();
            Ok(hashes.iter().map(|h| (h.clone(), sodium.clone())).collect())
        }

        async fn projects(&self, ids: &[String]) -> AppResult<Vec<Project>> {
            if !self.titled {
                return Err(AppError::invalid("Projekte nicht erreichbar"));
            }
            let project = |id: &String| -> Project {
                serde_json::from_value(serde_json::json!({
                    "id": id, "slug": id, "title": "Sodium", "description": "", "body": "", "icon_url": null,
                    "project_type": "mod", "client_side": "required", "server_side": "optional"
                }))
                .unwrap()
            };
            Ok(ids.iter().map(project).collect())
        }
    }

    #[tokio::test]
    async fn identify_asks_for_each_project_once_and_titles_are_best_effort() {
        let hashes = ["a".repeat(40), "b".repeat(40)];

        let titled = identify(&Answering { titled: true }, &hashes).await.unwrap();
        let untitled = identify(&Answering { titled: false }, &hashes).await.unwrap();

        assert_eq!(titled.versions.len(), 2);
        assert_eq!(titled.titles, HashMap::from([("sodium".to_string(), "Sodium".to_string())]));
        assert_eq!((untitled.versions.len(), untitled.titles.len()), (2, 0));
        assert!(identify_or_local(&Offline, &hashes).await.versions.is_empty());
    }

    #[tokio::test]
    async fn adopts_untracked_files_once() {
        let root = std::env::temp_dir().join(crate::models::new_id());
        let state = AppState::load(&root).unwrap();
        let i = state
            .instances
            .insert(Instance::from_new(NewInstance {
                name: "Alt".into(),
                minecraft_version: "1.21.1".into(),
                loader: ModLoader::Fabric,
                loader_version: None,
            }))
            .unwrap();
        let game = state.dirs.game_dir(&i.id);
        for (path, data) in [
            ("mods/a.jar", "a"),
            ("mods/off.jar.disabled", "off"),
            ("mods/notes.txt", "n"),
            ("resourcepacks/r.zip", "r"),
            ("shaderpacks/s.zip", "s"),
        ] {
            fs::create_dir_all(game.join(path).parent().unwrap()).unwrap();
            fs::write(game.join(path), data).unwrap();
        }
        assert_eq!(adopt_untracked(&state).await.unwrap(), 4);
        let mods = state.instances.get(&i.id).unwrap().mods;
        let got: Vec<_> = mods.iter().map(|m| (m.kind, m.file_name.as_str(), m.enabled)).collect();
        assert_eq!(
            got,
            [
                (ModKind::Mod, "a.jar", true),
                (ModKind::Mod, "off.jar", false),
                (ModKind::ResourcePack, "r.zip", true),
                (ModKind::Shader, "s.zip", true),
            ]
        );
        assert!(mods.iter().all(|m| m.source == ModSource::Local));
        // Gecacht: Aktivieren legt die deaktivierte Mod aus dem Cache ab.
        let on: Vec<_> = mods.iter().map(|m| Mod { enabled: true, ..m.clone() }).collect();
        mods::sync(&state.dirs, &i.id, &on).unwrap();
        assert_eq!(fs::read(game.join("mods/off.jar")).unwrap(), b"off");
        // Zweiter Lauf trägt nichts doppelt ein; Instanzen mit Liste bleiben unberührt,
        // auch wenn eine entfernte Mod-Datei noch im Ordner liegt.
        fs::write(game.join("mods/entfernt.jar"), "x").unwrap();
        assert_eq!(adopt_untracked(&state).await.unwrap(), 0);
        // Läuft ein Vorgang an irgendeiner Instanz, entfällt der Lauf.
        let empty = state
            .instances
            .insert(Instance::from_new(NewInstance {
                name: "Leer".into(),
                minecraft_version: "1.21.1".into(),
                loader: ModLoader::Fabric,
                loader_version: None,
            }))
            .unwrap();
        let empty_mods = state.dirs.game_dir(&empty.id).join("mods");
        fs::create_dir_all(&empty_mods).unwrap();
        fs::write(empty_mods.join("b.jar"), "b").unwrap();
        let busy = state.begin_instance_operation(&empty.id).unwrap();
        assert_eq!(adopt_untracked(&state).await.unwrap(), 0);
        drop(busy);
        assert_eq!(adopt_untracked(&state).await.unwrap(), 1);
        fs::remove_dir_all(root).unwrap();
    }
}
