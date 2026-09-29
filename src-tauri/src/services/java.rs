//! Java-Runtime aus Mojangs eigenen Runtime-Manifesten (keine System-Java nötig).
//! Welche Komponente eine Version braucht, steht in ihrer JSON unter `javaVersion.component`.
use std::collections::{BTreeMap, HashMap};
use std::path::{Path, PathBuf};

use serde::Deserialize;

use crate::error::{AppError, AppResult};
use crate::services::download::{self, Job};
use crate::services::mojang::Download;
use crate::services::Dirs;

const RUNTIMES_URL: &str =
    "https://launchermeta.mojang.com/v1/products/java-runtime/2ec0cc96c44e5a76b9c8b7c39df7210883d12871/all.json";

#[derive(Debug, Deserialize)]
struct RuntimeEntry {
    manifest: Download,
}

#[derive(Debug, Deserialize)]
struct RawDownloads {
    raw: Download,
}

#[derive(Debug, Deserialize)]
struct RuntimeFile {
    #[serde(rename = "type")]
    kind: String,
    #[serde(default)]
    downloads: Option<RawDownloads>,
    // Exec-Bit und Links gibt es nur unter Unix; Mojang liefert für Windows keine Links.
    #[serde(default)]
    #[cfg_attr(windows, allow(dead_code))]
    executable: bool,
    #[serde(default)]
    #[cfg_attr(windows, allow(dead_code))]
    target: Option<String>,
}

#[derive(Debug, Deserialize)]
struct RuntimeManifest {
    files: BTreeMap<String, RuntimeFile>,
}

/// Plattform-Schlüssel in `all.json`.
fn platform() -> Option<&'static str> {
    Some(match (std::env::consts::OS, std::env::consts::ARCH) {
        ("windows", "x86_64") => "windows-x64",
        ("windows", "x86") => "windows-x86",
        ("windows", "aarch64") => "windows-arm64",
        ("linux", "x86_64") => "linux",
        ("linux", "x86") => "linux-i386",
        ("macos", "x86_64") => "mac-os",
        ("macos", "aarch64") => "mac-os-arm64",
        _ => return None,
    })
}

/// Pfad der Java-Programmdatei einer installierten Komponente. Unter Windows `javaw.exe`
/// (kein Konsolenfenster; stdout/stderr gehen trotzdem in die Pipes).
pub fn java_exe(dirs: &Dirs, component: &str) -> PathBuf {
    let base = dirs.runtime(component);
    match std::env::consts::OS {
        "windows" => base.join("bin").join("javaw.exe"),
        "macos" => base.join("jre.bundle/Contents/Home/bin/java"),
        _ => base.join("bin").join("java"),
    }
}

/// Lädt die Runtime `component` (z. B. `java-runtime-delta`) nach `runtime/<component>/`
/// und liefert den Pfad der Java-Programmdatei.
pub async fn ensure(
    client: &reqwest::Client,
    dirs: &Dirs,
    component: &str,
    on_done: &(dyn Fn(u64, u64) + Send + Sync),
) -> AppResult<PathBuf> {
    let platform = platform().ok_or_else(|| AppError::Invalid("Plattform ohne Mojang-Java-Runtime".into()))?;
    let mut all: HashMap<String, HashMap<String, Vec<RuntimeEntry>>> =
        download::get_json(client, RUNTIMES_URL).await?;
    let entry = all
        .get_mut(platform)
        .and_then(|c| c.remove(component))
        .and_then(|v| v.into_iter().next())
        .ok_or_else(|| AppError::NotFound { kind: "Java-Runtime", id: format!("{component} ({platform})") })?;
    let manifest: RuntimeManifest = download::get_json(client, &entry.manifest.url).await?;

    let base = dirs.runtime(component);
    let mut jobs = Vec::new();
    for (path, file) in &manifest.files {
        let target = base.join(Path::new(path));
        match (file.kind.as_str(), &file.downloads) {
            ("directory", _) => tokio::fs::create_dir_all(&target).await?,
            ("file", Some(d)) => jobs.push(Job { url: d.raw.url.clone(), path: target, sha1: Some(d.raw.sha1.clone()) }),
            _ => {} // Links: siehe unten
        }
    }
    download::fetch_all(client, jobs, on_done).await?;

    #[cfg(unix)]
    for (path, file) in &manifest.files {
        use std::os::unix::fs::PermissionsExt;
        let target = base.join(path);
        if file.kind == "link" {
            if let (Some(link), Err(_)) = (&file.target, tokio::fs::symlink_metadata(&target).await) {
                tokio::fs::symlink(link, &target).await?;
            }
        } else if file.executable {
            tokio::fs::set_permissions(&target, std::fs::Permissions::from_mode(0o755)).await?;
        }
    }

    let exe = java_exe(dirs, component);
    if !exe.exists() {
        return Err(AppError::Download(format!("Java-Runtime unvollständig: {} fehlt", exe.display())));
    }
    Ok(exe)
}
