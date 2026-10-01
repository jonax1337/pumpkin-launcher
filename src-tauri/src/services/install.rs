//! Vanilla-Installation einer Version: Versions-JSON, Java, Client, Libraries, Natives,
//! Assets, Logging-Config. Alles außer den Natives landet im geteilten Cache (`Dirs`).
use std::path::{Path, PathBuf};
use std::{fs, io};

use serde::Serialize;

use crate::error::{AppError, AppResult};
use crate::models::{Instance, ModLoader};
use crate::services::download::{self, dedup_by_path, is_sha1, Job};
use crate::services::mojang::{
    AssetIndex, Download, Library, LoggingClient, VersionJson, VersionManifest, MANIFEST_URL, RESOURCES_URL,
};
use crate::services::rules::{self, Env};
use crate::services::{blocking, java, Dirs};

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
    download::read_json(&dirs.version_file(version_id, "json"))
        .await
        .map_err(|err| err.or_not_installed(format!("Version {version_id}")))
}

/// Die installierte Versions-JSON oder, fehlt sie, die von Mojang (dabei abgelegt wie bei `fetch_version`).
pub async fn installed_or_fetched_version(client: &reqwest::Client, dirs: &Dirs, version_id: &str) -> AppResult<VersionJson> {
    match download::read_json(&dirs.version_file(version_id, "json")).await {
        Err(err) if err.is_not_found() => fetch_version(client, dirs, version_id).await,
        read => read,
    }
}

/// Inhalt der Markerdatei: die MC-Version, bei Mod-Loadern plus Loader und Version. Ein Wechsel
/// von Loader oder Loader-Version gilt so als nicht installiert; Vanilla-Marker bleiben gültig.
fn install_key(instance: &Instance) -> String {
    match instance.loader {
        ModLoader::Vanilla => instance.minecraft_version.clone(),
        loader => {
            format!("{} {} {}", instance.minecraft_version, loader.display_name(), instance.loader_version.as_deref().unwrap_or("?"))
        }
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

/// Ablage der Logging-Config, die die Version per JVM-Argument einbindet.
pub fn log_config_path(dirs: &Dirs, log: &LoggingClient) -> PathBuf {
    dirs.assets().join("log_configs").join(&log.file.id)
}

/// Installiert `version` für eine Instanz und liefert den Pfad der Java-Programmdatei.
///
/// Der geteilte Cache hat keine Dateisperren: Installationen laufen nacheinander (globale Sperre in `AppState`),
/// zwei gleichzeitige schrieben sonst dieselben `.part`-Dateien.
pub async fn install(
    client: &reqwest::Client,
    dirs: &Dirs,
    version: &VersionJson,
    instance_id: &str,
    on_progress: OnProgress<'_>,
) -> AppResult<PathBuf> {
    let setup = Setup { client, dirs, version, env: Env::current(), on_progress };
    let java = setup.install_java().await?;
    setup.install_client().await?;
    setup.install_libraries().await?;
    setup.install_natives(instance_id).await?;
    setup.install_assets().await?;
    Ok(java)
}

/// Was alle Schritte einer Installation teilen.
struct Setup<'a> {
    client: &'a reqwest::Client,
    dirs: &'a Dirs,
    version: &'a VersionJson,
    env: Env,
    on_progress: OnProgress<'a>,
}

impl Setup<'_> {
    /// Fortschritt eines Schritts als `(erledigt, gesamt)`.
    fn counter(&self, step: InstallStep) -> impl Fn(u64, u64) + Send + Sync + '_ {
        move |done, total| (self.on_progress)(step, done, total)
    }

    async fn install_java(&self) -> AppResult<PathBuf> {
        java::ensure(self.client, self.dirs, self.version.java_component(), &self.counter(InstallStep::Java)).await
    }

    /// Client-JAR und, falls die Version eine nennt, ihre Logging-Config.
    async fn install_client(&self) -> AppResult<()> {
        let version = self.version;
        let mut jobs = vec![Job::from_download(&version.downloads.client, self.dirs.version_file(&version.id, "jar"))];
        if let Some(log) = &version.logging.client {
            jobs.push(Job::from_download(&log.file.download, log_config_path(self.dirs, log)));
        }
        download::fetch_all(self.client, jobs, &self.counter(InstallStep::Client)).await
    }

    async fn install_libraries(&self) -> AppResult<()> {
        let natives = native_jars(self.version, &self.env);
        let jobs = self
            .version
            .artifacts(&self.env)
            .chain(natives)
            .map(|(lib, d)| library_job(self.dirs, lib, d))
            .collect::<AppResult<Vec<_>>>()?;
        download::fetch_all(self.client, dedup_by_path(jobs), &self.counter(InstallStep::Libraries)).await
    }

    /// Natives immer frisch entpacken, damit nach einem Versionswechsel keine alten DLLs liegen bleiben.
    async fn install_natives(&self, instance_id: &str) -> AppResult<()> {
        let natives_dir = self.dirs.natives_dir(instance_id);
        let jars: Vec<(PathBuf, Vec<String>)> = native_jars(self.version, &self.env)
            .into_iter()
            .map(|(lib, d)| Ok((library_job(self.dirs, lib, d)?.path, lib.extract.exclude.clone())))
            .collect::<AppResult<_>>()?;
        let total = jars.len() as u64;
        (self.on_progress)(InstallStep::Natives, 0, total);
        let extracted = blocking(move |_| replace_natives(&natives_dir, &jars)).await?;
        (self.on_progress)(InstallStep::Natives, total, total);
        tracing::debug!(extracted, "Natives entpackt");
        Ok(())
    }

    async fn install_assets(&self) -> AppResult<()> {
        let index = self.asset_index().await?;
        let objects = self.dirs.assets().join("objects");
        let jobs = index.objects.values().map(|o| asset_job(&objects, &o.hash)).collect::<AppResult<Vec<_>>>()?;
        download::fetch_all(self.client, dedup_by_path(jobs), &self.counter(InstallStep::Assets)).await
    }

    async fn asset_index(&self) -> AppResult<AssetIndex> {
        let index = &self.version.asset_index;
        let path = self.dirs.assets().join("indexes").join(format!("{}.json", index.id));
        download::fetch(self.client, &Job::from_download(&index.download, path.clone())).await?;
        download::read_json(&path).await
    }
}

/// JARs, aus denen Natives entpackt werden: neue Versionen (`…:natives-windows` als eigenes
/// Artefakt, nur passende Architektur) und alte (`natives`-Map → Classifier).
fn native_jars<'a>(version: &'a VersionJson, env: &'a Env) -> Vec<(&'a Library, &'a Download)> {
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

fn library_job(dirs: &Dirs, lib: &Library, d: &Download) -> AppResult<Job> {
    let path = d.path.as_deref().ok_or_else(|| AppError::invalid(format!("Library {} ohne Pfad", lib.name)))?;
    Ok(Job::from_download(d, dirs.library(path)))
}

fn asset_job(objects: &Path, hash: &str) -> AppResult<Job> {
    // Der Hash wird Teil des Pfads: nur echte SHA-1-Hex-Strings zulassen.
    if !is_sha1(hash) {
        return Err(AppError::invalid(format!("ungültiger Asset-Hash '{hash}'")));
    }
    let prefix = &hash[..2];
    Ok(Job { url: format!("{RESOURCES_URL}/{prefix}/{hash}"), path: objects.join(prefix).join(hash), sha1: Some(hash.to_owned()) })
}

/// Leert `natives_dir` und entpackt die Natives aller `jars` (JAR, ausgeschlossene Präfixe) hinein.
fn replace_natives(natives_dir: &Path, jars: &[(PathBuf, Vec<String>)]) -> AppResult<u64> {
    if natives_dir.exists() {
        fs::remove_dir_all(natives_dir)?;
    }
    fs::create_dir_all(natives_dir)?;
    jars.iter().map(|(jar, exclude)| extract_natives(jar, natives_dir, exclude)).sum()
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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::NewInstance;

    #[test]
    fn marker_text_stays_readable_by_installations_of_older_launchers() {
        let instance = |loader, version: Option<&str>| {
            Instance::from_new(NewInstance {
                name: "Test".into(),
                minecraft_version: "1.21.1".into(),
                loader,
                loader_version: version.map(Into::into),
            })
        };
        assert_eq!(install_key(&instance(ModLoader::Vanilla, None)), "1.21.1");
        assert_eq!(install_key(&instance(ModLoader::NeoForge, Some("21.1.172"))), "1.21.1 NeoForge 21.1.172");
        assert_eq!(install_key(&instance(ModLoader::Fabric, None)), "1.21.1 Fabric ?");
    }

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
