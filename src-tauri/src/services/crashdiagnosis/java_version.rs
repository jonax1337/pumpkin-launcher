//! Regel „Falsche Java-Version“: Klassen wurden für ein neueres Java gebaut als das, das lief. Die Fehlermeldung nennt die
//! Version der Klassendatei; die Tabelle übersetzt sie in die Java-Hauptversion. Ein eigener Java-Pfad der Instanz lässt
//! sich löschen, dann gilt wieder die passende mitgelieferte Runtime.
use super::text::{contains_any, evidence_containing};
use super::{CrashContext, CrashDiagnosis, FixAction, Severity};

const MARKERS: [&str; 2] =
    ["UnsupportedClassVersionError", "has been compiled by a more recent version of the Java Runtime"];
/// Wie die Meldungen die Version der Klassendatei einleiten (neuere Java-Versionen, ältere Schreibweise).
const CLASS_VERSION_PREFIXES: [&str; 2] = ["class file version ", "Unsupported major.minor version "];

/// Version der Klassendatei → Java-Hauptversion.
const CLASS_VERSION_TO_JAVA: &[(u32, u32)] = &[
    (52, 8),
    (53, 9),
    (54, 10),
    (55, 11),
    (56, 12),
    (57, 13),
    (58, 14),
    (59, 15),
    (60, 16),
    (61, 17),
    (62, 18),
    (63, 19),
    (64, 20),
    (65, 21),
    (66, 22),
    (67, 23),
    (68, 24),
    (69, 25),
];

pub(super) fn diagnose(context: &CrashContext<'_>) -> Option<CrashDiagnosis> {
    let line = context.text.lines().find(|line| contains_any(line, &MARKERS))?;
    let mut evidence = evidence_containing(context.text, &MARKERS);
    let class_version = CLASS_VERSION_PREFIXES.iter().find_map(|prefix| number_after(line, prefix));
    let diagnosis = match class_version.and_then(|version| java_major(version).map(|java| (version, java))) {
        Some((version, java)) => {
            evidence.push(format!("class file version {version} → Java {java}"));
            CrashDiagnosis::new("javaVersion", Severity::Error, evidence).with_param("javaMajor", java)
        }
        None => CrashDiagnosis::new("javaVersionUnknown", Severity::Error, evidence),
    };
    Some(diagnosis.with_actions(use_managed_java(context)))
}

/// „Java 21“ für die Version 65 der Klassendatei; unbekannte Versionen nicht.
fn java_major(class_version: u32) -> Option<u32> {
    CLASS_VERSION_TO_JAVA.iter().find(|(version, _)| *version == class_version).map(|(_, java)| *java)
}

/// Die Zahl hinter `prefix`: „class file version 65.0“ → 65.
fn number_after(line: &str, prefix: &str) -> Option<u32> {
    let digits: String = line.split_once(prefix)?.1.chars().take_while(char::is_ascii_digit).collect();
    digits.parse().ok()
}

/// Nur wer einen eigenen Java-Pfad eingestellt hat, kann ihn löschen.
fn use_managed_java(context: &CrashContext<'_>) -> Option<FixAction> {
    let custom = context.instance.java_path.as_deref().is_some_and(|path| !path.trim().is_empty());
    custom.then_some(FixAction::UseManagedJava)
}

#[cfg(test)]
mod tests {
    use super::super::testing::*;
    use super::*;
    use crate::models::Instance;

    const MOJANG_LAUNCH_ERROR: &str = "Error: LinkageError occurred while loading main class net.minecraft.client.main.Main\n\
        java.lang.UnsupportedClassVersionError: net/minecraft/client/main/Main has been compiled by a more recent version of the Java Runtime (class file version 65.0), this version of the Java Runtime only recognizes class file versions up to 61.0\n";

    fn with_java(path: Option<&str>) -> Instance {
        Instance { java_path: path.map(Into::into), ..instance(Vec::new()) }
    }

    fn run(text: &str, instance: &Instance) -> Option<CrashDiagnosis> {
        diagnose(&context(text, instance))
    }

    #[test]
    fn the_required_class_version_becomes_a_java_version() {
        let found = run(MOJANG_LAUNCH_ERROR, &with_java(None)).unwrap();
        assert_eq!(found.id, "javaVersion");
        assert_eq!(found.params["javaMajor"], "21");
        assert_eq!(found.evidence.last().map(String::as_str), Some("class file version 65 → Java 21"));
        assert!(found.evidence[0].starts_with("java.lang.UnsupportedClassVersionError"));
    }

    #[test]
    fn a_custom_java_can_be_dropped() {
        let found = run(MOJANG_LAUNCH_ERROR, &with_java(Some("C:/Java/jdk-17/bin/javaw.exe"))).unwrap();
        assert_eq!(found.actions, [FixAction::UseManagedJava]);
    }

    #[test]
    fn without_a_custom_java_the_cause_is_only_explained() {
        assert!(run(MOJANG_LAUNCH_ERROR, &with_java(None)).unwrap().actions.is_empty());
        assert!(run(MOJANG_LAUNCH_ERROR, &with_java(Some("  "))).unwrap().actions.is_empty());
    }

    #[test]
    fn the_table_maps_the_known_class_versions() {
        let known = [(52, 8), (55, 11), (61, 17), (65, 21), (69, 25)];
        for (class_version, java) in known {
            assert_eq!(java_major(class_version), Some(java), "Klassenversion {class_version}");
        }
        assert_eq!(java_major(51), None);
        assert_eq!(java_major(70), None);
    }

    #[test]
    fn the_old_wording_names_its_version_too() {
        let log = "Exception in thread \"main\" java.lang.UnsupportedClassVersionError: com/example/Mod : Unsupported major.minor version 52.0\n";
        let found = run(log, &with_java(None)).unwrap();
        assert_eq!(found.params["javaMajor"], "8");
    }

    #[test]
    fn an_unknown_class_version_is_reported_without_a_java_version() {
        let log = "java.lang.UnsupportedClassVersionError: a/B has been compiled by a more recent version of the Java Runtime (class file version 99.0)\n";
        let found = run(log, &with_java(Some("/usr/bin/java"))).unwrap();
        assert_eq!(found.id, "javaVersionUnknown");
        assert!(found.params.is_empty());
        assert_eq!(found.actions, [FixAction::UseManagedJava]);
    }

    #[test]
    fn other_errors_are_not_a_java_version_problem() {
        assert!(run("java.lang.NoSuchMethodError: foo\n", &with_java(None)).is_none());
    }
}
