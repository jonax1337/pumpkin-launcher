//! Dateisystem-Hilfen der Services: Ordner durchlaufen, atomar schreiben, ZIPs schreiben, Papierkorb, freie Namen.
use std::{
    fs, io,
    path::{Path, PathBuf},
};

use super::download::RemoveOnDrop;
use crate::error::{AppError, AppResult};

/// Ab dieser Dateigröße schreiben ZIP-Archive ZIP64 (Pflicht ab 4 GiB); mit Abstand, weil Deflate Unkomprimierbares
/// leicht vergrößert.
pub(crate) const ZIP64_FROM: u64 = 2 * 1024 * 1024 * 1024;

/// Dateien unter `path` (Datei oder Ordner, rekursiv, ohne Symlinks/Junctions) als
/// (Pfad relativ zu `base` mit `/`, Pfad). Fehlt `path`, kommt nichts zurück.
pub(crate) fn walk(base: &Path, path: &Path) -> AppResult<Vec<(String, PathBuf)>> {
    let Some(meta) = none_if_missing(fs::symlink_metadata(path))? else { return Ok(Vec::new()) };
    let kind = meta.file_type();
    if kind.is_dir() {
        let mut files = Vec::new();
        for entry in fs::read_dir(path)? {
            files.extend(walk(base, &entry?.path())?);
        }
        Ok(files)
    } else if kind.is_file() {
        Ok(vec![(relative_slashed(base, path)?, path.to_owned())])
    } else {
        Ok(Vec::new())
    }
}

fn relative_slashed(base: &Path, path: &Path) -> AppResult<String> {
    let rel = path.strip_prefix(base).map_err(|_| AppError::invalid("Pfad außerhalb des Spielordners"))?;
    let rel = rel.to_str().ok_or_else(|| AppError::invalid("Dateiname ist kein gültiger Text"))?;
    Ok(rel.replace('\\', "/"))
}

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
    let guard = RemoveOnDrop::new(tmp.clone());
    let mut zip = zip::ZipWriter::new(fs::File::create(&tmp)?);
    fill(&mut zip)?;
    // Erst schließen, dann umbenennen: Windows verschiebt keine offene Datei. Vorher auf den Datenträger, damit ein
    // Absturz nach dem Umbenennen (und etwa dem Löschen der gesicherten Welt) keine leere Datei zurücklässt.
    zip.finish()?.sync_all()?;
    fs::rename(&tmp, path)?;
    guard.disarm();
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
    match none_if_missing(fs::read_dir(dir))? {
        Some(entries) => Ok(entries.collect::<io::Result<_>>()?),
        None => Ok(Vec::new()),
    }
}

/// Ein fehlendes Ziel ist oft kein Fehler: dann `None`; jeder andere Fehler bleibt einer.
pub(crate) fn none_if_missing<T>(result: io::Result<T>) -> io::Result<Option<T>> {
    match result {
        Ok(value) => Ok(Some(value)),
        Err(e) if e.kind() == io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(e),
    }
}

/// Löscht Datei oder Ordner (samt Inhalt) beim Aufräumen: ein Fehler daraus soll den eigentlichen Vorgang nicht
/// mehr kippen und wird nur geloggt. Was fehlt, ist schon aufgeräumt.
pub(crate) fn remove_logged(path: &Path) {
    let result = if path.is_dir() { fs::remove_dir_all(path) } else { fs::remove_file(path) };
    if let Err(err) = none_if_missing(result) {
        tracing::warn!(path = %path.display(), %err, "Aufräumen fehlgeschlagen");
    }
}

/// Hat `name` die Endung `ext` (ohne Punkt), unabhängig von der Schreibweise?
pub(crate) fn has_extension(name: &str, ext: &str) -> bool {
    Path::new(name).extension().is_some_and(|e| e.eq_ignore_ascii_case(ext))
}

/// `name` ohne die Endung `ext` (ohne Punkt, Schreibweise egal); `None`, wenn er sie nicht hat.
pub(crate) fn strip_extension<'a>(name: &'a str, ext: &str) -> Option<&'a str> {
    // Punkt und Endung sind im Namen gleich lang wie `ext`, auch wenn dessen Schreibweise abweicht.
    has_extension(name, ext).then(|| &name[..name.len() - ext.len() - 1])
}

/// Ein einzelner, unter Windows gültiger Datei- oder Ordnername (kein Pfad); sonst ein Fehler.
pub(crate) fn require_plain_name(name: &str) -> AppResult<&str> {
    if name.contains('/') {
        return Err(AppError::invalid(format!("Ungültiger Name: {name}")));
    }
    super::content::safe_path(name)?;
    Ok(name)
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

/// Legt den Eintrag `name` aus `dir` in den Papierkorb, sofern `is_listed` ihn gelten lässt (`kind` benennt ihn im
/// Fehler). Nur ein Name aus der Liste wird zum Pfad: so trifft das Löschen nie etwas außerhalb des Ordners.
pub(crate) fn trash_listed(
    dir: &Path,
    name: &str,
    kind: &'static str,
    is_listed: impl Fn(&fs::DirEntry) -> bool,
) -> AppResult<()> {
    let entry = entries(dir)?
        .into_iter()
        .find(|entry| entry.file_name() == name && is_listed(entry))
        .ok_or_else(|| AppError::NotFound { kind, id: name.to_owned() })?;
    move_to_trash(&entry.path())
}

/// Erster Name aus `numbered(1)`, `numbered(2)`, `numbered(3)` …, den `taken` nicht als belegt meldet.
pub(crate) fn first_free_name(numbered: impl Fn(u32) -> String, taken: impl Fn(&str) -> bool) -> String {
    let mut n = 1;
    loop {
        let name = numbered(n);
        if !taken(&name) {
            return name;
        }
        n += 1;
    }
}

/// Erster freier Name aus `stem<ext>`, `stem (2)<ext>`, `stem (3)<ext>` …, den `taken` nicht als belegt meldet.
pub(crate) fn free_name(stem: &str, ext: &str, taken: impl Fn(&str) -> bool) -> String {
    first_free_name(|n| if n == 1 { format!("{stem}{ext}") } else { format!("{stem} ({n}){ext}") }, taken)
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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::services::testutil::write_files;

    #[test]
    fn extensions_are_matched_and_stripped_regardless_of_case() {
        assert!(has_extension("Pack.ZIP", "zip"));
        assert!(!has_extension("Pack.zip.txt", "zip") && !has_extension(".zip", "zip"));
        assert_eq!(strip_extension("Pack.ZIP", "zip"), Some("Pack"));
        assert_eq!(strip_extension("Ä.zip", "zip"), Some("Ä"));
        assert_eq!(strip_extension("Pack", "zip"), None);
    }

    #[test]
    fn plain_names_are_single_windows_safe_components() {
        assert_eq!(require_plain_name("Neue Welt").unwrap(), "Neue Welt");
        for bad in ["", "a/b", "..", "a\\b", "C:", "NUL", "welt."] {
            assert!(require_plain_name(bad).is_err(), "{bad}");
        }
    }

    #[test]
    fn walk_lists_files_with_slashed_relative_paths() {
        let root = std::env::temp_dir().join(crate::models::new_id());
        write_files(&root, &[("a/b/c.txt", "1"), ("a/d.txt", "2"), ("e.txt", "3")]);

        let mut found: Vec<_> = walk(&root, &root.join("a")).unwrap().into_iter().map(|(rel, _)| rel).collect();
        found.sort();
        assert_eq!(found, ["a/b/c.txt", "a/d.txt"]);
        assert_eq!(walk(&root, &root.join("e.txt")).unwrap()[0].0, "e.txt");
        assert!(walk(&root, &root.join("fehlt")).unwrap().is_empty());
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn free_names_count_up_from_the_plain_name() {
        let taken = ["Welt (Kopie)", "Welt (Kopie 2)"];
        let numbered = |n| if n == 1 { "Welt (Kopie)".to_owned() } else { format!("Welt (Kopie {n})") };
        assert_eq!(first_free_name(numbered, |name| taken.contains(&name)), "Welt (Kopie 3)");
        assert_eq!(free_name("Sodium", ".jar", |_| false), "Sodium.jar");
        assert_eq!(free_name("Sodium", ".jar", |name| name != "Sodium (3).jar"), "Sodium (3).jar");
    }
}
