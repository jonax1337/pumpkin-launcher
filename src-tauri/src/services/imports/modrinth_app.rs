//! Modrinth App: Instanzen stehen in der SQLite-Datenbank `app.db` im Datenordner (seit Mitte 2026 in den Tabellen
//! `instances`, `instance_content_sets` und `instance_launch_overrides`, davor in `profiles`), die Spielordner unter
//! `profiles/<path>` im Datenordner oder im eigenen Ordner aus `settings.custom_dir`. Nur lesend geöffnet.
use std::path::{Path, PathBuf};

use rusqlite::{Connection, OpenFlags, OptionalExtension, Row};
use serde::Deserialize;

use super::{foreign_commands, loader_named, skip_unreadable, window_size, Found, Setup};
use crate::{error::AppResult, models::GameWindow};

/// Beide Abfragen liefern: Name, Pfad, Minecraft-Version, Loader, Loader-Version, RAM (MiB), JVM-Argumente
/// (JSON-Liste) und die übrigen Einstellungen als JSON (`Overrides`); fehlende Werte gelten wie in der App als
/// „Einstellung der App“.
const QUERY: &str = "
    SELECT i.name, i.path, s.game_version, s.loader, s.loader_version,
        json_extract(o.overrides, '$.memory.maximum'), json_extract(o.overrides, '$.extra_launch_args'), json(o.overrides)
    FROM instances i
    JOIN instance_content_sets s ON s.id = i.applied_content_set_id
    LEFT JOIN instance_launch_overrides o ON o.instance_id = i.id";

/// Datenbanken, die die App seit der Umstellung nicht mehr geöffnet hat, haben nur `profiles`.
const LEGACY_QUERY: &str = "
    SELECT name, path, game_version, mod_loader, mod_loader_version,
        override_mc_memory_max, json(override_extra_launch_args), NULL
    FROM profiles";

/// Weitere Einstellungen der Instanz. Sie sind nur Zugabe: passt ein Feld nicht, gilt keines davon, und die
/// Instanz kommt ohne sie.
#[derive(Deserialize, Default)]
#[serde(default)]
struct Overrides {
    java_path: Option<String>,
    force_fullscreen: Option<bool>,
    /// Breite und Höhe.
    game_resolution: Option<(u32, u32)>,
    hooks: Hooks,
}

#[derive(Deserialize, Default)]
#[serde(default)]
struct Hooks {
    pre_launch: Option<String>,
    wrapper: Option<String>,
    post_exit: Option<String>,
}

/// Instanzen der Modrinth App; ohne `app.db` in `root` keine. Eine unlesbare Zeile verbirgt nur sich selbst.
pub fn scan(root: &Path) -> AppResult<Vec<Found>> {
    let db = root.join("app.db");
    if !db.is_file() {
        return Ok(Vec::new());
    }
    let conn = Connection::open_with_flags(&db, OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NO_MUTEX)?;
    let custom: Option<String> = conn.query_row("SELECT custom_dir FROM settings", [], |r| r.get(0)).optional()?.flatten();
    let profiles = custom.map_or_else(|| root.to_owned(), PathBuf::from).join("profiles");
    let migrated = conn.query_row("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'instances'", [], |_| Ok(())).optional()?;
    let mut statement = conn.prepare(if migrated.is_some() { QUERY } else { LEGACY_QUERY })?;
    let rows = statement.query_map([], |row| Ok(instance(row, &profiles)))?;
    let readable = rows.map(|row| row?).filter_map(|row| skip_unreadable(&db, row.map(Some), "Instanz der Modrinth App übersprungen"));
    Ok(readable.collect())
}

fn instance(row: &Row, profiles: &Path) -> AppResult<Found> {
    let path: String = row.get(1)?;
    let args: Option<String> = row.get(6)?;
    let extra: Option<String> = row.get(7)?;
    let Overrides { java_path, force_fullscreen, game_resolution, hooks } =
        extra.and_then(|json| serde_json::from_str(&json).ok()).unwrap_or_default();
    let window = match (force_fullscreen, game_resolution) {
        (Some(true), _) => GameWindow::Fullscreen,
        (_, resolution) => window_size(resolution.map(|(width, _)| width), resolution.map(|(_, height)| height)),
    };
    let setup = Setup {
        memory_mb: row.get(5)?,
        jvm_args: args.map(|a| serde_json::from_str(&a)).transpose()?.unwrap_or_default(),
        java_path: java_path.filter(|path| !path.is_empty()),
        window,
        not_adopted: foreign_commands(hooks.pre_launch.as_deref(), hooks.post_exit.as_deref(), hooks.wrapper.as_deref()),
        ..Setup::new(row.get(0)?, row.get(2)?, loader_named(&row.get::<_, String>(3)?)?, row.get(4)?)
    };
    Ok(Found { game_dir: profiles.join(path), setup })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{models::ModLoader, services::imports::NotAdopted};

    /// Ausschnitt des Schemas der Modrinth App (Migrationen `init` und `instances-content-foundation`).
    const SCHEMA: &str = "
        CREATE TABLE settings (id INTEGER NOT NULL CHECK (id = 0), custom_dir TEXT NULL, PRIMARY KEY (id));
        CREATE TABLE instances (id TEXT NOT NULL, path TEXT NOT NULL, applied_content_set_id TEXT NULL,
            install_stage TEXT NOT NULL, name TEXT NOT NULL, PRIMARY KEY (id), UNIQUE (path));
        CREATE TABLE instance_content_sets (id TEXT NOT NULL, instance_id TEXT NOT NULL, game_version TEXT NOT NULL,
            loader TEXT NOT NULL, loader_version TEXT NULL, PRIMARY KEY (id));
        CREATE TABLE instance_launch_overrides (instance_id TEXT NOT NULL, overrides JSONB NOT NULL, PRIMARY KEY (instance_id));";

    /// Ausschnitt von `profiles` aus der Migration `init`, wie die App ihn vor der Umstellung nutzte.
    const LEGACY_SCHEMA: &str = "
        CREATE TABLE settings (id INTEGER NOT NULL CHECK (id = 0), custom_dir TEXT NULL, PRIMARY KEY (id));
        CREATE TABLE profiles (path TEXT NOT NULL, install_stage TEXT NOT NULL, name TEXT NOT NULL,
            game_version TEXT NOT NULL, mod_loader TEXT NOT NULL, mod_loader_version TEXT NULL,
            override_extra_launch_args JSONB NOT NULL, override_mc_memory_max INTEGER NULL, PRIMARY KEY (path));";

    fn database(root: &Path, schema: &str, custom_dir: Option<&str>) -> Connection {
        std::fs::create_dir_all(root).unwrap();
        let conn = Connection::open(root.join("app.db")).unwrap();
        conn.execute_batch(schema).unwrap();
        conn.execute("INSERT INTO settings (id, custom_dir) VALUES (0, ?1)", [custom_dir]).unwrap();
        conn
    }

    fn scan_sorted(root: &Path) -> Vec<Found> {
        let mut found = scan(root).unwrap();
        found.sort_by(|a, b| a.setup.name.cmp(&b.setup.name));
        found
    }

    #[test]
    fn reads_instances_with_their_launch_overrides() {
        let root = std::env::temp_dir().join(crate::models::new_id());
        let conn = database(&root, SCHEMA, None);
        conn.execute_batch(
            "INSERT INTO instances VALUES ('a', 'Fabric Welt', 'set-a', 'installed', 'Fabric Welt');
             INSERT INTO instance_content_sets VALUES ('set-a', 'a', '1.21.1', 'fabric', '0.16.10');
             INSERT INTO instance_launch_overrides VALUES ('a', jsonb('{\"memory\": {\"maximum\": 3072}, \"extra_launch_args\": [\"-Dx=1\"],
                 \"java_path\": \"C:/Java/bin/javaw.exe\", \"game_resolution\": [1280, 720], \"hooks\": {\"wrapper\": \"gamemoderun\", \"post_exit\": \"\"}}'));
             INSERT INTO instances VALUES ('b', 'Pur', 'set-b', 'not_installed', 'Pur');
             INSERT INTO instance_content_sets VALUES ('set-b', 'b', '1.21.4', 'vanilla', NULL);
             INSERT INTO instances VALUES ('c', 'Alt', 'set-c', 'installed', 'Alt');
             INSERT INTO instance_content_sets VALUES ('set-c', 'c', '1.7.10', 'liteloader', NULL);",
        )
        .unwrap();
        drop(conn);

        // „Alt“ hat einen Loader, den es bei Pumpkin Launcher nicht gibt, und verschwindet allein.
        let found = scan_sorted(&root);

        assert_eq!(found[0].game_dir, root.join("profiles").join("Fabric Welt"));
        assert_eq!(
            found[0].setup,
            Setup {
                memory_mb: Some(3072),
                jvm_args: vec!["-Dx=1".into()],
                java_path: Some("C:/Java/bin/javaw.exe".into()),
                window: GameWindow::Size { width: 1280, height: 720 },
                not_adopted: vec![NotAdopted::WrapperCommand],
                ..Setup::new("Fabric Welt".into(), "1.21.1".into(), ModLoader::Fabric, Some("0.16.10".into()))
            }
        );
        assert_eq!((found[1].setup.loader, found[1].setup.memory_mb, found[1].setup.jvm_args.len()), (ModLoader::Vanilla, None, 0));
        assert_eq!(found.len(), 2);
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn reads_profiles_of_databases_before_the_switch() {
        let root = std::env::temp_dir().join(crate::models::new_id());
        let conn = database(&root, LEGACY_SCHEMA, None);
        conn.execute_batch(
            "INSERT INTO profiles VALUES ('Neo', 'installed', 'Neo', '1.21.1', 'neoforge', '21.1.172', '[\"-XX:+UseZGC\"]', 6144);
             INSERT INTO profiles VALUES ('Pur', 'installed', 'Pur', '1.21.4', 'vanilla', NULL, '[]', NULL);",
        )
        .unwrap();
        drop(conn);

        let found = scan_sorted(&root);

        assert_eq!(found[0].game_dir, root.join("profiles").join("Neo"));
        assert_eq!(
            (found[0].setup.loader, found[0].setup.loader_version.as_deref(), found[0].setup.memory_mb, found[0].setup.jvm_args.as_slice()),
            (ModLoader::NeoForge, Some("21.1.172"), Some(6144), ["-XX:+UseZGC".to_owned()].as_slice())
        );
        assert_eq!((found[1].setup.loader, found[1].setup.memory_mb, found[1].setup.jvm_args.len()), (ModLoader::Vanilla, None, 0));
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn custom_dir_moves_the_profiles() {
        let root = std::env::temp_dir().join(crate::models::new_id());
        let conn = database(&root, SCHEMA, Some("D:\\Modrinth"));
        conn.execute_batch(
            "INSERT INTO instances VALUES ('a', 'Welt', 'set-a', 'installed', 'Welt');
             INSERT INTO instance_content_sets VALUES ('set-a', 'a', '1.21.1', 'quilt', NULL);",
        )
        .unwrap();
        drop(conn);
        assert_eq!(scan_sorted(&root)[0].game_dir, PathBuf::from("D:\\Modrinth").join("profiles").join("Welt"));
        assert!(scan(&root.join("leer")).unwrap().is_empty());
        std::fs::remove_dir_all(root).unwrap();
    }
}
