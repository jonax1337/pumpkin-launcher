//! Einfache Auswertung eines Absturzberichts: Welche Mods kommen als Ursache in Frage? Zwei Quellen, in dieser
//! Reihenfolge: der Abschnitt „Suspected Mods“ (Forge, NeoForge) und die Pakete im Stacktrace der Ausnahme, die auf die
//! installierten Mods abgebildet werden. Das ist ein Hinweis, kein Urteil.
use std::fs;
use std::io::Read;
use std::path::Path;

use crate::models::{Mod, ModKind};
use crate::services::limits::MIB;

/// So viele Verdächtige nennt die Oberfläche höchstens.
const MAX_SUSPECTS: usize = 3;
/// Berichte sind klein; was größer ist, ist kein Minecraft-Bericht.
const MAX_REPORT_BYTES: u64 = 2 * MIB;
/// Ab hier folgen die Details zum Zustand des Spiels, nicht mehr der Stacktrace der Ausnahme.
const DETAILS_START: &str = "A detailed walkthrough";
/// Obere Paketsegmente, die kein Mod benennen (`com.example.mod…`).
const GENERIC_SEGMENTS: [&str; 8] = ["com", "org", "net", "io", "me", "dev", "de", "xyz"];
/// Klassen des Spiels, der Loader und der Java-Laufzeit: sie sind nie der Mod, der den Absturz verursacht hat.
const PLATFORM_PREFIXES: [&str; 24] = [
    "java.", "javax.", "jdk.", "sun.", "com.sun.", "net.minecraft.", "com.mojang.", "net.fabricmc.", "org.quiltmc.",
    "net.minecraftforge.", "net.neoforged.", "cpw.", "org.spongepowered.", "org.lwjgl.", "io.netty.", "it.unimi.",
    "org.apache.", "com.google.", "org.slf4j.", "org.objectweb.", "org.joml.", "com.electronwill.", "oshi.", "org.jetbrains.",
];
/// Kürzeste Kennung, die ein Paketsegment mit einem Mod gleichsetzt (sonst träfe `ae` jedes zweite Paket).
const MIN_KEY_LEN: usize = 3;

/// Verdächtige Mods im Bericht unter `path`; ein nicht lesbarer Bericht ergibt keine.
pub fn suspects_in_file(path: &Path, mods: &[Mod]) -> Vec<String> {
    match read_capped(path) {
        Ok(report) => suspects(&report, mods),
        Err(err) => {
            tracing::warn!(path = %path.display(), %err, "Absturzbericht nicht lesbar");
            Vec::new()
        }
    }
}

fn read_capped(path: &Path) -> std::io::Result<String> {
    let mut bytes = Vec::new();
    fs::File::open(path)?.take(MAX_REPORT_BYTES).read_to_end(&mut bytes)?;
    Ok(String::from_utf8_lossy(&bytes).into_owned())
}

/// Anzeigenamen der verdächtigen Mods, wahrscheinlichster zuerst, ohne Doppelte.
pub fn suspects(report: &str, mods: &[Mod]) -> Vec<String> {
    let mut found: Vec<String> = Vec::new();
    for name in suspected_section(report).into_iter().chain(mods_in_stacktrace(report, mods)) {
        if !found.iter().any(|known| known.eq_ignore_ascii_case(&name)) {
            found.push(name);
        }
    }
    found.truncate(MAX_SUSPECTS);
    found
}

fn indent(line: &str) -> usize {
    line.len() - line.trim_start().len()
}

/// Einträge unter `Suspected Mods:`; ohne Eintrag (oder „None“) keine.
fn suspected_section(report: &str) -> Vec<String> {
    let mut lines = report.lines();
    let Some(header) = lines.find(|line| line.trim_start().starts_with("Suspected Mods:")) else { return Vec::new() };
    let inline = header.trim_start().trim_start_matches("Suspected Mods:");
    let nested: Vec<&str> = lines.take_while(|line| !line.trim().is_empty() && indent(line) > indent(header)).collect();
    // Tiefer eingerückte Zeilen gehören zum Eintrag davor (Issue-Tracker u. Ä.), nicht zur Liste.
    let entry_indent = nested.first().map(|line| indent(line));
    let entries = nested.into_iter().filter(|line| Some(indent(line)) == entry_indent);
    std::iter::once(inline).chain(entries).filter_map(suspect_name).collect()
}

/// „Create (create), Version: 0.5.1“ → „Create“; „None“ und Leeres sind kein Eintrag.
fn suspect_name(entry: &str) -> Option<String> {
    let entry = entry.split(", Version").next().unwrap_or_default().trim();
    let name = entry.rsplit_once(" (").filter(|_| entry.ends_with(')')).map_or(entry, |(name, _)| name).trim();
    (!name.is_empty() && !name.eq_ignore_ascii_case("none")).then(|| name.to_owned())
}

/// Mods, deren Kennung oder Name in den Paketen der Stacktrace-Zeilen vor den Details vorkommt, in der Reihenfolge
/// des ersten Auftretens.
fn mods_in_stacktrace(report: &str, mods: &[Mod]) -> Vec<String> {
    let installed: Vec<&Mod> = mods.iter().filter(|m| m.kind == ModKind::Mod && m.enabled).collect();
    let trace = report.split(DETAILS_START).next().unwrap_or_default();
    let mut found: Vec<String> = Vec::new();
    for frame in trace.lines().filter_map(|line| line.trim().strip_prefix("at ")) {
        let Some(class) = frame_class(frame) else { continue };
        if PLATFORM_PREFIXES.iter().any(|prefix| class.starts_with(prefix)) {
            continue;
        }
        let keys = frame_keys(frame, class);
        let owner = installed.iter().find(|m| [&m.id, &m.name].iter().any(|own| keys.contains(&normalized(own))));
        if let Some(owner) = owner.filter(|m| !found.contains(&m.name)) {
            found.push(owner.name.clone());
        }
    }
    found
}

/// Klasse einer Stacktrace-Zeile `[Modul/…/]pkg.Klasse.methode(Datei.java:1)`, ohne Methode; Forge stellt dem
/// Klassennamen `TRANSFORMER/<modid>@<version>/` voran.
fn frame_class(frame: &str) -> Option<&str> {
    let call = frame.split('(').next()?;
    let qualified = call.rsplit('/').next()?;
    qualified.rsplit_once('.').map(|(class, _method)| class)
}

/// Kennungen, unter denen eine Zeile einen Mod nennt: das Forge-Modul `<modid>@…` und die Paketsegmente der Klasse.
fn frame_keys(frame: &str, class: &str) -> Vec<String> {
    let module = frame.split('(').next().unwrap_or_default().split('/').filter_map(|part| part.split_once('@')).map(|(id, _)| id);
    let packages = class.split('.').filter(|segment| !GENERIC_SEGMENTS.contains(segment));
    module.chain(packages).map(normalized).filter(|key| key.len() >= MIN_KEY_LEN).collect()
}

/// Kleinbuchstaben und Ziffern: „Fabric API“, „fabric-api“ und „fabric_api“ sind dieselbe Kennung.
fn normalized(text: &str) -> String {
    text.chars().filter(char::is_ascii_alphanumeric).map(|c| c.to_ascii_lowercase()).collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::ModSource;

    fn installed(id: &str, name: &str) -> Mod {
        Mod {
            id: id.into(),
            name: name.into(),
            version: "1".into(),
            source: ModSource::Local,
            file_name: format!("{id}.jar"),
            sha1: None,
            enabled: true,
            kind: ModKind::Mod,
            required_by: Vec::new(),
            pinned: false,
            pack_managed: false,
        }
    }

    const FABRIC_REPORT: &str = "---- Minecraft Crash Report ----\n\
        // Don't be sad, have a hug! <3\n\n\
        Time: 2026-09-30 18:02:11\n\
        Description: Rendering screen\n\n\
        java.lang.NullPointerException: Cannot invoke \"Object.hashCode()\" because \"key\" is null\n\
        \tat me.jellysquid.mods.sodium.client.render.chunk.RenderSection.getData(RenderSection.java:88)\n\
        \tat net.minecraft.class_761.method_3273(class_761.java:1234)\n\
        \tat java.base/java.lang.Thread.run(Thread.java:1583)\n\n\
        A detailed walkthrough of the error, its code path and all known details is as follows:\n\
        ---------------------------------------------------------------------------------------\n\n\
        -- Head --\n\
        Thread: Render thread\n\
        \tat dev.lithium.ShouldNotBeListed.run(Foo.java:1)\n";

    #[test]
    fn stacktrace_packages_map_to_installed_mods() {
        let mods = [installed("lithium", "Lithium"), installed("sodium", "Sodium")];
        assert_eq!(suspects(FABRIC_REPORT, &mods), ["Sodium"]);
    }

    #[test]
    fn mods_that_are_off_or_not_installed_are_never_named() {
        let off = Mod { enabled: false, ..installed("sodium", "Sodium") };
        assert!(suspects(FABRIC_REPORT, &[off]).is_empty());
        assert!(suspects(FABRIC_REPORT, &[installed("iris", "Iris")]).is_empty());
    }

    const FORGE_REPORT: &str = "---- Minecraft Crash Report ----\n\n\
        Description: Exception in server tick loop\n\n\
        java.lang.IllegalStateException: Boom\n\
        \tat TRANSFORMER/create@0.5.1.f/com.simibubi.create.content.kinetics.Foo.tick(Foo.java:42)\n\
        \tat TRANSFORMER/minecraft@1.20.1/net.minecraft.server.MinecraftServer.tickServer(MinecraftServer.java:900)\n\n\
        A detailed walkthrough of the error, its code path and all known details is as follows:\n\n\
        -- System Details --\n\
        Details:\n\
        \tMinecraft Version: 1.20.1\n\
        \tSuspected Mods: \n\
        \t\tCreate (create), Version: 0.5.1.f\n\
        \t\t\tIssue tracker URL: https://github.com/Creators-of-Create/Create/issues\n\
        \t\tFlywheel (flywheel), Version: 0.6.10\n\
        \tStacktrace:\n";

    #[test]
    fn the_suspected_section_comes_first_without_duplicates() {
        let mods = [installed("create", "Create"), installed("flywheel", "Flywheel")];
        assert_eq!(suspects(FORGE_REPORT, &mods), ["Create", "Flywheel"]);
    }

    #[test]
    fn forge_modules_name_their_mod_in_the_trace() {
        let trace_only = FORGE_REPORT.split("-- System Details --").next().unwrap();
        assert_eq!(suspects(trace_only, &[installed("create", "Create")]), ["Create"]);
    }

    #[test]
    fn a_vanilla_crash_has_no_suspects() {
        let report = "Description: Ticking entity\n\njava.lang.RuntimeException\n\tat net.minecraft.world.entity.Entity.tick(Entity.java:1)\n\
                      \nA detailed walkthrough\n\tSuspected Mods: NONE\n";
        assert!(suspects(report, &[installed("sodium", "Sodium")]).is_empty());
        assert!(suspected_section("\tSuspected Mods: None\n").is_empty());
    }

    #[test]
    fn at_most_three_suspects_are_named() {
        let report = "\tSuspected Mods: \n\t\tA1 (a1)\n\t\tB2 (b2)\n\t\tC3 (c3)\n\t\tD4 (d4)\n";
        assert_eq!(suspects(report, &[]), ["A1", "B2", "C3"]);
    }

    #[test]
    fn names_ignore_case_spacing_and_dashes() {
        assert_eq!(normalized("Fabric API"), normalized("fabric-api"));
        assert_eq!(suspect_name("Create (create), Version: 0.5").as_deref(), Some("Create"));
        assert_eq!(suspect_name("  None "), None);
    }

    #[test]
    fn unreadable_reports_give_no_suspects() {
        assert!(suspects_in_file(Path::new("gibt-es-nicht.txt"), &[]).is_empty());
    }
}
