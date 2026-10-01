//! Datenpakete einer Welt: `saves/<Welt>/datapacks/`, je eins als `.zip` oder Ordner. Auflisten, eigene Zips und
//! Modrinth-Versionen hinzufügen, in den Papierkorb legen. Ob das Spiel ein Paket lädt, steht in `level.dat`
//! (`Data.DataPacks`); die Liste zeigt das nur an, `level.dat` schreibt allein das Spiel.
use std::{
    fs,
    io::{Cursor, Read, Seek},
    path::Path,
};

use serde::{Deserialize, Serialize};
use serde_json::Value;

use super::progress::{Phase, ProgressFn};
use super::{
    blocking, content, entries, has_extension, local_files, move_to_trash,
    modrinth::{self, Version},
    providers::zip_files,
    worlds, Dirs,
};
use crate::{
    error::{AppError, AppResult},
    state::AppState,
};

const DATAPACKS: &str = "datapacks";
const MCMETA: &str = "pack.mcmeta";
/// `pack.mcmeta` ist ein paar Zeilen JSON; mehr wird nicht gelesen.
const MCMETA_LIMIT: u64 = 64 * 1024;
/// Loader, unter dem Modrinth Datenpaket-Versionen führt.
const MODRINTH_LOADER: &str = "datapack";

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Datapack {
    /// Datei- oder Ordnername unter `datapacks/`.
    pub id: String,
    /// Name ohne `.zip`.
    pub name: String,
    /// Beschreibung aus `pack.mcmeta` als schlichter Text.
    pub description: Option<String>,
    /// Laut `level.dat` aktiv oder abgeschaltet; `None`, solange das Spiel das Paket noch nicht geladen hat.
    pub enabled: Option<bool>,
}

/// Aus `level.dat` nur die Listen der Datenpakete.
#[derive(Deserialize)]
struct LevelPacks {
    #[serde(rename = "Data")]
    data: LevelPacksData,
}

#[derive(Deserialize)]
struct LevelPacksData {
    #[serde(rename = "DataPacks", default)]
    data_packs: PackLists,
}

#[derive(Default, Deserialize)]
#[serde(rename_all = "PascalCase")]
struct PackLists {
    #[serde(default)]
    enabled: Vec<String>,
    #[serde(default)]
    disabled: Vec<String>,
}

impl PackLists {
    /// Zustand des Pakets `id` aus `datapacks/`; das Spiel führt es als `file/<id>`.
    fn state(&self, id: &str) -> Option<bool> {
        let name = format!("file/{id}");
        if self.enabled.contains(&name) {
            Some(true)
        } else if self.disabled.contains(&name) {
            Some(false)
        } else {
            None
        }
    }
}

#[derive(Deserialize)]
struct McMeta {
    pack: PackInfo,
}

#[derive(Deserialize)]
struct PackInfo {
    #[serde(default)]
    description: Value,
}

impl McMeta {
    /// Beschreibung ohne Formatierungscodes; leer = keine.
    fn description(&self) -> Option<String> {
        let text = strip_formatting(&plain_text(&self.pack.description));
        let text = text.trim();
        (!text.is_empty()).then(|| text.to_owned())
    }
}

/// Datenpakete der Welt, nach Namen sortiert.
pub fn list(dirs: &Dirs, instance_id: &str, world_id: &str) -> AppResult<Vec<Datapack>> {
    packs_in(&worlds::world_dir(dirs, instance_id, world_id)?)
}

/// Legt eigene Datenpaket-Zips (absolute Pfade) in die Welt: alle oder, wenn eins nicht passt, keins.
pub fn add_files(dirs: &Dirs, instance_id: &str, world_id: &str, paths: &[String]) -> AppResult<()> {
    let world = worlds::world_dir(dirs, instance_id, world_id)?;
    let files = paths.iter().map(|path| read_zip(path)).collect::<AppResult<Vec<_>>>()?;
    place(&dirs.root, &world, files)?;
    tracing::info!(instance = %instance_id, world = %world_id, count = paths.len(), "Datenpakete hinzugefügt");
    Ok(())
}

/// Lädt eine Datenpaket-Version von Modrinth (Größe und Hashes geprüft) in die Welt; sie muss zur Minecraft-Version
/// der Instanz passen.
pub async fn install(
    state: &AppState,
    instance_id: &str,
    world_id: &str,
    version_id: &str,
    progress: ProgressFn<'_>,
) -> AppResult<()> {
    let mc = state.instances.get(instance_id)?.minecraft_version;
    let world = worlds::world_dir(&state.dirs, instance_id, world_id)?;
    progress(Phase::Resolve, 0, 1);
    let client = modrinth::client()?;
    let version = modrinth::version(&client, version_id).await?;
    if !fits(&version, &mc) {
        return Err(AppError::invalid(format!("„{}“ ist kein Datenpaket für Minecraft {mc}", version.name)));
    }
    let file = modrinth::primary(&version, ".zip")?;
    progress(Phase::Download, 0, 1);
    let data = modrinth::download(&client, &file).await?;
    let root = state.dirs.root.clone();
    blocking(move |_| place(&root, &world, vec![(file.filename, data)])).await?;
    tracing::info!(instance = %instance_id, world = %world_id, version = %version_id, "Datenpaket installiert");
    progress(Phase::Complete, 1, 1);
    Ok(())
}

/// Legt das Paket `id` in den Papierkorb (lässt sich dort wiederherstellen). Nur ein Name aus der Liste wird zum Pfad.
pub fn remove(dirs: &Dirs, instance_id: &str, world_id: &str, id: &str) -> AppResult<()> {
    let world = worlds::world_dir(dirs, instance_id, world_id)?;
    let listed = entries(&world.join(DATAPACKS))?.iter().any(|entry| entry.file_name() == id && pack_kind(entry).is_some());
    if !listed {
        return Err(AppError::NotFound { kind: "Datenpaket", id: id.to_owned() });
    }
    move_to_trash(&world.join(DATAPACKS).join(id))?;
    tracing::info!(instance = %instance_id, world = %world_id, pack = %id, "Datenpaket in den Papierkorb gelegt");
    Ok(())
}

fn packs_in(world: &Path) -> AppResult<Vec<Datapack>> {
    let lists = pack_lists(world);
    let mut packs: Vec<Datapack> =
        entries(&world.join(DATAPACKS))?.iter().filter_map(|entry| read_pack(entry, &lists)).collect();
    packs.sort_by_key(|pack| pack.name.to_lowercase());
    Ok(packs)
}

/// Listen aus `level.dat`; ist sie unlesbar, gilt jedes Paket als noch nicht geladen.
fn pack_lists(world: &Path) -> PackLists {
    worlds::read_level(&world.join("level.dat")).map(|level: LevelPacks| level.data.data_packs).unwrap_or_else(|err| {
        tracing::warn!(world = %world.display(), %err, "level.dat nicht lesbar");
        PackLists::default()
    })
}

enum PackKind {
    Folder,
    Zip,
}

/// Ordner und `.zip`-Dateien sind Datenpakete, alles andere nicht.
fn pack_kind(entry: &fs::DirEntry) -> Option<PackKind> {
    // DirEntry folgt keinen Symlinks: ein Link ist hier weder Ordner noch Datei.
    let kind = entry.file_type().ok()?;
    if kind.is_dir() {
        Some(PackKind::Folder)
    } else if kind.is_file() && is_zip(entry.file_name().to_str()?) {
        Some(PackKind::Zip)
    } else {
        None
    }
}

/// Ist `pack.mcmeta` unlesbar, fehlt nur die Beschreibung.
fn read_pack(entry: &fs::DirEntry, lists: &PackLists) -> Option<Datapack> {
    let id = entry.file_name().into_string().ok()?;
    let mcmeta = match pack_kind(entry)? {
        PackKind::Folder => folder_mcmeta(&entry.path()),
        PackKind::Zip => file_mcmeta(&entry.path()),
    };
    let description = mcmeta.ok().and_then(|mcmeta| mcmeta.description());
    Some(Datapack { name: pack_name(&id).to_owned(), description, enabled: lists.state(&id), id })
}

fn folder_mcmeta(dir: &Path) -> AppResult<McMeta> {
    parse_mcmeta(fs::File::open(dir.join(MCMETA))?)
}

fn file_mcmeta(path: &Path) -> AppResult<McMeta> {
    zip_mcmeta(&mut zip::ZipArchive::new(fs::File::open(path)?)?)
}

fn zip_mcmeta(zip: &mut zip::ZipArchive<impl Read + Seek>) -> AppResult<McMeta> {
    parse_mcmeta(zip.by_name(MCMETA)?)
}

fn parse_mcmeta(reader: impl Read) -> AppResult<McMeta> {
    let mut json = Vec::new();
    reader.take(MCMETA_LIMIT).read_to_end(&mut json)?;
    // Editoren speichern JSON gern mit BOM; das Spiel liest das, serde_json nicht.
    Ok(serde_json::from_slice(json.strip_prefix(b"\xEF\xBB\xBF").unwrap_or(&json))?)
}

/// Text-Komponente des Spiels: Text, Liste oder Objekt mit `text` und `extra`.
fn plain_text(component: &Value) -> String {
    match component {
        Value::String(text) => text.clone(),
        Value::Array(parts) => parts.iter().map(plain_text).collect(),
        Value::Object(fields) => ["text", "extra"].iter().filter_map(|key| fields.get(*key)).map(plain_text).collect(),
        Value::Null => String::new(),
        other => other.to_string(),
    }
}

/// Ohne Formatierungscodes wie `§a` (Farbe) oder `§l` (fett).
fn strip_formatting(text: &str) -> String {
    let mut chars = text.chars();
    let mut plain = String::new();
    while let Some(c) = chars.next() {
        if c == '§' {
            chars.next();
        } else {
            plain.push(c);
        }
    }
    plain
}

fn is_zip(name: &str) -> bool {
    has_extension(name, "zip")
}

fn pack_name(id: &str) -> &str {
    if is_zip(id) { &id[..id.len() - ".zip".len()] } else { id }
}

/// Modrinth-Version mit Datenpaket für diese Minecraft-Version.
fn fits(version: &Version, mc: &str) -> bool {
    version.loaders.iter().any(|loader| loader == MODRINTH_LOADER) && version.game_versions.iter().any(|v| v == mc)
}

/// Inhalt einer eigenen `.zip`-Datei mit ihrem Namen.
fn read_zip(path: &str) -> AppResult<(String, Vec<u8>)> {
    let (path, name) = local_files::source(path)?;
    if !is_zip(&name) {
        return Err(AppError::invalid(format!("„{name}“ ist keine .zip-Datei")));
    }
    Ok((name, fs::read(path)?))
}

/// Prüft alle Zips und legt sie dann unter `datapacks/` ab, ohne Vorhandenes zu ersetzen. Schlägt das Ablegen fehl,
/// verschwinden die schon abgelegten wieder.
fn place(root: &Path, world: &Path, files: Vec<(String, Vec<u8>)>) -> AppResult<()> {
    let folder = world.join(DATAPACKS);
    for (name, data) in &files {
        check(name, data)?;
        if folder.join(name).exists() {
            return Err(AppError::invalid(format!("„{name}“ liegt schon in dieser Welt")));
        }
    }
    let mut created = Vec::new();
    for (name, data) in files {
        let target = folder.join(name);
        content::write_new(root, &target, &data).map_err(|err| content::rollback(&created, err))?;
        created.push(target);
    }
    Ok(())
}

/// Ein Datenpaket-Zip: Einträge nach den Regeln der Pack-Importe, ganz oben eine lesbare `pack.mcmeta` und `data/`.
fn check(name: &str, data: &[u8]) -> AppResult<()> {
    let not_a_pack =
        || AppError::invalid(format!("„{name}“ ist kein Datenpaket: ganz oben im Zip fehlen pack.mcmeta oder der Ordner data/"));
    let mut zip = zip::ZipArchive::new(Cursor::new(data))
        .map_err(|_| AppError::invalid(format!("„{name}“ ist kein lesbares Zip-Archiv")))?;
    let files = zip_files(&mut zip, "", &[]).map_err(|err| AppError::invalid(format!("„{name}“: {err}")))?;
    if !has_pack_layout(files.iter().map(|(path, _)| path.as_path())) {
        return Err(not_a_pack());
    }
    zip_mcmeta(&mut zip).map(drop).map_err(|_| not_a_pack())
}

/// Datenpakete haben `pack.mcmeta` und den Ordner `data/` im Wurzelverzeichnis; Ressourcenpakete kein `data/`.
fn has_pack_layout<'a>(paths: impl Iterator<Item = &'a Path>) -> bool {
    let (mut mcmeta, mut data) = (false, false);
    for path in paths {
        mcmeta |= path == Path::new(MCMETA);
        data |= path.starts_with("data");
    }
    mcmeta && data
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::new_id;
    use crate::services::{gzip_nbt, write_files};
    use std::io::Write;

    const MCMETA_JSON: &str = r#"{"pack": {"pack_format": 48, "description": "Mehr Biome"}}"#;

    fn zip_with(files: &[(&str, &str)]) -> Vec<u8> {
        let mut zip = zip::ZipWriter::new(Cursor::new(Vec::new()));
        for (name, data) in files {
            zip.start_file(*name, zip::write::SimpleFileOptions::default()).unwrap();
            zip.write_all(data.as_bytes()).unwrap();
        }
        zip.finish().unwrap().into_inner()
    }

    fn pack_zip() -> Vec<u8> {
        zip_with(&[(MCMETA, MCMETA_JSON), ("data/biome/x.json", "{}")])
    }

    /// `level.dat` wie vom Spiel, mit den Listen der Datenpakete.
    fn level_dat(enabled: &[&str], disabled: &[&str]) -> Vec<u8> {
        let level = fastnbt::nbt!({ "Data": { "LevelName": "Welt", "DataPacks": { "Enabled": enabled, "Disabled": disabled } } });
        gzip_nbt(&level)
    }

    /// Welt „Welt“ mit `files` unter ihrem Ordner.
    fn world(level: &[u8], files: &[(&str, &[u8])]) -> (std::path::PathBuf, Dirs) {
        let root = std::env::temp_dir().join(new_id());
        let dirs = Dirs::new(&root);
        let world = dirs.saves("i").join("Welt");
        write_files(&world, &[("level.dat", level)]);
        write_files(&world, files);
        (root, dirs)
    }

    fn description(json: &str) -> Option<String> {
        parse_mcmeta(json.as_bytes()).unwrap().description()
    }

    #[test]
    fn mcmeta_description_becomes_plain_text() {
        assert_eq!(description(MCMETA_JSON).as_deref(), Some("Mehr Biome"));
        let components = r#"{"pack": {"description": ["§aMehr ", {"text": "Biome", "extra": [" §lund ", 3, " Höhlen"]}]}}"#;
        assert_eq!(description(components).as_deref(), Some("Mehr Biome und 3 Höhlen"));
        assert_eq!(description(r#"{"pack": {"pack_format": 48}}"#), None);
        assert_eq!(description(r#"{"pack": {"description": " §r "}}"#), None);
        assert!(parse_mcmeta(&br#"{"pack_format": 48}"#[..]).is_err());
        assert_eq!(description("\u{FEFF}{\"pack\": {\"description\": \"Mit BOM\"}}").as_deref(), Some("Mit BOM"));
    }

    #[test]
    fn pack_layout_needs_mcmeta_and_data_at_the_root() {
        let layout = |names: &[&str]| has_pack_layout(names.iter().map(Path::new));
        assert!(layout(&["pack.mcmeta", "data/x/functions/a.mcfunction"]));
        assert!(!layout(&["pack.mcmeta", "assets/x.png"]));
        assert!(!layout(&["inner/pack.mcmeta", "data/x.json"]));
        assert!(!layout(&["pack.mcmeta", "database.json"]));
        assert!(check("ok.zip", &pack_zip()).is_ok());
        assert!(check("kaputt.zip", &zip_with(&[(MCMETA, "kein json"), ("data/x.json", "{}")])).is_err());
        assert!(check("kein zip.zip", b"kein zip").is_err());
    }

    #[test]
    fn lists_packs_with_their_state_from_level_dat() {
        let level = level_dat(&["vanilla", "file/Biome.zip"], &["file/Werkzeug"]);
        let mcmeta = MCMETA_JSON.as_bytes();
        let (root, dirs) = world(
            &level,
            &[
                ("datapacks/Biome.zip", &pack_zip()),
                ("datapacks/Werkzeug/pack.mcmeta", mcmeta),
                ("datapacks/neu.ZIP", b"kaputt"),
                ("datapacks/notiz.txt", b"x"),
            ],
        );
        let packs = list(&dirs, "i", "Welt").unwrap();
        let got: Vec<_> = packs.iter().map(|p| (p.id.as_str(), p.name.as_str(), p.description.as_deref(), p.enabled)).collect();
        assert_eq!(
            got,
            [
                ("Biome.zip", "Biome", Some("Mehr Biome"), Some(true)),
                ("neu.ZIP", "neu", None, None),
                ("Werkzeug", "Werkzeug", Some("Mehr Biome"), Some(false)),
            ]
        );
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn unreadable_level_dat_leaves_the_state_open() {
        let (root, dirs) = world(b"kein gzip", &[("datapacks/Biome.zip", &pack_zip())]);
        assert_eq!(list(&dirs, "i", "Welt").unwrap()[0].enabled, None);
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn adds_all_files_or_none() {
        let (root, dirs) = world(&level_dat(&[], &[]), &[]);
        let drop = root.join("drop");
        fs::create_dir_all(&drop).unwrap();
        fs::write(drop.join("Biome.zip"), pack_zip()).unwrap();
        fs::write(drop.join("Texturen.zip"), zip_with(&[(MCMETA, MCMETA_JSON), ("assets/x.png", "png")])).unwrap();
        let path = |name: &str| drop.join(name).to_string_lossy().into_owned();

        assert!(add_files(&dirs, "i", "Welt", &[path("Biome.zip"), path("Texturen.zip")]).is_err());
        assert!(list(&dirs, "i", "Welt").unwrap().is_empty());
        add_files(&dirs, "i", "Welt", &[path("Biome.zip")]).unwrap();
        assert_eq!(list(&dirs, "i", "Welt").unwrap()[0].id, "Biome.zip");
        // Ein vorhandenes Paket wird nicht ersetzt.
        assert!(add_files(&dirs, "i", "Welt", &[path("Biome.zip")]).is_err());
        assert!(matches!(remove(&dirs, "i", "Welt", "../level.dat"), Err(AppError::NotFound { .. })));
        fs::remove_dir_all(root).unwrap();
    }
}
