//! Welten von und nach außen: eine Welt aus einem Zip in die Instanz holen, die Sicherungen der Instanz in einen
//! Ordner kopieren (etwa vor dem Löschen der Instanz, mit der sie verschwinden).
use std::{
    fs,
    path::{Path, PathBuf},
};

use super::backup::extract_new_world;
use super::{backups, read_world, World};
use crate::coded;
use crate::error::{AppError, AppResult};
use crate::services::download::RemoveOnDrop;
use crate::services::progress::ProgressFn;
use crate::services::{copy_files, free_name, has_extension, providers::zip_files, require_plain_name, strip_extension, Dirs};

/// Ordnername einer importierten Welt, deren Zip keinen brauchbaren Namen hat.
const IMPORTED_WORLD: &str = "Importierte Welt";
/// Ordnername der kopierten Sicherungen, wenn der Instanzname keinen brauchbaren Namen ergibt.
const BACKUPS_FOLDER: &str = "Weltsicherungen";
/// So viele Zeichen des Instanznamens kommen in den Ordnernamen der kopierten Sicherungen.
const BACKUPS_FOLDER_NAME_CHARS: usize = 80;

/// Holt die Welt aus dem Zip `zip_path` (Pfad aus dem Dateidialog) als neue Welt in die Instanz: entweder liegt
/// `level.dat` ganz oben oder in genau einem Ordner. Der Ordner heißt wie der im Zip bzw. wie die Zip-Datei; ist er
/// belegt, kommt „<Name> (2)“. Eine bestehende Welt wird nie überschrieben. Die Einträge prüft `zip_files` wie bei
/// jedem fremden Archiv: sichere Pfade, keine Sonderdateien, Größen- und Kompressionsgrenzen.
pub fn import(dirs: &Dirs, instance_id: &str, zip_path: &Path, progress: ProgressFn<'_>) -> AppResult<World> {
    let zip_name = zip_name(zip_path)?;
    let mut zip = zip::ZipArchive::new(fs::File::open(zip_path)?)
        .map_err(|_| AppError::invalid(coded!("errors.packs.unreadableZip", name = zip_name)))?;
    let files = zip_files(&mut zip, "", &[]).map_err(|err| AppError::invalid(coded!("errors.packs.zipProblem", name = zip_name, reason = err)))?;
    let (root, folder) = locate_world(&files, &zip_name)?;
    let world_files: Vec<_> = files.into_iter().filter_map(|(path, index)| Some((path.strip_prefix(&root).ok()?.to_owned(), index))).collect();

    let saves = dirs.saves(instance_id);
    fs::create_dir_all(&saves)?;
    let id = free_name(&folder, "", |name| saves.join(name).exists());
    let target = saves.join(&id);
    extract_new_world(&mut zip, world_files, &target, progress)?;
    tracing::info!(instance = %instance_id, world = %id, "Welt importiert");
    Ok(read_world(&target, &id))
}

fn zip_name(path: &Path) -> AppResult<String> {
    let name = path
        .file_name()
        .and_then(|name| name.to_str())
        .filter(|_| path.is_absolute())
        .ok_or_else(|| AppError::invalid(coded!("errors.packs.fullPathRequired")))?;
    if !has_extension(name, "zip") {
        return Err(AppError::invalid(coded!("errors.packs.notZip", name = name)));
    }
    let meta = fs::symlink_metadata(path).map_err(|_| AppError::invalid(coded!("errors.packs.unreadableFile", name = name)))?;
    if !meta.is_file() {
        return Err(AppError::invalid(coded!("errors.packs.notNormalFile", name = name)));
    }
    Ok(name.to_owned())
}

/// Wo im Zip die Welt liegt: der Ordner ganz oben (leer, wenn `level.dat` direkt oben liegt) und der Name, den die
/// Welt bekommt. Mehr als eine `level.dat` ganz oben oder in einem Ordner darunter sind mehrere Welten.
fn locate_world(files: &[(PathBuf, usize)], zip_name: &str) -> AppResult<(PathBuf, String)> {
    let mut candidates = files
        .iter()
        .map(|(path, _)| path.as_path())
        .filter(|path| path.file_name().is_some_and(|name| name == "level.dat") && path.components().count() <= 2);
    let level = candidates.next().ok_or_else(|| AppError::invalid(coded!("errors.packs.world.noLevel", name = zip_name)))?;
    if candidates.next().is_some() {
        return Err(AppError::invalid(coded!("errors.packs.world.severalWorlds", name = zip_name)));
    }
    let root = level.parent().unwrap_or(Path::new("")).to_owned();
    let name = root.to_str().filter(|name| !name.is_empty()).unwrap_or_else(|| strip_extension(zip_name, "zip").unwrap_or(zip_name));
    let folder = require_plain_name(name).map_or_else(|_| IMPORTED_WORLD.to_owned(), str::to_owned);
    Ok((root, folder))
}

/// Kopiert alle Sicherungen der Instanz in einen neuen Ordner in `target` (ein bestehender Ordner, absolut) und
/// liefert dessen Pfad. Der Ordner heißt nach der Instanz und wird, ist der Name belegt, durchnummeriert.
pub fn export_backups(dirs: &Dirs, instance_id: &str, instance_name: &str, target: &Path) -> AppResult<PathBuf> {
    if !target.is_absolute() || !target.is_dir() {
        return Err(AppError::invalid(coded!("errors.packs.world.invalidTargetFolder")));
    }
    let saved = backups(dirs, instance_id)?;
    if saved.is_empty() {
        return Err(AppError::invalid(coded!("errors.packs.world.noBackups")));
    }
    let folder = target.join(free_name(&backups_folder_name(instance_name), "", |name| target.join(name).exists()));
    fs::create_dir(&folder)?;
    let guard = RemoveOnDrop::new(folder.clone());
    let source = dirs.backups(instance_id);
    let files: Vec<_> = saved.iter().map(|backup| (folder.join(&backup.id), source.join(&backup.id))).collect();
    copy_files(&files, &|_, _| Ok(()))?;
    guard.disarm();
    tracing::info!(instance = %instance_id, count = files.len(), "Sicherungen exportiert");
    Ok(folder)
}

/// „<Instanzname> - Weltsicherungen“ ohne Zeichen, die ein Ordnername unter Windows nicht trägt.
fn backups_folder_name(instance_name: &str) -> String {
    let clean: String = instance_name
        .chars()
        .take(BACKUPS_FOLDER_NAME_CHARS)
        .map(|c| if c.is_control() || "<>:\"/\\|?*".contains(c) { '_' } else { c })
        .collect();
    let name = format!("{} - {BACKUPS_FOLDER}", clean.trim());
    require_plain_name(&name).map_or_else(|_| BACKUPS_FOLDER.to_owned(), str::to_owned)
}

#[cfg(test)]
mod tests {
    use super::super::backup::backup;
    use super::super::fixtures::{level_dat, setup};
    use super::super::is_world;
    use super::*;
    use crate::models::new_id;
    use std::io::Write;

    /// Zip-Datei `name` mit den Einträgen `files` in einem neuen Ordner.
    fn zip_file(files: &[(&str, &[u8])]) -> (PathBuf, PathBuf) {
        let dir = std::env::temp_dir().join(new_id());
        fs::create_dir_all(&dir).unwrap();
        let path = dir.join("Meine Welt.zip");
        let mut zip = zip::ZipWriter::new(fs::File::create(&path).unwrap());
        for (name, data) in files {
            zip.start_file(*name, zip::write::SimpleFileOptions::default()).unwrap();
            zip.write_all(data).unwrap();
        }
        zip.finish().unwrap();
        (dir, path)
    }

    fn import_zip(dirs: &Dirs, files: &[(&str, &[u8])]) -> AppResult<World> {
        let (dir, path) = zip_file(files);
        let result = import(dirs, "i", &path, &|_, _, _| {});
        fs::remove_dir_all(dir).unwrap();
        result
    }

    #[test]
    fn imports_a_world_folder_and_numbers_it_when_the_name_is_taken() {
        let (root, dirs) = setup();
        let level = level_dat("Burg", 5, 0, false);
        let files: [(&str, &[u8]); 3] = [("Burg/level.dat", &level), ("Burg/region/r.0.0.mca", b"region"), ("liesmich.txt", b"x")];

        let first = import_zip(&dirs, &files).unwrap();
        let second = import_zip(&dirs, &files).unwrap();

        assert_eq!((first.id.as_str(), first.name.as_str()), ("Burg", "Burg"));
        assert_eq!(second.id, "Burg (2)");
        assert_eq!(fs::read(dirs.saves("i").join("Burg (2)/region/r.0.0.mca")).unwrap(), b"region");
        assert!(!dirs.saves("i").join("liesmich.txt").exists());
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn a_world_at_the_top_of_the_zip_is_named_after_the_file() {
        let (root, dirs) = setup();
        let level = level_dat("Oben", 5, 0, false);
        let world = import_zip(&dirs, &[("level.dat", &level), ("data/map.dat", b"karte")]).unwrap();
        assert_eq!(world.id, "Meine Welt");
        assert!(is_world(&dirs.saves("i").join("Meine Welt")));
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn refuses_zips_without_exactly_one_world_and_leaves_nothing_behind() {
        let (root, dirs) = setup();
        let level = level_dat("Welt", 5, 0, false);
        let before = dirs.saves("i").read_dir().unwrap().count();
        let refused = [
            vec![("notiz.txt", &b"x"[..])],
            vec![("A/level.dat", &level[..]), ("B/level.dat", &level[..])],
            vec![("level.dat", &level[..]), ("B/level.dat", &level[..])],
            vec![("tief/ver/steckt/level.dat", &level[..])],
            vec![("Welt/level.dat", &level[..]), ("Welt/../../evil.txt", b"x")],
            vec![("Welt/level.dat", &level[..]), ("Welt/CON", b"x")],
        ];
        for files in refused {
            assert!(import_zip(&dirs, &files).is_err(), "{files:?}");
        }
        assert_eq!(dirs.saves("i").read_dir().unwrap().count(), before);
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn names_the_zip_when_it_holds_no_or_several_worlds() {
        let (root, dirs) = setup();
        let level = level_dat("Welt", 5, 0, false);
        let none = import_zip(&dirs, &[("notiz.txt", b"x")]).unwrap_err().to_string();
        let several = import_zip(&dirs, &[("A/level.dat", &level), ("B/level.dat", &level)]).unwrap_err().to_string();
        assert!(none.ends_with(" enthält keine Welt: ganz oben oder in einem Ordner fehlt die Datei level.dat"), "{none}");
        assert!(several.ends_with(" enthält mehrere Welten; importiere sie einzeln"), "{several}");
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn only_plain_zip_files_are_imported() {
        let (root, dirs) = setup();
        let dir = std::env::temp_dir().join(new_id());
        fs::create_dir_all(dir.join("Ordner.zip")).unwrap();
        fs::write(dir.join("welt.txt"), b"x").unwrap();
        fs::write(dir.join("kaputt.zip"), b"kein zip").unwrap();
        for bad in ["Ordner.zip", "welt.txt", "kaputt.zip", "fehlt.zip"] {
            assert!(import(&dirs, "i", &dir.join(bad), &|_, _, _| {}).is_err(), "{bad}");
        }
        assert!(import(&dirs, "i", Path::new("relativ.zip"), &|_, _, _| {}).is_err());
        fs::remove_dir_all(dir).unwrap();
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn a_world_name_that_windows_cannot_use_becomes_the_default() {
        let level = [(PathBuf::from("CON/level.dat"), 0)];
        assert_eq!(locate_world(&level, "x").unwrap().1, IMPORTED_WORLD);
        let top = [(PathBuf::from("level.dat"), 0)];
        assert_eq!(locate_world(&top, "Meine Welt").unwrap(), (PathBuf::new(), "Meine Welt".to_owned()));
    }

    #[test]
    fn exports_all_backups_into_a_new_folder_named_after_the_instance() {
        let (root, dirs) = setup();
        let saved = backup(&dirs, "i", "Neue Welt", &|_, _, _| {}).unwrap();
        let target = std::env::temp_dir().join(new_id());
        fs::create_dir_all(&target).unwrap();

        let first = export_backups(&dirs, "i", "Mein: Pack", &target).unwrap();
        let second = export_backups(&dirs, "i", "Mein: Pack", &target).unwrap();

        assert_eq!(first, target.join("Mein_ Pack - Weltsicherungen"));
        assert_eq!(second, target.join("Mein_ Pack - Weltsicherungen (2)"));
        assert_eq!(fs::read(first.join(&saved.id)).unwrap(), fs::read(dirs.backups("i").join(&saved.id)).unwrap());
        assert!(export_backups(&dirs, "leer", "x", &target).is_err());
        assert!(export_backups(&dirs, "i", "x", &target.join("fehlt")).is_err());
        fs::remove_dir_all(target).unwrap();
        fs::remove_dir_all(root).unwrap();
    }
}
