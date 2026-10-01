//! Hilfen für Tests, die Spielordner, NBT und `level.dat` nachbauen.
use std::{fs, io::Write, path::Path};

/// Testdateien unter `dir` anlegen: (relativer Pfad, Inhalt).
pub(crate) fn write_files<B: AsRef<[u8]>>(dir: &Path, files: &[(&str, B)]) {
    for (path, data) in files {
        fs::create_dir_all(dir.join(path).parent().unwrap()).unwrap();
        fs::write(dir.join(path), data).unwrap();
    }
}

/// NBT-Compound aus Paaren.
pub(crate) fn compound(pairs: Vec<(&str, fastnbt::Value)>) -> fastnbt::Value {
    fastnbt::Value::Compound(pairs.into_iter().map(|(k, v)| (k.to_owned(), v)).collect())
}

/// `level.dat` wie vom Spiel: gzip-komprimiertes NBT.
pub(crate) fn gzip_nbt(value: &fastnbt::Value) -> Vec<u8> {
    let mut gz = flate2::write::GzEncoder::new(Vec::new(), flate2::Compression::default());
    gz.write_all(&fastnbt::to_bytes(value).unwrap()).unwrap();
    gz.finish().unwrap()
}
