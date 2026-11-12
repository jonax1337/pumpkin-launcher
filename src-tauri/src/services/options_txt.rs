//! Zeilen der Form `schlüssel<trenner>wert`, wie sie `options.txt` (`:`) und `.properties`-Dateien (`=`) haben. Geändert
//! wird immer nur die gemeinte Zeile; alle anderen bleiben samt Zeilenende, wie das Spiel sie geschrieben hat.
use std::{fs, path::Path};

use super::{none_if_missing, write_atomic};
use crate::error::AppResult;

/// Inhalt der Datei; fehlt sie, ist er leer.
pub(crate) fn read_text(path: &Path) -> AppResult<String> {
    Ok(none_if_missing(fs::read_to_string(path))?.unwrap_or_default())
}

/// Schreibt die Datei atomar und legt ihren Ordner bei Bedarf an.
pub(crate) fn write_text(path: &Path, text: &str) -> AppResult<()> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    write_atomic(path, text.as_bytes())
}

/// Der Wert der Zeile `key<separator>wert` ohne Zeilenende.
pub(crate) fn line_value<'t>(text: &'t str, key: &str, separator: char) -> Option<&'t str> {
    text.lines().find_map(|line| line.strip_prefix(key)?.strip_prefix(separator))
}

/// Alle Zeilen als (Schlüssel, Wert) in ihrer Reihenfolge, getrennt am ersten `separator` wie im Spiel; Zeilen ohne
/// Trenner fehlen.
pub(crate) fn entries(text: &str, separator: char) -> impl Iterator<Item = (&str, &str)> {
    text.lines().filter_map(move |line| line.trim_end_matches('\r').split_once(separator))
}

/// Setzt den Wert der Zeile `key<separator>…`, `None` entfernt sie. Fehlt die Zeile, kommt sie ans Ende. Alle anderen
/// Zeilen bleiben unverändert, auch ihre Zeilenenden.
pub(crate) fn set_line(text: &str, key: &str, separator: char, value: Option<&str>) -> String {
    let is_target = |line: &str| line.strip_prefix(key).is_some_and(|rest| rest.starts_with(separator));
    let ending = if text.contains("\r\n") { "\r\n" } else { "\n" };
    let mut out = String::with_capacity(text.len());
    let mut found = false;
    for line in text.split_inclusive('\n') {
        let content = line.trim_end_matches(['\r', '\n']);
        if !is_target(content) {
            out.push_str(line);
            continue;
        }
        found = true;
        if let Some(value) = value {
            out.push_str(&format!("{key}{separator}{value}{}", &line[content.len()..]));
        }
    }
    if let (false, Some(value)) = (found, value) {
        if !out.is_empty() && !out.ends_with('\n') {
            out.push_str(ending);
        }
        out.push_str(&format!("{key}{separator}{value}{ending}"));
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn entries_split_at_the_first_separator_and_skip_lines_without_one() {
        let text = "version:3955\r\nresourcePacks:[\"file/a:b.zip\"]\r\ngarbage\r\nlang:de_de";
        let all: Vec<_> = entries(text, ':').collect();
        assert_eq!(all, [("version", "3955"), ("resourcePacks", "[\"file/a:b.zip\"]"), ("lang", "de_de")]);
    }
}
