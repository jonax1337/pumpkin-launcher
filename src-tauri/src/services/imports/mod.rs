//! Instanzen anderer Launcher übernehmen: Prism Launcher/MultiMC, Modrinth App, CurseForge App und ATLauncher.
//! Erkennen liest nur deren Dateien; der Import kopiert den Spielordner, die Quelle bleibt unverändert.
mod atlauncher;
mod curseforge;
mod modrinth_app;
mod prism;

use std::{
    collections::HashSet,
    fs,
    path::{Path, PathBuf},
};

use serde::{de::DeserializeOwned, Deserialize, Serialize};

use super::java::{self, JavaSetting};
use super::launch_args::{self, MAX_ARGS};
use super::limits::ICON_LIMIT;
use super::progress::{Phase, SharedProgress};
use super::{blocking, check_cancelled, content, copy_files, data_url, forge, modrinth, none_if_missing, walk, REGENERATED};
use crate::{
    coded,
    error::{AppError, AppResult},
    models::{instance_name, GameWindow, Instance, InstanceIcon, ModLoader, NewInstance, MAX_NAME_LEN, MAX_NOTES_LEN},
    state::AppState,
};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Launcher {
    /// Prism Launcher und MultiMC (gleiches Format).
    Prism,
    Modrinth,
    CurseForge,
    AtLauncher,
}

/// Was die Instanz im anderen Launcher eingestellt hat und Pumpkin Launcher nicht übernimmt.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum NotAdopted {
    /// Pumpkin Launcher führt keine Befehle aus fremden Dateien aus: nicht vor dem Start, nicht danach, nicht als Wrapper.
    PreLaunchCommand,
    PostExitCommand,
    WrapperCommand,
    /// Zeigt auf keine Java-Programmdatei, die es auf diesem Rechner gibt.
    JavaPath,
    /// Argumente, die Code laden oder die Pumpkin Launcher nicht annimmt (siehe `launch_args`).
    JvmArgs,
}

/// Was die Instanz im anderen Launcher eingestellt hat.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Setup {
    pub name: String,
    pub minecraft_version: String,
    pub loader: ModLoader,
    pub loader_version: Option<String>,
    pub memory_mb: Option<u32>,
    pub min_memory_mb: Option<u32>,
    pub jvm_args: Vec<String>,
    pub java_path: Option<String>,
    pub window: GameWindow,
    pub group: Option<String>,
    pub notes: String,
    /// Eigenes Icon der Instanz als `data:`-URL.
    pub icon: Option<String>,
    pub not_adopted: Vec<NotAdopted>,
}

impl Setup {
    /// Nur das, was jeder Launcher kennt; die Reader tragen ein, was ihre Dateien sonst hergeben.
    fn new(name: String, minecraft_version: String, loader: ModLoader, loader_version: Option<String>) -> Self {
        Self {
            name,
            minecraft_version,
            loader,
            loader_version,
            memory_mb: None,
            min_memory_mb: None,
            jvm_args: Vec::new(),
            java_path: None,
            window: GameWindow::Default,
            group: None,
            notes: String::new(),
            icon: None,
            not_adopted: Vec::new(),
        }
    }

    /// Dateien eines anderen Launchers sind fremde Eingaben: übernommen wird nur, was Pumpkin Launcher in den
    /// Einstellungen einer Instanz selbst zuließe.
    fn vetted(mut self) -> Self {
        let args = self.jvm_args.len();
        self.jvm_args = self.jvm_args.into_iter().filter(|arg| launch_args::is_importable_jvm_arg(arg)).take(MAX_ARGS).collect();
        if self.jvm_args.len() < args {
            self.not_adopted.push(NotAdopted::JvmArgs);
        }
        if self.java_path.as_deref().is_some_and(|path| java::custom_java(path, JavaSetting::Instance).is_err()) {
            self.java_path = None;
            self.not_adopted.push(NotAdopted::JavaPath);
        }
        self.memory_mb = self.memory_mb.filter(|mb| *mb > 0);
        self.min_memory_mb = self.min_memory_mb.filter(|mb| *mb > 0);
        self.icon = self.icon.filter(|src| InstanceIcon::Image { src: src.clone() }.validated().is_ok());
        self.notes = self.notes.trim().chars().take(MAX_NOTES_LEN).collect();
        self.group = self.group.map(|group| group.trim().chars().take(MAX_NAME_LEN).collect::<String>()).filter(|group| !group.is_empty());
        self
    }
}

/// Was ein Reader in einem Ordner findet: der Spielordner, der kopiert wird (bei Prism `minecraft` bzw. `.minecraft`
/// im Instanzordner), und die Einstellungen.
pub(super) struct Found {
    game_dir: PathBuf,
    setup: Setup,
}

/// Was der Import aus dem Spielordner mitnimmt. Das Zählen läuft über alle Dateien und gehört deshalb nur zur
/// Erkennung (`detect`), nicht zum Wiederfinden beim Import.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Contents {
    pub size_bytes: u64,
    pub mods: u32,
    pub worlds: u32,
}

impl Contents {
    fn of(game_dir: &Path) -> AppResult<Self> {
        if !game_dir.is_dir() {
            return Ok(Self::default());
        }
        let mut contents = Self::default();
        let mut worlds = HashSet::new();
        for (rel, source) in files_to_copy(game_dir, Path::new(""))? {
            contents.size_bytes += fs::metadata(source)?.len();
            let mut parts = rel.components().map(|part| part.as_os_str().to_string_lossy().into_owned());
            match (parts.next().as_deref(), parts.next(), parts.next()) {
                (Some("mods"), Some(name), None) if name.ends_with(".jar") || name.ends_with(".jar.disabled") => contents.mods += 1,
                (Some("saves"), Some(world), Some(_)) => {
                    worlds.insert(world);
                }
                _ => {}
            }
        }
        contents.worlds = worlds.len() as u32;
        Ok(contents)
    }
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ForeignInstance {
    pub launcher: Launcher,
    /// Ordner, unter dem die Suche die Instanz fand; mit `path` findet der Import sie wieder.
    pub root: String,
    /// Instanzordner im anderen Launcher; daran erkennt Pumpkin Launcher frühere Importe.
    pub path: String,
    /// Spielordner, der kopiert wird (bei Prism `minecraft` bzw. `.minecraft` im Instanzordner).
    pub game_dir: String,
    /// Aus diesem Ordner wurde schon einmal importiert.
    pub imported: bool,
    /// Warum Pumpkin Launcher die Instanz nicht starten kann (z. B. Forge vor 1.17); dann gibt es keinen Import.
    pub unsupported: Option<String>,
    pub contents: Contents,
    #[serde(flatten)]
    pub setup: Setup,
}

impl ForeignInstance {
    /// `path` ist der Instanzordner im anderen Launcher, `root` der Ordner, in dem die Suche ihn fand.
    fn new(launcher: Launcher, root: &Path, path: String, Found { game_dir, setup }: Found) -> Self {
        let unsupported = forge::check_loader(setup.loader, &setup.minecraft_version).err().map(|e| e.to_string());
        Self {
            launcher,
            root: text(root),
            path,
            game_dir: text(&game_dir),
            imported: false,
            unsupported,
            contents: Contents::default(),
            setup: setup.vetted(),
        }
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
            let game_dir = Path::new(&instance.game_dir);
            instance.contents = skip_unreadable(game_dir, Contents::of(game_dir), "Inhalt der Instanz nicht lesbar; ohne Zahlen gelistet");
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
    let mut found: Vec<ForeignInstance> = skip_unreadable(root, modrinth_app::scan(root), INSTANCE_SKIPPED)
        .into_iter()
        .map(|found| ForeignInstance::new(Launcher::Modrinth, root, text(&found.game_dir), found))
        .collect();
    let folders = subdirs(root);
    // Die CurseForge App nennt ihn `Instances`; Linux unterscheidet das von `instances`.
    let instances: Vec<PathBuf> =
        folders.iter().filter(|dir| folder_name(dir).eq_ignore_ascii_case("instances")).flat_map(|dir| subdirs(dir)).collect();
    let candidates = std::iter::once(root.to_owned()).chain(folders).chain(instances);
    found.extend(candidates.filter_map(|dir| skip_unreadable(&dir, read(root, &dir), INSTANCE_SKIPPED)));
    found
}

const INSTANCE_SKIPPED: &str = "Instanz eines anderen Launchers übersprungen";

/// Liest die Instanz eines Launchers in einem Ordner; `None`, wenn der Ordner keine ist.
type Reader = fn(&Path) -> AppResult<Option<Found>>;

/// Instanz in `dir` (gefunden unter `root`), erkannt an der Datei, die der jeweilige Launcher dort ablegt.
fn read(root: &Path, dir: &Path) -> AppResult<Option<ForeignInstance>> {
    let readers: [(Launcher, Reader); 3] =
        [(Launcher::Prism, prism::read), (Launcher::CurseForge, curseforge::read), (Launcher::AtLauncher, atlauncher::read)];
    for (launcher, read) in readers {
        if let Some(found) = read(dir)? {
            return Ok(Some(ForeignInstance::new(launcher, root, text(dir), found)));
        }
    }
    Ok(None)
}

/// Eine unlesbare Datei eines anderen Launchers darf den Vorgang nicht abbrechen: mit `consequence` protokollieren
/// und mit dem leeren Wert weiter.
fn skip_unreadable<T: Default>(path: &Path, result: AppResult<T>, consequence: &str) -> T {
    result.unwrap_or_else(|err| {
        tracing::warn!(path = %path.display(), %err, "{consequence}");
        T::default()
    })
}

fn subdirs(dir: &Path) -> Vec<PathBuf> {
    let Ok(entries) = fs::read_dir(dir) else { return Vec::new() };
    entries.flatten().map(|e| e.path()).filter(|p| p.is_dir()).collect()
}

/// Kennungsdatei eines Launchers; fehlt sie, ist der Ordner keine Instanz dieses Launchers.
fn read_marker(path: &Path) -> AppResult<Option<Vec<u8>>> {
    Ok(none_if_missing(fs::read(path))?)
}

/// JSON der anderen Launcher; Windows-Programme schreiben es teils mit BOM.
fn from_json<T: DeserializeOwned>(data: &[u8]) -> AppResult<T> {
    Ok(serde_json::from_slice(data.strip_prefix(b"\xEF\xBB\xBF").unwrap_or(data))?)
}

/// Loader nach dem Namen, den die anderen Launcher schreiben: wie der serde-Name, Groß- und Kleinschreibung egal.
fn loader_named(name: &str) -> AppResult<ModLoader> {
    ModLoader::from_name(&name.to_ascii_lowercase())
        .ok_or_else(|| AppError::invalid(coded!("errors.app.import.loaderUnsupported", name = name)))
}

/// JVM-Argumente aus einer Zeile, wie die Launcher sie speichern.
fn split_args(line: &str) -> Vec<String> {
    line.split_whitespace().map(String::from).collect()
}

/// Die Befehle, die der andere Launcher für die Instanz eingestellt hat (nicht leer); Pumpkin Launcher übernimmt keinen.
fn foreign_commands(pre_launch: Option<&str>, post_exit: Option<&str>, wrapper: Option<&str>) -> Vec<NotAdopted> {
    [(pre_launch, NotAdopted::PreLaunchCommand), (post_exit, NotAdopted::PostExitCommand), (wrapper, NotAdopted::WrapperCommand)]
        .into_iter()
        .filter(|(command, _)| command.is_some_and(|c| !c.trim().is_empty()))
        .map(|(_, kind)| kind)
        .collect()
}

/// Eigene Fenstergröße; ohne beide Maße gilt das Fenster, wie Minecraft es selbst öffnet.
fn window_size(width: Option<u32>, height: Option<u32>) -> GameWindow {
    match (width, height) {
        (Some(width), Some(height)) if width > 0 && height > 0 => GameWindow::Size { width, height },
        _ => GameWindow::Default,
    }
}

/// Bilddatei eines anderen Launchers als `data:`-URL; `None` bei fehlender, zu großer oder gar keiner Bilddatei.
/// Erst die Kennung des Formats macht aus einem beliebigen Pfad aus fremden Dateien keinen Dateileser.
fn read_icon(path: &Path) -> Option<String> {
    let meta = fs::symlink_metadata(path).ok()?;
    if !meta.is_file() || meta.len() > ICON_LIMIT {
        return None;
    }
    let bytes = fs::read(path).ok()?;
    Some(data_url(image_mime(&bytes)?, &bytes))
}

fn image_mime(bytes: &[u8]) -> Option<&'static str> {
    match bytes {
        [0x89, b'P', b'N', b'G', ..] => Some("image/png"),
        [0xFF, 0xD8, 0xFF, ..] => Some("image/jpeg"),
        [b'G', b'I', b'F', b'8', ..] => Some("image/gif"),
        [b'R', b'I', b'F', b'F', _, _, _, _, b'W', b'E', b'B', b'P', ..] => Some("image/webp"),
        _ => None,
    }
}

fn folder_name(dir: &Path) -> String {
    dir.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default()
}

fn text(path: &Path) -> String {
    path.to_string_lossy().into_owned()
}

/// Welche erkannte Instanz importiert wird und wie sie heißen soll. Alles Weitere liest das Backend selbst neu aus
/// den Dateien des anderen Launchers; aus dem Frontend kommt nur die Wahl.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportRequest {
    /// `root` und `path` der erkannten Instanz (`ForeignInstance`).
    pub root: String,
    pub path: String,
    pub name: String,
}

/// Die Instanz, die `request` meint, frisch aus den Dateien des anderen Launchers gelesen (eine Erkennung unter
/// `request.root`, abgeglichen mit `request.path`) und mit dem gewählten Namen.
pub async fn resolve(request: ImportRequest) -> AppResult<ForeignInstance> {
    let name = instance_name(&request.name)?.to_owned();
    let root = PathBuf::from(request.root);
    if !root.is_absolute() {
        return Err(AppError::invalid(coded!("errors.app.folderNotAbsolute")));
    }
    let found = blocking(move |_| {
        scan(&root)
            .into_iter()
            .find(|found| found.path == request.path)
            .ok_or_else(|| AppError::invalid(coded!("errors.app.import.instanceGone")))
    })
    .await?;
    Ok(ForeignInstance { setup: Setup { name, ..found.setup }, ..found })
}

/// Neue Instanz aus `source`, einer Erkennung des Backends (siehe `resolve`): Einstellungen übernehmen,
/// Spielordner kopieren und Inhalte in den Mod-Cache legen (Fortschritt als Phasen `copy` und `hash`), dann
/// eintragen, damit Updates gehen. Bei Fehler oder Abbruch verschwindet die halbe Instanz wieder.
pub async fn import(state: &AppState, source: ForeignInstance, progress: SharedProgress) -> AppResult<Instance> {
    check(&source)?;
    let game_dir = PathBuf::from(source.game_dir);
    let origins = curseforge::origins(&game_dir);
    let setup = source.setup;
    let mut instance = Instance {
        memory_mb: setup.memory_mb,
        min_memory_mb: setup.min_memory_mb,
        jvm_args: setup.jvm_args,
        java_path: setup.java_path,
        window: setup.window,
        group: setup.group,
        notes: setup.notes,
        icon: setup.icon.map(|src| InstanceIcon::Image { src }),
        imported_from: Some(source.path),
        ..Instance::from_new(NewInstance {
            name: setup.name,
            minecraft_version: setup.minecraft_version,
            loader: setup.loader,
            loader_version: setup.loader_version,
        })
    };
    let (dirs, target, fresh) = (state.dirs.clone(), state.dirs.game_dir(&instance.id), instance.clone());
    let (guard, found) = content::populate_new_dir(&state.dirs, state.dirs.instance(&instance.id), move |stop| {
        copy_files(&files_to_copy(&game_dir, &target)?, &|done, total| {
            check_cancelled(stop)?;
            progress(Phase::Copy, done, total);
            Ok(())
        })?;
        content::cached_untracked(&dirs, &fresh, &*progress, stop)
    })
    .await?;
    content::record_untracked(&mut instance.mods, &found, &origins).await?;
    let instance = state.instances.insert(instance)?;
    guard.disarm();
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
        return Err(AppError::invalid(coded!("errors.app.import.gameDirGone", dir = source.game_dir)));
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
            files.extend(walk(source, &path)?);
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
    use crate::{models::ModSource, services::{progress::ignored, write_files}};

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
        let single = root.join("instances").join("Welt");
        let again = scan(&single);
        assert_eq!((again[0].path.as_str(), again[0].root.as_str()), (found[0].path.as_str(), single.to_str().unwrap()));
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

    fn request(from: &ForeignInstance) -> ImportRequest {
        ImportRequest { root: from.root.clone(), path: from.path.clone(), name: from.setup.name.clone() }
    }

    #[test]
    fn contents_count_size_mods_and_worlds_of_what_the_import_copies() {
        let dir = std::env::temp_dir().join(crate::models::new_id());
        write_files(
            &dir,
            &[
                ("mods/a.jar", "12345"),
                ("mods/b.jar.disabled", "123"),
                ("mods/config/c.jar", "1"),
                ("disabledmods/off.jar", "12"),
                ("saves/Welt 1/level.dat", "1234"),
                ("saves/Welt 1/region/r.0.0.mca", "12"),
                ("saves/Welt 2/level.dat", "1"),
                ("logs/latest.log", "ignored"),
            ],
        );

        let contents = Contents::of(&dir).unwrap();

        assert_eq!(contents, Contents { size_bytes: 5 + 3 + 1 + 2 + 4 + 2 + 1, mods: 3, worlds: 2 });
        assert_eq!(Contents::of(&dir.join("fehlt")).unwrap(), Contents::default());
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn settings_from_other_launchers_are_vetted_like_our_own() {
        let setup = Setup {
            jvm_args: ["-Xss2M", "-javaagent:x.jar", "", "@args", "-XX:+UseG1GC"].map(String::from).to_vec(),
            java_path: Some("/gibt/es/nicht/java".into()),
            memory_mb: Some(0),
            notes: format!("  {}", "ä".repeat(MAX_NOTES_LEN + 5)),
            group: Some("   ".into()),
            icon: Some("data:image/svg+xml;base64,AAAA".into()),
            ..Setup::new("Welt".into(), "1.21.1".into(), ModLoader::Vanilla, None)
        };

        let vetted = setup.vetted();

        assert_eq!(vetted.jvm_args, ["-Xss2M", "-XX:+UseG1GC"]);
        assert_eq!(vetted.not_adopted, [NotAdopted::JvmArgs, NotAdopted::JavaPath]);
        assert_eq!((vetted.java_path, vetted.memory_mb, vetted.group, vetted.icon), (None, None, None, None));
        assert_eq!(vetted.notes.chars().count(), MAX_NOTES_LEN);
    }

    #[tokio::test]
    async fn import_takes_over_settings_notes_group_and_the_chosen_name() {
        let root = std::env::temp_dir().join(crate::models::new_id());
        let state = AppState::load(&root.join("data")).unwrap();
        let instances = root.join("Prism/instances");
        let cfg = "name=Welt\nnotes=Zum Testen\nOverrideWindow=true\nMinecraftWinWidth=1280\nMinecraftWinHeight=720\n\
            OverrideCommands=true\nWrapperCommand=gamemoderun\nOverrideJavaArgs=true\nJvmArgs=\"-javaagent:evil.jar -Xss2M\"\n";
        write_files(&instances.join("Welt"), &[("instance.cfg", cfg), ("mmc-pack.json", PACK)]);
        write_files(&instances, &[("instgroups.json", r#"{"groups": {"Freunde": {"instances": ["Welt"]}}}"#)]);
        add_content(&instances.join("Welt/minecraft"));
        let from = detect(&state, Some(&instances)).await.unwrap().remove(0);
        assert_eq!(from.setup.not_adopted, [NotAdopted::WrapperCommand, NotAdopted::JvmArgs]);

        let chosen = resolve(ImportRequest { name: "  Meine Welt ".into(), ..request(&from) }).await.unwrap();
        let instance = import(&state, chosen, ignored()).await.unwrap();

        assert_eq!(instance.name, "Meine Welt");
        assert_eq!((instance.notes.as_str(), instance.group.as_deref()), ("Zum Testen", Some("Freunde")));
        assert_eq!((instance.window, instance.jvm_args.as_slice()), (GameWindow::Size { width: 1280, height: 720 }, ["-Xss2M".to_owned()].as_slice()));
        fs::remove_dir_all(root).unwrap();
    }

    #[tokio::test]
    async fn import_copies_without_touching_the_source() {
        let root = std::env::temp_dir().join(crate::models::new_id());
        let state = AppState::load(&root.join("data")).unwrap();
        let source = root.join("Prism/instances/Welt");
        let cfg = "name=Welt\nOverrideMemory=true\nMaxMemAlloc=4096\nMinMemAlloc=1024\niconKey=eigenes\n";
        write_files(&source, &[("instance.cfg", cfg), ("mmc-pack.json", PACK)]);
        let png = [&[0x89, b'P', b'N', b'G'][..], b"rest"].concat();
        write_files(&root.join("Prism/icons"), &[("eigenes.png", png.as_slice())]);
        add_content(&source.join("minecraft"));
        let from = detect(&state, Some(&source)).await.unwrap().remove(0);

        let instance = import(&state, from, ignored()).await.unwrap();

        assert_eq!((instance.name.as_str(), instance.loader, instance.memory_mb), ("Welt", ModLoader::Fabric, Some(4096)));
        assert_eq!((instance.min_memory_mb, instance.jvm_args.len()), (Some(1024), 0));
        assert_eq!(instance.icon, Some(InstanceIcon::Image { src: data_url("image/png", &png) }));
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

        let instance = import(&state, from, ignored()).await.unwrap();

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
    async fn unsupported_sources_are_rejected() {
        let root = std::env::temp_dir().join(crate::models::new_id());
        let state = AppState::load(&root.join("data")).unwrap();
        let old_forge = r#"{"gameVersion": "1.12.2", "baseModLoader": {"name": "forge-14.23.5.2860"}}"#;
        write_files(&root.join("da"), &[("minecraftinstance.json", old_forge)]);
        let from = detect(&state, Some(&root.join("da"))).await.unwrap().remove(0);
        assert!(from.unsupported.is_some());

        assert!(import(&state, from, ignored()).await.is_err());

        assert!(state.instances.list().is_empty());
        fs::remove_dir_all(root).unwrap();
    }

    #[tokio::test]
    async fn only_what_the_backend_detects_can_be_chosen_for_import() {
        let root = std::env::temp_dir().join(crate::models::new_id());
        let state = AppState::load(&root.join("data")).unwrap();
        write_files(&root.join("ok"), &[("minecraftinstance.json", r#"{"gameVersion": "1.21.1", "name": "Pack"}"#)]);
        let valid = detect(&state, Some(&root.join("ok"))).await.unwrap().remove(0);

        let renamed = resolve(ImportRequest { name: " Neu ".into(), ..request(&valid) }).await.unwrap();
        assert_eq!((renamed.setup.name.as_str(), renamed.game_dir.as_str()), ("Neu", valid.game_dir.as_str()));

        let refused = [
            ImportRequest { path: text(&root.join("woanders")), ..request(&valid) },
            ImportRequest { root: "relativ".into(), ..request(&valid) },
            ImportRequest { root: text(&root.join("leer")), ..request(&valid) },
            ImportRequest { name: "  ".into(), ..request(&valid) },
            ImportRequest { name: "x".repeat(MAX_NAME_LEN + 1), ..request(&valid) },
        ];
        for request in refused {
            assert!(resolve(request).await.is_err());
        }
        fs::remove_dir_all(root).unwrap();
    }
}
