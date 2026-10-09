//! Regel „Spieldateien beschädigt“: Eine JAR des Spiels oder seiner Bibliotheken lässt sich nicht lesen (abgebrochener
//! Download, Festplattenfehler, Virenscanner) oder fehlt. „Reparieren“ lädt sie neu; Welten und Mods bleiben.
//! Dieselben Fehler an Mods, Ressourcenpaketen oder Welten betreffen nicht das Spiel und zählen nicht.
use super::text::{contains_any, evidence_where};
use super::{CrashContext, CrashDiagnosis, FixAction, Severity};

/// Meldungen für eine kaputte ZIP-/JAR-Datei.
const CORRUPT_MARKERS: [&str; 3] = ["ZipException", "invalid LOC header", "Missing or invalid sha1"];
const MISSING_FILE_MARKER: &str = "NoSuchFileException";
/// Ordner des Spiels, in denen eine fehlende Datei auf eine kaputte Installation hindeutet.
const GAME_FOLDERS: [&str; 2] = ["libraries", "versions"];
/// Ordner mit Inhalten des Spielers: Dort ist eine kaputte Datei Sache des Inhalts.
const CONTENT_FOLDERS: [&str; 8] =
    ["mods/", "mods\\", "resourcepacks/", "resourcepacks\\", "shaderpacks/", "shaderpacks\\", "saves/", "saves\\"];

pub(super) fn diagnose(context: &CrashContext<'_>) -> Option<CrashDiagnosis> {
    let evidence = evidence_where(context.text, is_game_file_line);
    if evidence.is_empty() {
        return None;
    }
    Some(CrashDiagnosis::new("gameFiles", Severity::Error, evidence).with_actions([FixAction::ReinstallGameFiles]))
}

fn is_game_file_line(line: &str) -> bool {
    let corrupt = contains_any(line, &CORRUPT_MARKERS) && !contains_any(line, &CONTENT_FOLDERS);
    let missing = line.contains(MISSING_FILE_MARKER) && contains_any(line, &GAME_FOLDERS);
    corrupt || missing
}

#[cfg(test)]
mod tests {
    use super::super::testing::*;
    use super::*;

    fn run(text: &str) -> Option<CrashDiagnosis> {
        let instance = instance(Vec::new());
        diagnose(&context(text, &instance))
    }

    #[test]
    fn a_broken_library_archive_suggests_repairing() {
        let log = "Error: Unable to initialize main class net.minecraft.client.main.Main\n\
                   Caused by: java.util.zip.ZipException: invalid LOC header (bad signature)\n\
                   \tat java.base/java.util.zip.ZipFile$Source.zerror(ZipFile.java:1)\n";
        let found = run(log).unwrap();
        assert_eq!(found.id, "gameFiles");
        assert_eq!(found.actions, [FixAction::ReinstallGameFiles]);
        assert_eq!(found.evidence, ["Caused by: java.util.zip.ZipException: invalid LOC header (bad signature)"]);
    }

    #[test]
    fn a_missing_file_counts_only_in_the_game_folders() {
        let missing = "Exception in thread \"main\" java.nio.file.NoSuchFileException: C:\\Users\\Steve\\AppData\\Roaming\\Pumpkin Launcher\\libraries\\org\\lwjgl\\lwjgl\\3.3.3\\lwjgl-3.3.3.jar\n";
        assert!(run(missing).is_some());
        let version = "java.nio.file.NoSuchFileException: /home/steve/.local/share/pumpkin/versions/1.21.1/1.21.1.jar\n";
        assert!(run(version).is_some());
        let options = "java.nio.file.NoSuchFileException: /home/steve/instances/a/minecraft/options.txt\n";
        assert!(run(options).is_none());
    }

    #[test]
    fn a_checksum_message_counts() {
        assert!(run("Missing or invalid sha1 for libraries/org/ow2/asm/asm/9.7/asm-9.7.jar\n").is_some());
    }

    #[test]
    fn broken_content_of_the_player_is_not_a_game_file() {
        let mod_jar = "java.util.zip.ZipException: zip file is empty (mods/broken.jar)\n";
        let pack = "[12:00:01] [Worker-Main-1/WARN]: Failed to read resourcepacks\\old.zip: java.util.zip.ZipException: zip END header not found\n";
        assert!(run(mod_jar).is_none());
        assert!(run(pack).is_none());
    }
}
