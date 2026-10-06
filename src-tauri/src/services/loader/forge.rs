//! Forge und NeoForge über ihren offiziellen Installer: `install_profile.json` nennt Libraries und
//! Processors (Java-Programme, die das Client-JAR entschlüsseln, umbenennen und patchen), die
//! `version.json` darin ist ein Profil mit `inheritsFrom` auf Vanilla. Beide Loader nutzen dasselbe
//! Installer-Format; unterstützt wird es ab Forge für Minecraft 1.16.5 bzw. NeoForge ab 1.20.1.
use std::collections::{HashMap, HashSet};
use std::fs;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::process::Output;

use serde::Deserialize;

use super::maven::{artifact_url, maven_path, maven_sha1};
use super::{compare_versions, profile_path, save_profile, segment, LoaderProfile, LoaderTarget, LoaderVersion};
use crate::coded;
use crate::error::{AppError, AppResult};
use crate::models::ModLoader;
use crate::services::download::{self, dedup_by_path, is_sha1, Job};
use crate::services::limits::{FILE_LIMIT, ZIP_JSON_LIMIT};
use crate::services::mojang::{secure_logging_libraries, Argument, Arguments, Download, Library};
use crate::services::progress::CountFn;
use crate::services::rules::Env;
use crate::services::{blocking, zip_guard, Dirs};

const FORGE_MAVEN: &str = "https://maven.minecraftforge.net/releases";
const NEOFORGE_MAVEN: &str = "https://maven.neoforged.net/releases";
const FORGE_VERSIONS_URL: &str = "https://files.minecraftforge.net/net/minecraftforge/forge/maven-metadata.json";
const NEOFORGE_VERSIONS_URL: &str = "https://maven.neoforged.net/api/maven/versions/releases/net/neoforged/neoforge";
const LEGACY_NEOFORGE_VERSIONS_URL: &str = "https://maven.neoforged.net/api/maven/versions/releases/net/neoforged/forge";
/// Die einzige Minecraft-Version, für die NeoForge noch als Forge-Abzweig erschien.
const LEGACY_NEOFORGE_MC: &str = "1.20.1";

/// Unter welchem Maven-Artefakt ein Loader für eine Minecraft-Version erscheint.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Artifact {
    Forge,
    NeoForge,
    /// NeoForge für 1.20.1: `net.neoforged:forge:1.20.1-<version>`.
    LegacyNeoForge,
}

impl Artifact {
    /// Dieses Modul bedient nur Forge und NeoForge.
    fn of(loader: ModLoader, mc: &str) -> Self {
        match loader {
            ModLoader::NeoForge if mc == LEGACY_NEOFORGE_MC => Self::LegacyNeoForge,
            ModLoader::NeoForge => Self::NeoForge,
            _ => Self::Forge,
        }
    }

    fn repo(self) -> &'static str {
        match self {
            Self::Forge => FORGE_MAVEN,
            Self::NeoForge | Self::LegacyNeoForge => NEOFORGE_MAVEN,
        }
    }

    /// ID der Loader-Version, wie im Installer: `neoforge-21.1.252`, `1.21.1-forge-52.1.16`.
    fn profile_id(self, mc: &str, version: &str) -> String {
        match self {
            Self::Forge => format!("{mc}-forge-{version}"),
            Self::NeoForge => format!("neoforge-{version}"),
            Self::LegacyNeoForge => format!("{mc}-neoforge-{version}"),
        }
    }

    fn installer_coord(self, mc: &str, version: &str) -> String {
        match self {
            Self::Forge => format!("net.minecraftforge:forge:{mc}-{version}:installer"),
            Self::NeoForge => format!("net.neoforged:neoforge:{version}:installer"),
            Self::LegacyNeoForge => format!("net.neoforged:forge:{mc}-{version}:installer"),
        }
    }
}

#[derive(Debug, Clone, Default, Deserialize)]
struct InstallerArtifact {
    #[serde(default)]
    url: String,
    #[serde(default)]
    sha1: Option<String>,
}

#[derive(Debug, Clone, Default, Deserialize)]
struct ArtifactDownloads {
    #[serde(default)]
    artifact: Option<InstallerArtifact>,
}

/// Library im Installer-Format. Der Pfad kommt immer aus der Koordinate, nie aus dem JSON.
/// Eine leere URL heißt: liegt im Installer (`maven/…`) oder entsteht durch einen Processor.
#[derive(Debug, Clone, Deserialize)]
pub struct InstallerLibrary {
    name: String,
    #[serde(default)]
    downloads: ArtifactDownloads,
}

impl InstallerLibrary {
    fn url(&self) -> &str {
        self.downloads.artifact.as_ref().map_or("", |a| a.url.as_str())
    }

    fn sha1(&self) -> Option<String> {
        self.downloads.artifact.as_ref().and_then(|a| a.sha1.clone()).filter(|s| is_sha1(s))
    }

    fn to_library(&self) -> AppResult<Library> {
        let download = Download { path: Some(maven_path(&self.name)?), sha1: self.sha1().unwrap_or_default(), url: self.url().to_owned() };
        Ok(Library::from_artifact(&self.name, download))
    }
}

/// Die `version.json` aus dem Installer; nach erfolgreicher Installation unter
/// `versions/<id>/<id>.json` abgelegt (gilt dann als installiert).
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Profile {
    pub id: String,
    pub inherits_from: String,
    pub main_class: String,
    #[serde(default)]
    pub arguments: Arguments,
    #[serde(default)]
    pub libraries: Vec<InstallerLibrary>,
}

impl LoaderProfile for Profile {
    fn id_for(target: LoaderTarget) -> String {
        Artifact::of(target.loader, target.mc).profile_id(target.mc, target.version)
    }

    fn inherits_from(&self) -> &str {
        &self.inherits_from
    }

    fn main_class(&self) -> &str {
        &self.main_class
    }

    /// Jede Koordinate nur einmal: Installer-Profile nennen manche doppelt.
    fn libraries(&self) -> AppResult<Vec<Library>> {
        let mut seen = HashSet::new();
        let mut libraries = self.libraries.iter().filter(|lib| seen.insert(lib.name.as_str()))
            .map(InstallerLibrary::to_library).collect::<AppResult<Vec<_>>>()?;
        secure_logging_libraries(&mut libraries);
        Ok(libraries)
    }

    fn arguments(&self) -> (Vec<Argument>, Vec<Argument>) {
        (self.arguments.jvm.clone(), self.arguments.game.clone())
    }
}

impl Profile {
    /// Forge 1.16.5 findet diese Dateien über LibraryFinder, nicht über version.json/libraries.
    /// Nicht in den JVM-Classpath aufnehmen: Minecraft-Klassen müssen durch den TransformingClassLoader.
    fn runtime_coordinates(&self) -> AppResult<Vec<String>> {
        if self.inherits_from != "1.16.5" {
            return Ok(Vec::new());
        }
        let argument = |key: &str| -> AppResult<&str> {
            self.arguments.game.windows(2).find_map(|pair| match pair {
                [Argument::Plain(name), Argument::Plain(value)] if name == key => Some(value.as_str()),
                _ => None,
            }).ok_or_else(|| AppError::invalid(coded!("errors.game.installerVariableUnknown", variable = key)))
        };
        let forge = argument("--fml.forgeVersion")?;
        let mcp = argument("--fml.mcpVersion")?;
        let group = argument("--fml.forgeGroup")?;
        let coordinates = vec![
            format!("{group}:forge:{}-{forge}:universal", self.inherits_from),
            format!("{group}:forge:{}-{forge}:client", self.inherits_from),
            format!("net.minecraft:client:{}-{mcp}:extra", self.inherits_from),
            format!("net.minecraft:client:{}-{mcp}:srg", self.inherits_from),
        ];
        for coordinate in &coordinates {
            maven_path(coordinate)?;
        }
        Ok(coordinates)
    }
}

#[derive(Debug, Deserialize)]
struct DataEntry {
    client: String,
}

#[derive(Debug, Deserialize)]
struct Processor {
    #[serde(default)]
    sides: Option<Vec<String>>,
    jar: String,
    #[serde(default)]
    classpath: Vec<String>,
    #[serde(default)]
    args: Vec<String>,
    #[serde(default)]
    outputs: HashMap<String, String>,
}

impl Processor {
    fn runs_on_client(&self) -> bool {
        self.sides.as_ref().is_none_or(|sides| sides.iter().any(|side| side == "client"))
    }
}

#[derive(Debug, Deserialize)]
struct InstallProfile {
    #[serde(default = "default_json")]
    json: String,
    data: HashMap<String, DataEntry>,
    processors: Vec<Processor>,
    #[serde(default)]
    libraries: Vec<InstallerLibrary>,
}

fn default_json() -> String {
    "/version.json".into()
}

/// Zahlen einer Minecraft-Version (`1.21.1` → [1, 21, 1]); Snapshots liefern `None`.
fn mc_numbers(mc: &str) -> Option<Vec<u32>> {
    mc.split('.').map(|p| p.parse().ok()).collect()
}

/// Ältere Versionen haben ein anderes Installer-Format bzw. keinen Loader; dann eine klare Absage.
/// Vanilla, Fabric und Quilt gibt es für alle Versionen.
pub fn check_loader(loader: ModLoader, mc: &str) -> AppResult<()> {
    let from = match loader {
        ModLoader::Forge => "1.16.5",
        ModLoader::NeoForge => LEGACY_NEOFORGE_MC,
        ModLoader::Vanilla | ModLoader::Fabric | ModLoader::Quilt => return Ok(()),
    };
    let supported = match (loader, mc_numbers(mc).as_deref()) {
        (_, Some([major, ..])) if *major >= 2 => true,
        (ModLoader::Forge, Some([1, 16, patch, ..])) => *patch >= 5,
        (ModLoader::Forge, Some([1, minor, ..])) => *minor >= 17,
        // 1.20.1: NeoForges erste Versionen, noch als Forge-Abzweig (`net.neoforged:forge`).
        (ModLoader::NeoForge, Some([1, 20, patch, ..])) => *patch >= 1,
        (ModLoader::NeoForge, Some([1, minor, ..])) => *minor >= 21,
        _ => false,
    };
    if supported {
        return Ok(());
    }
    Err(AppError::invalid(coded!("errors.game.loaderUnsupportedMinecraft", loader = loader.display_name(), from = from, mc = mc)))
}

/// NeoForge-Versionen beginnen mit der Minecraft-Version ohne führende `1.`:
/// `1.21.1` → `21.1.`, `1.21` → `21.0.`, `26.1` → `26.1.0.`.
fn neoforge_prefix(mc: &str) -> Option<String> {
    let n = mc_numbers(mc)?;
    Some(match n.as_slice() {
        [1, minor] => format!("{minor}.0."),
        [1, minor, patch] => format!("{minor}.{patch}."),
        [major, minor] => format!("{major}.{minor}.0."),
        [major, minor, patch] => format!("{major}.{minor}.{patch}."),
        _ => return None,
    })
}

#[derive(Deserialize)]
struct NeoForgeVersions {
    versions: Vec<String>,
}

/// Loader-Versionen zu einer Minecraft-Version, neueste zuerst.
pub(super) async fn loader_versions(client: &reqwest::Client, loader: ModLoader, mc: &str) -> AppResult<Vec<LoaderVersion>> {
    check_loader(loader, segment(mc)?)?;
    let mut versions = match Artifact::of(loader, mc) {
        Artifact::Forge => forge_versions(client, mc).await?,
        Artifact::NeoForge => neoforge_versions(client, mc).await?,
        Artifact::LegacyNeoForge => legacy_neoforge_versions(client).await?,
    };
    versions.sort_by(|a, b| compare_versions(&b.version, &a.version));
    Ok(versions)
}

/// Forge führt nur Releases.
async fn forge_versions(client: &reqwest::Client, mc: &str) -> AppResult<Vec<LoaderVersion>> {
    let mut all: HashMap<String, Vec<String>> = download::get_json(client, FORGE_VERSIONS_URL).await?;
    let prefix = format!("{mc}-");
    Ok(all
        .remove(mc)
        .unwrap_or_default()
        .into_iter()
        .filter_map(|v| v.strip_prefix(&prefix).map(str::to_owned))
        .map(|version| LoaderVersion { stable: true, version })
        .collect())
}

async fn neoforge_versions(client: &reqwest::Client, mc: &str) -> AppResult<Vec<LoaderVersion>> {
    let all: NeoForgeVersions = download::get_json(client, NEOFORGE_VERSIONS_URL).await?;
    let Some(prefix) = neoforge_prefix(mc) else { return Ok(Vec::new()) };
    Ok(all.versions.into_iter().filter(|v| v.starts_with(&prefix)).map(LoaderVersion::from_tag).collect())
}

async fn legacy_neoforge_versions(client: &reqwest::Client) -> AppResult<Vec<LoaderVersion>> {
    let all: NeoForgeVersions = download::get_json(client, LEGACY_NEOFORGE_VERSIONS_URL).await?;
    let prefix = format!("{LEGACY_NEOFORGE_MC}-");
    Ok(all.versions.into_iter().filter_map(|v| v.strip_prefix(&prefix).map(str::to_owned)).map(LoaderVersion::from_tag).collect())
}

/// Ersetzt ein Processor-Argument: `[koordinate]` → Library-Pfad, `'text'` → Text,
/// sonst `{SCHLÜSSEL}` durch Werte aus `data` (unbekannte Schlüssel sind ein Fehler).
fn resolve(arg: &str, data: &HashMap<String, String>, libraries: &Path) -> AppResult<String> {
    if let Some(coord) = arg.strip_prefix('[').and_then(|a| a.strip_suffix(']')) {
        return Ok(path_text(&libraries.join(maven_path(coord)?)));
    }
    if let Some(text) = arg.strip_prefix('\'').and_then(|a| a.strip_suffix('\'')) {
        return Ok(text.to_owned());
    }
    let mut out = String::with_capacity(arg.len());
    let mut rest = arg;
    while let Some(start) = rest.find('{') {
        let end = rest[start..].find('}').ok_or_else(|| AppError::invalid(coded!("errors.game.installerArgumentIncomplete", arg = arg)))?;
        let key = &rest[start + 1..start + end];
        let value = data.get(key).ok_or_else(|| AppError::invalid(coded!("errors.game.installerVariableUnknown", variable = format!("{{{key}}}"))))?;
        out.push_str(&rest[..start]);
        out.push_str(value);
        rest = &rest[start + end + 1..];
    }
    out.push_str(rest);
    Ok(out)
}

fn path_text(path: &Path) -> String {
    path.to_string_lossy().into_owned()
}

/// `Main-Class` aus dem Manifest eines JARs (Fortsetzungszeilen beginnen mit einem Leerzeichen).
fn main_class(jar: &Path) -> AppResult<String> {
    let mut zip = zip::ZipArchive::new(fs::File::open(jar)?)?;
    let mut manifest = String::new();
    zip.by_name("META-INF/MANIFEST.MF")?.read_to_string(&mut manifest)?;
    manifest
        .replace("\r\n ", "")
        .replace("\n ", "")
        .lines()
        .find_map(|l| l.strip_prefix("Main-Class:").map(|v| v.trim().to_owned()))
        .ok_or_else(|| AppError::invalid(coded!("errors.game.installerNoMainClass", path = jar.display())))
}

/// Was das Installer-JAR mitbringt.
struct Installer {
    profile: InstallProfile,
    /// Die `version.json` roh, so wird sie nach der Installation abgelegt.
    version_json: Vec<u8>,
    /// Entpackte `/data/…`-Einträge, nach ihrem Wert in `data`.
    data_files: HashMap<String, PathBuf>,
}

type InstallerZip = zip::ZipArchive<fs::File>;

/// Liest das Installer-JAR: Install-Profil, `version.json` (roh) und entpackt `maven/…` in die
/// Libraries sowie die referenzierten `/data/…`-Dateien nach `tmp`.
fn read_installer(installer: &Path, libraries: &Path, tmp: &Path) -> AppResult<Installer> {
    let mut zip = zip::ZipArchive::new(fs::File::open(installer)?)?;
    let profile = read_profile(&mut zip)?;
    let version_json = read_entry(&mut zip, &profile.json, ZIP_JSON_LIMIT)?;
    #[derive(Deserialize)]
    struct VersionLibraries {
        #[serde(default)]
        libraries: Vec<InstallerLibrary>,
    }
    let version: VersionLibraries = serde_json::from_slice(&version_json)?;
    let hashes = profile.libraries.iter().chain(&version.libraries)
        .filter_map(|lib| lib.sha1().map(|sha1| Ok((PathBuf::from(maven_path(&lib.name)?), sha1))))
        .collect::<AppResult<HashMap<_, _>>>()?;
    extract_maven(&mut zip, libraries, &hashes)?;
    let data_files = extract_data_files(&mut zip, &profile, tmp)?;
    Ok(Installer { profile, version_json, data_files })
}

/// Eintrag des Installers im Speicher, höchstens `limit` Bytes.
fn read_entry(zip: &mut InstallerZip, name: &str, limit: u64) -> AppResult<Vec<u8>> {
    zip_guard::read_entry(&mut zip.by_name(name.trim_start_matches('/'))?, limit)
}

fn read_profile(zip: &mut InstallerZip) -> AppResult<InstallProfile> {
    serde_json::from_slice(&read_entry(zip, "install_profile.json", ZIP_JSON_LIMIT)?).map_err(|e| {
        tracing::warn!(%e, "Install-Profil in altem Format");
        AppError::invalid(coded!("errors.game.installerFormatOld"))
    })
}

/// Entpackt `maven/…` in die Libraries.
fn extract_maven(zip: &mut InstallerZip, libraries: &Path, hashes: &HashMap<PathBuf, String>) -> AppResult<()> {
    for i in 0..zip.len() {
        let mut entry = zip.by_index(i)?;
        // `enclosed_name` verwirft `..` und absolute Pfade.
        let Some(rel) = entry.enclosed_name().and_then(|p| p.strip_prefix("maven").ok().map(Path::to_path_buf)) else { continue };
        let expected = hashes.get(&rel);
        let target = libraries.join(rel);
        let current = fs::metadata(&target).is_ok_and(|m| m.len() == entry.size())
            && expected.is_none_or(|sha1| download::sha1_file(&target).is_ok_and(|actual| actual.eq_ignore_ascii_case(sha1)));
        if entry.is_dir() || current {
            continue;
        }
        if let Some(parent) = target.parent() {
            fs::create_dir_all(parent)?;
        }
        download::write_stream_atomic(&mut entry, &target)?;
        if let Some(sha1) = expected {
            if !download::sha1_file(&target)?.eq_ignore_ascii_case(sha1) {
                return Err(AppError::Download(coded!("errors.game.loaderSetupWrongFile", loader = "Forge", step = "maven").into()));
            }
        }
    }
    Ok(())
}

/// Entpackt die in `data` genannten `/data/…`-Dateien flach nach `tmp`.
fn extract_data_files(zip: &mut InstallerZip, profile: &InstallProfile, tmp: &Path) -> AppResult<HashMap<String, PathBuf>> {
    fs::create_dir_all(tmp)?;
    let mut files = HashMap::new();
    for entry in profile.data.values().filter(|d| d.client.starts_with('/')) {
        let name = entry.client.trim_start_matches('/');
        let invalid = || AppError::invalid(coded!("errors.game.installerEntryInvalid", name = name));
        let file_name = Path::new(name).file_name().ok_or_else(invalid)?;
        if name.contains("..") {
            return Err(invalid());
        }
        let target = tmp.join(file_name);
        fs::write(&target, read_entry(zip, name, FILE_LIMIT)?)?;
        files.insert(entry.client.clone(), target);
    }
    Ok(files)
}

/// SHA-1 einer Datei; `None`, wenn sie fehlt oder nicht lesbar ist.
async fn file_sha1(path: &Path) -> Option<String> {
    let path = path.to_owned();
    blocking(move |_| Ok(download::sha1_file(&path)?)).await.ok()
}

/// `true`, wenn alle Ausgaben eines Processors mit passender SHA-1 vorliegen.
async fn outputs_ok(outputs: &[(String, String)]) -> bool {
    for (file, sha1) in outputs {
        if file_sha1(Path::new(file)).await.is_none_or(|s| !s.eq_ignore_ascii_case(sha1)) {
            return false;
        }
    }
    true
}

/// Fehlende Classpath- oder direkt vom Loader entdeckte Runtime-Library.
fn missing_library(profile: &Profile, libraries: &Path) -> AppResult<Option<String>> {
    for library in profile.libraries()? {
        if !libraries.join(maven_path(&library.name)?).is_file() {
            return Ok(Some(library.name));
        }
    }
    for coordinate in profile.runtime_coordinates()? {
        if !libraries.join(maven_path(&coordinate)?).is_file() {
            return Ok(Some(coordinate));
        }
    }
    Ok(None)
}

/// Installiert die Loader-Version. Voraussetzung: Vanilla-Client und Java-Runtime sind installiert.
/// `on_progress(erledigt, gesamt)` zählt Libraries und Processors.
pub(super) async fn install(
    client: &reqwest::Client,
    dirs: &Dirs,
    target: LoaderTarget<'_>,
    java: &Path,
    on_progress: CountFn<'_>,
) -> AppResult<Profile> {
    check_loader(target.loader, target.mc)?;
    let setup = Setup::new(dirs, target, java);
    let installer_jar = setup.ensure_installer(client).await?;
    let installer = setup.read_installer(&installer_jar).await?;
    let profile = setup.version_profile(&installer)?;
    let processors: Vec<&Processor> = installer.profile.processors.iter().filter(|p| p.runs_on_client()).collect();
    let jobs = library_jobs(&installer.profile, &profile, &setup.libraries)?;
    let total = (jobs.len() + processors.len()) as u64;
    let downloaded = jobs.len() as u64;
    download::fetch_all(client, jobs, &|done, _| on_progress(done, total)).await?;

    let data = setup.processor_data(&installer_jar, &installer)?;
    let outputs = processors.iter().flat_map(|processor| &processor.outputs)
        .map(|(file, sha1)| Ok((resolve(file, &data, &setup.libraries)?, resolve(sha1, &data, &setup.libraries)?)))
        .collect::<AppResult<Vec<_>>>()?;
    let processing = Processing { setup: &setup, data, count: processors.len(), outputs };
    if setup.complete_installation(&profile, &processing, &installer.version_json).await? {
        on_progress(total, total);
        setup.remove_work_dir().await;
        return Ok(profile);
    }
    for (step, processor) in (1..).zip(&processors) {
        processing.run(step, processor).await?;
        on_progress(downloaded + step as u64, total);
    }
    setup.verify_libraries(&profile)?;
    // Zuletzt schreiben: die Profil-Datei markiert eine vollständige Installation.
    save_profile::<Profile>(dirs, target, &installer.version_json).await?;
    setup.remove_work_dir().await;
    Ok(profile)
}

/// Downloads der Libraries aus Install-Profil und Profil; ohne URL liegen sie im Installer oder entstehen
/// durch einen Processor.
fn library_jobs(install_profile: &InstallProfile, profile: &Profile, root: &Path) -> AppResult<Vec<Job>> {
    let mut jobs = Vec::new();
    let mut libraries = install_profile.libraries.iter().map(InstallerLibrary::to_library)
        .collect::<AppResult<Vec<_>>>()?;
    libraries.extend(profile.libraries()?);
    secure_logging_libraries(&mut libraries);
    for lib in libraries {
        let Some(artifact) = lib.downloads.artifact.as_ref() else { continue };
        if !artifact.url.is_empty() {
            jobs.push(Job::from_download(artifact, root.join(maven_path(&lib.name)?)));
        }
    }
    Ok(dedup_by_path(jobs))
}

/// Ziel und Verzeichnisse einer Forge-Installation.
struct Setup<'a> {
    target: LoaderTarget<'a>,
    dirs: &'a Dirs,
    java: &'a Path,
    libraries: PathBuf,
    /// Arbeitsverzeichnis der Processors, danach entfernt.
    work_dir: PathBuf,
}

impl<'a> Setup<'a> {
    fn new(dirs: &'a Dirs, target: LoaderTarget<'a>, java: &'a Path) -> Self {
        let work_dir = dirs.root.join("tmp").join(Profile::id_for(target));
        Self { target, dirs, java, libraries: dirs.libraries(), work_dir }
    }

    /// Ein Marker reicht nicht: erzeugte Dateien und SHA-1-Ausgaben müssen weiterhin vollständig sein.
    async fn complete_installation(&self, profile: &Profile, processing: &Processing<'_>, official_json: &[u8]) -> AppResult<bool> {
        let cached = tokio::fs::read(profile_path::<Profile>(self.dirs, self.target)).await;
        if !cached.is_ok_and(|bytes| bytes == official_json) || missing_library(profile, &self.libraries)?.is_some() {
            return Ok(false);
        }
        Ok(outputs_ok(&processing.outputs).await)
    }

    /// Lädt das Installer-JAR, geprüft über die `.sha1` daneben, in die Libraries.
    async fn ensure_installer(&self, client: &reqwest::Client) -> AppResult<PathBuf> {
        let artifact = Artifact::of(self.target.loader, self.target.mc);
        let coord = artifact.installer_coord(self.target.mc, self.target.version);
        let path = self.libraries.join(maven_path(&coord)?);
        let url = artifact_url(artifact.repo(), &coord)?;
        let sha1 = maven_sha1(client, &url).await.map_err(|err| self.target.unknown_on_client_error(err))?;
        download::fetch(client, &Job { url, path: path.clone(), sha1: Some(sha1) }).await?;
        Ok(path)
    }

    async fn read_installer(&self, installer_jar: &Path) -> AppResult<Installer> {
        let (installer_jar, libraries, work_dir) = (installer_jar.to_owned(), self.libraries.clone(), self.work_dir.clone());
        blocking(move |_| read_installer(&installer_jar, &libraries, &work_dir)).await
    }

    /// Das Profil aus dem Installer; es muss zur Minecraft-Version gehören.
    fn version_profile(&self, installer: &Installer) -> AppResult<Profile> {
        let profile: Profile = serde_json::from_slice(&installer.version_json)?;
        if profile.inherits_from != self.target.mc {
            let LoaderTarget { mc, version, .. } = self.target;
            let name = self.target.name();
            return Err(AppError::invalid(coded!(
                "errors.game.loaderVersionWrongMinecraft",
                loader = name,
                version = version,
                inherits = profile.inherits_from,
                mc = mc
            )));
        }
        Ok(profile)
    }

    /// Werte für `{SCHLÜSSEL}` in Processor-Argumenten: feste Angaben plus `data` des Install-Profils.
    fn processor_data(&self, installer_jar: &Path, installer: &Installer) -> AppResult<HashMap<String, String>> {
        let mut data: HashMap<String, String> = HashMap::from([
            ("SIDE".to_owned(), "client".to_owned()),
            ("MINECRAFT_JAR".to_owned(), path_text(&self.dirs.version_file(self.target.mc, "jar"))),
            ("MINECRAFT_VERSION".to_owned(), self.target.mc.to_owned()),
            ("ROOT".to_owned(), path_text(&self.dirs.root)),
            ("INSTALLER".to_owned(), path_text(installer_jar)),
            ("LIBRARY_DIR".to_owned(), path_text(&self.libraries)),
        ]);
        for (key, entry) in &installer.profile.data {
            let value = match installer.data_files.get(&entry.client) {
                Some(file) => path_text(file),
                None => resolve(&entry.client, &HashMap::new(), &self.libraries)?,
            };
            data.insert(key.clone(), value);
        }
        Ok(data)
    }

    fn verify_libraries(&self, profile: &Profile) -> AppResult<()> {
        match missing_library(profile, &self.libraries)? {
            Some(library) => Err(AppError::Download(
                coded!("errors.game.loaderIncomplete", loader = self.target.name(), library = library).into(),
            )),
            None => Ok(()),
        }
    }

    async fn remove_work_dir(&self) {
        if let Err(err) = tokio::fs::remove_dir_all(&self.work_dir).await {
            tracing::debug!(%err, "Temp-Verzeichnis des Installers bleibt liegen");
        }
    }
}

/// Die Processors eines Installers mit ihren Variablen.
struct Processing<'a> {
    setup: &'a Setup<'a>,
    data: HashMap<String, String>,
    count: usize,
    outputs: Vec<(String, String)>,
}

impl Processing<'_> {
    /// Führt Schritt `step` aus, außer seine Ausgaben liegen schon mit passender SHA-1 vor.
    async fn run(&self, step: usize, processor: &Processor) -> AppResult<()> {
        let outputs = processor
            .outputs
            .iter()
            .map(|(file, sha1)| Ok((self.resolve(file)?, self.resolve(sha1)?)))
            .collect::<AppResult<Vec<_>>>()?;
        if !outputs.is_empty() && outputs_ok(&outputs).await {
            return Ok(());
        }
        tracing::info!(step, jar = %processor.jar, "Loader-Processor läuft");
        let output = self.execute(processor).await?;
        let name = self.setup.target.name();
        if !output.status.success() {
            let last = failure_line(processor, &output);
            return Err(AppError::Download(
                coded!("errors.game.loaderSetupStepFailed", loader = name, step = step, count = self.count, last = last).into(),
            ));
        }
        if !outputs_ok(&outputs).await {
            return Err(AppError::Download(coded!("errors.game.loaderSetupWrongFile", loader = name, step = step).into()));
        }
        Ok(())
    }

    fn resolve(&self, arg: &str) -> AppResult<String> {
        resolve(arg, &self.data, &self.setup.libraries)
    }

    async fn execute(&self, processor: &Processor) -> AppResult<Output> {
        let libraries = &self.setup.libraries;
        let jar = libraries.join(maven_path(&processor.jar)?);
        let main = {
            let jar = jar.clone();
            blocking(move |_| main_class(&jar)).await?
        };
        let mut classpath = vec![path_text(&jar)];
        for entry in &processor.classpath {
            classpath.push(path_text(&libraries.join(maven_path(entry)?)));
        }
        let args = processor.args.iter().map(|a| self.resolve(a)).collect::<AppResult<Vec<_>>>()?;
        Ok(tokio::process::Command::new(self.setup.java)
            .arg("-cp")
            .arg(classpath.join(Env::current().classpath_separator()))
            .arg(&main)
            .args(&args)
            .current_dir(&self.setup.work_dir)
            .stdin(std::process::Stdio::null())
            .kill_on_drop(true)
            .output()
            .await?)
    }
}

/// Loggt die ganze Ausgabe eines gescheiterten Processors und liefert ihre letzte Zeile für die Meldung.
fn failure_line(processor: &Processor, output: &Output) -> String {
    let log = String::from_utf8_lossy(&output.stdout).into_owned() + &String::from_utf8_lossy(&output.stderr);
    tracing::error!(jar = %processor.jar, code = ?output.status.code(), "Processor fehlgeschlagen:\n{log}");
    log.lines().rev().find(|l| !l.trim().is_empty()).unwrap_or("ohne Ausgabe").trim().to_owned()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::services::launch::{build_args, test_support::plain_spec};
    use crate::services::loader::merge;
    use crate::services::loader::test_support::vanilla_version;

    fn target(loader: ModLoader, mc: &'static str, version: &'static str) -> LoaderTarget<'static> {
        LoaderTarget::new(loader, mc, version).unwrap()
    }

    #[test]
    fn supported_versions() {
        assert!(check_loader(ModLoader::Forge, "1.21.1").is_ok());
        assert!(check_loader(ModLoader::Forge, "1.17").is_ok());
        assert!(check_loader(ModLoader::Forge, "1.16.5").is_ok());
        assert!(check_loader(ModLoader::Forge, "1.16.4").is_err());
        assert!(check_loader(ModLoader::Forge, "1.16").is_err());
        assert!(check_loader(ModLoader::Forge, "1.15.2").is_err());
        assert!(check_loader(ModLoader::NeoForge, "1.20.2").is_ok());
        assert!(check_loader(ModLoader::NeoForge, "1.20.1").is_ok());
        assert!(check_loader(ModLoader::NeoForge, "1.20").is_err());
        assert!(check_loader(ModLoader::Fabric, "1.14").is_ok());
        let legacy = Artifact::of(ModLoader::NeoForge, "1.20.1");
        assert_eq!(legacy.installer_coord("1.20.1", "47.1.106"), "net.neoforged:forge:1.20.1-47.1.106:installer");
        assert_eq!(Profile::id_for(target(ModLoader::NeoForge, "1.20.1", "47.1.106")), "1.20.1-neoforge-47.1.106");
        assert!(check_loader(ModLoader::NeoForge, "26.1").is_ok());
        assert!(check_loader(ModLoader::Forge, "25w14a").is_err());
        assert_eq!(neoforge_prefix("1.21.1").as_deref(), Some("21.1."));
        assert_eq!(neoforge_prefix("1.21").as_deref(), Some("21.0."));
        assert_eq!(neoforge_prefix("26.1").as_deref(), Some("26.1.0."));
        assert!(!"21.10.3".starts_with("21.1."));
        assert_eq!(Profile::id_for(target(ModLoader::Forge, "1.21.1", "52.1.16")), "1.21.1-forge-52.1.16");
        let neoforge = Artifact::of(ModLoader::NeoForge, "1.21.1");
        assert_eq!(neoforge.installer_coord("1.21.1", "21.1.252"), "net.neoforged:neoforge:21.1.252:installer");
    }

    fn legacy_profile() -> Profile {
        serde_json::from_str(include_str!("fixtures/forge-1.16.5-36.2.42-version.json")).unwrap()
    }

    #[test]
    fn official_legacy_profile_preserves_launch_and_processor_contracts() {
        let install: InstallProfile = serde_json::from_str(include_str!("fixtures/forge-1.16.5-36.2.42-install.json")).unwrap();
        let profile = legacy_profile();
        let libs = Path::new("/libs");
        let data: HashMap<_, _> = install.data.iter().filter(|(_, value)| !value.client.starts_with('/'))
            .map(|(key, value)| (key.clone(), resolve(&value.client, &HashMap::new(), libs).unwrap())).collect();
        assert_eq!(install.processors.iter().map(|p| p.jar.as_str()).collect::<Vec<_>>(), [
            "net.minecraftforge:installertools:1.3.0", "net.minecraftforge:jarsplitter:1.1.4",
            "net.md-5:SpecialSource:1.8.5", "net.minecraftforge:binarypatcher:1.0.12",
        ]);
        assert_eq!(resolve("{PATCHED_SHA}", &data, libs).unwrap(), "427f13ce6f486c182c9693e94e907e2eb049773f");
        assert_eq!(profile.runtime_coordinates().unwrap(), [
            "net.minecraftforge:forge:1.16.5-36.2.42:universal",
            "net.minecraftforge:forge:1.16.5-36.2.42:client",
            "net.minecraft:client:1.16.5-20210115.111550:extra",
            "net.minecraft:client:1.16.5-20210115.111550:srg",
        ]);
        let merged = merge(vanilla_version("1.16.5"), &profile).unwrap();
        assert_eq!(merged.java_component(), "jre-legacy");
        assert_eq!(merged.main_class, "cpw.mods.modlauncher.Launcher");
        let dirs = Dirs::new("/d");
        let account = crate::services::auth::offline_account("Notch").unwrap();
        let args = build_args(&plain_spec(&merged, &dirs, &account), &Env { os: "windows", arch: "x86_64", features: Vec::new() }).unwrap();
        assert!(args.windows(2).any(|pair| pair == ["--launchTarget", "fmlclient"]));
        let cp = crate::services::launch::classpath(&merged, &dirs, &Env::current());
        for module in ["log4j-api", "log4j-core", "log4j-slf4j18-impl"] {
            assert!(cp.contains(&dirs.library(&format!("org/apache/logging/log4j/{module}/2.17.1/{module}-2.17.1.jar"))));
        }
        assert!(!cp.iter().any(|path| path.to_string_lossy().contains("2.15.0")));
        let jobs = library_jobs(&install, &profile, libs).unwrap();
        assert!(!jobs.iter().any(|job| job.url.contains("log4j") && !job.url.contains("2.17.1")));
    }

    #[tokio::test]
    async fn completed_legacy_profile_requires_generated_runtime_artifacts() {
        let dirs = Dirs::new(std::env::temp_dir().join(crate::models::new_id()));
        let profile = legacy_profile();
        for library in profile.libraries().unwrap() {
            let path = dirs.library(library.downloads.artifact.unwrap().path.as_deref().unwrap());
            fs::create_dir_all(path.parent().unwrap()).unwrap();
            fs::write(path, b"present").unwrap();
        }
        assert_eq!(missing_library(&profile, &dirs.libraries()).unwrap().as_deref(),
            Some("net.minecraftforge:forge:1.16.5-36.2.42:universal"));
        for coordinate in profile.runtime_coordinates().unwrap() {
            let path = dirs.library(&maven_path(&coordinate).unwrap());
            fs::create_dir_all(path.parent().unwrap()).unwrap();
            fs::write(path, b"present").unwrap();
        }
        assert!(missing_library(&profile, &dirs.libraries()).unwrap().is_none());
        fs::remove_dir_all(dirs.root).unwrap();
    }

    #[tokio::test]
    async fn completed_installation_rechecks_processor_output_sha1() {
        let dirs = Dirs::new(std::env::temp_dir().join(crate::models::new_id()));
        let mut profile = legacy_profile();
        profile.libraries.clear();
        let setup = Setup::new(&dirs, target(ModLoader::Forge, "1.16.5", "36.2.42"), Path::new("java"));
        let runtime = profile.runtime_coordinates().unwrap();
        for coordinate in &runtime {
            let path = dirs.library(&maven_path(coordinate).unwrap());
            fs::create_dir_all(path.parent().unwrap()).unwrap();
            fs::write(path, b"valid").unwrap();
        }
        let output = dirs.library(&maven_path(&runtime[1]).unwrap());
        let processing = Processing {
            setup: &setup, data: HashMap::new(), count: 4,
            outputs: vec![(path_text(&output), download::sha1_hex(b"valid"))],
        };
        let marker = profile_path::<Profile>(&dirs, setup.target);
        fs::create_dir_all(marker.parent().unwrap()).unwrap();
        fs::write(&marker, b"official").unwrap();
        assert!(setup.complete_installation(&profile, &processing, b"official").await.unwrap());
        fs::write(&output, b"wrong").unwrap();
        assert!(!setup.complete_installation(&profile, &processing, b"official").await.unwrap());
        fs::write(&output, b"valid").unwrap();
        fs::write(&marker, b"damaged").unwrap();
        assert!(!setup.complete_installation(&profile, &processing, b"official").await.unwrap());
        fs::remove_dir_all(dirs.root).unwrap();
    }

    #[test]
    fn processor_arguments() {
        let libs = Path::new("/libs");
        let data = HashMap::from([
            ("SIDE".to_owned(), "client".to_owned()),
            ("MC_OFF_SHA".to_owned(), "fd32".to_owned()),
            ("PATCHED".to_owned(), "/libs/p.jar".to_owned()),
        ]);
        assert_eq!(resolve("{SIDE}", &data, libs).unwrap(), "client");
        assert_eq!(resolve("--side={SIDE}/{PATCHED}", &data, libs).unwrap(), "--side=client//libs/p.jar");
        assert_eq!(resolve("'1.21.1-2024'", &data, libs).unwrap(), "1.21.1-2024");
        assert_eq!(resolve("--flag", &data, libs).unwrap(), "--flag");
        assert_eq!(
            resolve("[net.minecraft:client:1.21.1:mappings@tsrg]", &data, libs).unwrap(),
            libs.join("net/minecraft/client/1.21.1/client-1.21.1-mappings.tsrg").to_string_lossy()
        );
        assert_eq!(resolve("{UNKNOWN}", &data, libs).unwrap_err().to_string(), "Installer-Variable {UNKNOWN} unbekannt");
        assert!(resolve("[../../x:y:1]", &data, libs).is_err());
    }

    #[test]
    fn merge_neoforge_profile() {
        let vanilla = vanilla_version("1.21.1");
        // Auszug aus neoforge-21.1.252-installer.jar/version.json und Forge 1.21.1-52.1.16 (leere URL).
        let profile: Profile = serde_json::from_value(serde_json::json!({
            "id": "neoforge-21.1.252", "inheritsFrom": "1.21.1", "type": "release",
            "mainClass": "cpw.mods.bootstraplauncher.BootstrapLauncher",
            "arguments": {
                "game": ["--launchTarget", "forgeclient"],
                "jvm": ["-DignoreList=client-extra,${version_name}.jar", "-DlibraryDirectory=${library_directory}",
                        "-p", "${library_directory}/cpw/mods/bootstraplauncher/2.0.2/bootstraplauncher-2.0.2.jar${classpath_separator}${library_directory}/x.jar"]
            },
            "libraries": [
                {"name": "org.ow2.asm:asm:9.10.1", "downloads": {"artifact": {"sha1": "ada2141c0cc52ee8f5c48cd5fa4ce0e794f22236", "url": "https://maven.neoforged.net/releases/org/ow2/asm/asm/9.10.1/asm-9.10.1.jar", "path": "org/ow2/asm/asm/9.10.1/asm-9.10.1.jar"}}},
                {"name": "net.minecraftforge:forge:1.21.1-52.1.16:client", "downloads": {"artifact": {"path": "x", "url": "", "sha1": "586c071a3ead6c755c700ad6328f069006296196"}}},
                {"name": "org.ow2.asm:asm:9.10.1", "downloads": {"artifact": {"sha1": "ada2141c0cc52ee8f5c48cd5fa4ce0e794f22236", "url": "u", "path": "p"}}}
            ]
        }))
        .unwrap();
        let merged = merge(vanilla.clone(), &profile).unwrap();
        assert_eq!(merged.id, "1.21.1");
        assert_eq!(merged.main_class, "cpw.mods.bootstraplauncher.BootstrapLauncher");
        let names: Vec<_> = merged.libraries.iter().map(|l| l.name.as_str()).collect();
        assert_eq!(names, ["org.ow2.asm:asm:9.10.1", "net.minecraftforge:forge:1.21.1-52.1.16:client", "com.mojang:brigadier:1.3.10"]);
        // Der Pfad kommt aus der Koordinate, nicht aus dem JSON.
        assert_eq!(
            merged.libraries[1].downloads.artifact.as_ref().unwrap().path.as_deref(),
            Some("net/minecraftforge/forge/1.21.1-52.1.16/forge-1.21.1-52.1.16-client.jar")
        );

        let dirs = Dirs::new("/d");
        let account = crate::services::auth::offline_account("Notch").unwrap();
        let args = build_args(&plain_spec(&merged, &dirs, &account), &Env { os: "windows", arch: "x86_64", features: Vec::new() }).unwrap();
        let libs = dirs.libraries().to_string_lossy().into_owned();
        assert!(args.contains(&"-DignoreList=client-extra,1.21.1.jar".to_owned()));
        assert!(args.contains(&format!("-DlibraryDirectory={libs}")));
        assert!(args.contains(&format!("{libs}/cpw/mods/bootstraplauncher/2.0.2/bootstraplauncher-2.0.2.jar;{libs}/x.jar")));
        assert_eq!(args.last().map(String::as_str), Some("forgeclient"));

        let other = Profile { inherits_from: "1.20.1".into(), ..profile };
        assert!(merge(vanilla, &other).is_err());
    }

    #[test]
    fn installer_replaces_truncated_maven_file() {
        use std::io::Write;
        let root = std::env::temp_dir().join(crate::models::new_id());
        let (installer, libs) = (root.join("installer.jar"), root.join("libs"));
        fs::create_dir_all(&root).unwrap();
        let mut zip = zip::ZipWriter::new(fs::File::create(&installer).unwrap());
        let opts = zip::write::SimpleFileOptions::default().compression_method(zip::CompressionMethod::Stored);
        for (name, data) in [
            ("install_profile.json", r#"{"data":{},"processors":[]}"#),
            ("version.json", "{}"),
            ("maven/a/b.jar", "vollständig"),
            ("maven/a/c.jar", "neu"),
        ] {
            zip.start_file(name, opts).unwrap();
            zip.write_all(data.as_bytes()).unwrap();
        }
        zip.finish().unwrap();
        fs::create_dir_all(libs.join("a")).unwrap();
        fs::write(libs.join("a/b.jar"), "voll").unwrap(); // abgebrochener Lauf
        fs::write(libs.join("a/c.jar"), "alt").unwrap(); // gleiche Größe: bleibt
        read_installer(&installer, &libs, &root.join("tmp")).unwrap();
        assert_eq!(fs::read_to_string(libs.join("a/b.jar")).unwrap(), "vollständig");
        assert_eq!(fs::read_to_string(libs.join("a/c.jar")).unwrap(), "alt");
        assert!(!libs.join("a/b.jar.part").exists());
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn embedded_maven_sha1_replaces_same_size_corruption_without_rewriting_the_jar() {
        use std::io::Write;
        let root = std::env::temp_dir().join(crate::models::new_id());
        fs::create_dir_all(&root).unwrap();
        let installer = root.join("installer.jar");
        let relative = PathBuf::from(maven_path("a:b:1").unwrap());
        let target = root.join("libs").join(&relative);
        fs::create_dir_all(target.parent().unwrap()).unwrap();
        fs::write(&target, b"wrong").unwrap();
        let mut writer = zip::ZipWriter::new(fs::File::create(&installer).unwrap());
        writer.start_file(format!("maven/{}", relative.to_string_lossy()), zip::write::SimpleFileOptions::default()).unwrap();
        writer.write_all(b"valid").unwrap();
        writer.finish().unwrap();
        let mut archive = zip::ZipArchive::new(fs::File::open(&installer).unwrap()).unwrap();
        let hashes = HashMap::from([(relative, download::sha1_hex(b"valid"))]);
        extract_maven(&mut archive, &root.join("libs"), &hashes).unwrap();
        assert_eq!(fs::read(&target).unwrap(), b"valid");
        assert_eq!(download::sha1_file(&target).unwrap(), download::sha1_hex(b"valid"));
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn installer_entries_are_read_up_to_the_limit() {
        use std::io::Write;
        let path = std::env::temp_dir().join(crate::models::new_id());
        let mut writer = zip::ZipWriter::new(fs::File::create(&path).unwrap());
        writer.start_file("version.json", zip::write::SimpleFileOptions::default()).unwrap();
        writer.write_all(b"12345").unwrap();
        writer.finish().unwrap();
        let mut zip = zip::ZipArchive::new(fs::File::open(&path).unwrap()).unwrap();

        assert_eq!(read_entry(&mut zip, "/version.json", 5).unwrap(), b"12345");
        assert!(read_entry(&mut zip, "/version.json", 4).is_err());
        fs::remove_file(path).unwrap();
    }
}
