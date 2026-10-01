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

/// Plattform-Schlüssel in `all.json`, der passendste zuerst. Für ARM fehlen alte Runtimes (Java 8 und 16);
/// dann läuft die x64-Runtime in der Emulation (Rosetta 2 bzw. die x64-Emulation von Windows).
fn runtime_platforms(os: &str, arch: &str) -> &'static [&'static str] {
    match (os, arch) {
        ("windows", "x86_64") => &["windows-x64"],
        ("windows", "x86") => &["windows-x86"],
        ("windows", "aarch64") => &["windows-arm64", "windows-x64"],
        ("linux", "x86_64") => &["linux"],
        ("linux", "x86") => &["linux-i386"],
        ("macos", "x86_64") => &["mac-os"],
        ("macos", "aarch64") => &["mac-os-arm64", "mac-os"],
        _ => &[],
    }
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

/// Dateinamen, die als eigene Java-Programmdatei gelten (verglichen in Kleinbuchstaben).
const JAVA_FILE_NAMES: &[&str] = if cfg!(windows) { &["javaw.exe", "java.exe"] } else { &["java"] };

/// Wo ein eigener Java-Pfad eingestellt ist. Es gibt zwei Stellen; Fehlermeldungen nennen die richtige.
#[derive(Debug, Clone, Copy)]
pub enum JavaSetting {
    Instance,
    Launcher,
}

impl JavaSetting {
    fn place(self) -> &'static str {
        match self {
            Self::Instance => "in den Einstellungen der Instanz",
            Self::Launcher => "in den Einstellungen des Launchers",
        }
    }
}

/// Java für den Start: eigener Pfad der Instanz vor dem aus den Einstellungen vor der mitgelieferten Runtime.
pub fn resolve(dirs: &Dirs, component: &str, instance_path: Option<&str>, global_path: Option<&str>) -> AppResult<PathBuf> {
    let custom = [(instance_path, JavaSetting::Instance), (global_path, JavaSetting::Launcher)]
        .into_iter()
        .filter_map(|(path, setting)| Some((path?.trim(), setting)))
        .find(|(path, _)| !path.is_empty());
    if let Some((path, setting)) = custom {
        return custom_java(path, setting);
    }
    let java = java_exe(dirs, component);
    if !java.exists() {
        return Err(AppError::Invalid(format!("Java nicht gefunden: {}", java.display())));
    }
    Ok(java)
}

/// Prüft einen eigenen Java-Pfad: Er muss auf eine vorhandene `javaw.exe` bzw. `java.exe` zeigen
/// (unter Linux/macOS `java`).
pub fn custom_java(path: &str, setting: JavaSetting) -> AppResult<PathBuf> {
    let path = PathBuf::from(path.trim());
    let name = path.file_name().map(|n| n.to_string_lossy().to_lowercase()).unwrap_or_default();
    if !JAVA_FILE_NAMES.contains(&name.as_str()) {
        return Err(AppError::Invalid(format!(
            "„{}“ ist kein Java-Programm. Wähle {} die {} im bin-Ordner deiner Java-Installation.",
            path.display(),
            setting.place(),
            JAVA_FILE_NAMES[0]
        )));
    }
    if !path.is_file() {
        return Err(AppError::Invalid(format!(
            "Java nicht gefunden: {}. Prüfe Java {}.",
            path.display(),
            setting.place()
        )));
    }
    Ok(path)
}

/// Lädt die Runtime `component` (z. B. `java-runtime-delta`) nach `runtime/<component>/`
/// und liefert den Pfad der Java-Programmdatei.
pub async fn ensure(
    client: &reqwest::Client,
    dirs: &Dirs,
    component: &str,
    on_done: &(dyn Fn(u64, u64) + Send + Sync),
) -> AppResult<PathBuf> {
    let (os, arch) = (std::env::consts::OS, std::env::consts::ARCH);
    let mut all: HashMap<String, HashMap<String, Vec<RuntimeEntry>>> =
        download::get_json(client, RUNTIMES_URL).await?;
    let entry = runtime_platforms(os, arch)
        .iter()
        .find_map(|platform| all.get_mut(*platform)?.remove(component)?.into_iter().next())
        .ok_or_else(|| AppError::NotFound { kind: "Java-Runtime", id: format!("{component} ({os} {arch})") })?;
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

#[cfg(test)]
mod tests {
    use super::*;

    /// Leere Datei `<root>/<name>`; liefert ihren Pfad als Text.
    fn fake_java(root: &Path, name: &str) -> String {
        let file = root.join(name);
        std::fs::write(&file, "").unwrap();
        file.to_string_lossy().into_owned()
    }

    #[test]
    fn runtime_keys_per_platform_with_x64_fallback_on_arm() {
        assert_eq!(runtime_platforms("windows", "x86_64"), ["windows-x64"]);
        assert_eq!(runtime_platforms("linux", "x86_64"), ["linux"]);
        assert_eq!(runtime_platforms("linux", "x86"), ["linux-i386"]);
        assert_eq!(runtime_platforms("macos", "x86_64"), ["mac-os"]);
        assert_eq!(runtime_platforms("macos", "aarch64"), ["mac-os-arm64", "mac-os"]);
        assert_eq!(runtime_platforms("windows", "aarch64"), ["windows-arm64", "windows-x64"]);
        assert!(runtime_platforms("linux", "aarch64").is_empty());
    }

    #[test]
    fn instance_path_wins_over_setting_and_runtime() {
        let root = std::env::temp_dir().join(crate::models::new_id());
        std::fs::create_dir_all(root.join("jdk")).unwrap();
        let own = fake_java(&root, JAVA_FILE_NAMES[0]);
        let global = fake_java(&root.join("jdk"), JAVA_FILE_NAMES[0]);
        let dirs = Dirs::new(&root);

        assert_eq!(resolve(&dirs, "delta", Some(&own), Some(&global)).unwrap(), PathBuf::from(&own));
        assert_eq!(resolve(&dirs, "delta", Some("  "), Some(&global)).unwrap(), PathBuf::from(&global));
        // Ein fehlendes Java nennt die Stelle, an der der Pfad eingestellt ist.
        let gone = root.join("gone").join(JAVA_FILE_NAMES[0]).to_string_lossy().into_owned();
        let own_gone = resolve(&dirs, "delta", Some(&gone), Some(&global)).unwrap_err().to_string();
        assert!(own_gone.contains(JavaSetting::Instance.place()), "{own_gone}");
        let global_gone = resolve(&dirs, "delta", None, Some(&gone)).unwrap_err().to_string();
        assert!(global_gone.contains(JavaSetting::Launcher.place()), "{global_gone}");
        // Ohne eigenen Pfad die Runtime; die fehlt hier.
        let missing = resolve(&dirs, "delta", None, Some("")).unwrap_err().to_string();
        assert!(missing.starts_with("Java nicht gefunden"), "{missing}");
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn custom_java_must_exist_and_be_java() {
        let root = std::env::temp_dir().join(crate::models::new_id());
        std::fs::create_dir_all(&root).unwrap();
        let other = fake_java(&root, "notepad.exe");
        assert!(custom_java(&other, JavaSetting::Instance).unwrap_err().to_string().contains("ist kein Java-Programm"));
        let gone = root.join(JAVA_FILE_NAMES[0]).to_string_lossy().into_owned();
        assert!(custom_java(&gone, JavaSetting::Instance).unwrap_err().to_string().starts_with("Java nicht gefunden"));
        let java = fake_java(&root, &JAVA_FILE_NAMES[0].to_uppercase());
        assert_eq!(custom_java(&format!(" {java} "), JavaSetting::Instance).unwrap(), PathBuf::from(&java));
        std::fs::remove_dir_all(root).unwrap();
    }
}
