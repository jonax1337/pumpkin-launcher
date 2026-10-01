//! Welten einer Instanz (`saves/<Ordner>`; der Ordnername ist die ID): Anzeige aus `level.dat`, Sicherungen als ZIP
//! unter `instances/<id>/backups/`, Wiederherstellen und Löschen. Löschen sichert vorher, aus der Sicherung lässt sich
//! die Welt wiederherstellen; die Sicherungen gehören zur Instanz und verschwinden mit ihr.
use std::{
    cmp::Reverse,
    fs,
    io::{self, Read},
    path::{Path, PathBuf},
};

use base64::Engine;
use serde::{de::DeserializeOwned, Deserialize, Serialize};

use super::{
    blocking, content, download::RemoveOnDrop, free_name, modrinth::invalid, providers::zip_paths, servers, walk, Dirs,
    ZIP64_FROM,
};
use crate::{
    error::{AppError, AppResult},
    models::{now_ms, QuickPlay},
    state::AppState,
};

/// `icon.png` ist im Spiel 64 × 64; größere Dateien zeigt die Liste nicht.
const ICON_LIMIT: u64 = 256 * 1024;
/// Sperrdatei des laufenden Spiels; gehört nicht in eine Sicherung.
const SESSION_LOCK: &str = "session.lock";
/// Endung einer gelöschten Welt, solange ihr Ordner unter `backups/` noch entfernt wird.
const DELETING: &str = "deleting";
/// Endung einer Sicherung, solange sie geschrieben wird.
const PART: &str = "zip.part";
/// Phase der `content-progress`-Events beim Sichern (Dateien).
const BACKUP_PHASE: &str = "backup";

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum GameMode {
    Survival,
    Creative,
    Adventure,
    Spectator,
}

impl GameMode {
    /// `GameType` aus `level.dat`.
    fn from_id(id: i32) -> Option<Self> {
        [Self::Survival, Self::Creative, Self::Adventure, Self::Spectator].get(usize::try_from(id).ok()?).copied()
    }
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct World {
    /// Ordnername unter `saves/`.
    pub id: String,
    pub name: String,
    /// Unix-Millisekunden, vom Spiel gespeichert.
    pub last_played: Option<u64>,
    pub game_mode: Option<GameMode>,
    pub hardcore: bool,
    /// Minecraft-Version, mit der die Welt zuletzt gespielt wurde.
    pub version: Option<String>,
    pub size_bytes: u64,
    /// `icon.png` als `data:`-URL.
    pub icon: Option<String>,
    /// Absoluter Ordnerpfad für „Ordner öffnen“.
    pub path: String,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorldBackup {
    /// Dateiname unter `backups/`: `<Welt>-<Unix-ms>.zip`.
    pub id: String,
    /// Ordnername der gesicherten Welt.
    pub world: String,
    pub created_at: u64,
    pub size_bytes: u64,
}

/// Was die Liste aus `level.dat` braucht; alles optional, alte und neue Formate haben nicht jedes Feld.
#[derive(Default, Deserialize)]
struct LevelDat {
    #[serde(rename = "Data", default)]
    data: LevelData,
}

#[derive(Default, Deserialize)]
#[serde(rename_all = "PascalCase")]
struct LevelData {
    level_name: Option<String>,
    last_played: Option<i64>,
    game_type: Option<i32>,
    #[serde(rename = "hardcore", default)]
    hardcore: bool,
    version: Option<LevelVersion>,
}

#[derive(Deserialize)]
#[serde(rename_all = "PascalCase")]
struct LevelVersion {
    name: String,
}

/// Welten der Instanz, zuletzt gespielte zuerst. Ordner ohne `level.dat` sind keine Welten.
pub fn list(dirs: &Dirs, instance_id: &str) -> AppResult<Vec<World>> {
    let mut worlds = Vec::new();
    for entry in entries(&dirs.saves(instance_id))? {
        let path = entry.path();
        if let Some(id) = entry.file_name().to_str().filter(|_| path.join("level.dat").is_file()) {
            worlds.push(read_world(&path, id));
        }
    }
    worlds.sort_by_key(|w| Reverse(w.last_played));
    Ok(worlds)
}

/// Ordner der Welt `id`: ein einzelner Ordnername direkt unter `saves/` mit einer `level.dat`.
pub fn world_dir(dirs: &Dirs, instance_id: &str, id: &str) -> AppResult<PathBuf> {
    let dir = dirs.saves(instance_id).join(file_name(id)?);
    if !dir.join("level.dat").is_file() {
        return Err(AppError::NotFound { kind: "Welt", id: id.into() });
    }
    Ok(dir)
}

/// Prüft ein Quick-Play-Ziel, bevor es zum Startargument wird.
pub fn require_target(dirs: &Dirs, instance_id: &str, target: &QuickPlay) -> AppResult<()> {
    match target {
        QuickPlay::World { id } => world_dir(dirs, instance_id, id).map(drop),
        QuickPlay::Server { address } => servers::require_address(address).map(drop),
    }
}

/// Sichert die Welt als ZIP mit dem Ordner als oberstem Eintrag (wie die Sicherung im Spiel), ohne `session.lock`.
pub fn backup(dirs: &Dirs, instance_id: &str, id: &str, progress: &dyn Fn(&str, u64, u64)) -> AppResult<WorldBackup> {
    let dir = world_dir(dirs, instance_id, id)?;
    let mut files = Vec::new();
    walk(&dirs.saves(instance_id), &dir, &mut files)?;
    let lock = format!("{id}/{SESSION_LOCK}");
    files.retain(|(name, _)| *name != lock);
    let backups = dirs.backups(instance_id);
    fs::create_dir_all(&backups)?;
    let backup_id = format!("{id}-{}.zip", now_ms());
    write_zip(&backups.join(&backup_id), &files, progress)?;
    tracing::info!(instance = %instance_id, world = %id, backup = %backup_id, "Welt gesichert");
    read_backup(&backups, &backup_id)
}

/// Sicherungen aller Welten der Instanz (auch gelöschter), neueste zuerst.
pub fn backups(dirs: &Dirs, instance_id: &str) -> AppResult<Vec<WorldBackup>> {
    let dir = dirs.backups(instance_id);
    let mut list: Vec<WorldBackup> = entries(&dir)?
        .iter()
        .filter_map(|entry| read_backup(&dir, entry.file_name().to_str()?).ok())
        .collect();
    list.sort_by_key(|b| Reverse(b.created_at));
    Ok(list)
}

/// Stellt eine Sicherung als neue Welt her: unter dem alten Ordnernamen oder, ist der belegt, als „<Name> (2)“ usw.
/// Eine bestehende Welt wird nie überschrieben.
pub fn restore(dirs: &Dirs, instance_id: &str, backup_id: &str) -> AppResult<World> {
    let backups = dirs.backups(instance_id);
    let backup = read_backup(&backups, backup_id)?;
    let mut zip = zip::ZipArchive::new(fs::File::open(backups.join(backup_id))?)?;
    // Nur Pfadregeln: die Grenzen gegen ZIP-Bomben aus Pack-Importen würden große Welten aussperren, die `backup` sichert.
    let files = zip_paths(&mut zip, &format!("{}/", backup.world), &[])?;
    if files.is_empty() {
        return Err(invalid("Die Sicherung enthält keine Welt"));
    }
    let saves = dirs.saves(instance_id);
    fs::create_dir_all(&saves)?;
    let id = free_name(&backup.world, "", |name| saves.join(name).exists());
    let target = saves.join(&id);
    // `create_dir` statt `create_dir_all`: taucht der Ordner gerade erst auf, wird er nicht befüllt.
    fs::create_dir(&target)?;
    let mut guard = RemoveOnDrop(Some(target.clone()));
    extract(&mut zip, files, &target)?;
    guard.0 = None;
    tracing::info!(instance = %instance_id, backup = %backup_id, world = %id, "Welt wiederhergestellt");
    Ok(read_world(&target, &id))
}

/// Löscht die Welt, nachdem sie gesichert wurde; die Sicherung kommt zurück. Der Ordner verlässt zuerst `saves/`:
/// hält unter Windows ein anderes Programm eine Datei offen, bleibt so keine halbe Welt in der Liste.
pub fn delete(dirs: &Dirs, instance_id: &str, id: &str, progress: &dyn Fn(&str, u64, u64)) -> AppResult<WorldBackup> {
    let backup = backup(dirs, instance_id, id, progress)?;
    let doomed = dirs.backups(instance_id).join(&backup.id).with_extension(DELETING);
    fs::rename(world_dir(dirs, instance_id, id)?, &doomed)?;
    if let Err(err) = fs::remove_dir_all(&doomed) {
        tracing::warn!(path = %doomed.display(), %err, "Gelöschte Welt nicht vollständig entfernt");
    }
    tracing::info!(instance = %instance_id, world = %id, "Welt gelöscht");
    Ok(backup)
}

pub fn delete_backup(dirs: &Dirs, instance_id: &str, backup_id: &str) -> AppResult<()> {
    let dir = dirs.backups(instance_id);
    read_backup(&dir, backup_id)?;
    fs::remove_file(dir.join(backup_id))?;
    Ok(())
}

/// Räumt beim Start unter `backups/` aller Instanzen auf, was ein unterbrochener Vorgang liegen ließ: halbe Sicherungen
/// und gelöschte Welten, deren Ordner nicht ganz wegging. Läuft schon ein anderer Vorgang, bleibt alles bis zum nächsten Start.
pub async fn remove_leftovers(state: &AppState) -> AppResult<usize> {
    let Ok(_guard) = state.operation(None) else { return Ok(0) };
    let dirs: Vec<PathBuf> = state.instances.list().iter().map(|i| state.dirs.backups(&i.id)).collect();
    blocking(move |_| Ok(dirs.iter().map(|dir| remove_leftovers_in(dir)).sum())).await
}

/// Was sich nicht entfernen lässt (unter Windows etwa eine noch geöffnete Datei) oder nicht lesbar ist, bleibt bis zum
/// nächsten Start und hält die übrigen Instanzen nicht auf.
fn remove_leftovers_in(dir: &Path) -> usize {
    let entries = entries(dir).unwrap_or_else(|err| {
        tracing::warn!(path = %dir.display(), %err, "Sicherungsordner nicht lesbar");
        Vec::new()
    });
    let leftovers = entries.iter().filter(|entry| entry.file_name().to_str().is_some_and(is_leftover));
    leftovers
        .filter(|entry| match remove_entry(entry) {
            Ok(()) => true,
            Err(err) => {
                tracing::warn!(path = %entry.path().display(), %err, "Rest eines unterbrochenen Vorgangs nicht entfernt");
                false
            }
        })
        .count()
}

fn remove_entry(entry: &fs::DirEntry) -> io::Result<()> {
    let path = entry.path();
    if entry.file_type()?.is_dir() { fs::remove_dir_all(path) } else { fs::remove_file(path) }
}

/// Namen, die nur `backup` (`<Welt>-<Unix-ms>.zip.part`) und `delete` (`<Welt>-<Unix-ms>.deleting`) vergeben.
fn is_leftover(name: &str) -> bool {
    [PART, DELETING].iter().any(|ext| name.strip_suffix(ext).and_then(|n| n.strip_suffix('.')).and_then(backup_stem).is_some())
}

/// Eine Welt aus ihrem Ordner. Ist `level.dat` unlesbar, heißt sie wie der Ordner und lässt sich trotzdem
/// sichern und löschen.
fn read_world(dir: &Path, id: &str) -> World {
    let level = read_level(&dir.join("level.dat")).map(|level: LevelDat| level.data).unwrap_or_else(|err| {
        tracing::warn!(world = %id, %err, "level.dat nicht lesbar");
        LevelData::default()
    });
    World {
        id: id.to_owned(),
        name: level.level_name.filter(|n| !n.trim().is_empty()).unwrap_or_else(|| id.to_owned()),
        last_played: level.last_played.and_then(|ms| u64::try_from(ms).ok()),
        game_mode: level.game_type.and_then(GameMode::from_id),
        hardcore: level.hardcore,
        version: level.version.map(|v| v.name),
        size_bytes: dir_size(dir),
        icon: icon(&dir.join("icon.png")),
        path: dir.to_string_lossy().into_owned(),
    }
}

/// `level.dat` ist gzip-komprimiertes NBT; `T` nimmt daraus, was es braucht.
pub(super) fn read_level<T: DeserializeOwned>(path: &Path) -> AppResult<T> {
    let mut nbt = Vec::new();
    flate2::read::GzDecoder::new(fs::File::open(path)?).read_to_end(&mut nbt)?;
    Ok(fastnbt::from_bytes(&nbt)?)
}

fn icon(path: &Path) -> Option<String> {
    if fs::metadata(path).ok()?.len() > ICON_LIMIT {
        return None;
    }
    let png = fs::read(path).ok()?;
    Some(format!("data:image/png;base64,{}", base64::engine::general_purpose::STANDARD.encode(png)))
}

/// Belegter Platz eines Ordners, nur zur Anzeige: Unlesbares zählt nicht, Verknüpfungen werden nicht verfolgt.
fn dir_size(dir: &Path) -> u64 {
    let Ok(entries) = fs::read_dir(dir) else { return 0 };
    entries
        .flatten()
        .map(|entry| match entry.file_type() {
            Ok(kind) if kind.is_dir() => dir_size(&entry.path()),
            Ok(kind) if kind.is_file() => entry.metadata().map_or(0, |m| m.len()),
            _ => 0,
        })
        .sum()
}

/// Einträge eines Ordners; fehlt er, keine.
pub(super) fn entries(dir: &Path) -> AppResult<Vec<fs::DirEntry>> {
    match fs::read_dir(dir) {
        Ok(entries) => Ok(entries.collect::<io::Result<_>>()?),
        Err(e) if e.kind() == io::ErrorKind::NotFound => Ok(Vec::new()),
        Err(e) => Err(e.into()),
    }
}

/// Ein einzelner, unter Windows gültiger Datei- oder Ordnername (kein Pfad).
fn file_name(name: &str) -> AppResult<&str> {
    if name.contains('/') {
        return Err(invalid(format!("Ungültiger Name: {name}")));
    }
    content::safe_path(name)?;
    Ok(name)
}

/// Sicherung `id` in `dir`; ihr Name verrät Welt und Zeitpunkt.
fn read_backup(dir: &Path, id: &str) -> AppResult<WorldBackup> {
    let not_found = || AppError::NotFound { kind: "Sicherung", id: id.into() };
    let (world, created_at) = backup_name(file_name(id)?).ok_or_else(not_found)?;
    let size_bytes = fs::metadata(dir.join(id)).map_err(|_| not_found())?.len();
    Ok(WorldBackup { id: id.into(), world: world.into(), created_at, size_bytes })
}

/// `<Welt>-<Unix-ms>.zip` → (Welt, Zeitpunkt).
fn backup_name(name: &str) -> Option<(&str, u64)> {
    backup_stem(name.strip_suffix(".zip")?)
}

/// `<Welt>-<Unix-ms>` → (Welt, Zeitpunkt). Der Weltname darf selbst Bindestriche enthalten.
fn backup_stem(stem: &str) -> Option<(&str, u64)> {
    let (world, at) = stem.rsplit_once('-')?;
    (!world.is_empty()).then_some((world, at.parse().ok()?))
}

/// Entpackt die geprüften Einträge `files` (aus `zip_paths`) nach `target`.
fn extract(zip: &mut zip::ZipArchive<fs::File>, files: Vec<(PathBuf, usize)>, target: &Path) -> AppResult<()> {
    for (path, index) in files {
        let dest = target.join(path);
        if let Some(parent) = dest.parent() {
            fs::create_dir_all(parent)?;
        }
        io::copy(&mut zip.by_index(index)?, &mut fs::File::create(&dest)?)?;
    }
    Ok(())
}

/// Schreibt das Archiv über `<path>.part`; bei einem Fehler bleibt nichts Halbes liegen.
fn write_zip(path: &Path, files: &[(String, PathBuf)], progress: &dyn Fn(&str, u64, u64)) -> AppResult<()> {
    let tmp = path.with_extension(PART);
    let mut guard = RemoveOnDrop(Some(tmp.clone()));
    let mut zip = zip::ZipWriter::new(fs::File::create(&tmp)?);
    let total = files.len() as u64;
    progress(BACKUP_PHASE, 0, total);
    for (done, (name, source)) in (1..).zip(files) {
        let mut file = fs::File::open(source)?;
        let large = file.metadata()?.len() >= ZIP64_FROM;
        zip.start_file(name.as_str(), zip::write::SimpleFileOptions::default().large_file(large))?;
        io::copy(&mut file, &mut zip)?;
        progress(BACKUP_PHASE, done, total);
    }
    // Erst schließen, dann umbenennen: Windows verschiebt keine offene Datei.
    drop(zip.finish()?);
    fs::rename(&tmp, path)?;
    guard.0 = None;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::{new_id, Instance, ModLoader, NewInstance};
    use fastnbt::Value;
    use std::{collections::HashMap, io::Write};

    fn compound(pairs: Vec<(&str, Value)>) -> Value {
        Value::Compound(pairs.into_iter().map(|(k, v)| (k.to_owned(), v)).collect::<HashMap<_, _>>())
    }

    /// `level.dat` wie vom Spiel: gzip-NBT mit `Data`, dazu Tags, die die Liste nicht braucht.
    fn level_dat(name: &str, last_played: i64, game_type: i32, hardcore: bool) -> Vec<u8> {
        let data = compound(vec![
            ("LevelName", Value::String(name.into())),
            ("LastPlayed", Value::Long(last_played)),
            ("GameType", Value::Int(game_type)),
            ("hardcore", Value::Byte(hardcore.into())),
            ("Version", compound(vec![("Name", Value::String("1.21.4".into())), ("Id", Value::Int(4189))])),
            ("SpawnX", Value::Int(12)),
        ]);
        let mut gz = flate2::write::GzEncoder::new(Vec::new(), flate2::Compression::default());
        gz.write_all(&fastnbt::to_bytes(&compound(vec![("Data", data)])).unwrap()).unwrap();
        gz.finish().unwrap()
    }

    fn write_files(dir: &Path, files: &[(&str, &[u8])]) {
        for (path, data) in files {
            fs::create_dir_all(dir.join(path).parent().unwrap()).unwrap();
            fs::write(dir.join(path), data).unwrap();
        }
    }

    fn setup() -> (PathBuf, Dirs) {
        let root = std::env::temp_dir().join(new_id());
        let dirs = Dirs::new(&root);
        write_files(
            &dirs.saves("i"),
            &[
                ("Neue Welt/level.dat", &level_dat("Abenteuer", 1_700_000_000_000, 1, true)),
                ("Neue Welt/region/r.0.0.mca", b"region"),
                ("Neue Welt/session.lock", b"lock"),
                ("Neue Welt/icon.png", b"png"),
                ("Alt/level.dat", &level_dat("Alte Welt", 1_600_000_000_000, 0, false)),
                ("Kaputt/level.dat", b"kein gzip"),
                ("Kein Spielstand/notiz.txt", b"x"),
            ],
        );
        (root, dirs)
    }

    #[test]
    fn lists_worlds_from_level_dat() {
        let (root, dirs) = setup();
        let worlds = list(&dirs, "i").unwrap();
        let ids: Vec<_> = worlds.iter().map(|w| w.id.as_str()).collect();
        assert_eq!(ids, ["Neue Welt", "Alt", "Kaputt"]);
        let new = &worlds[0];
        assert_eq!(
            (new.name.as_str(), new.last_played, new.game_mode, new.hardcore, new.version.as_deref()),
            ("Abenteuer", Some(1_700_000_000_000), Some(GameMode::Creative), true, Some("1.21.4"))
        );
        assert_eq!(new.icon.as_deref(), Some("data:image/png;base64,cG5n"));
        assert!(new.size_bytes > 0);
        assert_eq!((worlds[1].game_mode, worlds[1].icon.as_ref()), (Some(GameMode::Survival), None));
        assert_eq!((worlds[2].name.as_str(), worlds[2].last_played, worlds[2].game_mode), ("Kaputt", None, None));
        assert!(list(&dirs, "leer").unwrap().is_empty());
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn backup_restore_and_delete() {
        let (root, dirs) = setup();
        let backup = backup(&dirs, "i", "Neue Welt", &|_, _, _| {}).unwrap();
        assert_eq!(backup.world, "Neue Welt");
        assert_eq!(backups(&dirs, "i").unwrap(), std::slice::from_ref(&backup));

        // Die Welt gibt es noch: die Sicherung kommt daneben, ohne Sperrdatei.
        let copy = restore(&dirs, "i", &backup.id).unwrap();
        assert_eq!((copy.id.as_str(), copy.name.as_str()), ("Neue Welt (2)", "Abenteuer"));
        let restored = dirs.saves("i").join("Neue Welt (2)");
        assert_eq!(fs::read(restored.join("region/r.0.0.mca")).unwrap(), b"region");
        assert!(!restored.join(SESSION_LOCK).exists());

        let safety = delete(&dirs, "i", "Neue Welt", &|_, _, _| {}).unwrap();
        assert!(!dirs.saves("i").join("Neue Welt").exists());
        assert!(!dirs.backups("i").join(&safety.id).with_extension(DELETING).exists());
        assert_eq!(restore(&dirs, "i", &safety.id).unwrap().id, "Neue Welt");

        delete_backup(&dirs, "i", &backup.id).unwrap();
        assert_eq!(backups(&dirs, "i").unwrap().len(), 1);
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn restores_worlds_beyond_the_pack_import_limits() {
        let (root, dirs) = setup();
        // 2 MiB Nullen packen weit über 200:1, wie große, leere Kartendaten: für einen Pack-Import eine ZIP-Bombe.
        let zeros = vec![0u8; 2 * 1024 * 1024];
        write_files(&dirs.saves("i"), &[("Alt/data/karte.dat", &zeros)]);
        let safety = delete(&dirs, "i", "Alt", &|_, _, _| {}).unwrap();
        restore(&dirs, "i", &safety.id).unwrap();
        assert_eq!(fs::read(dirs.saves("i").join("Alt/data/karte.dat")).unwrap(), zeros);
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn only_names_of_interrupted_backups_and_deletes_are_leftovers() {
        assert!(is_leftover("Meine-Welt-1700000000000.zip.part"));
        assert!(is_leftover("Meine Welt-1700000000000.deleting"));
        for name in ["Welt-1700000000000.zip", "Welt.zip.part", "Welt-gestern.deleting", "-1.deleting", "notiz.part", "Welt-1.deleting.txt"] {
            assert!(!is_leftover(name), "{name}");
        }
    }

    #[tokio::test]
    async fn startup_removes_leftovers_but_keeps_backups() {
        let root = std::env::temp_dir().join(new_id());
        let state = AppState::load(&root).unwrap();
        let new = NewInstance { name: "Welten".into(), minecraft_version: "1.21.4".into(), loader: ModLoader::Vanilla, loader_version: None };
        let id = state.instances.insert(Instance::from_new(new)).unwrap().id;
        let backups = state.dirs.backups(&id);
        write_files(&backups, &[("Alt-1.zip", b"zip"), ("Alt-2.zip.part", b"halb"), ("Neu-3.deleting/level.dat", b"weg"), ("notiz.txt", b"x")]);

        assert_eq!(remove_leftovers(&state).await.unwrap(), 2);

        let mut left: Vec<_> = entries(&backups).unwrap().iter().map(|e| e.file_name().into_string().unwrap()).collect();
        left.sort();
        assert_eq!(left, ["Alt-1.zip", "notiz.txt"]);
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn names_and_targets_stay_inside_the_instance() {
        let (root, dirs) = setup();
        assert_eq!(backup_name("Meine-Welt-1700000000000.zip"), Some(("Meine-Welt", 1_700_000_000_000)));
        assert_eq!(backup_name("-1.zip"), None);
        assert_eq!(backup_name("Welt-gestern.zip"), None);
        for id in ["../Alt", "Alt/..", "..\\Alt", "Kein Spielstand", "fehlt"] {
            assert!(world_dir(&dirs, "i", id).is_err(), "{id}");
        }
        assert!(restore(&dirs, "i", "../instances.json-1.zip").is_err());
        assert!(require_target(&dirs, "i", &QuickPlay::World { id: "Alt".into() }).is_ok());
        assert!(require_target(&dirs, "i", &QuickPlay::Server { address: "--demo".into() }).is_err());
        fs::remove_dir_all(root).unwrap();
    }
}
