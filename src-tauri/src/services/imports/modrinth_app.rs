//! Modrinth App: Instanzen stehen in der SQLite-Datenbank `app.db` im Datenordner (seit Mitte 2026 in den Tabellen
//! `instances`, `instance_content_sets` und `instance_launch_overrides`, davor in `profiles`), die Spielordner unter
//! `profiles/<path>` im Datenordner oder im eigenen Ordner aus `settings.custom_dir`. Nur lesend geöffnet.
use std::path::{Path, PathBuf};

use rusqlite::{Connection, OpenFlags, OptionalExtension, Row};

use super::{loader_named, Setup};
use crate::error::AppResult;

/// Beide Abfragen liefern: Name, Pfad, Minecraft-Version, Loader, Loader-Version, RAM (MiB) und JVM-Argumente
/// (JSON-Liste); fehlende Werte gelten wie in der App als „Einstellung der App“.
const QUERY: &str = "
    SELECT i.name, i.path, s.game_version, s.loader, s.loader_version,
        json_extract(o.overrides, '$.memory.maximum'), json_extract(o.overrides, '$.extra_launch_args')
    FROM instances i
    JOIN instance_content_sets s ON s.id = i.applied_content_set_id
    LEFT JOIN instance_launch_overrides o ON o.instance_id = i.id";

/// Datenbanken, die die App seit der Umstellung nicht mehr geöffnet hat, haben nur `profiles`.
const LEGACY_QUERY: &str = "
    SELECT name, path, game_version, mod_loader, mod_loader_version,
        override_mc_memory_max, json(override_extra_launch_args)
    FROM profiles";

/// Instanzen der Modrinth App als (Spielordner, Einstellungen); ohne `app.db` in `root` keine. Eine unlesbare
/// Zeile kommt als Fehler, damit sie nur sich selbst verbirgt.
pub fn scan(root: &Path) -> AppResult<Vec<AppResult<(PathBuf, Setup)>>> {
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
    Ok(rows.map(|row| row?).collect())
}

fn instance(row: &Row, profiles: &Path) -> AppResult<(PathBuf, Setup)> {
    let path: String = row.get(1)?;
    let args: Option<String> = row.get(6)?;
    let setup = Setup {
        name: row.get(0)?,
        minecraft_version: row.get(2)?,
        loader: loader_named(&row.get::<_, String>(3)?)?,
        loader_version: row.get(4)?,
        memory_mb: row.get(5)?,
        jvm_args: args.map(|a| serde_json::from_str(&a)).transpose()?.unwrap_or_default(),
    };
    Ok((profiles.join(path), setup))
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

    /// Lesbare Instanzen nach Namen sortiert, dazu die Anzahl unlesbarer.
    fn scan_sorted(root: &Path) -> (Vec<(PathBuf, Setup)>, usize) {
        let (ok, bad): (Vec<_>, Vec<_>) = scan(root).unwrap().into_iter().partition(Result::is_ok);
        let mut found: Vec<_> = ok.into_iter().map(Result::unwrap).collect();
        found.sort_by(|a, b| a.1.name.cmp(&b.1.name));
        (found, bad.len())
    }

    #[test]
    fn reads_instances_with_their_launch_overrides() {
        let root = std::env::temp_dir().join(crate::models::new_id());
        let conn = database(&root, SCHEMA, None);
        conn.execute_batch(
            "INSERT INTO instances VALUES ('a', 'Fabric Welt', 'set-a', 'installed', 'Fabric Welt');
             INSERT INTO instance_content_sets VALUES ('set-a', 'a', '1.21.1', 'fabric', '0.16.10');
             INSERT INTO instance_launch_overrides VALUES ('a', jsonb('{\"memory\": {\"maximum\": 3072}, \"extra_launch_args\": [\"-Dx=1\"], \"hooks\": {}}'));
             INSERT INTO instances VALUES ('b', 'Pur', 'set-b', 'not_installed', 'Pur');
             INSERT INTO instance_content_sets VALUES ('set-b', 'b', '1.21.4', 'vanilla', NULL);
             INSERT INTO instances VALUES ('c', 'Alt', 'set-c', 'installed', 'Alt');
             INSERT INTO instance_content_sets VALUES ('set-c', 'c', '1.7.10', 'liteloader', NULL);",
        )
        .unwrap();
        drop(conn);

        let (found, unreadable) = scan_sorted(&root);

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
        assert_eq!((found.len(), unreadable), (2, 1));
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

        let (found, _) = scan_sorted(&root);

        assert_eq!(found[0].0, root.join("profiles").join("Neo"));
        assert_eq!(
            (found[0].1.loader, found[0].1.loader_version.as_deref(), found[0].1.memory_mb, found[0].1.jvm_args.as_slice()),
            (ModLoader::NeoForge, Some("21.1.172"), Some(6144), ["-XX:+UseZGC".to_owned()].as_slice())
        );
        assert_eq!((found[1].1.loader, found[1].1.memory_mb, found[1].1.jvm_args.len()), (ModLoader::Vanilla, None, 0));
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
        assert_eq!(scan_sorted(&root).0[0].0, PathBuf::from("D:\\Modrinth").join("profiles").join("Welt"));
        assert!(scan(&root.join("leer")).unwrap().is_empty());
        std::fs::remove_dir_all(root).unwrap();
    }
}
