//! Regel „Fehlende Abhängigkeit“: Ein Mod braucht einen anderen, der fehlt oder in der falschen Version vorliegt. Die
//! Loader sagen das in eigenen Worten: Fabric und Quilt in `Mod 'X' (id) … requires … of Y, which is missing!`, Forge und
//! NeoForge unter „Missing or unsupported mandatory dependencies“ in `Mod ID: 'Y', Requested by: 'X', …`. Vorgeschlagen
//! wird, die Abhängigkeit zu suchen, und den fordernden Mod auszuschalten, wenn er in der Instanz liegt.
use super::text::{evidence_where, is_mod_id_char, quoted_after};
use super::{disable_actions, CrashContext, CrashDiagnosis, FixAction, Severity};
use crate::services::crashreport::normalized;

/// Mehr Abhängigkeiten nennt der Befund nicht; große Pakete scheitern ohnehin an einer nach der anderen.
const MAX_REQUIREMENTS: usize = 6;
/// Fabric und Quilt: so endet eine Zeile, die eine fehlende oder falsche Version meldet.
const FABRIC_ENDINGS: [&str; 2] = ["which is missing", "wrong version is present"];
/// Was kein Mod ist, sondern Spiel, Java oder Loader (in der Schreibweise von `normalized`); das lädt man nicht herunter.
const PLATFORM_IDS: [&str; 6] = ["minecraft", "java", "forge", "neoforge", "fabricloader", "quiltloader"];

/// Eine Zeile des Berichts, die sagt: Der Mod `requester` braucht `dependency`. `requester` sind seine Kennungen
/// (Kennung und Name, falls bekannt), unter denen er sich in der Instanz wiederfinden lässt.
#[derive(Debug)]
struct Requirement<'a> {
    dependency: &'a str,
    requester: Vec<&'a str>,
    line: &'a str,
}

pub(super) fn diagnose(context: &CrashContext<'_>) -> Option<CrashDiagnosis> {
    let requirements = requirements_in(context.text);
    if requirements.is_empty() {
        return None;
    }
    let dependencies = distinct_dependencies(&requirements);
    let requesters = requirements.iter().filter_map(|r| context.installed_mod(&r.requester));
    let evidence = evidence_where(context.text, |line| requirements.iter().any(|r| r.line == line));
    let searches = dependencies.iter().map(|dependency| FixAction::InstallDependency { project_query: (*dependency).to_owned() });
    Some(
        CrashDiagnosis::new("missingDependency", Severity::Error, evidence)
            .with_param("dependencies", dependencies.join(", "))
            .with_actions(searches)
            .with_actions(disable_actions(requesters)),
    )
}

/// Die Anforderungen im Text, ohne Doppelte und ohne Spiel, Java und Loader.
fn requirements_in(text: &str) -> Vec<Requirement<'_>> {
    let mut found: Vec<Requirement<'_>> = Vec::new();
    let lines = text.lines().map(str::trim).filter_map(requirement_in).filter(|r| !is_platform(r.dependency));
    for requirement in lines {
        let known = found.iter().any(|f| f.dependency == requirement.dependency && f.requester == requirement.requester);
        if !known {
            found.push(requirement);
        }
        if found.len() == MAX_REQUIREMENTS {
            break;
        }
    }
    found
}

fn requirement_in(line: &str) -> Option<Requirement<'_>> {
    fabric_requirement(line).or_else(|| forge_requirement(line))
}

/// `Mod 'Sodium Extra' (sodium-extra) 0.5.4 requires any version of sodium, which is missing!`
fn fabric_requirement(line: &str) -> Option<Requirement<'_>> {
    if !FABRIC_ENDINGS.iter().any(|ending| line.contains(ending)) {
        return None;
    }
    let after_mod = line.split_once("Mod ")?.1.trim_start_matches('\'');
    let (name, rest) = after_mod.split_once(" (")?;
    let (id, rest) = rest.split_once(')')?;
    let (_, wanted) = rest.split_once(" requires ")?;
    let (_, dependency) = wanted.split_once(" of ")?;
    let dependency = dependency.trim_start_matches("mod ").trim_start_matches('\'');
    let dependency = dependency.split(|c: char| !is_mod_id_char(c)).next().filter(|dependency| !dependency.is_empty())?;
    Some(Requirement { dependency, requester: vec![id, name.trim_end_matches('\'')], line })
}

/// `Mod ID: 'flywheel', Requested by: 'create', Expected range: '[0.6.10,0.7)', Actual version: '[MISSING]'`
fn forge_requirement(line: &str) -> Option<Requirement<'_>> {
    let dependency = quoted_after(line, "Mod ID: '")?;
    let requester = quoted_after(line, "Requested by: '")?;
    Some(Requirement { dependency, requester: vec![requester], line })
}

fn is_platform(dependency: &str) -> bool {
    PLATFORM_IDS.contains(&normalized(dependency).as_str())
}

/// Jede Abhängigkeit einmal, in der Reihenfolge des ersten Auftretens.
fn distinct_dependencies<'a>(requirements: &[Requirement<'a>]) -> Vec<&'a str> {
    let mut dependencies: Vec<&str> = Vec::new();
    for requirement in requirements {
        if !dependencies.iter().any(|known| known.eq_ignore_ascii_case(requirement.dependency)) {
            dependencies.push(requirement.dependency);
        }
    }
    dependencies
}

#[cfg(test)]
mod tests {
    use super::super::testing::*;
    use super::*;
    use crate::models::{Instance, Mod};

    const FABRIC_MISSING: &str = "[20:15:42] [main/ERROR] (FabricLoader) Incompatible mods found!\n\
        net.fabricmc.loader.impl.FormattedException: Some of your mods are incompatible with the game or each other!\n\
        A potential solution has been determined, this may resolve your problem:\n\
        \t - Install sodium, version 0.5.0 or later.\n\
        More details:\n\
        \t - Mod 'Sodium Extra' (sodium-extra) 0.5.4+mc1.20.1 requires any version of sodium, which is missing!\n\
        \t - Mod 'Iris Shaders' (iris) 1.6.4 requires version 0.5.0 or later of sodium, which is missing!\n\
        \t - Mod 'Cloth Config' (cloth-config) 11.1.0 requires version 0.90.0 or later of fabric-api, but only the wrong version is present: 0.88.0!\n\
        \t - Mod 'Dynamic FPS' (dynamic_fps) 3.0.0 requires version 0.15.0 or later of fabricloader, which is missing!\n";

    const FORGE_MISSING: &str = "net.minecraftforge.fml.ModLoadingException: Create (create) has failed to load correctly\n\
        Missing or unsupported mandatory dependencies:\n\
        \tMod ID: 'flywheel', Requested by: 'create', Expected range: '[0.6.10,0.7)', Actual version: '[MISSING]'\n\
        \tMod ID: 'forge', Requested by: 'create', Expected range: '[47.1.0,)', Actual version: '47.0.1'\n";

    fn run(text: &str, instance: &Instance) -> Option<CrashDiagnosis> {
        diagnose(&context(text, instance))
    }

    fn installs(found: &CrashDiagnosis) -> Vec<&str> {
        found.actions.iter().filter_map(|a| match a {
            FixAction::InstallDependency { project_query } => Some(project_query.as_str()),
            _ => None,
        }).collect()
    }

    #[test]
    fn fabric_names_each_missing_mod_once() {
        let found = run(FABRIC_MISSING, &instance(Vec::new())).unwrap();
        assert_eq!(found.id, "missingDependency");
        assert_eq!(installs(&found), ["sodium", "fabric-api"]);
        assert_eq!(found.params["dependencies"], "sodium, fabric-api");
    }

    #[test]
    fn the_loader_itself_is_not_offered_as_a_download() {
        let only_loader = "Mod 'Dynamic FPS' (dynamic_fps) 3.0.0 requires version 0.15.0 or later of fabricloader, which is missing!\n";
        assert!(run(only_loader, &instance(Vec::new())).is_none());
    }

    #[test]
    fn the_requiring_mod_can_be_switched_off_when_it_is_installed() {
        let mods = vec![installed("PtjYWJkn", "Sodium Extra"), installed("iris", "Iris Shaders")];
        let found = run(FABRIC_MISSING, &instance(mods)).unwrap();
        assert_eq!(found.actions[2..], [disable("PtjYWJkn"), disable("iris")]);
    }

    #[test]
    fn evidence_quotes_the_requirement_lines() {
        let found = run(FABRIC_MISSING, &instance(Vec::new())).unwrap();
        assert_eq!(found.evidence.len(), 3);
        assert!(found.evidence[0].starts_with("- Mod 'Sodium Extra' (sodium-extra)"));
    }

    #[test]
    fn forge_reads_the_dependency_and_the_requesting_mod() {
        let found = run(FORGE_MISSING, &instance(vec![installed("create", "Create")])).unwrap();
        assert_eq!(installs(&found), ["flywheel"]);
        assert_eq!(found.actions[1..], [disable("create")]);
    }

    #[test]
    fn mods_that_are_switched_off_are_not_offered() {
        let off = Mod { enabled: false, ..installed("create", "Create") };
        let found = run(FORGE_MISSING, &instance(vec![off])).unwrap();
        assert_eq!(found.actions.len(), 1);
    }

    #[test]
    fn crashes_without_requirements_are_not_a_missing_dependency() {
        let headline = "Incompatible mods found!\n\tMod 'X' (x) conflicts with version 2 of y\n";
        assert!(run(headline, &instance(Vec::new())).is_none());
        assert!(run("Mod ID: 'a'\n", &instance(Vec::new())).is_none());
    }

    #[test]
    fn a_huge_list_stays_bounded() {
        let line = "Mod 'M' (m) 1 requires any version of dep-{n}, which is missing!\n";
        let text: String = (0..500).map(|n| line.replace("{n}", &n.to_string())).collect();
        let found = run(&text, &instance(Vec::new())).unwrap();
        assert_eq!(installs(&found).len(), MAX_REQUIREMENTS);
    }
}
