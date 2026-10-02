//! Installierte Java-Versionen finden (Standardordner, `JAVA_HOME`, `PATH`) und ihre Version aus der Datei `release`
//! im Java-Home lesen. Es wird nichts gestartet; der Launcher bringt für jede Minecraft-Version ohnehin eine eigene
//! Runtime mit, die Funde sind nur ein Angebot für „Eigene Java-Installation“.
use std::fs;
use std::path::{Path, PathBuf};

use serde::Serialize;

use crate::services::java::JAVA_FILE_NAMES;

/// Eine gefundene Java-Installation: die Programmdatei, die der Launcher als eigenen Pfad annimmt.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct JavaInstall {
    pub path: String,
    /// Version wie im `release`-Eintrag, z. B. „21.0.2“ oder „1.8.0_392“.
    pub version: String,
    /// Hauptversion („8“ für 1.8.0_392).
    pub major: u32,
    pub vendor: Option<String>,
}

/// Ordner, in denen Hersteller ihre JDKs ablegen: je Eintrag ein Unterordner pro installierter Version.
const WINDOWS_VENDOR_FOLDERS: [&str; 9] =
    ["Java", "Eclipse Adoptium", "Eclipse Foundation", "Microsoft", "Zulu", "BellSoft", "Amazon Corretto", "Semeru", "AdoptOpenJDK"];

/// Felder aus der Datei `release` eines Java-Homes.
#[derive(Debug, PartialEq, Eq)]
struct Release {
    version: String,
    vendor: Option<String>,
}

/// Wert von `KEY="Wert"` (die Anführungszeichen sind optional) in einer `release`-Datei.
fn release_value<'a>(text: &'a str, key: &str) -> Option<&'a str> {
    let value = text.lines().find_map(|line| line.strip_prefix(key)?.strip_prefix('='))?;
    Some(value.trim().trim_matches('"')).filter(|value| !value.is_empty())
}

fn parse_release(text: &str) -> Option<Release> {
    Some(Release { version: release_value(text, "JAVA_VERSION")?.to_owned(), vendor: release_value(text, "IMPLEMENTOR").map(str::to_owned) })
}

/// Hauptversion: „1.8.0_392“ ist Java 8, „21.0.2“ Java 21.
fn major_of(version: &str) -> Option<u32> {
    let mut numbers = version.split(['.', '_', '-', '+']).map_while(|part| part.parse::<u32>().ok());
    match numbers.next()? {
        1 => numbers.next(),
        major => Some(major),
    }
}

fn read_release(home: &Path) -> Option<Release> {
    parse_release(&fs::read_to_string(home.join("release")).ok()?)
}

/// Version der Java-Programmdatei `exe` (`<home>/bin/java`); ohne `release`-Datei unbekannt.
pub fn version_of(exe: &Path) -> Option<String> {
    read_release(exe.parent()?.parent()?).map(|release| release.version)
}

/// Die Installation im Java-Home `home`, sofern dort Programmdatei und `release` liegen.
fn install_at(home: &Path) -> Option<JavaInstall> {
    let exe = JAVA_FILE_NAMES.iter().map(|name| home.join("bin").join(name)).find(|exe| exe.is_file())?;
    let Release { version, vendor } = read_release(home)?;
    Some(JavaInstall { path: exe.to_string_lossy().into_owned(), major: major_of(&version)?, version, vendor })
}

/// Installationen in den Unterordnern von `parent`; unter macOS liegt das Home in `<name>.jdk/Contents/Home`.
fn scan(parent: &Path) -> Vec<JavaInstall> {
    let Ok(children) = fs::read_dir(parent) else { return Vec::new() };
    children
        .filter_map(Result::ok)
        .map(|child| child.path())
        .filter_map(|home| install_at(&home).or_else(|| install_at(&home.join("Contents").join("Home"))))
        .collect()
}

fn env_path(name: &str) -> Option<PathBuf> {
    std::env::var_os(name).map(PathBuf::from).filter(|path| !path.as_os_str().is_empty())
}

/// Ordner, deren Unterordner Java-Homes sind, je System.
fn standard_roots() -> Vec<PathBuf> {
    let home = dirs::home_dir();
    let in_home = |sub: &str| home.as_ref().map(|home| home.join(sub));
    let mut roots = vec![in_home(".jdks"), in_home(".sdkman/candidates/java")];
    match std::env::consts::OS {
        "windows" => {
            let bases = ["ProgramFiles", "ProgramFiles(x86)"].map(env_path).into_iter().flatten();
            let local = env_path("LOCALAPPDATA").map(|dir| dir.join("Programs"));
            roots.extend(bases.chain(local).flat_map(|base| WINDOWS_VENDOR_FOLDERS.map(|vendor| Some(base.join(vendor)))));
        }
        "macos" => roots.extend([Some("/Library/Java/JavaVirtualMachines".into()), in_home("Library/Java/JavaVirtualMachines")]),
        _ => roots.extend(["/usr/lib/jvm", "/usr/java", "/opt/java"].map(|dir| Some(PathBuf::from(dir)))),
    }
    roots.into_iter().flatten().collect()
}

/// Installationen, auf die `JAVA_HOME` und `PATH` zeigen.
fn from_environment() -> Vec<JavaInstall> {
    let java_home = env_path("JAVA_HOME");
    let on_path = std::env::var_os("PATH").into_iter().flat_map(|paths| std::env::split_paths(&paths).collect::<Vec<_>>());
    java_home.into_iter().chain(on_path.filter_map(|bin| bin.parent().map(Path::to_path_buf))).filter_map(|home| install_at(&home)).collect()
}

/// Alle gefundenen Installationen, neueste Hauptversion zuerst, ohne Doppelte.
pub fn detect() -> Vec<JavaInstall> {
    let mut found: Vec<JavaInstall> = standard_roots().iter().flat_map(|root| scan(root)).chain(from_environment()).collect();
    found.sort_by(|a, b| b.major.cmp(&a.major).then_with(|| a.path.cmp(&b.path)));
    found.dedup_by(|a, b| a.path == b.path);
    found
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fake_home(parent: &Path, name: &str, release: Option<&str>) -> PathBuf {
        let home = parent.join(name);
        fs::create_dir_all(home.join("bin")).unwrap();
        fs::write(home.join("bin").join(JAVA_FILE_NAMES[0]), "").unwrap();
        if let Some(release) = release {
            fs::write(home.join("release"), release).unwrap();
        }
        home
    }

    #[test]
    fn reads_version_and_vendor_from_the_release_file() {
        let release = parse_release("IMPLEMENTOR=\"Eclipse Adoptium\"\nJAVA_VERSION=\"21.0.2\"\nOS_NAME=\"Windows\"\n").unwrap();
        assert_eq!(release, Release { version: "21.0.2".into(), vendor: Some("Eclipse Adoptium".into()) });
        assert_eq!(parse_release("JAVA_VERSION=17").unwrap().vendor, None);
        assert_eq!(parse_release("JAVA_VERSION_DATE=\"2024-01-16\"\nOS_NAME=x"), None);
    }

    #[test]
    fn main_versions_from_old_and_new_schemes() {
        assert_eq!([major_of("1.8.0_392"), major_of("17.0.9"), major_of("21"), major_of("22-ea")], [Some(8), Some(17), Some(21), Some(22)]);
        assert_eq!(major_of("kaputt"), None);
    }

    #[test]
    fn finds_homes_with_program_and_release_only() {
        let root = std::env::temp_dir().join(crate::models::new_id());
        let jdk21 = fake_home(&root, "jdk-21", Some("JAVA_VERSION=\"21.0.2\"\nIMPLEMENTOR=\"Microsoft\""));
        fake_home(&root, "jdk-8", Some("JAVA_VERSION=\"1.8.0_392\""));
        fake_home(&root, "ohne-release", None);
        fs::create_dir_all(root.join("leer")).unwrap();

        let mut found = scan(&root);
        found.sort_by_key(|install| install.major);
        assert_eq!(found.iter().map(|i| (i.major, i.version.as_str())).collect::<Vec<_>>(), [(8, "1.8.0_392"), (21, "21.0.2")]);
        assert_eq!(found[1].vendor.as_deref(), Some("Microsoft"));
        assert_eq!(Path::new(&found[1].path), jdk21.join("bin").join(JAVA_FILE_NAMES[0]));
        assert_eq!(version_of(Path::new(&found[1].path)).as_deref(), Some("21.0.2"));
        assert!(scan(&root.join("gibt-es-nicht")).is_empty());
        fs::remove_dir_all(root).unwrap();
    }
}
