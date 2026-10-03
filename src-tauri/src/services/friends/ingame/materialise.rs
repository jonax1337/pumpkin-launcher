//! Legt das eingebettete JAR im Datenordner des Launchers ab und sichert es bis zum Spielstart (INGAME 3.1, 3.7).
//! Der Ort ist `<Daten>/runtime/friends-mod/<Mod-Version>/`; für Loader, die ein Maven-Verzeichnis erwarten, liegt
//! das JAR darin nach dessen Schema. Das JAR gehört dem Launcher, nie der Instanz.
use std::fs;
use std::io::{self, Read};
use std::path::{Path, PathBuf};

use data_encoding::HEXLOWER;
use sha2::{Digest, Sha256};

use super::index::{ModSource, Node, Strategy};

/// Maven-Koordinaten der Mod, wie `--fml.mods` sie nennt: `<Gruppe>:<Artefakt>:<Version>`.
pub const MAVEN_GROUP: &str = "dev.laux.pumpkin";
pub const MAVEN_ARTIFACT: &str = "pumpkin_friends";

/// Mehr als das hat nie ein JAR dieser Mod (INGAME 3.2: höchstens 300 KB je JAR); alles Größere ist fremd.
const MAX_JAR_BYTES: u64 = 8 * 1024 * 1024;

/// Warum das JAR nicht bereitliegt. Der Aufrufer startet dann ohne Einspeisung.
#[derive(Debug, thiserror::Error)]
pub enum MaterialiseError {
    #[error("Das JAR {file} fehlt in diesem Build")]
    JarMissing { file: String },
    #[error("Das eingebettete JAR {file} passt nicht zu seiner Prüfsumme im Index")]
    EmbeddedJarCorrupt { file: String },
    #[error("Das abgelegte JAR {path} passt nach dem Schreiben nicht zur Prüfsumme")]
    WrittenJarCorrupt { path: PathBuf },
    #[error("Das JAR {path} hat sich seit der Prüfung verändert")]
    JarChanged { path: PathBuf },
    #[error("Zugriff auf {path} gescheitert: {source}")]
    Io { path: PathBuf, source: io::Error },
}

/// Ein abgelegtes, geprüftes JAR. Unter Windows hält der Wert die Datei mit Freigabe „nur Lesen“ offen, solange er
/// lebt: niemand kann sie in der Zeit überschreiben oder löschen, und damit schließt sich das Fenster zwischen Prüfung
/// und Laden. Der Aufrufer behält ihn, bis das Spiel gestartet ist.
#[derive(Debug)]
pub struct MaterialisedJar {
    jar: PathBuf,
    maven_root: Option<PathBuf>,
    runtime_dir: PathBuf,
    mod_version: String,
    sha256: String,
    _hold: Option<fs::File>,
}

impl MaterialisedJar {
    /// Pfad des JARs; bei `fmlMavenRoot` die Datei im Maven-Verzeichnis.
    pub fn jar(&self) -> &Path {
        &self.jar
    }

    /// Wurzel des Maven-Verzeichnisses; nur bei `fmlMavenRoot`.
    pub fn maven_root(&self) -> Option<&Path> {
        self.maven_root.as_deref()
    }

    /// Ordner dieser Mod-Version; hier legen auch die Argumente ihre Hilfsdateien ab.
    pub fn runtime_dir(&self) -> &Path {
        &self.runtime_dir
    }

    pub fn mod_version(&self) -> &str {
        &self.mod_version
    }

    /// Hasht die Datei erneut und vergleicht mit dem Index. Der Aufrufer ruft das unmittelbar vor dem Start auf.
    pub fn verify(&self) -> Result<(), MaterialiseError> {
        let file = fs::File::open(&self.jar).map_err(|source| io_error(&self.jar, source))?;
        match hash_of(file).map_err(|source| io_error(&self.jar, source))? {
            Some(hash) if hash == self.sha256 => Ok(()),
            _ => Err(MaterialiseError::JarChanged { path: self.jar.clone() }),
        }
    }
}

/// Der Ordner dieser Mod-Version im Datenordner des Launchers.
pub fn runtime_dir(data_dir: &Path, mod_version: &str) -> PathBuf {
    data_dir.join("runtime").join("friends-mod").join(mod_version)
}

/// SHA-256 als 64 Hexzeichen in Kleinbuchstaben.
pub fn sha256_hex(bytes: &[u8]) -> String {
    HEXLOWER.encode(&Sha256::digest(bytes))
}

/// Legt das JAR des Knotens bereit: Bytes aus der Quelle gegen den Index prüfen, ablegen, wenn die Datei fehlt oder
/// nicht passt (ein verkürztes oder verändertes JAR wird neu geschrieben), erneut prüfen, schreibschützen.
pub fn materialise(source: &impl ModSource, data_dir: &Path, node: &Node) -> Result<MaterialisedJar, MaterialiseError> {
    let bytes = source.jar_bytes(&node.file).ok_or_else(|| MaterialiseError::JarMissing { file: node.file.clone() })?;
    if sha256_hex(bytes) != node.sha256 {
        return Err(MaterialiseError::EmbeddedJarCorrupt { file: node.file.clone() });
    }
    let mod_version = source.index().mod_version.clone();
    let runtime_dir = runtime_dir(data_dir, &mod_version);
    let (maven_root, jar) = locations(node, &runtime_dir, &mod_version);
    let hold = place(&jar, bytes, &node.sha256)?;
    Ok(MaterialisedJar { jar, maven_root, runtime_dir, mod_version, sha256: node.sha256.clone(), _hold: hold })
}

/// Wo das JAR liegt: bei `fmlMavenRoot` in einem Maven-Verzeichnis je Knoten, sonst flach unter seinem Dateinamen.
fn locations(node: &Node, runtime_dir: &Path, mod_version: &str) -> (Option<PathBuf>, PathBuf) {
    if node.strategy != Strategy::FmlMavenRoot {
        return (None, runtime_dir.join(&node.file));
    }
    let root = runtime_dir.join(format!("maven-{}", node.id));
    let jar = MAVEN_GROUP
        .split('.')
        .fold(root.clone(), |path, part| path.join(part))
        .join(MAVEN_ARTIFACT)
        .join(mod_version)
        .join(format!("{MAVEN_ARTIFACT}-{mod_version}.jar"));
    (Some(root), jar)
}

/// Sorgt dafür, dass unter `path` genau `bytes` liegen, und gibt die Haltevorrichtung zurück.
fn place(path: &Path, bytes: &[u8], sha256: &str) -> Result<Option<fs::File>, MaterialiseError> {
    let parent = path.parent().ok_or_else(|| io_error(path, io::ErrorKind::InvalidInput.into()))?;
    fs::create_dir_all(parent).map_err(|source| io_error(parent, source))?;
    let hold = match open_if_matching(path, sha256)? {
        Some(hold) => hold,
        None => {
            write_atomically(path, bytes).map_err(|source| io_error(path, source))?;
            open_if_matching(path, sha256)?.ok_or_else(|| MaterialiseError::WrittenJarCorrupt { path: path.to_owned() })?
        }
    };
    mark_read_only(path).map_err(|source| io_error(path, source))?;
    Ok(hold.into_retained())
}

/// Eine geöffnete Datei, deren Inhalt zur erwarteten Prüfsumme passte.
struct VerifiedFile(fs::File);

impl VerifiedFile {
    /// Windows hält die Datei offen (die Freigabe „nur Lesen“ sperrt Schreiben und Löschen); anderswo gäbe das
    /// Offenhalten nichts, also wird sie geschlossen.
    fn into_retained(self) -> Option<fs::File> {
        cfg!(windows).then_some(self.0)
    }
}

/// Öffnet die Datei zum Lesen und prüft ihren Inhalt über genau dieses Handle. `None`, wenn sie fehlt oder nicht passt.
fn open_if_matching(path: &Path, sha256: &str) -> Result<Option<VerifiedFile>, MaterialiseError> {
    let file = match open_shared_for_reading(path) {
        Ok(file) => file,
        Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(None),
        Err(source) => return Err(io_error(path, source)),
    };
    let mut handle = &file;
    let matches = hash_of(&mut handle).map_err(|source| io_error(path, source))?.is_some_and(|hash| hash == sha256);
    Ok(matches.then_some(VerifiedFile(file)))
}

/// Hash des Inhalts; `None`, wenn mehr als [`MAX_JAR_BYTES`] kommen.
fn hash_of(reader: impl Read) -> io::Result<Option<String>> {
    let mut content = Vec::new();
    reader.take(MAX_JAR_BYTES + 1).read_to_end(&mut content)?;
    Ok((content.len() as u64 <= MAX_JAR_BYTES).then(|| sha256_hex(&content)))
}

#[cfg(windows)]
fn open_shared_for_reading(path: &Path) -> io::Result<fs::File> {
    use std::os::windows::fs::OpenOptionsExt;
    use windows_sys::Win32::Storage::FileSystem::FILE_SHARE_READ;
    fs::OpenOptions::new().read(true).share_mode(FILE_SHARE_READ).open(path)
}

#[cfg(not(windows))]
fn open_shared_for_reading(path: &Path) -> io::Result<fs::File> {
    fs::File::open(path)
}

/// Schreibt `bytes` in eine eigene Temp-Datei neben dem Ziel und benennt sie um: ein Abbruch hinterlässt nie eine
/// halbe Datei, und zwei gleichzeitige Starts stören sich nicht (der Name der Temp-Datei ist einmalig).
pub(super) fn write_atomically(path: &Path, bytes: &[u8]) -> io::Result<()> {
    let temp = temp_name_beside(path);
    let result = write_synced(&temp, bytes).and_then(|()| {
        make_replaceable(path)?;
        fs::rename(&temp, path)
    });
    if result.is_err() {
        let _ = fs::remove_file(&temp);
    }
    result
}

fn temp_name_beside(path: &Path) -> PathBuf {
    let name = path.file_name().map(|name| name.to_string_lossy().into_owned()).unwrap_or_default();
    path.with_file_name(format!("{name}.{}.tmp", uuid::Uuid::new_v4().simple()))
}

fn write_synced(path: &Path, bytes: &[u8]) -> io::Result<()> {
    let mut file = fs::File::create(path)?;
    io::Write::write_all(&mut file, bytes)?;
    file.sync_all()
}

/// Windows ersetzt keine schreibgeschützte Datei; unter Unix hindert das Attribut das Umbenennen nicht.
#[cfg(windows)]
#[allow(clippy::permissions_set_readonly_false)] // unter Windows heißt das nur „Schreibschutz-Attribut entfernen“
fn make_replaceable(path: &Path) -> io::Result<()> {
    match fs::metadata(path) {
        Ok(meta) => {
            let mut permissions = meta.permissions();
            permissions.set_readonly(false);
            fs::set_permissions(path, permissions)
        }
        Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(error),
    }
}

#[cfg(not(windows))]
fn make_replaceable(_path: &Path) -> io::Result<()> {
    Ok(())
}

fn mark_read_only(path: &Path) -> io::Result<()> {
    let mut permissions = fs::metadata(path)?.permissions();
    permissions.set_readonly(true);
    fs::set_permissions(path, permissions)
}

fn io_error(path: &Path, source: io::Error) -> MaterialiseError {
    MaterialiseError::Io { path: path.to_owned(), source }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::services::friends::ingame::index::Loader;
    use crate::services::friends::ingame::test_support::{jar_node, FakeSource, TempDir};

    const JAR: &[u8] = b"PK\x03\x04 the real jar bytes";

    fn setup(loader: Loader) -> (TempDir, FakeSource, Node) {
        let node = jar_node("1.21.1-neoforge", loader, JAR);
        (TempDir::new(), FakeSource::with_jar(&node, JAR), node)
    }

    fn jar_path(data: &TempDir, node: &Node) -> PathBuf {
        runtime_dir(data.path(), "2.1.0").join(&node.file)
    }

    #[test]
    fn a_missing_jar_is_written_to_the_runtime_folder_and_made_read_only() {
        let (data, source, node) = setup(Loader::Fabric);
        let materialised = materialise(&source, data.path(), &node).unwrap();
        assert_eq!(materialised.jar(), jar_path(&data, &node));
        assert_eq!(fs::read(materialised.jar()).unwrap(), JAR);
        assert!(fs::metadata(materialised.jar()).unwrap().permissions().readonly());
        assert_eq!(materialised.maven_root(), None);
        assert_eq!(materialised.mod_version(), "2.1.0");
        assert!(materialised.verify().is_ok());
    }

    #[test]
    fn a_jar_with_wrong_content_is_rewritten() {
        let (data, source, node) = setup(Loader::Fabric);
        let path = jar_path(&data, &node);
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(&path, vec![0u8; JAR.len()]).unwrap();
        materialise(&source, data.path(), &node).unwrap();
        assert_eq!(fs::read(&path).unwrap(), JAR);
    }

    #[test]
    fn a_truncated_jar_is_rewritten() {
        let (data, source, node) = setup(Loader::Fabric);
        let path = jar_path(&data, &node);
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(&path, &JAR[..JAR.len() / 2]).unwrap();
        materialise(&source, data.path(), &node).unwrap();
        assert_eq!(fs::read(&path).unwrap(), JAR);
    }

    #[test]
    fn an_oversized_file_is_rewritten() {
        let (data, source, node) = setup(Loader::Fabric);
        let path = jar_path(&data, &node);
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(&path, vec![7u8; MAX_JAR_BYTES as usize + 10]).unwrap();
        materialise(&source, data.path(), &node).unwrap();
        assert_eq!(fs::read(&path).unwrap(), JAR);
    }

    #[test]
    fn a_wrong_read_only_jar_from_an_earlier_launch_is_replaced() {
        let (data, source, node) = setup(Loader::Fabric);
        let path = jar_path(&data, &node);
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(&path, b"stale").unwrap();
        mark_read_only(&path).unwrap();
        materialise(&source, data.path(), &node).unwrap();
        assert_eq!(fs::read(&path).unwrap(), JAR);
        assert!(fs::metadata(&path).unwrap().permissions().readonly());
    }

    #[test]
    fn a_correct_jar_stays_untouched_and_a_repeat_call_works_while_the_first_guard_lives() {
        let (data, source, node) = setup(Loader::Fabric);
        let first = materialise(&source, data.path(), &node).unwrap();
        let before = fs::metadata(first.jar()).unwrap().modified().unwrap();
        let second = materialise(&source, data.path(), &node).unwrap();
        assert_eq!(fs::metadata(second.jar()).unwrap().modified().unwrap(), before);
        let leftovers = fs::read_dir(second.runtime_dir()).unwrap().count();
        assert_eq!(leftovers, 1, "keine Temp-Dateien übrig");
    }

    #[test]
    fn an_embedded_jar_that_does_not_match_the_index_is_refused_and_nothing_is_written() {
        let (data, _, node) = setup(Loader::Fabric);
        let source = FakeSource::with_jar(&node, b"other bytes");
        let error = materialise(&source, data.path(), &node).unwrap_err();
        assert!(matches!(error, MaterialiseError::EmbeddedJarCorrupt { .. }), "{error}");
        assert!(!runtime_dir(data.path(), "2.1.0").exists());
    }

    #[test]
    fn a_jar_the_source_does_not_have_is_reported() {
        let (data, _, node) = setup(Loader::Fabric);
        let source = FakeSource::empty();
        assert!(matches!(materialise(&source, data.path(), &node), Err(MaterialiseError::JarMissing { .. })));
    }

    #[test]
    fn maven_nodes_get_a_repository_layout_per_node() {
        let (data, source, node) = setup(Loader::Neoforge);
        let node = Node { strategy: Strategy::FmlMavenRoot, ..node };
        let materialised = materialise(&source, data.path(), &node).unwrap();
        let root = runtime_dir(data.path(), "2.1.0").join("maven-1.21.1-neoforge");
        assert_eq!(materialised.maven_root(), Some(root.as_path()));
        let expected = root.join("dev").join("laux").join("pumpkin").join("pumpkin_friends").join("2.1.0").join("pumpkin_friends-2.1.0.jar");
        assert_eq!(materialised.jar(), expected);
        assert_eq!(fs::read(&expected).unwrap(), JAR);
    }

    #[cfg(not(windows))]
    #[test]
    fn verify_notices_a_file_that_changed_after_it_was_placed() {
        let (data, source, node) = setup(Loader::Fabric);
        let materialised = materialise(&source, data.path(), &node).unwrap();
        crate::services::friends::ingame::test_support::make_writable(materialised.jar());
        fs::write(materialised.jar(), b"tampered").unwrap();
        assert!(matches!(materialised.verify(), Err(MaterialiseError::JarChanged { .. })));
    }

    #[cfg(windows)]
    #[test]
    fn the_guard_keeps_the_jar_from_being_changed_until_it_is_dropped() {
        use std::os::windows::fs::OpenOptionsExt;
        const SHARING_VIOLATION: i32 = 32;
        let (data, source, node) = setup(Loader::Fabric);
        let materialised = materialise(&source, data.path(), &node).unwrap();
        let path = materialised.jar().to_owned();
        make_replaceable(&path).unwrap();
        let open_for_writing = || fs::OpenOptions::new().write(true).share_mode(0).open(&path);
        assert_eq!(open_for_writing().unwrap_err().raw_os_error(), Some(SHARING_VIOLATION));
        assert_eq!(fs::remove_file(&path).unwrap_err().raw_os_error(), Some(SHARING_VIOLATION));
        drop(materialised);
        assert!(open_for_writing().is_ok());
    }
}
