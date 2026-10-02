//! Welten einer Instanz (`saves/<Ordner>`; der Ordnername ist die ID): Anzeige aus `level.dat`, Sicherungen
//! (Modul `backup`), Wiederherstellen und Löschen sowie das Aufräumen unterbrochener Vorgänge beim Start.
use std::{
    cmp::Reverse,
    fs,
    io::Read,
    path::{Path, PathBuf},
};

use serde::{de::DeserializeOwned, Deserialize, Serialize};

use super::progress::SharedProgress;
use super::{data_url, entries, require_plain_name, servers, Dirs};
use crate::{
    coded,
    error::{AppError, AppResult},
    models::QuickPlay,
    state::AppState,
};

mod auto;
mod backup;
mod leftovers;
mod transfer;
#[cfg(test)]
mod fixtures;

pub use auto::backup_before_launch;
pub use backup::{backup, backup_cancellable, backups, delete, delete_backup, restore, WorldBackup};
pub use leftovers::remove_leftovers;
pub use transfer::{export_backups, import};

/// `icon.png` ist im Spiel 64 × 64; größere Dateien zeigt die Liste nicht.
const ICON_LIMIT: u64 = 256 * 1024;

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
    let mut worlds: Vec<World> = entries(&dirs.saves(instance_id))?
        .iter()
        .filter(|entry| is_world(&entry.path()))
        .filter_map(|entry| Some(read_world(&entry.path(), entry.file_name().to_str()?)))
        .collect();
    worlds.sort_by_key(|w| Reverse(w.last_played));
    Ok(worlds)
}

/// Ordner der Welt `id`: ein einzelner Ordnername direkt unter `saves/` mit einer `level.dat`.
pub fn world_dir(dirs: &Dirs, instance_id: &str, id: &str) -> AppResult<PathBuf> {
    let dir = dirs.saves(instance_id).join(require_plain_name(id)?);
    if !is_world(&dir) {
        return Err(AppError::NotFound(coded!("errors.packs.world.notFound", id = id).into()));
    }
    Ok(dir)
}

/// Ein Ordner mit `level.dat` ist eine Welt.
fn is_world(dir: &Path) -> bool {
    dir.join("level.dat").is_file()
}

/// Prüft ein Quick-Play-Ziel, bevor es zum Startargument wird.
pub fn require_target(dirs: &Dirs, instance_id: &str, target: &QuickPlay) -> AppResult<()> {
    match target {
        QuickPlay::World { id } => world_dir(dirs, instance_id, id).map(drop),
        QuickPlay::Server { address } => servers::require_address(address).map(drop),
    }
}

/// Löscht die Welt wie [`delete`] und vergisst sie als letztes Quick-Play-Ziel der Instanz, falls sie es war:
/// „Weiterspielen“ liefe sonst ins Leere. Liefert die Sicherung.
pub async fn delete_and_forget_target(
    state: &AppState,
    instance_id: &str,
    world_id: &str,
    progress: SharedProgress,
) -> AppResult<WorldBackup> {
    let (instance, world) = (instance_id.to_owned(), world_id.to_owned());
    let saved = state.blocking_with_dirs(move |dirs| delete(dirs, &instance, &world, &*progress)).await?;
    state.instances.modify(instance_id, |i| {
        if matches!(&i.last_quick_play, Some(QuickPlay::World { id }) if *id == saved.world) {
            i.last_quick_play = None;
        }
    })?;
    Ok(saved)
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
    Some(data_url("image/png", &fs::read(path).ok()?))
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

#[cfg(test)]
mod tests {
    use super::fixtures::{level_dat, setup};
    use super::*;
    use crate::models::{new_id, Instance, ModLoader, NewInstance};
    use crate::services::{progress::ignored, write_files};

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
    fn world_ids_and_targets_stay_inside_the_instance() {
        let (root, dirs) = setup();
        for id in ["../Alt", "Alt/..", "..\\Alt", "Kein Spielstand", "fehlt"] {
            assert!(world_dir(&dirs, "i", id).is_err(), "{id}");
        }
        assert!(require_target(&dirs, "i", &QuickPlay::World { id: "Alt".into() }).is_ok());
        assert!(require_target(&dirs, "i", &QuickPlay::Server { address: "--demo".into() }).is_err());
        fs::remove_dir_all(root).unwrap();
    }

    #[tokio::test]
    async fn deleting_the_last_quick_play_world_forgets_the_target() {
        let root = std::env::temp_dir().join(new_id());
        let state = AppState::load(&root).unwrap();
        let new = NewInstance { name: "Welten".into(), minecraft_version: "1.21.4".into(), loader: ModLoader::Vanilla, loader_version: None };
        let id = state.instances.insert(Instance::from_new(new)).unwrap().id;
        let level = level_dat("Welt", 1, 0, false);
        write_files::<&[u8]>(&state.dirs.saves(&id), &[("A/level.dat", &level), ("B/level.dat", &level)]);
        let play = |world: &str| QuickPlay::World { id: world.into() };
        let set_target = |target| state.instances.modify(&id, |i| i.last_quick_play = Some(target)).unwrap();

        set_target(play("B"));
        delete_and_forget_target(&state, &id, "A", ignored()).await.unwrap();
        assert_eq!(state.instances.get(&id).unwrap().last_quick_play, Some(play("B")));

        delete_and_forget_target(&state, &id, "B", ignored()).await.unwrap();
        assert_eq!(state.instances.get(&id).unwrap().last_quick_play, None);
        fs::remove_dir_all(root).unwrap();
    }
}
