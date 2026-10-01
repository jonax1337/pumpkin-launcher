//! Instanzen anderer Launcher übernehmen: Prism Launcher/MultiMC, Modrinth App, CurseForge App und ATLauncher.
//! Erkennen liest nur deren Dateien; der Import kopiert den Spielordner, die Quelle bleibt unverändert.
mod atlauncher;
mod curseforge;
mod modrinth_app;
mod prism;

use std::{
    collections::HashSet,
    env, fs, io,
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc,
    },
};

use serde::{de::DeserializeOwned, Deserialize, Serialize};

use super::{content, copy_files, download::RemoveOnDrop, forge, modrinth, walk, REGENERATED};
use crate::{
    error::{AppError, AppResult},
    models::{Instance, ModLoader, NewInstance},
    state::AppState,
};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Launcher {
    /// Prism Launcher und MultiMC (gleiches Format).
    Prism,
    Modrinth,
    CurseForge,
    AtLauncher,
}

/// Was die Instanz im anderen Launcher eingestellt hat.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Setup {
    pub name: String,
    pub minecraft_version: String,
    pub loader: ModLoader,
    pub loader_version: Option<String>,
    pub memory_mb: Option<u32>,
    pub jvm_args: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ForeignInstance {
    pub launcher: Launcher,
    /// Instanzordner im anderen Launcher; daran erkennt Pumpkin Launcher frühere Importe.
    pub path: String,
    /// Spielordner, der kopiert wird (bei Prism `minecraft` bzw. `.minecraft` im Instanzordner).
    pub game_dir: String,
    /// Aus diesem Ordner wurde schon einmal importiert.
    #[serde(default)]
    pub imported: bool,
    #[serde(flatten)]
    pub setup: Setup,
}

impl ForeignInstance {
    fn new(launcher: Launcher, dir: &Path, setup: Setup) -> Self {
        let game_dir = if launcher == Launcher::Prism { prism::game_dir(dir) } else { dir.to_owned() };
        Self { launcher, path: text(dir), game_dir: text(&game_dir), imported: false, setup }
    }
}

/// Neben den Ordnern, die Minecraft neu anlegt, bleiben die Dateien der anderen Launcher zurück.
const SKIPPED: [&str; 3] = [".cache", "instance.json", "minecraftinstance.json"];

/// Instanzen anderer Launcher an den bekannten Orten oder, mit `folder`, in diesem Ordner, nach Namen sortiert.
pub fn detect(state: &AppState, folder: Option<&Path>) -> Vec<ForeignInstance> {
    let roots = folder.map_or_else(default_roots, |f| vec![f.to_owned()]);
    let imported: HashSet<String> = state.instances.list().into_iter().filter_map(|i| i.imported_from).collect();
    let mut found: Vec<ForeignInstance> = roots.iter().flat_map(|root| scan(root)).collect();
    for instance in &mut found {
        instance.imported = imported.contains(&instance.path);
    }
    found.sort_by_key(|i| i.setup.name.to_lowercase());
    found
}

/// Standardorte unter Windows. MultiMC ist portabel und hat keinen; dafür gibt es „Ordner wählen…“.
fn default_roots() -> Vec<PathBuf> {
    let data = env::var_os("APPDATA").map(PathBuf::from);
    let home = env::var_os("USERPROFILE").map(PathBuf::from);
    [
        data.as_ref().map(|d| d.join("PrismLauncher")),
        data.as_ref().map(|d| d.join("ModrinthApp")),
        data.as_ref().map(|d| d.join("ATLauncher")),
        home.map(|h| h.join("curseforge").join("minecraft")),
    ]
    .into_iter()
    .flatten()
    .collect()
}

/// Instanzen unter `root`: Datenordner eines Launchers, dessen Instanzordner oder eine einzelne Instanz.
fn scan(root: &Path) -> Vec<ForeignInstance> {
    let mut found: Vec<ForeignInstance> = skip_unreadable(root, modrinth_app::scan(root))
        .into_iter()
        .map(|(dir, setup)| ForeignInstance::new(Launcher::Modrinth, &dir, setup))
        .collect();
    let candidates = std::iter::once(root.to_owned()).chain(subdirs(root)).chain(subdirs(&root.join("instances")));
    found.extend(candidates.filter_map(|dir| skip_unreadable(&dir, read(&dir))));
    found
}

/// Liest die Instanz eines Launchers in einem Ordner; `None`, wenn der Ordner keine ist.
type Reader = fn(&Path) -> AppResult<Option<Setup>>;

/// Instanz in `dir`, erkannt an der Datei, die der jeweilige Launcher dort ablegt.
fn read(dir: &Path) -> AppResult<Option<ForeignInstance>> {
    let readers: [(Launcher, Reader); 3] =
        [(Launcher::Prism, prism::read), (Launcher::CurseForge, curseforge::read), (Launcher::AtLauncher, atlauncher::read)];
    for (launcher, read) in readers {
        if let Some(setup) = read(dir)? {
            return Ok(Some(ForeignInstance::new(launcher, dir, setup)));
        }
    }
    Ok(None)
}

/// Eine unlesbare Instanz oder Datenbank darf die Suche nicht abbrechen: protokollieren und weiter.
fn skip_unreadable<T: Default>(path: &Path, result: AppResult<T>) -> T {
    result.unwrap_or_else(|err| {
        tracing::warn!(path = %path.display(), %err, "Instanz eines anderen Launchers übersprungen");
        T::default()
    })
}

fn subdirs(dir: &Path) -> Vec<PathBuf> {
    let Ok(entries) = fs::read_dir(dir) else { return Vec::new() };
    entries.flatten().map(|e| e.path()).filter(|p| p.is_dir()).collect()
}

/// Kennungsdatei eines Launchers; fehlt sie, ist der Ordner keine Instanz dieses Launchers.
fn read_marker(path: &Path) -> AppResult<Option<Vec<u8>>> {
    match fs::read(path) {
        Ok(data) => Ok(Some(data)),
        Err(e) if e.kind() == io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(e.into()),
    }
}

/// JSON der anderen Launcher; Windows-Programme schreiben es teils mit BOM.
fn from_json<T: DeserializeOwned>(data: &[u8]) -> AppResult<T> {
    Ok(serde_json::from_slice(data.strip_prefix(b"\xEF\xBB\xBF").unwrap_or(data))?)
}

/// Loader nach dem Namen, den die anderen Launcher schreiben: wie der serde-Name, Groß- und Kleinschreibung egal.
fn loader_named(name: &str) -> AppResult<ModLoader> {
    serde_json::from_value(name.to_ascii_lowercase().into())
        .map_err(|_| modrinth::invalid(format!("Den Loader „{name}“ kann Pumpkin Launcher nicht starten")))
}

/// JVM-Argumente aus einer Zeile, wie die Launcher sie speichern.
fn split_args(line: &str) -> Vec<String> {
    line.split_whitespace().map(String::from).collect()
}

fn folder_name(dir: &Path) -> String {
    dir.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default()
}

fn text(path: &Path) -> String {
    path.to_string_lossy().into_owned()
}

/// Neue Instanz aus `source`: Einstellungen übernehmen, Spielordner kopieren (Fortschritt als Phase `copy`),
/// Inhalte eintragen, damit Updates gehen. Bei Fehler oder Abbruch verschwindet die halbe Instanz wieder.
pub async fn import(
    state: &AppState,
    source: ForeignInstance,
    progress: impl Fn(&str, u64, u64) + Send + 'static,
) -> AppResult<Instance> {
    check(&source)?;
    let setup = source.setup;
    let mut instance = Instance {
        memory_mb: setup.memory_mb,
        jvm_args: setup.jvm_args,
        imported_from: Some(source.path),
        ..Instance::from_new(NewInstance {
            name: setup.name.trim().into(),
            minecraft_version: setup.minecraft_version,
            loader: setup.loader,
            loader_version: setup.loader_version,
        })
    };
    let root = state.dirs.instance(&instance.id);
    content::regular_parents(&root)?;
    let mut cleanup = Cleanup::new(root);
    let copy = cleanup.copier(PathBuf::from(source.game_dir), state.dirs.game_dir(&instance.id), progress);
    tokio::task::spawn_blocking(copy).await.map_err(|e| modrinth::invalid(format!("Kopieren abgebrochen: {e}")))??;
    content::record_untracked(&state.dirs, &mut instance).await?;
    let instance = state.instances.insert(instance)?;
    cleanup.root = None;
    tracing::info!(id = %instance.id, from = ?instance.imported_from, "Instanz importiert");
    Ok(instance)
}

/// Was nicht startet oder fehlt, wird abgelehnt, bevor etwas kopiert ist.
fn check(source: &ForeignInstance) -> AppResult<()> {
    let setup = &source.setup;
    modrinth::identifier(&setup.minecraft_version)?;
    if let Some(version) = &setup.loader_version {
        modrinth::identifier(version)?;
    }
    forge::check_loader(setup.loader, &setup.minecraft_version)?;
    let game_dir = Path::new(&source.game_dir);
    if !game_dir.is_absolute() || !game_dir.is_dir() {
        return Err(modrinth::invalid(format!("Den Spielordner {} gibt es nicht mehr", source.game_dir)));
    }
    Ok(())
}

/// Der Spielordner ohne Neuerzeugtes und ohne die Dateien des anderen Launchers, als (Ziel, Quelle).
fn files_to_copy(source: &Path, target: &Path) -> AppResult<Vec<(PathBuf, PathBuf)>> {
    let mut files = Vec::new();
    for entry in fs::read_dir(source)? {
        let path = entry?.path();
        let name = folder_name(&path);
        if !REGENERATED.contains(&name.as_str()) && !SKIPPED.contains(&name.as_str()) {
            walk(source, &path, &mut files)?;
        }
    }
    Ok(files.into_iter().map(|(rel, path)| (target.join(rel), path)).collect())
}

/// Räumt den Instanzordner bei Abbruch auf. Das Kopieren läuft in einem eigenen Thread weiter, auch wenn der
/// Vorgang verworfen wird; `done` setzt, wer zuerst fertig ist (Kopie durch oder Vorgang abgebrochen), und
/// der Zweite räumt auf. So schreibt nach dem Aufräumen nichts mehr in den Ordner.
struct Cleanup {
    root: Option<PathBuf>,
    done: Arc<AtomicBool>,
}

impl Cleanup {
    fn new(root: PathBuf) -> Self {
        Self { root: Some(root), done: Arc::new(AtomicBool::new(false)) }
    }

    /// Kopiert `source` nach `target`; bei Fehler oder Abbruch entfernt es den Instanzordner selbst.
    fn copier(
        &self,
        source: PathBuf,
        target: PathBuf,
        progress: impl Fn(&str, u64, u64) + Send + 'static,
    ) -> impl FnOnce() -> AppResult<()> + Send + 'static {
        let (root, done) = (self.root.clone(), self.done.clone());
        move || {
            let result = files_to_copy(&source, &target).and_then(|files| copy_files(&files, &progress, &done));
            if done.swap(true, Ordering::SeqCst) || result.is_err() {
                drop(RemoveOnDrop(root));
                return result.and(Err(AppError::Cancelled));
            }
            Ok(())
        }
    }
}

impl Drop for Cleanup {
    fn drop(&mut self) {
        if self.root.is_some() && self.done.swap(true, Ordering::SeqCst) {
            drop(RemoveOnDrop(self.root.take()));
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::services::duplicate::tests::write_files;

    const PACK: &str = r#"{"formatVersion": 1, "components": [
        {"uid": "net.minecraft", "version": "1.21.1", "important": true},
        {"uid": "net.fabricmc.fabric-loader", "version": "0.16.10"}]}"#;

    #[test]
    fn scan_finds_instances_in_launcher_and_instance_folders() {
        let root = env::temp_dir().join(crate::models::new_id());
        write_files(
            &root,
            &[
                ("instances/Welt/instance.cfg", "[General]\nname=Welt\n"),
                ("instances/Welt/mmc-pack.json", PACK),
                ("instances/Kaputt/instance.cfg", "name=Kaputt\n"),
                ("instances/Kaputt/mmc-pack.json", "{"),
                ("instances/Leer/notes.txt", ""),
            ],
        );
        let found = scan(&root);
        assert_eq!(found.iter().map(|i| i.setup.name.as_str()).collect::<Vec<_>>(), ["Welt"]);
        assert_eq!(found[0].game_dir, text(&root.join("instances").join("Welt").join("minecraft")));
        // Eine einzelne Instanz als gewählter Ordner.
        assert_eq!(scan(&root.join("instances").join("Welt")), found);
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn copy_skips_regenerated_and_launcher_files() {
        let root = env::temp_dir().join(crate::models::new_id());
        let source = root.join("cf");
        write_files(
            &source,
            &[
                ("minecraftinstance.json", "{}"),
                ("mods/a.jar", "a"),
                ("saves/w/level.dat", "w"),
                ("options.txt", "fov:1"),
                ("logs/latest.log", "log"),
                ("crash-reports/c.txt", "c"),
            ],
        );
        let mut got: Vec<String> = files_to_copy(&source, &root.join("ziel"))
            .unwrap()
            .into_iter()
            .map(|(dest, _)| text(dest.strip_prefix(root.join("ziel")).unwrap()).replace('\\', "/"))
            .collect();
        got.sort();
        assert_eq!(got, ["mods/a.jar", "options.txt", "saves/w/level.dat"]);
        fs::remove_dir_all(root).unwrap();
    }

    fn add_content(game_dir: &Path) {
        write_files(game_dir, &[("mods/own.jar", "own"), ("mods/off.jar.disabled", "off"), ("config/a.toml", "x=1")]);
    }

    #[tokio::test]
    async fn import_copies_without_touching_the_source() {
        let root = env::temp_dir().join(crate::models::new_id());
        let state = AppState::load(&root.join("data")).unwrap();
        let source = root.join("Prism/instances/Welt");
        let cfg = "name=Welt\nOverrideMemory=true\nMaxMemAlloc=4096\n";
        write_files(&source, &[("instance.cfg", cfg), ("mmc-pack.json", PACK)]);
        add_content(&source.join("minecraft"));
        let from = detect(&state, Some(&source)).remove(0);

        let instance = import(&state, from, |_, _, _| {}).await.unwrap();

        assert_eq!((instance.name.as_str(), instance.loader, instance.memory_mb), ("Welt", ModLoader::Fabric, Some(4096)));
        let mods: Vec<_> = instance.mods.iter().map(|m| (m.file_name.as_str(), m.enabled)).collect();
        assert_eq!(mods, [("off.jar", false), ("own.jar", true)]);
        assert_eq!(fs::read_to_string(state.dirs.game_dir(&instance.id).join("config/a.toml")).unwrap(), "x=1");
        assert!(source.join("minecraft/mods/off.jar.disabled").exists() && !source.join("minecraft/mods/off.jar").exists());
        assert!(detect(&state, Some(&source)).iter().all(|i| i.imported));
        fs::remove_dir_all(root).unwrap();
    }

    #[tokio::test]
    async fn unsupported_or_missing_sources_are_rejected() {
        let root = env::temp_dir().join(crate::models::new_id());
        let state = AppState::load(&root.join("data")).unwrap();
        add_content(&root.join("da"));
        let setup = Setup {
            name: "Alt".into(),
            minecraft_version: "1.12.2".into(),
            loader: ModLoader::Forge,
            loader_version: Some("14.23.5.2860".into()),
            memory_mb: None,
            jvm_args: Vec::new(),
        };
        let old_forge = ForeignInstance::new(Launcher::CurseForge, &root.join("da"), setup);
        let missing = ForeignInstance {
            setup: Setup { loader: ModLoader::Vanilla, loader_version: None, ..old_forge.setup.clone() },
            ..ForeignInstance::new(Launcher::CurseForge, &root.join("weg"), old_forge.setup.clone())
        };
        for source in [old_forge, missing] {
            assert!(import(&state, source, |_, _, _| {}).await.is_err());
        }
        assert!(state.instances.list().is_empty());
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn whoever_finishes_last_removes_the_folder() {
        let root = env::temp_dir().join(crate::models::new_id());
        add_content(&root.join("quelle"));
        let target = root.join("instanz");
        // Kopie fertig, danach abgebrochen: der Wächter räumt auf.
        let cleanup = Cleanup::new(target.clone());
        cleanup.copier(root.join("quelle"), target.join("minecraft"), |_, _, _| {})().unwrap();
        assert!(target.join("minecraft/config/a.toml").exists());
        drop(cleanup);
        assert!(!target.exists());
        // Abgebrochen, bevor die Kopie fertig ist: sie hört auf und räumt selbst auf.
        let cleanup = Cleanup::new(target.clone());
        let copy = cleanup.copier(root.join("quelle"), target.join("minecraft"), |_, _, _| {});
        drop(cleanup);
        assert!(matches!(copy(), Err(AppError::Cancelled)));
        assert!(!target.exists());
        fs::remove_dir_all(root).unwrap();
    }
}
