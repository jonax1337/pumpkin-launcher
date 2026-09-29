//! Forge und NeoForge über ihren offiziellen Installer: `install_profile.json` nennt Libraries und
//! Processors (Java-Programme, die das Client-JAR entschlüsseln, umbenennen und patchen), die
//! `version.json` darin ist ein Profil mit `inheritsFrom` auf Vanilla. Beide Loader nutzen dasselbe
//! Installer-Format; unterstützt wird es ab Forge für Minecraft 1.17 bzw. NeoForge ab 1.20.1.
use std::collections::{HashMap, HashSet};
use std::fs;
use std::io::{self, Read};
use std::path::{Path, PathBuf};

use serde::Deserialize;

use crate::error::{AppError, AppResult};
use crate::services::download::{self, Job};
use crate::services::fabric::{compare_versions, is_sha1, maven_path, maven_sha1, merge_parts, segment, LoaderVersion};
use crate::services::mojang::{Arguments, Download, Library, LibraryDownloads, VersionJson};
use crate::services::Dirs;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Kind {
    Forge,
    NeoForge,
}

impl Kind {
    pub fn name(self) -> &'static str {
        match self {
            Self::Forge => "Forge",
            Self::NeoForge => "NeoForge",
        }
    }

    fn maven(self) -> &'static str {
        match self {
            Self::Forge => "https://maven.minecraftforge.net",
            Self::NeoForge => "https://maven.neoforged.net/releases",
        }
    }
}

#[derive(Debug, Clone, Default, Deserialize)]
struct Artifact {
    #[serde(default)]
    url: String,
    #[serde(default)]
    sha1: Option<String>,
}

#[derive(Debug, Clone, Default, Deserialize)]
struct ArtifactDownloads {
    #[serde(default)]
    artifact: Option<Artifact>,
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
pub fn check_supported(kind: Kind, mc: &str) -> AppResult<()> {
    let ok = match (kind, mc_numbers(mc).as_deref()) {
        (_, Some([major, ..])) if *major >= 2 => true,
        (Kind::Forge, Some([1, minor, ..])) => *minor >= 17,
        // 1.20.1: NeoForges erste Versionen, noch als Forge-Abzweig (`net.neoforged:forge`).
        (Kind::NeoForge, Some([1, 20, patch, ..])) => *patch >= 1,
        (Kind::NeoForge, Some([1, minor, ..])) => *minor >= 21,
        _ => false,
    };
    if ok {
        return Ok(());
    }
    let from = match kind {
        Kind::Forge => "1.17",
        Kind::NeoForge => "1.20.1",
    };
    Err(AppError::Invalid(format!("{} gibt es in Voxlet erst ab Minecraft {from}, nicht für {mc}", kind.name())))
}

/// NeoForge für 1.20.1 liegt als Forge-Abzweig unter `net.neoforged:forge:1.20.1-<version>`.
fn legacy_neoforge(kind: Kind, mc: &str) -> bool {
    kind == Kind::NeoForge && mc == "1.20.1"
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
pub async fn loader_versions(client: &reqwest::Client, kind: Kind, mc: &str) -> AppResult<Vec<LoaderVersion>> {
    check_supported(kind, segment(mc)?)?;
    let mut versions: Vec<LoaderVersion> = match kind {
        Kind::NeoForge if legacy_neoforge(kind, mc) => {
            let url = "https://maven.neoforged.net/api/maven/versions/releases/net/neoforged/forge";
            let all: NeoForgeVersions = download::get_json(client, url).await?;
            all.versions
                .into_iter()
                .filter_map(|v| v.strip_prefix("1.20.1-").map(str::to_owned))
                .map(|v| LoaderVersion { stable: !v.contains('-'), version: v })
                .collect()
        }
        Kind::NeoForge => {
            let url = "https://maven.neoforged.net/api/maven/versions/releases/net/neoforged/neoforge";
            let all: NeoForgeVersions = download::get_json(client, url).await?;
            let Some(prefix) = neoforge_prefix(mc) else { return Ok(Vec::new()) };
            all.versions
                .into_iter()
                .filter(|v| v.starts_with(&prefix))
                .map(|v| LoaderVersion { stable: !v.contains('-'), version: v })
                .collect()
        }
        Kind::Forge => {
            let url = "https://files.minecraftforge.net/net/minecraftforge/forge/maven-metadata.json";
            let mut all: HashMap<String, Vec<String>> = download::get_json(client, url).await?;
            let prefix = format!("{mc}-");
            all.remove(mc)
                .unwrap_or_default()
                .into_iter()
                .filter_map(|v| v.strip_prefix(&prefix).map(str::to_owned))
                .map(|v| LoaderVersion { stable: true, version: v })
                .collect()
        }
    };
    versions.sort_by(|a, b| compare_versions(&b.version, &a.version));
    Ok(versions)
}

/// Die gewünschte Loader-Version oder, ohne Wunsch, die neueste stabile (sonst die neueste).
pub async fn resolve_loader(client: &reqwest::Client, kind: Kind, mc: &str, wanted: Option<&str>) -> AppResult<String> {
    if let Some(v) = wanted.filter(|v| !v.trim().is_empty()) {
        return Ok(segment(v.trim())?.to_owned());
    }
    let versions = loader_versions(client, kind, mc).await?;
    versions
        .iter()
        .find(|v| v.stable)
        .or(versions.first())
        .map(|v| v.version.clone())
        .ok_or_else(|| AppError::NotFound { kind: "Loader für Minecraft", id: format!("{} {mc}", kind.name()) })
}

/// ID der Loader-Version, wie im Installer: `neoforge-21.1.252`, `1.21.1-forge-52.1.16`.
pub fn profile_id(kind: Kind, mc: &str, loader: &str) -> String {
    match kind {
        Kind::NeoForge if legacy_neoforge(kind, mc) => format!("{mc}-neoforge-{loader}"),
        Kind::NeoForge => format!("neoforge-{loader}"),
        Kind::Forge => format!("{mc}-forge-{loader}"),
    }
}

fn installer_coord(kind: Kind, mc: &str, loader: &str) -> String {
    match kind {
        Kind::NeoForge if legacy_neoforge(kind, mc) => format!("net.neoforged:forge:{mc}-{loader}:installer"),
        Kind::NeoForge => format!("net.neoforged:neoforge:{loader}:installer"),
        Kind::Forge => format!("net.minecraftforge:forge:{mc}-{loader}:installer"),
    }
}

/// Liest ein installiertes Profil (für den Start ohne Netz).
pub async fn installed_profile(dirs: &Dirs, kind: Kind, mc: &str, loader: &str) -> AppResult<Profile> {
    let path = dirs.version_file(&profile_id(kind, segment(mc)?, segment(loader)?), "json");
    download::read_json(&path).await.map_err(|err| match err {
        AppError::Io(e) if e.kind() == io::ErrorKind::NotFound => {
            AppError::Invalid(format!("{} {loader} für {mc} ist nicht installiert", kind.name()))
        }
        other => other,
    })
}

/// Ersetzt ein Processor-Argument: `[koordinate]` → Library-Pfad, `'text'` → Text,
/// sonst `{SCHLÜSSEL}` durch Werte aus `data` (unbekannte Schlüssel sind ein Fehler).
fn resolve(arg: &str, data: &HashMap<String, String>, libraries: &Path) -> AppResult<String> {
    if let Some(coord) = arg.strip_prefix('[').and_then(|a| a.strip_suffix(']')) {
        return Ok(libraries.join(maven_path(coord)?).to_string_lossy().into_owned());
    }
    if let Some(text) = arg.strip_prefix('\'').and_then(|a| a.strip_suffix('\'')) {
        return Ok(text.to_owned());
    }
    let mut out = String::with_capacity(arg.len());
    let mut rest = arg;
    while let Some(start) = rest.find('{') {
        let end = rest[start..].find('}').ok_or_else(|| AppError::Invalid(format!("Installer-Argument '{arg}' unvollständig")))?;
        let key = &rest[start + 1..start + end];
        let value = data.get(key).ok_or_else(|| AppError::Invalid(format!("Installer-Variable {{{key}}} unbekannt")))?;
        out.push_str(&rest[..start]);
        out.push_str(value);
        rest = &rest[start + end + 1..];
    }
    out.push_str(rest);
    Ok(out)
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
        .ok_or_else(|| AppError::Invalid(format!("{} hat keine Main-Class", jar.display())))
}

/// Liest das Installer-JAR: Install-Profil, `version.json` (roh) und entpackt `maven/…` in die
/// Libraries sowie die referenzierten `/data/…`-Dateien nach `tmp`.
fn read_installer(installer: &Path, libraries: &Path, tmp: &Path) -> AppResult<(InstallProfile, Vec<u8>, HashMap<String, PathBuf>)> {
    let mut zip = zip::ZipArchive::new(fs::File::open(installer)?)?;
    let read = |zip: &mut zip::ZipArchive<fs::File>, name: &str| -> AppResult<Vec<u8>> {
        let mut buf = Vec::new();
        zip.by_name(name.trim_start_matches('/'))?.read_to_end(&mut buf)?;
        Ok(buf)
    };
    let profile: InstallProfile = serde_json::from_slice(&read(&mut zip, "install_profile.json")?).map_err(|e| {
        tracing::warn!(%e, "Install-Profil in altem Format");
        AppError::Invalid("Diese Loader-Version nutzt ein altes Installer-Format, das Voxlet nicht unterstützt".into())
    })?;
    let version = read(&mut zip, &profile.json)?;

    for i in 0..zip.len() {
        let mut entry = zip.by_index(i)?;
        // `enclosed_name` verwirft `..` und absolute Pfade.
        let Some(rel) = entry.enclosed_name().and_then(|p| p.strip_prefix("maven").ok().map(Path::to_path_buf)) else { continue };
        let target = libraries.join(rel);
        // Vorhandene Datei nur bei passender Größe behalten: ein früherer Abbruch kann sie abgeschnitten haben.
        if entry.is_dir() || fs::metadata(&target).is_ok_and(|m| m.len() == entry.size()) {
            continue;
        }
        if let Some(parent) = target.parent() {
            fs::create_dir_all(parent)?;
        }
        // Erst `.part` vollständig schreiben, dann umbenennen (wie in `download`).
        let mut part = target.clone().into_os_string();
        part.push(".part");
        let part = PathBuf::from(part);
        let mut guard = download::RemoveOnDrop(Some(part.clone()));
        io::copy(&mut entry, &mut fs::File::create(&part)?)?;
        fs::rename(&part, &target)?;
        guard.0 = None;
    }

    fs::create_dir_all(tmp)?;
    let mut files = HashMap::new();
    for entry in profile.data.values().filter(|d| d.client.starts_with('/')) {
        let name = entry.client.trim_start_matches('/');
        let file_name = Path::new(name).file_name().ok_or_else(|| AppError::Invalid(format!("ungültiger Installer-Eintrag '{name}'")))?;
        if name.contains("..") {
            return Err(AppError::Invalid(format!("ungültiger Installer-Eintrag '{name}'")));
        }
        let target = tmp.join(file_name);
        fs::write(&target, read(&mut zip, name)?)?;
        files.insert(entry.client.clone(), target);
    }
    Ok((profile, version, files))
}

async fn file_sha1(path: &Path) -> Option<String> {
    tokio::fs::read(path).await.ok().map(|b| download::sha1_hex(&b))
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

/// Installiert die Loader-Version. Voraussetzung: Vanilla-Client und Java-Runtime sind installiert.
/// `on_progress(erledigt, gesamt)` zählt Libraries und Processors.
pub async fn install(
    client: &reqwest::Client,
    dirs: &Dirs,
    kind: Kind,
    mc: &str,
    loader: &str,
    java: &Path,
    on_progress: &(dyn Fn(u64, u64) + Send + Sync),
) -> AppResult<Profile> {
    check_supported(kind, segment(mc)?)?;
    let id = profile_id(kind, mc, segment(loader)?);
    let profile_path = dirs.version_file(&id, "json");
    let libraries = dirs.libraries();
    if let Ok(profile) = download::read_json::<Profile>(&profile_path).await {
        let complete = profile.libraries.iter().all(|l| maven_path(&l.name).is_ok_and(|p| libraries.join(p).exists()));
        if complete {
            return Ok(profile);
        }
    }

    let coord = installer_coord(kind, mc, loader);
    let installer_rel = maven_path(&coord)?;
    let url = format!("{}/{installer_rel}", kind.maven());
    let sha1 = maven_sha1(client, &url).await.map_err(|err| match err {
        AppError::Http(e) if e.status().is_some_and(|s| s.is_client_error()) => {
            AppError::NotFound { kind: "Loader", id: format!("{} {loader} für Minecraft {mc}", kind.name()) }
        }
        other => other,
    })?;
    let installer = libraries.join(&installer_rel);
    download::fetch(client, &Job { url, path: installer.clone(), sha1: Some(sha1) }).await?;

    let tmp = dirs.root.join("tmp").join(&id);
    let (install_profile, version_raw, data_files) = {
        let (installer, libraries, tmp) = (installer.clone(), libraries.clone(), tmp.clone());
        tokio::task::spawn_blocking(move || read_installer(&installer, &libraries, &tmp))
            .await
            .map_err(|e| AppError::Download(format!("Installer lesen abgebrochen: {e}")))??
    };
    let profile: Profile = serde_json::from_slice(&version_raw)?;
    if profile.inherits_from != mc {
        return Err(AppError::Invalid(format!("{} {loader} gehört zu Minecraft {} statt {mc}", kind.name(), profile.inherits_from)));
    }

    let processors: Vec<&Processor> = install_profile
        .processors
        .iter()
        .filter(|p| p.sides.as_ref().is_none_or(|s| s.iter().any(|s| s == "client")))
        .collect();
    let mut jobs = Vec::new();
    let mut seen = HashSet::new();
    for lib in install_profile.libraries.iter().chain(&profile.libraries) {
        let path = libraries.join(maven_path(&lib.name)?);
        if lib.url().is_empty() || !seen.insert(path.clone()) {
            continue;
        }
        jobs.push(Job { url: lib.url().to_owned(), path, sha1: lib.sha1() });
    }
    let total = jobs.len() as u64 + processors.len() as u64;
    let downloaded = jobs.len() as u64;
    download::fetch_all(client, jobs, &|d, _| on_progress(d, total)).await?;

    let path_str = |p: &Path| p.to_string_lossy().into_owned();
    let mut data: HashMap<String, String> = HashMap::from([
        ("SIDE".to_owned(), "client".to_owned()),
        ("MINECRAFT_JAR".to_owned(), path_str(&dirs.version_file(mc, "jar"))),
        ("MINECRAFT_VERSION".to_owned(), mc.to_owned()),
        ("ROOT".to_owned(), path_str(&dirs.root)),
        ("INSTALLER".to_owned(), path_str(&installer)),
        ("LIBRARY_DIR".to_owned(), path_str(&libraries)),
    ]);
    for (key, entry) in &install_profile.data {
        let value = match data_files.get(&entry.client) {
            Some(file) => path_str(file),
            None => resolve(&entry.client, &HashMap::new(), &libraries)?,
        };
        data.insert(key.clone(), value);
    }

    let sep = if cfg!(windows) { ";" } else { ":" };
    for (i, processor) in processors.iter().enumerate() {
        let outputs = processor
            .outputs
            .iter()
            .map(|(k, v)| Ok((resolve(k, &data, &libraries)?, resolve(v, &data, &libraries)?)))
            .collect::<AppResult<Vec<_>>>()?;
        if outputs.is_empty() || !outputs_ok(&outputs).await {
            let jar = libraries.join(maven_path(&processor.jar)?);
            let main = {
                let jar = jar.clone();
                tokio::task::spawn_blocking(move || main_class(&jar))
                    .await
                    .map_err(|e| AppError::Download(format!("Processor lesen abgebrochen: {e}")))??
            };
            let mut cp = vec![path_str(&jar)];
            for c in &processor.classpath {
                cp.push(path_str(&libraries.join(maven_path(c)?)));
            }
            let args = processor.args.iter().map(|a| resolve(a, &data, &libraries)).collect::<AppResult<Vec<_>>>()?;
            tracing::info!(step = i + 1, jar = %processor.jar, "Loader-Processor läuft");
            let output = tokio::process::Command::new(java)
                .arg("-cp")
                .arg(cp.join(sep))
                .arg(&main)
                .args(&args)
                .current_dir(&tmp)
                .stdin(std::process::Stdio::null())
                .kill_on_drop(true)
                .output()
                .await?;
            if !output.status.success() {
                let log = String::from_utf8_lossy(&output.stdout).into_owned() + &String::from_utf8_lossy(&output.stderr);
                tracing::error!(jar = %processor.jar, code = ?output.status.code(), "Processor fehlgeschlagen:\n{log}");
                let last = log.lines().rev().find(|l| !l.trim().is_empty()).unwrap_or("ohne Ausgabe").trim();
                return Err(AppError::Download(format!("{} ließ sich nicht einrichten (Schritt {} von {}): {last}", kind.name(), i + 1, processors.len())));
            }
            if !outputs_ok(&outputs).await {
                return Err(AppError::Download(format!("{} ließ sich nicht einrichten: Schritt {} lieferte eine falsche Datei", kind.name(), i + 1)));
            }
        }
        on_progress(downloaded + i as u64 + 1, total);
    }

    for lib in &profile.libraries {
        let path = libraries.join(maven_path(&lib.name)?);
        if !path.exists() {
            return Err(AppError::Download(format!("{} unvollständig: {} fehlt", kind.name(), lib.name)));
        }
    }
    if let Some(parent) = profile_path.parent() {
        tokio::fs::create_dir_all(parent).await?;
    }
    // Zuletzt schreiben: die Profil-Datei markiert eine vollständige Installation.
    tokio::fs::write(&profile_path, &version_raw).await?;
    if let Err(err) = tokio::fs::remove_dir_all(&tmp).await {
        tracing::debug!(%err, "Temp-Verzeichnis des Installers bleibt liegen");
    }
    Ok(profile)
}

/// Vanilla-Versions-JSON plus Loader-Profil (siehe `fabric::merge_parts`). Die ID bleibt die
/// Vanilla-ID; NeoForge schließt über `-DignoreList=…,${version_name}.jar` genau dieses JAR aus.
pub fn merge(version: VersionJson, profile: &Profile) -> AppResult<VersionJson> {
    if profile.inherits_from != version.id {
        return Err(AppError::Invalid(format!("Loader-Profil erbt von {} statt {}", profile.inherits_from, version.id)));
    }
    let mut seen = HashSet::new();
    let mut libraries = Vec::with_capacity(profile.libraries.len());
    for lib in &profile.libraries {
        if !seen.insert(lib.name.clone()) {
            continue;
        }
        libraries.push(Library {
            name: lib.name.clone(),
            downloads: LibraryDownloads {
                artifact: Some(Download {
                    path: Some(maven_path(&lib.name)?),
                    sha1: lib.sha1().unwrap_or_default(),
                    url: lib.url().to_owned(),
                }),
                classifiers: Default::default(),
            },
            rules: Vec::new(),
            natives: Default::default(),
            extract: Default::default(),
        });
    }
    let args = profile.arguments.clone();
    Ok(merge_parts(version, libraries, &profile.main_class, args.jvm, args.game))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::services::launch::{build_args, LaunchSpec};
    use crate::services::rules::Env;

    #[test]
    fn supported_versions() {
        assert!(check_supported(Kind::Forge, "1.21.1").is_ok());
        assert!(check_supported(Kind::Forge, "1.17").is_ok());
        assert!(check_supported(Kind::Forge, "1.16.5").is_err());
        assert!(check_supported(Kind::NeoForge, "1.20.2").is_ok());
        assert!(check_supported(Kind::NeoForge, "1.20.1").is_ok());
        assert!(check_supported(Kind::NeoForge, "1.20").is_err());
        assert_eq!(installer_coord(Kind::NeoForge, "1.20.1", "47.1.106"), "net.neoforged:forge:1.20.1-47.1.106:installer");
        assert_eq!(profile_id(Kind::NeoForge, "1.20.1", "47.1.106"), "1.20.1-neoforge-47.1.106");
        assert!(check_supported(Kind::NeoForge, "26.1").is_ok());
        assert!(check_supported(Kind::Forge, "25w14a").is_err());
        assert_eq!(neoforge_prefix("1.21.1").as_deref(), Some("21.1."));
        assert_eq!(neoforge_prefix("1.21").as_deref(), Some("21.0."));
        assert_eq!(neoforge_prefix("26.1").as_deref(), Some("26.1.0."));
        assert!(!"21.10.3".starts_with("21.1."));
        assert_eq!(profile_id(Kind::Forge, "1.21.1", "52.1.16"), "1.21.1-forge-52.1.16");
        assert_eq!(installer_coord(Kind::NeoForge, "1.21.1", "21.1.252"), "net.neoforged:neoforge:21.1.252:installer");
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
        assert!(resolve("{UNKNOWN}", &data, libs).is_err());
        assert!(resolve("[../../x:y:1]", &data, libs).is_err());
    }

    #[test]
    fn merge_neoforge_profile() {
        let vanilla: VersionJson = serde_json::from_value(serde_json::json!({
            "id": "1.21.1", "type": "release", "mainClass": "net.minecraft.client.main.Main",
            "assetIndex": {"id": "17", "sha1": "x", "url": "u"},
            "downloads": {"client": {"sha1": "x", "url": "u"}},
            "libraries": [
                {"name": "org.ow2.asm:asm:9.6", "downloads": {"artifact": {"path": "org/ow2/asm/asm/9.6/asm-9.6.jar", "sha1": "x", "url": "u"}}},
                {"name": "com.mojang:brigadier:1.3.10", "downloads": {"artifact": {"path": "com/mojang/brigadier/1.3.10/brigadier-1.3.10.jar", "sha1": "x", "url": "u"}}}
            ],
            "arguments": {"jvm": ["-cp", "${classpath}"], "game": ["--version", "${version_name}"]}
        }))
        .unwrap();
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
        let spec = LaunchSpec { version: &merged, dirs: &dirs, instance_id: "i", account: &account, memory_mb: 2048, extra_jvm_args: &[] };
        let args = build_args(&spec, &Env { os: "windows", arch: "x86_64", features: Vec::new() }).unwrap();
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
}
