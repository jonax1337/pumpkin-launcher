//! Regel „Mixin gescheitert“: Ein Mod konnte seinen Code nicht in Minecraft einhängen, meist weil er nicht zur Version
//! passt oder sich mit einem anderen beißt. Wer es war, verraten die Meldung (`Mixin apply for mod X failed`,
//! `from mod X`), die Mixin-Konfiguration (`x.mixins.json`) und die Verdächtigen aus dem Stacktrace.
use super::text::{contains_any, evidence_containing, word_after};
use super::{disable_actions, CrashContext, CrashDiagnosis, Severity};
use crate::services::crashreport;

const MARKERS: [&str; 4] = ["Mixin apply failed", "Mixin apply for mod", "InvalidMixinException", "MixinApplyError"];
/// So viele Meldungen werden nach Mods durchsucht; eine Mixin-Lawine nennt dieselben Mods immer wieder.
const MAX_SCANNED_LINES: usize = 40;

pub(super) fn diagnose(context: &CrashContext<'_>) -> Option<CrashDiagnosis> {
    if !contains_any(context.text, &MARKERS) {
        return None;
    }
    let keys = owner_keys(context);
    let owners = keys.iter().filter_map(|key| context.installed_mod(&[key.as_str()]));
    let evidence = evidence_containing(context.text, &MARKERS);
    Some(CrashDiagnosis::new("mixinFailure", Severity::Error, evidence).with_actions(disable_actions(owners)))
}

/// Kennungen und Namen der Mods, die als Verursacher in Frage kommen: erst die der Meldungen, dann die Verdächtigen.
fn owner_keys(context: &CrashContext<'_>) -> Vec<String> {
    let from_messages = context
        .text
        .lines()
        .filter(|line| contains_any(line, &MARKERS))
        .take(MAX_SCANNED_LINES)
        .flat_map(owners_in_line)
        .map(str::to_owned);
    let suspects = crashreport::suspects(context.text, &context.instance.mods);
    from_messages.chain(suspects).collect()
}

/// `Mixin apply for mod lithium failed lithium.mixins.json:… from mod lithium` nennt den Mod zweimal, einmal als Wort und
/// einmal als Name der Konfigurationsdatei.
fn owners_in_line(line: &str) -> Vec<&str> {
    let named = ["for mod ", "from mod "].into_iter().filter_map(|marker| word_after(line, marker));
    let configs = line.split(is_separator).filter_map(config_owner);
    named.chain(configs).collect()
}

fn is_separator(c: char) -> bool {
    c.is_whitespace() || matches!(c, ':' | ',' | ';' | '[' | ']' | '(' | ')' | '\'' | '"')
}

/// Der Mod hinter einer Mixin-Konfiguration: `lithium.mixins.json` und `mixins.lithium.core.json` → `lithium`.
fn config_owner(token: &str) -> Option<&str> {
    let stem = token.strip_suffix(".json")?;
    let owner = stem
        .strip_suffix(".mixins")
        .or_else(|| stem.strip_suffix(".mixin"))
        .or_else(|| stem.strip_prefix("mixins."))
        .or_else(|| stem.strip_prefix("mixin."))?;
    owner.split('.').next().filter(|owner| !owner.is_empty())
}

#[cfg(test)]
mod tests {
    use super::super::testing::*;
    use super::super::FixAction;
    use super::*;
    use crate::models::{Instance, Mod};

    const FABRIC_MIXIN_ERROR: &str = "[20:31:07] [main/ERROR] (FabricLoader/Mixin) Mixin apply for mod lithium failed lithium.mixins.json:gen.fast_hopper_access.HopperBlockEntityMixin from mod lithium -> net.minecraft.class_2614: org.spongepowered.asm.mixin.injection.throwables.InvalidInjectionException @Inject annotation on tick could not find any targets\n\
        [20:31:07] [main/ERROR] (FabricLoader/Mixin) Mixin apply for mod sodium failed sodium.mixins.json:core.MixinFoo from mod sodium -> net.minecraft.class_1\n";

    const FORGE_MIXIN_CRASH: &str = "---- Minecraft Crash Report ----\n\
        Description: Initializing game\n\n\
        org.spongepowered.asm.mixin.transformer.throwables.MixinTransformerError: An unexpected critical error was encountered\n\
        Caused by: org.spongepowered.asm.mixin.throwables.MixinApplyError: Mixin [mixins.create.json:MixinBar] from phase [DEFAULT] in config [mixins.create.json] FAILED during APPLY\n\
        Caused by: org.spongepowered.asm.mixin.throwables.InvalidMixinException: @Shadow field x was not located in the target class\n";

    fn run(text: &str, instance: &Instance) -> Option<CrashDiagnosis> {
        diagnose(&context(text, instance))
    }

    #[test]
    fn fabric_names_the_failing_mods_in_the_message() {
        let mods = vec![installed("lithium", "Lithium"), installed("sodium", "Sodium"), installed("iris", "Iris")];
        let found = run(FABRIC_MIXIN_ERROR, &instance(mods)).unwrap();
        assert_eq!(found.id, "mixinFailure");
        assert_eq!(found.actions, [disable("lithium"), disable("sodium")]);
        assert_eq!(found.evidence.len(), 2);
    }

    #[test]
    fn a_mixin_config_leads_to_its_mod() {
        let found = run(FORGE_MIXIN_CRASH, &instance(vec![installed("create", "Create")])).unwrap();
        assert_eq!(found.actions, [disable("create")]);
    }

    #[test]
    fn suspects_from_the_stacktrace_count_as_well() {
        let report = "org.spongepowered.asm.mixin.throwables.InvalidMixinException: boom\n\
                      \tat me.jellysquid.mods.sodium.mixin.Foo.apply(Foo.java:1)\n";
        let found = run(report, &instance(vec![installed("sodium", "Sodium")])).unwrap();
        assert_eq!(found.actions, [disable("sodium")]);
    }

    #[test]
    fn unknown_mods_still_give_a_finding_without_actions() {
        let found = run(FABRIC_MIXIN_ERROR, &instance(Vec::new())).unwrap();
        assert!(found.actions.is_empty());
    }

    #[test]
    fn mods_that_are_switched_off_are_not_offered() {
        let off = Mod { enabled: false, ..installed("lithium", "Lithium") };
        let found = run(FABRIC_MIXIN_ERROR, &instance(vec![off])).unwrap();
        assert!(!found.actions.contains(&FixAction::DisableMod { mod_id: "lithium".into() }));
    }

    #[test]
    fn config_names_are_read_in_both_spellings() {
        assert_eq!(config_owner("lithium.mixins.json"), Some("lithium"));
        assert_eq!(config_owner("mixins.create.core.json"), Some("create"));
        assert_eq!(config_owner("mixin.json"), None);
        assert_eq!(config_owner("data.json"), None);
        assert_eq!(config_owner("lithium.mixins.txt"), None);
    }

    #[test]
    fn other_crashes_are_not_a_mixin_failure() {
        assert!(run("java.lang.NullPointerException: x\n", &instance(Vec::new())).is_none());
    }
}
