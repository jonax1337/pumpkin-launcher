//! Die Regeln, die ein Mod-Index erfüllen muss, bevor der Launcher ihm traut. Sie entsprechen
//! `mod/index.schema.json` und ergänzen, was ein Schema nicht ausdrückt (eindeutige Ids, Dateinamen und Zellen).
use std::collections::{HashMap, HashSet};

use super::index::{IndexError, Loader, ModIndex, Node, Verified};
use super::version::{is_release_id, LoaderVersion};

/// Die kleinste und die größte Java-Hauptversion, die ein Knoten verlangen darf.
pub const JAVA_MIN_RANGE: std::ops::RangeInclusive<u32> = 8..=64;
/// Länge einer Id oder eines Dateinamens, damit nichts Absurdes als Pfadteil landet.
pub const NAME_MAX_CHARS: usize = 128;
const SHA256_HEX_CHARS: usize = 64;
const JAR_SUFFIX: &str = ".jar";

pub(super) fn index(index: &ModIndex) -> Result<(), IndexError> {
    if !is_plain_name(&index.mod_version) {
        return Err(IndexError::ModVersionInvalid(index.mod_version.clone()));
    }
    let mut ids: HashSet<&str> = HashSet::new();
    let mut files: HashMap<&str, &str> = HashMap::new();
    let mut cells: HashMap<(Loader, &str), &str> = HashMap::new();
    for node in &index.nodes {
        single_node(node)?;
        if !ids.insert(&node.id) {
            return Err(IndexError::NodeIdDuplicate(node.id.clone()));
        }
        if let Some(other) = files.insert(&node.file, &node.id) {
            return Err(IndexError::FileNameDuplicate {
                node: node.id.clone(),
                file: node.file.clone(),
                other: other.to_owned(),
            });
        }
        for minecraft in &node.minecraft {
            if let Some(other) = cells.insert((node.loader, minecraft), &node.id) {
                return Err(IndexError::MinecraftIdClaimedTwice {
                    node: node.id.clone(),
                    minecraft: minecraft.clone(),
                    loader: node.loader,
                    other: other.to_owned(),
                });
            }
        }
    }
    Ok(())
}

fn single_node(node: &Node) -> Result<(), IndexError> {
    let id = node.id.clone();
    if !is_plain_name(&node.id) {
        return Err(IndexError::NodeIdInvalid(id));
    }
    if LoaderVersion::parse(&node.loader_min).is_none() {
        return Err(IndexError::LoaderMinInvalid {
            node: id,
            value: node.loader_min.clone(),
        });
    }
    minecraft_list(node)?;
    if !JAVA_MIN_RANGE.contains(&node.java_min) {
        return Err(IndexError::JavaMinInvalid {
            node: id,
            value: node.java_min,
            min: *JAVA_MIN_RANGE.start(),
            max: *JAVA_MIN_RANGE.end(),
        });
    }
    if !node.strategy.suits(node.loader) {
        return Err(IndexError::StrategyMismatch {
            node: id,
            strategy: node.strategy,
            loader: node.loader,
        });
    }
    if !is_jar_file_name(&node.file) {
        return Err(IndexError::FileNameInvalid {
            node: id,
            value: node.file.clone(),
        });
    }
    if !is_sha256_hex(&node.sha256) {
        return Err(IndexError::Sha256Invalid { node: id });
    }
    if let Some(verified) = &node.verified {
        verified_dates(&node.id, verified)?;
    }
    Ok(())
}

fn minecraft_list(node: &Node) -> Result<(), IndexError> {
    let has_duplicates = node
        .minecraft
        .iter()
        .enumerate()
        .any(|(i, id)| node.minecraft[..i].contains(id));
    if node.minecraft.is_empty() || has_duplicates {
        return Err(IndexError::MinecraftListInvalid {
            node: node.id.clone(),
        });
    }
    match node.minecraft.iter().find(|id| !is_release_id(id)) {
        Some(value) => Err(IndexError::MinecraftIdInvalid {
            node: node.id.clone(),
            value: value.clone(),
        }),
        None => Ok(()),
    }
}

fn verified_dates(node: &str, verified: &Verified) -> Result<(), IndexError> {
    for date in std::iter::once(&verified.smoke).chain(verified.owner.as_ref()) {
        if !is_iso_date(date) {
            return Err(IndexError::VerifiedDateInvalid {
                node: node.to_owned(),
                value: date.clone(),
            });
        }
    }
    Ok(())
}

/// Ein Name, der als einzelner Pfadteil taugt: Buchstabe oder Ziffer vorn (kein versteckter Dateiname), danach
/// Buchstaben, Ziffern und `._+-`.
pub fn is_plain_name(text: &str) -> bool {
    let mut chars = text.chars();
    chars
        .next()
        .is_some_and(|first| first.is_ascii_alphanumeric())
        && text.len() <= NAME_MAX_CHARS
        && text
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '_' | '+' | '-'))
}

/// Ein reiner Blattname, der auf `.jar` endet.
pub fn is_jar_file_name(text: &str) -> bool {
    text.strip_suffix(JAR_SUFFIX).is_some_and(is_plain_name)
}

fn is_sha256_hex(text: &str) -> bool {
    text.len() == SHA256_HEX_CHARS
        && text
            .bytes()
            .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
}

/// `JJJJ-MM-TT` mit Monat 01 bis 12 und Tag 01 bis 31; ob der Tag im Monat existiert, ist hier egal.
fn is_iso_date(text: &str) -> bool {
    let parts: Vec<&str> = text.split('-').collect();
    let [year, month, day] = parts[..] else {
        return false;
    };
    let digits =
        |part: &str, len: usize| part.len() == len && part.bytes().all(|b| b.is_ascii_digit());
    digits(year, 4)
        && digits(month, 2)
        && digits(day, 2)
        && (1..=12).contains(&month.parse::<u32>().unwrap_or(0))
        && (1..=31).contains(&day.parse::<u32>().unwrap_or(0))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn plain_names_have_no_path_parts_and_no_hidden_start() {
        for name in [
            "2.1.0",
            "1.21.1-neoforge",
            "pumpkin_bridge-2.1.0+1.21.1-neoforge",
            "a",
        ] {
            assert!(is_plain_name(name), "{name}");
        }
        for name in [
            "",
            ".hidden",
            "-x",
            "a/b",
            "a\\b",
            "..",
            "a b",
            "ä",
            "a:b",
            &"x".repeat(NAME_MAX_CHARS + 1),
        ] {
            assert!(!is_plain_name(name), "{name:?}");
        }
    }

    #[test]
    fn jar_file_names_end_in_lower_case_jar_and_are_plain() {
        for name in [
            "a.jar",
            "pumpkin_bridge-2.1.0+1.21.1-neoforge.jar",
            "x.y.z.jar",
        ] {
            assert!(is_jar_file_name(name), "{name}");
        }
        for name in [
            "",
            ".jar",
            "a.JAR",
            "a.zip",
            "a",
            "../a.jar",
            "dir/a.jar",
            "dir\\a.jar",
            ".a.jar",
            "a b.jar",
            "a.jar.exe",
        ] {
            assert!(!is_jar_file_name(name), "{name:?}");
        }
    }

    #[test]
    fn sha256_is_64_lower_case_hex_characters() {
        assert!(is_sha256_hex(&"0123456789abcdef".repeat(4)));
        for text in [
            &"A".repeat(64),
            &"a".repeat(63),
            &"a".repeat(65),
            &"g".repeat(64),
            &String::new(),
        ] {
            assert!(!is_sha256_hex(text), "{text:?}");
        }
    }

    #[test]
    fn iso_dates_need_year_month_and_day() {
        for date in ["2026-10-03", "1999-01-31", "2026-12-01"] {
            assert!(is_iso_date(date), "{date}");
        }
        for date in [
            "",
            "2026-10",
            "2026-13-01",
            "2026-00-10",
            "2026-10-32",
            "2026-10-00",
            "26-10-03",
            "2026/10/03",
            "2026-1-3",
            "2026-10-03T10:00",
        ] {
            assert!(!is_iso_date(date), "{date:?}");
        }
    }
}
