//! Testwelten: ein Spielordner mit `saves/` wie vom Spiel angelegt.
use std::path::PathBuf;

use fastnbt::Value;

use crate::models::new_id;
use crate::services::{compound, gzip_nbt, write_files, Dirs};

/// `level.dat` wie vom Spiel: gzip-NBT mit `Data`, dazu Tags, die die Liste nicht braucht.
pub(super) fn level_dat(name: &str, last_played: i64, game_type: i32, hardcore: bool) -> Vec<u8> {
    let data = compound(vec![
        ("LevelName", Value::String(name.into())),
        ("LastPlayed", Value::Long(last_played)),
        ("GameType", Value::Int(game_type)),
        ("hardcore", Value::Byte(hardcore.into())),
        ("Version", compound(vec![("Name", Value::String("1.21.4".into())), ("Id", Value::Int(4189))])),
        ("SpawnX", Value::Int(12)),
    ]);
    gzip_nbt(&compound(vec![("Data", data)]))
}

/// Instanz `i` mit drei Welten (eine davon mit unlesbarer `level.dat`) und einem Ordner, der keine Welt ist.
pub(super) fn setup() -> (PathBuf, Dirs) {
    let root = std::env::temp_dir().join(new_id());
    let dirs = Dirs::new(&root);
    write_files::<&[u8]>(
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
