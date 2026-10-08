//! Regel „Mod doppelt“: Derselbe Mod liegt in zwei Dateien im Ordner `mods`. Die Loader nennen die Dateien unter der
//! Meldung; was davon in der Instanz steht, lässt sich ausschalten (welche Fassung bleibt, entscheidet der Spieler).
use super::text::{block_after, contains_any, evidence_containing};
use super::{disable_actions, CrashContext, CrashDiagnosis, Severity};
use crate::models::{Mod, ModKind};

const MARKERS: [&str; 3] = ["Found duplicate mods", "DuplicateModsFoundException", "Duplicate mod"];
/// So viele Zeilen unter der Meldung werden nach Dateien durchsucht.
const DETAIL_LINES: usize = 10;

pub(super) fn diagnose(context: &CrashContext<'_>) -> Option<CrashDiagnosis> {
    if !contains_any(context.text, &MARKERS) {
        return None;
    }
    let files = jar_names(&block_after(context.text, &MARKERS, DETAIL_LINES));
    let copies = files.iter().filter_map(|file| installed_file(&context.instance.mods, file));
    let evidence = evidence_containing(context.text, &MARKERS);
    Some(CrashDiagnosis::new("duplicateMods", Severity::Error, evidence).with_actions(disable_actions(copies)))
}

/// Dateinamen der JARs, die in den Zeilen vorkommen (Pfade ohne Ordner), ohne Doppelte.
fn jar_names<'a>(lines: &[&'a str]) -> Vec<&'a str> {
    let mut names: Vec<&str> = Vec::new();
    for token in lines.iter().copied().flat_map(|line| line.split(is_separator)) {
        let name = token.rsplit(['/', '\\']).next().unwrap_or_default();
        if name.to_ascii_lowercase().ends_with(".jar") && !names.contains(&name) {
            names.push(name);
        }
    }
    names
}

fn is_separator(c: char) -> bool {
    c.is_whitespace() || matches!(c, ',' | ';' | '[' | ']' | '(' | ')' | '\'' | '"')
}

/// Der eingeschaltete Mod der Instanz, dessen Datei `file_name` heißt.
fn installed_file<'a>(mods: &'a [Mod], file_name: &str) -> Option<&'a Mod> {
    mods.iter().find(|m| m.kind == ModKind::Mod && m.enabled && m.file_name.eq_ignore_ascii_case(file_name))
}

#[cfg(test)]
mod tests {
    use super::super::testing::*;
    use super::*;
    use crate::models::Instance;

    const FABRIC_DUPLICATES: &str = "[20:40:11] [main/ERROR] (FabricLoader) Found duplicate mods:\n\
        \t- Mod ID 'sodium' is present in: C:\\Users\\Steve\\mods\\sodium-fabric-0.5.3.jar, C:\\Users\\Steve\\mods\\sodium-fabric-0.5.8.jar\n\
        net.fabricmc.loader.impl.discovery.ModResolutionException: Duplicate mod: sodium\n";

    fn named(file_name: &str) -> Mod {
        Mod { file_name: file_name.into(), ..installed(file_name, "Sodium") }
    }

    fn run(text: &str, instance: &Instance) -> Option<CrashDiagnosis> {
        diagnose(&context(text, instance))
    }

    #[test]
    fn each_installed_copy_can_be_switched_off() {
        let mods = vec![named("sodium-fabric-0.5.3.jar"), named("sodium-fabric-0.5.8.jar"), named("lithium.jar")];
        let found = run(FABRIC_DUPLICATES, &instance(mods)).unwrap();
        assert_eq!(found.id, "duplicateMods");
        assert_eq!(found.actions, [disable("sodium-fabric-0.5.3.jar"), disable("sodium-fabric-0.5.8.jar")]);
    }

    #[test]
    fn the_duplicate_message_is_quoted() {
        let found = run(FABRIC_DUPLICATES, &instance(Vec::new())).unwrap();
        assert!(found.evidence[0].starts_with("[20:40:11] [main/ERROR] (FabricLoader) Found duplicate mods"));
        assert!(found.actions.is_empty());
    }

    #[test]
    fn file_names_are_found_with_either_path_separator() {
        let lines = ["see /home/steve/mods/a.jar; (b.JAR) 'c.jar'", "a.jar twice"];
        assert_eq!(jar_names(&lines), ["a.jar", "b.JAR", "c.jar"]);
    }

    #[test]
    fn copies_that_are_switched_off_are_not_offered() {
        let off = Mod { enabled: false, ..named("sodium-fabric-0.5.3.jar") };
        let found = run(FABRIC_DUPLICATES, &instance(vec![off])).unwrap();
        assert!(found.actions.is_empty());
    }

    #[test]
    fn the_forge_exception_name_is_enough() {
        let crash = "net.minecraftforge.fml.loading.moddiscovery.DuplicateModsFoundException: Duplicate mods found\n";
        assert_eq!(run(crash, &instance(Vec::new())).unwrap().id, "duplicateMods");
        assert!(run("Everything is fine\n", &instance(Vec::new())).is_none());
    }
}
