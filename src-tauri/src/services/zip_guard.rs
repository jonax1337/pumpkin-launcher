//! Prüfungen für ZIP-Archive aus fremden Quellen (Packs): Sonderdateien, ZIP-Bomben und Pfadkonflikte. Jede Grenze
//! kommt vom Aufrufer, denn `.mrpack` und Anbieter-Zips gelten unterschiedlich streng (siehe `limits`).
use std::{collections::HashSet, io::Read};

use zip::read::ZipFile;

use super::{
    limits::{FILE_LIMIT, MIB},
    transport::read_capped_io,
};
use crate::{
    coded,
    error::{AppError, AppResult, Coded},
};

/// Ein Eintrag darf höchstens so viel größer sein wie das 200-Fache seiner komprimierten Größe (plus 1 MiB Spielraum
/// für winzige Einträge); darüber ist es eine ZIP-Bombe.
const MAX_COMPRESSION_RATIO: u64 = 200;

pub(crate) fn check_entry_count(count: usize, max: usize) -> AppResult<()> {
    if count > max {
        return Err(AppError::invalid(coded!("errors.providers.tooManyZipEntries")));
    }
    Ok(())
}

/// Symlinks, Geräte, Pipes und Sockets gehören nicht in ein Pack.
pub(crate) fn reject_special(entry: &ZipFile<'_, impl Read + ?Sized>) -> AppResult<()> {
    const SYMLINK: u32 = 0o120000;
    const BLOCK_DEVICE: u32 = 0o060000;
    const CHAR_DEVICE: u32 = 0o020000;
    const FIFO: u32 = 0o010000;
    const SOCKET: u32 = 0o140000;
    const FILE_TYPE_MASK: u32 = 0o170000;
    if entry.unix_mode().is_some_and(|mode| matches!(mode & FILE_TYPE_MASK, SYMLINK | BLOCK_DEVICE | CHAR_DEVICE | FIFO | SOCKET)) {
        return Err(AppError::invalid(coded!("errors.providers.zipSpecialFile")));
    }
    Ok(())
}

fn exceeds_ratio(entry: &ZipFile<'_, impl Read + ?Sized>) -> bool {
    entry.size() > entry.compressed_size().saturating_mul(MAX_COMPRESSION_RATIO).saturating_add(MIB)
}

/// Summe der entpackten Größen gegen eine Obergrenze; `limit` bestimmt der Aufrufer.
pub(crate) struct ExpandedSize {
    used: u64,
    limit: u64,
}

impl ExpandedSize {
    pub(crate) fn new(limit: u64) -> Self {
        Self { used: 0, limit }
    }

    /// Zählt einen ZIP-Eintrag: Gesamtgröße, Einzelgröße ([`FILE_LIMIT`]) und Kompressionsverhältnis.
    pub(crate) fn add_entry(&mut self, entry: &ZipFile<'_, impl Read + ?Sized>) -> AppResult<()> {
        self.add(entry.size(), coded!("errors.providers.zipSizeOverflow"))?;
        if self.used > self.limit || entry.size() > FILE_LIMIT || exceeds_ratio(entry) {
            return Err(AppError::invalid(coded!("errors.providers.zipLimitExceeded")));
        }
        Ok(())
    }

    /// Zählt eine Datei, die das Pack beschreibt und die erst geladen wird: Gesamtgröße und Einzelgröße.
    pub(crate) fn add_file(&mut self, size: u64) -> AppResult<()> {
        self.add(size, coded!("errors.providers.packSizeOverflow"))?;
        if self.used > self.limit || size > FILE_LIMIT {
            return Err(AppError::invalid(coded!("errors.providers.packFileLimitExceeded")));
        }
        Ok(())
    }

    fn add(&mut self, size: u64, overflow: Coded) -> AppResult<()> {
        self.used = self.used.checked_add(size).ok_or_else(|| AppError::invalid(overflow))?;
        Ok(())
    }
}

/// Liest den Inhalt eines Eintrags, höchstens `limit` Bytes; er muss genau so lang sein, wie das Archiv angibt.
pub(crate) fn read_entry(entry: &mut ZipFile<'_, impl Read + ?Sized>, limit: u64) -> AppResult<Vec<u8>> {
    let data = read_capped_io(&mut *entry, limit, &coded!("errors.providers.zipSizeInvalid").to_string())?;
    if data.len() as u64 != entry.size() {
        return Err(AppError::invalid(coded!("errors.providers.zipSizeInvalid")));
    }
    Ok(data)
}

/// Keine Datei in `files` ist zugleich Ordner einer anderen. Die Pfade sind relativ, mit `/` getrennt und
/// kleingeschrieben, weil Windows Groß- und Kleinschreibung nicht unterscheidet.
pub(crate) fn ensure_no_file_dir_conflict(files: &HashSet<String>) -> AppResult<()> {
    ensure_no_file_as_parent(files, files)
}

/// Kein Ordner eines Pfades aus `paths` ist eine Datei aus `files`.
pub(crate) fn ensure_no_file_as_parent(paths: &HashSet<String>, files: &HashSet<String>) -> AppResult<()> {
    for path in paths {
        if path.match_indices('/').any(|(at, _)| files.contains(&path[..at])) {
            return Err(AppError::invalid(coded!("errors.providers.fileDirConflict")));
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::{Cursor, Write};

    fn archive(entries: &[(&str, &[u8])]) -> zip::ZipArchive<Cursor<Vec<u8>>> {
        let mut writer = zip::ZipWriter::new(Cursor::new(Vec::new()));
        for (name, data) in entries {
            writer.start_file(*name, zip::write::SimpleFileOptions::default()).unwrap();
            writer.write_all(data).unwrap();
        }
        zip::ZipArchive::new(Cursor::new(writer.finish().unwrap().into_inner())).unwrap()
    }

    fn set(paths: &[&str]) -> HashSet<String> {
        paths.iter().map(|p| p.to_string()).collect()
    }

    #[test]
    fn symlinks_are_special_and_plain_files_are_not() {
        let mut writer = zip::ZipWriter::new(Cursor::new(Vec::new()));
        writer.start_file("plain", zip::write::SimpleFileOptions::default()).unwrap();
        writer.add_symlink("link", "plain", zip::write::SimpleFileOptions::default()).unwrap();
        let mut zip = zip::ZipArchive::new(Cursor::new(writer.finish().unwrap().into_inner())).unwrap();

        assert!(reject_special(&zip.by_index_raw(0).unwrap()).is_ok());
        assert_eq!(reject_special(&zip.by_index_raw(1).unwrap()).unwrap_err().to_string(), "ZIP-Symlink/Spezialdatei");
    }

    #[test]
    fn entry_counts_are_capped() {
        assert!(check_entry_count(3, 3).is_ok());
        assert_eq!(check_entry_count(4, 3).unwrap_err().to_string(), "Zu viele ZIP-Einträge");
    }

    #[test]
    fn expanded_sizes_add_up_to_the_limit() {
        let mut zip = archive(&[("a", b"1234"), ("b", b"1234")]);
        let mut budget = ExpandedSize::new(7);
        assert!(budget.add_entry(&zip.by_index_raw(0).unwrap()).is_ok());
        assert_eq!(budget.add_entry(&zip.by_index_raw(1).unwrap()).unwrap_err().to_string(), "ZIP-Limit überschritten");
    }

    #[test]
    fn a_highly_compressed_entry_is_a_bomb() {
        let zeros = vec![0u8; 4 * MIB as usize];
        let mut writer = zip::ZipWriter::new(Cursor::new(Vec::new()));
        writer.start_file("bomb", zip::write::SimpleFileOptions::default().compression_method(zip::CompressionMethod::Deflated)).unwrap();
        writer.write_all(&zeros).unwrap();
        let mut zip = zip::ZipArchive::new(Cursor::new(writer.finish().unwrap().into_inner())).unwrap();

        let entry = zip.by_index_raw(0).unwrap();

        assert!(exceeds_ratio(&entry));
        assert!(ExpandedSize::new(u64::MAX).add_entry(&entry).is_err());
    }

    #[test]
    fn described_files_have_their_own_messages() {
        let mut budget = ExpandedSize::new(10);
        assert!(budget.add_file(10).is_ok());
        assert_eq!(budget.add_file(1).unwrap_err().to_string(), "Pack-Dateilimit überschritten");
        assert_eq!(ExpandedSize::new(u64::MAX).add_file(FILE_LIMIT + 1).unwrap_err().to_string(), "Pack-Dateilimit überschritten");
        let mut full = ExpandedSize { used: u64::MAX, limit: u64::MAX };
        assert_eq!(full.add_file(1).unwrap_err().to_string(), "Pack-Größenüberlauf");
    }

    #[test]
    fn entries_are_read_with_their_exact_size() {
        let mut zip = archive(&[("a", b"abcd")]);
        assert_eq!(read_entry(&mut zip.by_index(0).unwrap(), 4).unwrap(), b"abcd");
        assert_eq!(read_entry(&mut zip.by_index(0).unwrap(), 3).unwrap_err().to_string(), "ZIP-Dateigröße ungültig");
    }

    #[test]
    fn a_file_must_not_also_be_a_folder() {
        assert!(ensure_no_file_dir_conflict(&set(&["mods/a.jar", "config/a.toml", "mods"])).is_err());
        assert!(ensure_no_file_dir_conflict(&set(&["mods/a.jar", "mods/b.jar", "modsx"])).is_ok());
        assert!(ensure_no_file_dir_conflict(&set(&[])).is_ok());
    }

    #[test]
    fn only_the_given_direction_counts_across_two_sets() {
        let overrides = set(&["mods/a.jar"]);
        let downloads = set(&["mods"]);
        assert!(ensure_no_file_as_parent(&overrides, &downloads).is_err());
        assert!(ensure_no_file_as_parent(&downloads, &overrides).is_ok());
    }
}
