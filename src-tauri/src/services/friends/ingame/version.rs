//! Versionen, wie die Einspeisung sie braucht: Loader-Versionen vergleichen und Minecraft-Release-Ids erkennen.

/// Eine Loader-Version als Zahlenfolge (Fabric Loader `0.16.14`, NeoForge `21.1.172` oder `26.1.2.114`, Forge `47.4.0`).
///
/// Verglichen wird komponentenweise als Zahl; fehlende Stellen zählen als 0 (`21.1` ist `21.1.0`). Ein Zusatz hinter
/// den Ziffern (`-beta`, `+build.3`) und alles danach wird **bewusst ignoriert**: `21.0.0-beta` gilt als `21.0.0`.
/// Die Mindestversionen im Index sind Release-Stände, und eine Vorabversion eines Loaders, die den Zusatz trägt, ist
/// für die Frage „reicht der Loader?“ nicht feiner zu beurteilen als mit ihrer Zahl. Wer Forge-Versionen aus der
/// Kombination `1.20.1-47.4.0` zerlegt, übergibt nur den Forge-Teil (`47.4.0`).
#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord)]
pub struct LoaderVersion(Vec<u64>);

impl LoaderVersion {
    /// Liest die Version; `None`, wenn schon die erste Komponente keine Zahl ist oder überläuft.
    pub fn parse(text: &str) -> Option<Self> {
        let mut numbers = Vec::new();
        for component in text.trim().split('.') {
            let digits: String = component.chars().take_while(char::is_ascii_digit).collect();
            if digits.is_empty() {
                break;
            }
            numbers.push(digits.parse().ok()?);
            if digits.len() < component.len() {
                break;
            }
        }
        if numbers.is_empty() {
            return None;
        }
        while numbers.len() > 1 && numbers.last() == Some(&0) {
            numbers.pop();
        }
        Some(Self(numbers))
    }
}

/// Mehr Stellen hat keine Minecraft-Version (`1.21.1`, `26.1.2`).
const RELEASE_ID_MAX_PARTS: usize = 3;
const RELEASE_ID_MIN_PARTS: usize = 2;
const RELEASE_ID_MAX_PART_DIGITS: usize = 4;

/// Ob `id` eine Release-Id wie `1.21.1` oder `26.3` ist: zwei oder drei Zahlen mit Punkten, sonst nichts.
/// Snapshots (`24w14a`, `26.1-snapshot-1`), Vorabversionen, Release Candidates, Bereiche und Platzhalter sind keine.
pub fn is_release_id(id: &str) -> bool {
    let parts: Vec<&str> = id.split('.').collect();
    (RELEASE_ID_MIN_PARTS..=RELEASE_ID_MAX_PARTS).contains(&parts.len())
        && parts.iter().all(|part| is_plain_number(part))
}

fn is_plain_number(text: &str) -> bool {
    !text.is_empty()
        && text.len() <= RELEASE_ID_MAX_PART_DIGITS
        && text.bytes().all(|byte| byte.is_ascii_digit())
        && (text == "0" || !text.starts_with('0'))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::cmp::Ordering;

    fn compare(left: &str, right: &str) -> Ordering {
        LoaderVersion::parse(left)
            .unwrap()
            .cmp(&LoaderVersion::parse(right).unwrap())
    }

    #[test]
    fn loader_versions_compare_component_wise_as_numbers() {
        let cases = [
            ("0.16.14", "0.16.9", Ordering::Greater),
            ("0.19.5", "0.19.5", Ordering::Equal),
            ("21.1.172", "21.1.0", Ordering::Greater),
            ("21.1.172", "21.10.0", Ordering::Less),
            ("26.1.2.114", "26.1.2.9", Ordering::Greater),
            ("26.1.2.114", "26.1.2", Ordering::Greater),
            ("47.4.0", "47.4", Ordering::Equal),
            ("47.4.0", "47.3.99", Ordering::Greater),
            ("21", "21.0.0.0", Ordering::Equal),
            ("21", "21.0.5", Ordering::Less),
            ("0.0.0", "0", Ordering::Equal),
        ];
        for (left, right, expected) in cases {
            assert_eq!(compare(left, right), expected, "{left} gegen {right}");
        }
    }

    #[test]
    fn suffixes_after_the_digits_are_ignored_on_purpose() {
        let cases = [
            ("21.0.0-beta", "21.0.0", Ordering::Equal),
            ("21.1.172-beta", "21.1.172", Ordering::Equal),
            ("26.1.0.0-beta.2", "26.1", Ordering::Equal),
            ("0.16.14+build.3", "0.16.14", Ordering::Equal),
            ("21.1.172-beta", "21.1.173", Ordering::Less),
            (" 47.4.0 ", "47.4.0", Ordering::Equal),
        ];
        for (left, right, expected) in cases {
            assert_eq!(compare(left, right), expected, "{left} gegen {right}");
        }
    }

    #[test]
    fn text_without_a_leading_number_is_not_a_version() {
        for text in [
            "",
            " ",
            "beta",
            "-1",
            ".5",
            "v1.2",
            "99999999999999999999999.1",
        ] {
            assert_eq!(LoaderVersion::parse(text), None, "{text:?}");
        }
    }

    #[test]
    fn release_ids_are_two_or_three_plain_numbers() {
        for id in ["1.20", "1.21.1", "1.20.6", "26.1", "26.1.2", "26.3", "1.0"] {
            assert!(is_release_id(id), "{id}");
        }
    }

    #[test]
    fn snapshots_pre_releases_ranges_and_junk_are_no_release_ids() {
        let cases = [
            "",
            "1",
            "1.21.1.1",
            "24w14a",
            "1.21-pre1",
            "1.21.1-rc1",
            "26.1-snapshot-1",
            "26.1-pre-1",
            "1.21-1.21.1",
            "~1.21",
            ">=1.21",
            "1.21.x",
            "1.*",
            "1.RV-Pre1",
            "3D Shareware v1.34",
            "1..21",
            ".1.21",
            "1.21.",
            "1.021",
            "1.21.01",
            "1.21.12345",
            " 1.21",
            "1.21 ",
            "١.٢١",
        ];
        for id in cases {
            assert!(!is_release_id(id), "{id:?}");
        }
    }
}
