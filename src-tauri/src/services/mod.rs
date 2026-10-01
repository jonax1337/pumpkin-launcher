//! Services: Persistenz, Auth, Installation (Mojang-Formate, Downloads, Java), Spielstart, Kopie, Export und
//! Import von Instanzen, Welten und Server, Skins und Support.
use std::{
    fs, io,
    path::{Path, PathBuf},
};

use tokio_util::sync::CancellationToken;

use crate::error::{AppError, AppResult};
use download::RemoveOnDrop;
use modrinth::invalid;

pub mod auth;
pub mod datapacks;
pub mod debuginfo;
pub mod download;
pub mod duplicate;
pub mod fabric;
pub mod forge;
pub mod gamelog;
pub mod imports;
pub mod install;
pub mod java;
pub mod launch;
pub mod local_files;
pub mod logshare;
pub mod mods;
pub mod modrinth;
pub mod content;
pub mod mojang;
pub mod mrpack;
pub mod providers;
pub mod rules;
pub mod servers;
pub mod screenshots;
pub mod skins;
pub mod store;
pub mod system;
pub mod templates;
pub mod worlds;

/// Ordner im Spielverzeichnis, die Minecraft und Loader von selbst neu anlegen (Fabric: `.fabric`
/// mit umgemappten JARs); Kopien und Exporte lassen sie weg.
pub(crate) const REGENERATED: [&str; 3] = ["logs", "crash-reports", ".fabric"];

/// Verzeichnislayout unter dem App-Datenverzeichnis. Libraries, Assets, Versionen und
/// Java-Runtimes teilen sich alle Instanzen; jede Instanz hat ihr eigenes Spiel- und Natives-Verzeichnis.
#[derive(Debug, Clone)]
pub struct Dirs {
    pub root: PathBuf,
}

impl Dirs {
    pub fn new(root: impl Into<PathBuf>) -> Self {
        Self { root: root.into() }
    }

    pub fn libraries(&self) -> PathBuf {
        self.root.join("libraries")
    }

    pub fn assets(&self) -> PathBuf {
        self.root.join("assets")
    }

    pub fn runtime(&self, component: &str) -> PathBuf {
        self.root.join("runtime").join(component)
    }

    /// `versions/<id>/<id>.<ext>` (Versions-JSON und Client-JAR).
    pub fn version_file(&self, id: &str, ext: &str) -> PathBuf {
        self.root.join("versions").join(id).join(format!("{id}.{ext}"))
    }

    pub fn instance(&self, instance_id: &str) -> PathBuf {
        self.root.join("instances").join(instance_id)
    }

    pub fn game_dir(&self, instance_id: &str) -> PathBuf {
        self.instance(instance_id).join("minecraft")
    }

    /// Protokoll des letzten Starts, von Minecraft selbst geschrieben.
    pub fn latest_log(&self, instance_id: &str) -> PathBuf {
        self.game_dir(instance_id).join("logs").join("latest.log")
    }

    /// `mods/` im Spielverzeichnis, dort sucht Fabric (und jeder andere Loader).
    pub fn mods_dir(&self, instance_id: &str) -> PathBuf {
        self.game_dir(instance_id).join("mods")
    }

    /// Welten des Spiels, je eine als Ordner.
    pub fn saves(&self, instance_id: &str) -> PathBuf {
        self.game_dir(instance_id).join("saves")
    }

    /// Sicherungen der Welten; außerhalb des Spielordners, damit Exporte und Kopien sie nicht mitnehmen.
    pub fn backups(&self, instance_id: &str) -> PathBuf {
        self.instance(instance_id).join("backups")
    }

    /// `screenshots/` im Spielverzeichnis, dort legt Minecraft mit F2 ab.
    pub fn screenshots_dir(&self, instance_id: &str) -> PathBuf {
        self.game_dir(instance_id).join("screenshots")
    }

    /// Globaler Mod-Cache, Dateien als `<sha1>.jar`.
    pub fn mod_cache(&self) -> PathBuf {
        self.root.join("cache").join("mods")
    }

    /// Skin-Bibliothek, Dateien als `<sha1>.png`.
    pub fn skins(&self) -> PathBuf {
        self.root.join("skins")
    }

    pub fn natives_dir(&self, instance_id: &str) -> PathBuf {
        self.instance(instance_id).join("natives")
    }

    /// Markerdatei einer vollständigen Installation; ihr Inhalt hängt nur an Version und Loader.
    pub fn installed_marker(&self, instance_id: &str) -> PathBuf {
        self.instance(instance_id).join("installed")
    }

    /// Ordner und Dateien direkt im Spielverzeichnis, sortiert und ohne Neuerzeugtes.
    pub fn game_entries(&self, instance_id: &str) -> AppResult<Vec<String>> {
        let mut names: Vec<String> = entries(&self.game_dir(instance_id))?
            .iter()
            .filter_map(|entry| entry.file_name().into_string().ok())
            .filter(|name| !REGENERATED.contains(&name.as_str()))
            .collect();
        names.sort();
        Ok(names)
    }

    pub fn library(&self, path: &str) -> PathBuf {
        self.libraries().join(Path::new(path))
    }
}

/// Dateien unter `path` (Datei oder Ordner, rekursiv, ohne Symlinks/Junctions) als
/// (Pfad relativ zu `base` mit `/`, Pfad). Fehlt `path`, kommt nichts hinzu.
pub(crate) fn walk(base: &Path, path: &Path, out: &mut Vec<(String, PathBuf)>) -> AppResult<()> {
    let kind = match fs::symlink_metadata(path) {
        Ok(meta) => meta.file_type(),
        Err(e) if e.kind() == io::ErrorKind::NotFound => return Ok(()),
        Err(e) => return Err(e.into()),
    };
    if kind.is_dir() {
        for entry in fs::read_dir(path)? {
            walk(base, &entry?.path(), out)?;
        }
    } else if kind.is_file() {
        let rel = path.strip_prefix(base).map_err(|_| invalid("Pfad außerhalb des Spielordners"))?;
        let rel = rel.to_str().ok_or_else(|| invalid("Dateiname ist kein gültiger Text"))?.replace('\\', "/");
        out.push((rel, path.to_owned()));
    }
    Ok(())
}

/// Ab dieser Dateigröße schreiben ZIP-Archive ZIP64 (Pflicht ab 4 GiB); mit Abstand, weil Deflate Unkomprimierbares
/// leicht vergrößert.
pub(crate) const ZIP64_FROM: u64 = 2 * 1024 * 1024 * 1024;

/// Schreibt `bytes` erst in `<path>.tmp` und benennt dann um: ein Abbruch hinterlässt nie eine halbe Datei.
pub(crate) fn write_atomic(path: &Path, bytes: &[u8]) -> AppResult<()> {
    let mut tmp = path.as_os_str().to_owned();
    tmp.push(".tmp");
    let tmp = PathBuf::from(tmp);
    fs::write(&tmp, bytes)?;
    fs::rename(&tmp, path)?;
    Ok(())
}

/// Schreibt ein ZIP über `<path>.<part_ext>`: `fill` legt die Einträge an, danach wird umbenannt. Bei einem Fehler
/// (auch aus `fill`) oder Abbruch bleibt am Ziel nichts Halbes liegen.
pub(crate) fn write_zip_atomic(
    path: &Path,
    part_ext: &str,
    fill: impl FnOnce(&mut zip::ZipWriter<fs::File>) -> AppResult<()>,
) -> AppResult<()> {
    let tmp = path.with_extension(part_ext);
    let mut guard = RemoveOnDrop(Some(tmp.clone()));
    let mut zip = zip::ZipWriter::new(fs::File::create(&tmp)?);
    fill(&mut zip)?;
    // Erst schließen, dann umbenennen: Windows verschiebt keine offene Datei. Vorher auf den Datenträger, damit ein
    // Absturz nach dem Umbenennen (und etwa dem Löschen der gesicherten Welt) keine leere Datei zurücklässt.
    zip.finish()?.sync_all()?;
    fs::rename(&tmp, path)?;
    guard.0 = None;
    Ok(())
}

/// Hängt `file` als Eintrag `name` an; ab [`ZIP64_FROM`] als ZIP64.
pub(crate) fn add_zip_file(zip: &mut zip::ZipWriter<fs::File>, name: &str, file: &mut fs::File) -> AppResult<()> {
    let large = file.metadata()?.len() >= ZIP64_FROM;
    zip.start_file(name, zip::write::SimpleFileOptions::default().large_file(large))?;
    io::copy(file, zip)?;
    Ok(())
}

/// Einträge eines Ordners; fehlt er, keine.
pub(crate) fn entries(dir: &Path) -> AppResult<Vec<fs::DirEntry>> {
    match fs::read_dir(dir) {
        Ok(entries) => Ok(entries.collect::<io::Result<_>>()?),
        Err(e) if e.kind() == io::ErrorKind::NotFound => Ok(Vec::new()),
        Err(e) => Err(e.into()),
    }
}

/// Hat `name` die Endung `ext` (ohne Punkt), unabhängig von der Schreibweise?
pub(crate) fn has_extension(name: &str, ext: &str) -> bool {
    Path::new(name).extension().is_some_and(|e| e.eq_ignore_ascii_case(ext))
}

/// Präfix einer `data:`-URL mit base64-codiertem PNG.
pub(crate) const PNG_DATA_URL: &str = "data:image/png;base64,";

pub(crate) fn png_data_url(png: &[u8]) -> String {
    use base64::Engine;
    format!("{PNG_DATA_URL}{}", base64::engine::general_purpose::STANDARD.encode(png))
}

/// Legt eine Datei oder einen Ordner in den Papierkorb. Unter macOS über `NSFileManager`: der Standardweg über den
/// Finder bräuchte die Automation-Freigabe (Apple Events) und bliebe ohne sie wirkungslos.
pub(crate) fn move_to_trash(path: &Path) -> AppResult<()> {
    #[cfg(target_os = "macos")]
    {
        use trash::macos::{DeleteMethod, TrashContextExtMacos};
        let mut trash = trash::TrashContext::default();
        trash.set_delete_method(DeleteMethod::NsFileManager);
        trash.delete(path)?;
    }
    #[cfg(not(target_os = "macos"))]
    trash::delete(path)?;
    Ok(())
}

/// Erster freier Name aus `stem<ext>`, `stem (2)<ext>`, `stem (3)<ext>` …, den `taken` nicht als belegt meldet.
pub(crate) fn free_name(stem: &str, ext: &str, taken: impl Fn(&str) -> bool) -> String {
    let mut name = format!("{stem}{ext}");
    let mut n = 1;
    while taken(&name) {
        n += 1;
        name = format!("{stem} ({n}){ext}");
    }
    name
}

/// Kopiert (Ziel, Quelle)-Paare. `step(done, total)` folgt jeder Datei; ein Fehler daraus (etwa ein Abbruch)
/// beendet das Kopieren.
pub(crate) fn copy_files(files: &[(PathBuf, PathBuf)], step: &dyn Fn(u64, u64) -> AppResult<()>) -> AppResult<()> {
    let total = files.len() as u64;
    for (done, (dest, source)) in (1..).zip(files) {
        if let Some(parent) = dest.parent() {
            fs::create_dir_all(parent)?;
        }
        fs::copy(source, dest)?;
        step(done, total)?;
    }
    Ok(())
}

/// Führt blockierende Dateiarbeit aus. Verwirft der Aufrufer das Future (Abbruch über `AppState::cancellable`),
/// läuft der Thread weiter, bis `work` das Token prüft ([`check_cancelled`]); aufräumen muss `work` selbst,
/// erst dann schreibt nichts mehr in das, was weg soll.
pub(crate) async fn blocking<T: Send + 'static>(
    work: impl FnOnce(&CancellationToken) -> AppResult<T> + Send + 'static,
) -> AppResult<T> {
    let stop = CancellationToken::new();
    let _stop_on_drop = stop.clone().drop_guard();
    tokio::task::spawn_blocking(move || work(&stop))
        .await
        .map_err(|e| invalid(format!("Der Vorgang ist unerwartet abgebrochen: {e}")))?
}

pub(crate) fn check_cancelled(stop: &CancellationToken) -> AppResult<()> {
    if stop.is_cancelled() {
        return Err(AppError::Cancelled);
    }
    Ok(())
}

/// Testdateien unter `dir` anlegen: (relativer Pfad, Inhalt).
#[cfg(test)]
pub(crate) fn write_files<B: AsRef<[u8]>>(dir: &Path, files: &[(&str, B)]) {
    for (path, data) in files {
        fs::create_dir_all(dir.join(path).parent().unwrap()).unwrap();
        fs::write(dir.join(path), data).unwrap();
    }
}

/// NBT-Compound aus Paaren.
#[cfg(test)]
pub(crate) fn compound(pairs: Vec<(&str, fastnbt::Value)>) -> fastnbt::Value {
    fastnbt::Value::Compound(pairs.into_iter().map(|(k, v)| (k.to_owned(), v)).collect())
}

/// `level.dat` wie vom Spiel: gzip-komprimiertes NBT.
#[cfg(test)]
pub(crate) fn gzip_nbt(value: &fastnbt::Value) -> Vec<u8> {
    use std::io::Write;
    let mut gz = flate2::write::GzEncoder::new(Vec::new(), flate2::Compression::default());
    gz.write_all(&fastnbt::to_bytes(value).unwrap()).unwrap();
    gz.finish().unwrap()
}
