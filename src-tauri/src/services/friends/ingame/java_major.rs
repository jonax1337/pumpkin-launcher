//! Die Java-Hauptversion aus dem, was eine Java-Installation preisgibt (INGAME 3.4): die Datei `release` im
//! Java-Home oder die Ausgabe von `java -version`. Gestartet wird hier nichts; das tut der Aufrufer einmal je Pfad.

/// Hauptversion aus der Datei `release` einer Runtime (`JAVA_VERSION="21.0.2"`, bei Java 8 `"1.8.0_392"`).
pub fn from_release_file(text: &str) -> Option<u32> {
    let version = text.lines().find_map(|line| line.trim().strip_prefix("JAVA_VERSION="))?;
    from_version_string(version.trim().trim_matches('"'))
}

/// Hauptversion aus der Ausgabe von `java -version` (sie kommt auf stderr), etwa
/// `openjdk version "21.0.2" 2024-01-16`, `java version "1.8.0_392"` oder `openjdk version "25-ea"`.
/// Zeilen davor, wie `Picked up JAVA_TOOL_OPTIONS: ...`, werden übersprungen.
pub fn from_version_output(text: &str) -> Option<u32> {
    text.lines().find_map(quoted_version_of_line).and_then(from_version_string)
}

fn quoted_version_of_line(line: &str) -> Option<&str> {
    let after_keyword = line.split_once(" version \"")?.1;
    after_keyword.split_once('"').map(|(version, _)| version)
}

/// `1.8.0_392` ist Java 8, `21.0.2`, `17` und `25-ea` sind Java 21, 17 und 25.
fn from_version_string(version: &str) -> Option<u32> {
    let mut numbers = version.split(['.', '_', '-', '+']).map_while(|part| part.parse::<u32>().ok());
    match numbers.next()? {
        1 => numbers.next(),
        major => Some(major),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn release_files_give_the_major_version() {
        let cases = [
            ("JAVA_VERSION=\"21.0.2\"\nIMPLEMENTOR=\"Eclipse Adoptium\"\n", Some(21)),
            ("IMPLEMENTOR=\"Oracle\"\nJAVA_VERSION=\"17.0.20\"\r\nOS_NAME=\"Windows\"\r\n", Some(17)),
            ("JAVA_VERSION=\"1.8.0_392\"\n", Some(8)),
            ("JAVA_VERSION=\"25\"\n", Some(25)),
            ("JAVA_VERSION=\"25-ea\"\n", Some(25)),
            ("JAVA_VERSION=21.0.2\n", Some(21)),
            ("  JAVA_VERSION=\"11.0.3\"\n", Some(11)),
        ];
        for (text, expected) in cases {
            assert_eq!(from_release_file(text), expected, "{text:?}");
        }
    }

    #[test]
    fn release_files_without_a_usable_version_give_nothing() {
        for text in ["", "IMPLEMENTOR=\"x\"\n", "JAVA_VERSION=\"\"\n", "JAVA_VERSION=\"abc\"\n", "JAVA_VERSION=\"1\"\n", "JAVA_RUNTIME_VERSION=\"21.0.2+13\"\n"] {
            assert_eq!(from_release_file(text), None, "{text:?}");
        }
    }

    #[test]
    fn version_output_gives_the_major_version() {
        let cases = [
            ("openjdk version \"21.0.2\" 2024-01-16\nOpenJDK Runtime Environment Temurin-21.0.2+13 (build 21.0.2+13)\n", Some(21)),
            ("java version \"1.8.0_392\"\nJava(TM) SE Runtime Environment (build 1.8.0_392-b08)\n", Some(8)),
            ("openjdk version \"17\" 2021-09-14\n", Some(17)),
            ("openjdk version \"25-ea\" 2025-09-16\n", Some(25)),
            ("Picked up JAVA_TOOL_OPTIONS: -Dfile.encoding=UTF-8\nopenjdk version \"21.0.2\" 2024-01-16\n", Some(21)),
            ("openjdk version \"17.0.20\" 2026-04-21 LTS\r\n", Some(17)),
        ];
        for (text, expected) in cases {
            assert_eq!(from_version_output(text), expected, "{text:?}");
        }
    }

    #[test]
    fn version_output_that_is_not_java_gives_nothing() {
        for text in ["", "command not found: java\n", "version \"21\"\n", "openjdk version 21\n", "openjdk version \"\" 2024\n", "openjdk version \"21"] {
            assert_eq!(from_version_output(text), None, "{text:?}");
        }
    }
}
