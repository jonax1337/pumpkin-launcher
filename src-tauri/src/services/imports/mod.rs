//! Instanzen anderer Launcher übernehmen: Prism Launcher/MultiMC, Modrinth App, CurseForge App und ATLauncher.
//! Erkennen liest nur deren Dateien; der Import kopiert den Spielordner, die Quelle bleibt unverändert.
mod atlauncher;
mod curseforge;
mod modrinth_app;
mod prism;

use std::{
    collections::HashSet,
    fs, io,
    path::{Path, PathBuf},
};

use serde::{de::DeserializeOwned, Deserialize, Serialize};

use super::{blocking, check_cancelled, content, copy_files, forge, modrinth, walk, REGENERATED};
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

/// Was ein Reader in einem Ordner findet: der Spielordner, der kopiert wird (bei Prism `minecraft` bzw. `.minecraft`
/// im Instanzordner), und die Einstellungen.
pub(super) struct Found {
    game_dir: PathBuf,
    setup: Setup,
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
    /// Warum Pumpkin Launcher die Instanz nicht starten kann (z. B. Forge vor 1.17); dann gibt es keinen Import.
    #[serde(default)]
    pub unsupported: Option<String>,
    #[serde(flatten)]
    pub setup: Setup,
}

impl ForeignInstance {
    fn new(launcher: Launcher, dir: &Path, Found { game_dir, setup }: Found) -> Self {
        let unsupported = forge::check_loader(setup.loader, &setup.minecraft_version).err().map(|e| e.to_string());
        Self { launcher, path: text(dir), game_dir: text(&game_dir), imported: false, unsupported, setup }
    }
}

/// Neben den Ordnern, die Minecraft neu anlegt, bleiben die Dateien der anderen Launcher zurück.
const SKIPPED: [&str; 3] = [".cache", atlauncher::MANIFEST, curseforge::MANIFEST];

/// ATLauncher deaktiviert Mods, indem es sie hierher verschiebt; Pumpkin Launcher kennt sie als `mods/<name>.disabled`.
const DISABLED_MODS: &str = "disabledmods/";

/// Instanzen anderer Launcher an den bekannten Orten oder, mit `folder`, in diesem Ordner, nach Namen sortiert.
/// Liest Datenbanken und Ordner, deshalb im eigenen Thread.
pub async fn detect(state: &AppState, folder: Option<&Path>) -> AppResult<Vec<ForeignInstance>> {
    let roots = folder.map_or_else(default_roots, |f| vec![f.to_owned()]);
    let imported: HashSet<String> = state.instances.list().into_iter().filter_map(|i| i.imported_from).collect();
    blocking(move |_| {
        let mut found: Vec<ForeignInstance> = roots.iter().flat_map(|root| scan(root)).collect();
        for instance in &mut found {
            instance.imported = imported.contains(&instance.path);
        }
        found.sort_by_key(|i| i.setup.name.to_lowercase());
        Ok(found)
    })
    .await
}

/// Standardorte im Datenordner des Systems (unter Windows `%APPDATA%`). MultiMC ist portabel und hat keinen;
/// dafür gibt es „Ordner wählen…“. Die CurseForge App legt ihren Ordner unter Windows im Benutzerordner an, sonst
/// in „Dokumente“ (CurseForge-Hilfe „Minecraft - Getting Started“).
fn default_roots() -> Vec<PathBuf> {
    let data = dirs::data_dir();
    let curseforge = if cfg!(windows) { dirs::home_dir() } else { dirs::document_dir() };
    [
        data.as_ref().map(|d| d.join("PrismLauncher")),
        data.as_ref().map(|d| d.join("ModrinthApp")),
        data.as_ref().map(|d| d.join("ATLauncher")),
        curseforge.map(|d| d.join("curseforge").join("minecraft")),
    ]
    .into_iter()
    .flatten()
    .collect()
}

/// Instanzen unter `root`: Datenordner eines Launchers, dessen Instanzordner oder eine einzelne Instanz.
fn scan(root: &Path) -> Vec<ForeignInstance> {
    let mut found: Vec<ForeignInstance> = skip_unreadable(root, modrinth_app::scan(root))
        .into_iter()
        .map(|found| ForeignInstance::new(Launcher::Modrinth, &found.game_dir.clone(), found))
        .collect();
    let folders = subdirs(root);
    // Die CurseForge App nennt ihn `Instances`; Linux unterscheidet das von `instances`.
    let instances: Vec<PathBuf> =
        folders.iter().filter(|dir| folder_name(dir).eq_ignore_ascii_case("instances")).flat_map(|dir| subdirs(dir)).collect();
    let candidates = std::iter::once(root.to_owned()).chain(folders).chain(instances);
    found.extend(candidates.filter_map(|dir| skip_unreadable(&dir, read(&dir))));
    found
}

/// Liest die Instanz eines Launchers in einem Ordner; `None`, wenn der Ordner keine ist.
type Reader = fn(&Path) -> AppResult<Option<Found>>;

/// Instanz in `dir`, erkannt an der Datei, die der jeweilige Launcher dort ablegt.
fn read(dir: &Path) -> AppResult<Option<ForeignInstance>> {
    let readers: [(Launcher, Reader); 3] =
        [(Launcher::Prism, prism::read), (Launcher::CurseForge, curseforge::read), (Launcher::AtLauncher, atlauncher::read)];
    for (launcher, read) in readers {
        if let Some(found) = read(dir)? {
            return Ok(Some(ForeignInstance::new(launcher, dir, found)));
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
        .map_err(|_| AppError::invalid(format!("Den Loader „{name}“ kann Pumpkin Launcher nicht starten")))
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

/// Neue Instanz aus `source`: Einstellungen übernehmen, Spielordner kopieren und Inhalte in den Mod-Cache legen
/// (Fortschritt als Phasen `copy` und `hash`), dann eintragen, damit Updates gehen. Bei Fehler oder Abbruch
/// verschwindet die halbe Instanz wieder.
pub async fn import(
    state: &AppState,
    source: ForeignInstance,
    progress: impl Fn(&str, u64, u64) + Send + 'static,
) -> AppResult<Instance> {
    check(&source)?;
    let game_dir = PathBuf::from(source.game_dir);
    let origins = curseforge::origins(&game_dir);
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
    let (dirs, target, fresh) = (state.dirs.clone(), state.dirs.game_dir(&instance.id), instance.clone());
    let (mut guard, found) = content::populate_new_dir(&state.dirs, state.dirs.instance(&instance.id), move |stop| {
        copy_files(&files_to_copy(&game_dir, &target)?, &|done, total| {
            check_cancelled(stop)?;
            progress("copy", done, total);
            Ok(())
        })?;
        content::cached_untracked(&dirs, &fresh, &progress, stop)
    })
    .await?;
    content::record_untracked(&mut instance.mods, &found, &origins).await?;
    let instance = state.instances.insert(instance)?;
    guard.0 = None;
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
        return Err(AppError::invalid(format!("Den Spielordner {} gibt es nicht mehr", source.game_dir)));
    }
    Ok(())
}

/// Der Spielordner ohne Neuerzeugtes und ohne die Dateien des anderen Launchers, als (Ziel, Quelle).
/// Deaktivierte Mods aus `disabledmods` landen deaktiviert in `mods`.
fn files_to_copy(source: &Path, target: &Path) -> AppResult<Vec<(PathBuf, PathBuf)>> {
    let mut files = Vec::new();
    for entry in fs::read_dir(source)? {
        let path = entry?.path();
        let name = folder_name(&path);
        if !REGENERATED.contains(&name.as_str()) && !SKIPPED.contains(&name.as_str()) {
            walk(source, &path, &mut files)?;
        }
    }
    Ok(files.into_iter().map(|(rel, path)| (target.join(relocated(rel)), path)).collect())
}

fn relocated(rel: String) -> String {
    match rel.strip_prefix(DISABLED_MODS) {
        Some(name) => format!("mods/{name}.disabled"),
        None => rel,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{models::ModSource, services::write_files};

    const PACK: &str = r#"{"formatVersion": 1, "components": [
        {"uid": "net.minecraft", "version": "1.21.1", "important": true},
        {"uid": "net.fabricmc.fabric-loader", "version": "0.16.10"}]}"#;

    #[test]
    fn scan_finds_instances_in_launcher_and_instance_folders() {
        let root = std::env::temp_dir().join(crate::models::new_id());
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
    fn scan_finds_curseforge_instances_in_a_capitalized_instances_folder() {
        let root = std::env::temp_dir().join(crate::models::new_id());
        write_files(&root, &[("Instances/Pack/minecraftinstance.json", r#"{"gameVersion": "1.21.1", "name": "Pack"}"#)]);

        let found = scan(&root);

        assert_eq!(found.iter().map(|i| (i.launcher, i.setup.name.as_str())).collect::<Vec<_>>(), [(Launcher::CurseForge, "Pack")]);
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn copy_skips_regenerated_and_launcher_files() {
        let root = std::env::temp_dir().join(crate::models::new_id());
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
                ("disabledmods/off.jar", "off"),
            ],
        );
        let mut got: Vec<String> = files_to_copy(&source, &root.join("ziel"))
            .unwrap()
            .into_iter()
            .map(|(dest, _)| text(dest.strip_prefix(root.join("ziel")).unwrap()).replace('\\', "/"))
            .collect();
        got.sort();
        assert_eq!(got, ["mods/a.jar", "mods/off.jar.disabled", "options.txt", "saves/w/level.dat"]);
        fs::remove_dir_all(root).unwrap();
    }

    fn add_content(game_dir: &Path) {
        write_files(game_dir, &[("mods/own.jar", "own"), ("mods/off.jar.disabled", "off"), ("config/a.toml", "x=1")]);
    }

    #[tokio::test]
    async fn import_copies_without_touching_the_source() {
        let root = std::env::temp_dir().join(crate::models::new_id());
        let state = AppState::load(&root.join("data")).unwrap();
        let source = root.join("Prism/instances/Welt");
        let cfg = "name=Welt\nOverrideMemory=true\nMaxMemAlloc=4096\n";
        write_files(&source, &[("instance.cfg", cfg), ("mmc-pack.json", PACK)]);
        add_content(&source.join("minecraft"));
        let from = detect(&state, Some(&source)).await.unwrap().remove(0);

        let instance = import(&state, from, |_, _, _| {}).await.unwrap();

        assert_eq!((instance.name.as_str(), instance.loader, instance.memory_mb), ("Welt", ModLoader::Fabric, Some(4096)));
        let mods: Vec<_> = instance.mods.iter().map(|m| (m.file_name.as_str(), m.enabled)).collect();
        assert_eq!(mods, [("off.jar", false), ("own.jar", true)]);
        assert_eq!(fs::read_to_string(state.dirs.game_dir(&instance.id).join("config/a.toml")).unwrap(), "x=1");
        assert!(source.join("minecraft/mods/off.jar.disabled").exists() && !source.join("minecraft/mods/off.jar").exists());
        assert!(detect(&state, Some(&source)).await.unwrap().iter().all(|i| i.imported));
        fs::remove_dir_all(root).unwrap();
    }

    #[tokio::test]
    async fn import_keeps_curseforge_origins_of_unknown_mods() {
        let root = std::env::temp_dir().join(crate::models::new_id());
        let state = AppState::load(&root.join("data")).unwrap();
        let source = root.join("Instances/Pack");
        let manifest = r#"{"gameVersion": "1.21.1", "baseModLoader": {"name": "neoforge-21.1.172"},
            "installedAddons": [{"addonID": 238222, "installedFile": {"id": 5846880, "fileName": "jei.jar"}}]}"#;
        write_files(&source, &[("minecraftinstance.json", manifest), ("mods/jei.jar", "jei"), ("mods/own.jar", "own")]);
        let from = detect(&state, Some(&source)).await.unwrap().remove(0);

        let instance = import(&state, from, |_, _, _| {}).await.unwrap();

        let sources: Vec<_> = instance.mods.iter().map(|m| (m.id.as_str(), &m.source)).collect();
        assert_eq!(sources[0], ("cf-238222", &ModSource::CurseForge { project_id: 238222, file_id: 5846880 }));
        assert_eq!(sources[1].1, &ModSource::Local);
        fs::remove_dir_all(root).unwrap();
    }

    #[tokio::test]
    async fn cancelled_import_leaves_nothing_behind() {
        let root = std::env::temp_dir().join(crate::models::new_id());
        let state = AppState::load(&root.join("data")).unwrap();
        let source = root.join("Prism/instances/Welt");
        write_files(&source, &[("instance.cfg", "name=Welt\n"), ("mmc-pack.json", PACK)]);
        add_content(&source.join("minecraft"));
        let from = detect(&state, Some(&source)).await.unwrap().remove(0);

        // Die erste kopierte Datei hält an.
        let result = content::cancel_at_step(&state, 1, |progress| import(&state, from, progress)).await;

        assert!(matches!(result, Err(crate::error::AppError::Cancelled)));
        assert!(state.instances.list().is_empty());
        assert_eq!(fs::read_dir(state.dirs.root.join("instances")).unwrap().count(), 0);
        fs::remove_dir_all(root).unwrap();
    }

    #[tokio::test]
    async fn unsupported_or_missing_sources_are_rejected() {
        let root = std::env::temp_dir().join(crate::models::new_id());
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
        let old_forge = ForeignInstance::new(Launcher::CurseForge, &root.join("da"), Found { game_dir: root.join("da"), setup });
        assert!(old_forge.unsupported.is_some());
        let vanilla = Setup { loader: ModLoader::Vanilla, loader_version: None, ..old_forge.setup.clone() };
        let missing = ForeignInstance::new(Launcher::CurseForge, &root.join("weg"), Found { game_dir: root.join("weg"), setup: vanilla });
        for source in [old_forge, missing] {
            assert!(import(&state, source, |_, _, _| {}).await.is_err());
        }
        assert!(state.instances.list().is_empty());
        fs::remove_dir_all(root).unwrap();
    }
}
