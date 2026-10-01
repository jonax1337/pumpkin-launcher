//! Modrinth App: Instanzen stehen in der SQLite-Datenbank `app.db` im Datenordner (Tabellen `instances`,
//! `instance_content_sets` und `instance_launch_overrides`, Stand v0.21), die Spielordner unter `profiles/<path>`
//! im Datenordner oder im eigenen Ordner aus `settings.custom_dir`. Nur lesend geöffnet.
use std::path::{Path, PathBuf};

use rusqlite::{Connection, OpenFlags, OptionalExtension};
use serde::Deserialize;

use super::{loader_named, Setup};
use crate::error::AppResult;

const QUERY: &str = "
    SELECT i.name, i.path, s.game_version, s.loader, s.loader_version, json(o.overrides)
    FROM instances i
    JOIN instance_content_sets s ON s.id = i.applied_content_set_id
    LEFT JOIN instance_launch_overrides o ON o.instance_id = i.id";

/// Eigene Startoptionen der Instanz (JSONB); fehlende Werte gelten wie in der App als „Einstellung der App“.
#[derive(Default, Deserialize)]
struct Overrides {
    #[serde(default)]
    memory: Option<Memory>,
    #[serde(default)]
    extra_launch_args: Option<Vec<String>>,
}

#[derive(Deserialize)]
struct Memory {
    /// MiB.
    maximum: u32,
}

/// Instanzen der Modrinth App mit ihrem Spielordner; ohne `app.db` in `root` keine.
pub fn scan(root: &Path) -> AppResult<Vec<(PathBuf, Setup)>> {
    let db = root.join("app.db");
    if !db.is_file() {
        return Ok(Vec::new());
    }
    let conn = Connection::open_with_flags(&db, OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NO_MUTEX)?;
    let custom: Option<String> = conn.query_row("SELECT custom_dir FROM settings", [], |r| r.get(0)).optional()?.flatten();
    let profiles = custom.map_or_else(|| root.to_owned(), PathBuf::from).join("profiles");
    let mut statement = conn.prepare(QUERY)?;
    let rows = statement.query_map([], |r| {
        Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?, r.get(2)?, r.get::<_, String>(3)?, r.get(4)?, r.get::<_, Option<String>>(5)?))
    })?;
    let mut found = Vec::new();
    for row in rows {
        let (name, path, minecraft_version, loader, loader_version, overrides) = row?;
        let overrides: Overrides = overrides.map(|o| serde_json::from_str(&o)).transpose()?.unwrap_or_default();
        let setup = Setup {
            name,
            minecraft_version,
            loader: loader_named(&loader)?,
            loader_version,
            memory_mb: overrides.memory.map(|m| m.maximum),
            jvm_args: overrides.extra_launch_args.unwrap_or_default(),
        };
        found.push((profiles.join(path), setup));
    }
    Ok(found)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::ModLoader;

    /// Ausschnitt des Schemas der Modrinth App (Migrationen `init` und `instances-content-foundation`).
    const SCHEMA: &str = "
        CREATE TABLE settings (id INTEGER NOT NULL CHECK (id = 0), custom_dir TEXT NULL, PRIMARY KEY (id));
        CREATE TABLE instances (id TEXT NOT NULL, path TEXT NOT NULL, applied_content_set_id TEXT NULL,
            install_stage TEXT NOT NULL, name TEXT NOT NULL, PRIMARY KEY (id), UNIQUE (path));
        CREATE TABLE instance_content_sets (id TEXT NOT NULL, instance_id TEXT NOT NULL, game_version TEXT NOT NULL,
            loader TEXT NOT NULL, loader_version TEXT NULL, PRIMARY KEY (id));
        CREATE TABLE instance_launch_overrides (instance_id TEXT NOT NULL, overrides JSONB NOT NULL, PRIMARY KEY (instance_id));";

    fn database(root: &Path, custom_dir: Option<&str>) -> Connection {
        std::fs::create_dir_all(root).unwrap();
        let conn = Connection::open(root.join("app.db")).unwrap();
        conn.execute_batch(SCHEMA).unwrap();
        conn.execute("INSERT INTO settings (id, custom_dir) VALUES (0, ?1)", [custom_dir]).unwrap();
        conn
    }

    #[test]
    fn reads_instances_with_their_launch_overrides() {
        let root = std::env::temp_dir().join(crate::models::new_id());
        let conn = database(&root, None);
        conn.execute_batch(
            "INSERT INTO instances VALUES ('a', 'Fabric Welt', 'set-a', 'installed', 'Fabric Welt');
             INSERT INTO instance_content_sets VALUES ('set-a', 'a', '1.21.1', 'fabric', '0.16.10');
             INSERT INTO instance_launch_overrides VALUES ('a', jsonb('{\"memory\": {\"maximum\": 3072}, \"extra_launch_args\": [\"-Dx=1\"], \"hooks\": {}}'));
             INSERT INTO instances VALUES ('b', 'Pur', 'set-b', 'not_installed', 'Pur');
             INSERT INTO instance_content_sets VALUES ('set-b', 'b', '1.21.4', 'vanilla', NULL);",
        )
        .unwrap();
        drop(conn);

        let mut found = scan(&root).unwrap();
        found.sort_by(|a, b| a.1.name.cmp(&b.1.name));

        assert_eq!(found[0].0, root.join("profiles").join("Fabric Welt"));
        assert_eq!(
            found[0].1,
            Setup {
                name: "Fabric Welt".into(),
                minecraft_version: "1.21.1".into(),
                loader: ModLoader::Fabric,
                loader_version: Some("0.16.10".into()),
                memory_mb: Some(3072),
                jvm_args: vec!["-Dx=1".into()],
            }
        );
        assert_eq!((found[1].1.loader, found[1].1.memory_mb, found[1].1.jvm_args.len()), (ModLoader::Vanilla, None, 0));
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn custom_dir_moves_the_profiles() {
        let root = std::env::temp_dir().join(crate::models::new_id());
        let conn = database(&root, Some("D:\\Modrinth"));
        conn.execute_batch(
            "INSERT INTO instances VALUES ('a', 'Welt', 'set-a', 'installed', 'Welt');
             INSERT INTO instance_content_sets VALUES ('set-a', 'a', '1.21.1', 'quilt', NULL);",
        )
        .unwrap();
        drop(conn);
        assert_eq!(scan(&root).unwrap()[0].0, PathBuf::from("D:\\Modrinth").join("profiles").join("Welt"));
        assert!(scan(&root.join("leer")).unwrap().is_empty());
        std::fs::remove_dir_all(root).unwrap();
    }
}
