//! Dateien eines Pack-Zips: Pfadregeln und Größengrenzen, die für Anbieter-Packs wie für das `.mrpack` gelten.
use crate::{
    error::{AppError, AppResult},
    services::{
        content::safe_path,
        limits::{PROVIDER_ZIP_ENTRIES, PROVIDER_ZIP_EXPANDED_LIMIT},
        zip_guard::{check_entry_count, ensure_no_file_dir_conflict, reject_special, ExpandedSize},
    },
};

/// Dateien eines Pack-Zips wie bei `zip_paths`, dazu Größen- und Kompressionsgrenzen gegen ZIP-Bomben
/// (Regeln wie beim `.mrpack`).
pub(crate) fn zip_files(
    zip: &mut zip::ZipArchive<impl std::io::Read + std::io::Seek>,
    prefix: &str,
    skip: &[&str],
) -> AppResult<Vec<(std::path::PathBuf, usize)>> {
    check_entry_count(zip.len(), PROVIDER_ZIP_ENTRIES)?;
    let files = zip_paths(zip, prefix, skip)?;
    let mut expanded = ExpandedSize::new(PROVIDER_ZIP_EXPANDED_LIMIT);
    for (_, index) in &files {
        expanded.add_entry(&zip.by_index_raw(*index)?)?;
    }
    Ok(files)
}

/// Dateien eines ZIPs unterhalb von `prefix`, ohne die Ordner in `skip` (Namen der obersten Ebene):
/// `(Zielpfad, Eintrags-Nummer)`. Nur Pfadregeln: sichere Pfade, keine Sonderdateien, keine Doppelten,
/// keine Datei, die zugleich Ordner einer anderen ist.
pub(crate) fn zip_paths(
    zip: &mut zip::ZipArchive<impl std::io::Read + std::io::Seek>,
    prefix: &str,
    skip: &[&str],
) -> AppResult<Vec<(std::path::PathBuf, usize)>> {
    let mut seen = std::collections::HashSet::new();
    let mut files = Vec::new();
    for index in 0..zip.len() {
        let entry = zip.by_index_raw(index)?;
        if entry.is_dir() {
            continue;
        }
        let Some(rel) = entry.name().strip_prefix(prefix) else { continue };
        if skip.iter().any(|s| rel == *s || rel.strip_prefix(s).is_some_and(|r| r.starts_with('/'))) {
            continue;
        }
        let rel = rel.to_string();
        let path = safe_path(&rel)?;
        reject_special(&entry)?;
        if !seen.insert(rel.to_lowercase()) {
            return Err(AppError::invalid("Doppelter ZIP-Pfad"));
        }
        files.push((path, index));
    }
    ensure_no_file_dir_conflict(&seen)?;
    Ok(files)
}
