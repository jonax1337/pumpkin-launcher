//! Vanilla-Installation einer Version: Versions-JSON, Java, Client, Libraries, Natives,
//! Assets, Logging-Config. Alles außer den Natives landet im geteilten Cache (`Dirs`).
use std::fs;
use std::io;
use std::path::{Path, PathBuf};

use serde::Serialize;

use crate::error::{AppError, AppResult};
use crate::models::{Instance, ModLoader};
use crate::services::download::{self, Job};
use crate::services::mojang::{AssetIndex, Library, VersionJson, VersionManifest, MANIFEST_URL, RESOURCES_URL};
use crate::services::rules::{self, Env};
use crate::services::{java, Dirs};

/// Name des Tauri-Events, über das `InstallProgress` ans Frontend geht.
pub const INSTALL_PROGRESS_EVENT: &str = "install-progress";

/// Benannte Installationsschritte in Ausführungsreihenfolge (`Loader`/`Mods` nur mit Mod-Loader).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum InstallStep {
    Java,
    Client,
    Libraries,
    Natives,
    Assets,
    Loader,
    Mods,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InstallProgress {
    pub instance_id: String,
    pub step: InstallStep,
    pub done: u64,
    pub total: u64,
}

pub type OnProgress<'a> = &'a (dyn Fn(InstallStep, u64, u64) + Send + Sync);

/// Lädt die Versions-JSON (per Manifest-SHA-1 gecacht) nach `versions/<id>/<id>.json`.
pub async fn fetch_version(client: &reqwest::Client, dirs: &Dirs, version_id: &str) -> AppResult<VersionJson> {
    let manifest: VersionManifest = download::get_json(client, MANIFEST_URL).await?;
    let entry = manifest
        .versions
        .into_iter()
        .find(|v| v.id == version_id)
        .ok_or_else(|| AppError::NotFound { kind: "Minecraft-Version", id: version_id.into() })?;
    let path = dirs.version_file(version_id, "json");
    download::fetch(client, &Job { url: entry.url, path: path.clone(), sha1: Some(entry.sha1) }).await?;
    download::read_json(&path).await
}

/// Liest eine bereits installierte Versions-JSON (für den Start ohne Netz).
pub async fn installed_version(dirs: &Dirs, version_id: &str) -> AppResult<VersionJson> {
    download::read_json(&dirs.version_file(version_id, "json")).await.map_err(|err| {
        if is_missing(&err) {
            AppError::invalid(format!("Version {version_id} ist nicht installiert"))
        } else {
            err
        }
    })
}

/// Die installierte Versions-JSON oder, fehlt sie, die von Mojang (dabei abgelegt wie bei `fetch_version`).
pub async fn installed_or_fetched_version(client: &reqwest::Client, dirs: &Dirs, version_id: &str) -> AppResult<VersionJson> {
    match download::read_json(&dirs.version_file(version_id, "json")).await {
        Err(err) if is_missing(&err) => fetch_version(client, dirs, version_id).await,
        read => read,
    }
}

fn is_missing(err: &AppError) -> bool {
    matches!(err, AppError::Io(e) if e.kind() == io::ErrorKind::NotFound)
}

/// Inhalt der Markerdatei: die MC-Version, bei Mod-Loadern plus Loader und Version. Ein Wechsel
/// von Loader oder Loader-Version gilt so als nicht installiert; Vanilla-Marker bleiben gültig.
fn install_key(instance: &Instance) -> String {
    match instance.loader {
        ModLoader::Vanilla => instance.minecraft_version.clone(),
        loader => format!("{} {loader:?} {}", instance.minecraft_version, instance.loader_version.as_deref().unwrap_or("?")),
    }
}

/// Vermerkt die Instanz als installiert. Erst nach vollständigem Erfolg: `is_installed` erkennt so auch
/// abgebrochene Installationen.
pub async fn mark_installed(dirs: &Dirs, instance: &Instance) -> AppResult<()> {
    Ok(tokio::fs::write(dirs.installed_marker(&instance.id), install_key(instance)).await?)
}

/// Aktuelle Minecraft-Version (samt Loader) der Instanz ist vollständig installiert.
pub fn is_installed(dirs: &Dirs, instance: &Instance) -> bool {
    fs::read_to_string(dirs.installed_marker(&instance.id)).is_ok_and(|v| v == install_key(instance))
}

/// Java-Komponente der Version; sehr alte Versions-JSONs haben keine Angabe → Java 8.
pub fn java_component(version: &VersionJson) -> &str {
    version.java_version.as_ref().map_or("jre-legacy", |j| j.component.as_str())
}

/// Library-Artefakte, die laut Regeln auf diese Plattform gehören (Classpath und Download).
pub fn artifacts<'a>(version: &'a VersionJson, env: &'a Env) -> impl Iterator<Item = (&'a Library, &'a crate::services::mojang::Download)> {
    version
        .libraries
        .iter()
        .filter(|l| rules::allowed(&l.rules, env))
        .filter_map(|l| l.downloads.artifact.as_ref().map(|a| (l, a)))
}

/// JARs, aus denen Natives entpackt werden: neue Versionen (`…:natives-windows` als eigenes
/// Artefakt, nur passende Architektur) und alte (`natives`-Map → Classifier).
fn native_jars<'a>(version: &'a VersionJson, env: &'a Env) -> Vec<(&'a Library, &'a crate::services::mojang::Download)> {
    let mut jars = Vec::new();
    for lib in version.libraries.iter().filter(|l| rules::allowed(&l.rules, env)) {
        if let (Some(c), Some(a)) = (lib.classifier(), &lib.downloads.artifact) {
            if c.starts_with("natives-") && rules::native_classifier_matches(c, env) {
                jars.push((lib, a));
            }
        }
        if let Some(classifier) = lib.natives.get(env.os) {
            let bits = if env.arch.contains("64") { "64" } else { "32" };
            if let Some(d) = lib.downloads.classifiers.get(&classifier.replace("${arch}", bits)) {
                jars.push((lib, d));
            }
        }
    }
    jars
}

fn library_job(dirs: &Dirs, lib: &Library, d: &crate::services::mojang::Download) -> AppResult<Job> {
    let path = d.path.as_deref().ok_or_else(|| AppError::invalid(format!("Library {} ohne Pfad", lib.name)))?;
    Ok(Job { url: d.url.clone(), path: dirs.library(path), sha1: Some(d.sha1.clone()) })
}

/// Entpackt native Bibliotheken (`.dll`/`.so`/`.dylib`/`.jnilib`) flach nach `dest`.
fn extract_natives(jar: &Path, dest: &Path, exclude: &[String]) -> AppResult<u64> {
    let mut zip = zip::ZipArchive::new(fs::File::open(jar)?)?;
    let mut count = 0;
    for i in 0..zip.len() {
        let mut entry = zip.by_index(i)?;
        let name = entry.name().to_owned();
        let is_native = [".dll", ".so", ".dylib", ".jnilib"].iter().any(|ext| name.ends_with(ext));
        if entry.is_dir() || !is_native || exclude.iter().any(|e| name.starts_with(e.as_str())) {
            continue;
        }
        // Nur der Dateiname zählt: schützt zugleich vor `../` in Einträgen.
        let Some(file_name) = Path::new(&name).file_name() else { continue };
        io::copy(&mut entry, &mut fs::File::create(dest.join(file_name))?)?;
        count += 1;
    }
    Ok(count)
}

// ponytail: kein Dateisperren-Schutz im geteilten Cache. Zwei gleichzeitige Installationen
// derselben Datei schreiben dieselbe `.part`-Datei; bei Bedarf `fs4`-Lock pro Datei.
/// Installiert `version` für eine Instanz und liefert den Pfad der Java-Programmdatei.
pub async fn install(
    client: &reqwest::Client,
    dirs: &Dirs,
    version: &VersionJson,
    instance_id: &str,
    on_progress: OnProgress<'_>,
) -> AppResult<PathBuf> {
    let env = Env::current();

    let java = java::ensure(client, dirs, java_component(version), &|d, t| on_progress(InstallStep::Java, d, t)).await?;

    let mut client_jobs = vec![Job {
        url: version.downloads.client.url.clone(),
        path: dirs.version_file(&version.id, "jar"),
        sha1: Some(version.downloads.client.sha1.clone()),
    }];
    if let Some(log) = &version.logging.client {
        client_jobs.push(Job {
            url: log.file.url.clone(),
            path: dirs.assets().join("log_configs").join(&log.file.id),
            sha1: Some(log.file.sha1.clone()),
        });
    }
    download::fetch_all(client, client_jobs, &|d, t| on_progress(InstallStep::Client, d, t)).await?;

    let natives = native_jars(version, &env);
    let mut lib_jobs = artifacts(version, &env).map(|(l, a)| library_job(dirs, l, a)).collect::<AppResult<Vec<_>>>()?;
    for (lib, d) in &natives {
        lib_jobs.push(library_job(dirs, lib, d)?);
    }
    lib_jobs.sort_by(|a, b| a.path.cmp(&b.path));
    lib_jobs.dedup_by(|a, b| a.path == b.path);
    download::fetch_all(client, lib_jobs, &|d, t| on_progress(InstallStep::Libraries, d, t)).await?;

    // Natives immer frisch entpacken, damit nach einem Versionswechsel keine alten DLLs liegen bleiben.
    let natives_dir = dirs.natives_dir(instance_id);
    let jars: Vec<(PathBuf, Vec<String>)> = natives
        .iter()
        .map(|(lib, d)| Ok((library_job(dirs, lib, d)?.path, lib.extract.exclude.clone())))
        .collect::<AppResult<_>>()?;
    let total = jars.len() as u64;
    on_progress(InstallStep::Natives, 0, total);
    let extracted = tokio::task::spawn_blocking(move || -> AppResult<u64> {
        if natives_dir.exists() {
            fs::remove_dir_all(&natives_dir)?;
        }
        fs::create_dir_all(&natives_dir)?;
        jars.iter().map(|(jar, exclude)| extract_natives(jar, &natives_dir, exclude)).sum()
    })
    .await
    .map_err(|e| AppError::Download(format!("Natives-Entpacken abgebrochen: {e}")))??;
    on_progress(InstallStep::Natives, total, total);
    tracing::debug!(extracted, "Natives entpackt");

    let index_path = dirs.assets().join("indexes").join(format!("{}.json", version.asset_index.id));
    let index_job = Job { url: version.asset_index.url.clone(), path: index_path.clone(), sha1: Some(version.asset_index.sha1.clone()) };
    download::fetch(client, &index_job).await?;
    let index: AssetIndex = download::read_json(&index_path).await?;
    let objects = dirs.assets().join("objects");
    let mut asset_jobs = index
        .objects
        .values()
        .map(|o| {
            // Der Hash wird Teil des Pfads: nur echte SHA-1-Hex-Strings zulassen.
            if o.hash.len() != 40 || !o.hash.bytes().all(|b| b.is_ascii_hexdigit()) {
                return Err(AppError::invalid(format!("ungültiger Asset-Hash '{}'", o.hash)));
            }
            Ok(Job {
                url: format!("{RESOURCES_URL}/{}/{}", &o.hash[..2], o.hash),
                path: objects.join(&o.hash[..2]).join(&o.hash),
                sha1: Some(o.hash.clone()),
            })
        })
        .collect::<AppResult<Vec<_>>>()?;
    asset_jobs.sort_by(|a, b| a.path.cmp(&b.path));
    asset_jobs.dedup_by(|a, b| a.path == b.path);
    download::fetch_all(client, asset_jobs, &|d, t| on_progress(InstallStep::Assets, d, t)).await?;

    Ok(java)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::NewInstance;

    #[tokio::test]
    async fn loader_change_invalidates_the_installed_marker() {
        let dirs = Dirs::new(std::env::temp_dir().join(crate::models::new_id()));
        let mut instance = Instance::from_new(NewInstance {
            name: "Test".into(),
            minecraft_version: "1.21.1".into(),
            loader: ModLoader::Fabric,
            loader_version: Some("0.16.5".into()),
        });
        fs::create_dir_all(dirs.instance(&instance.id)).unwrap();
        assert!(!is_installed(&dirs, &instance));
        mark_installed(&dirs, &instance).await.unwrap();
        assert!(is_installed(&dirs, &instance));
        instance.loader_version = Some("0.16.6".into());
        assert!(!is_installed(&dirs, &instance));
        fs::remove_dir_all(&dirs.root).unwrap();
    }
}
