//! Rückfallregel „Verdächtige Mods“: Wenn keine andere Regel greift, nennt der Befund die Mods, die der Absturzbericht
//! als Verursacher in Frage stellt (Abschnitt „Suspected Mods“ und Stacktrace, siehe `crashreport`), und lässt jeden
//! davon ausschalten.
use super::text::first_exception_line;
use super::{disable_actions, CrashContext, CrashDiagnosis, Severity};
use crate::services::crashreport;

pub(super) fn diagnose(context: &CrashContext<'_>) -> Option<CrashDiagnosis> {
    let names = crashreport::suspects(context.text, &context.instance.mods);
    if names.is_empty() {
        return None;
    }
    let installed = names.iter().filter_map(|name| context.installed_mod(&[name.as_str()]));
    let evidence = first_exception_line(context.text).into_iter().collect();
    Some(
        CrashDiagnosis::new("suspectMods", Severity::Warning, evidence)
            .with_param("mods", names.join(", "))
            .with_actions(disable_actions(installed)),
    )
}

#[cfg(test)]
mod tests {
    use super::super::testing::*;
    use super::*;
    use crate::models::Instance;

    const FABRIC_REPORT: &str = "---- Minecraft Crash Report ----\n\
        // Don't be sad, have a hug! <3\n\n\
        Time: 2026-09-30 18:02:11\n\
        Description: Rendering screen\n\n\
        java.lang.NullPointerException: Cannot invoke \"Object.hashCode()\" because \"key\" is null\n\
        \tat me.jellysquid.mods.sodium.client.render.chunk.RenderSection.getData(RenderSection.java:88)\n\
        \tat net.minecraft.class_761.method_3273(class_761.java:1234)\n\n\
        A detailed walkthrough of the error, its code path and all known details is as follows:\n";

    const FORGE_REPORT: &str = "---- Minecraft Crash Report ----\n\
        Description: Exception in server tick loop\n\n\
        java.lang.IllegalStateException: Boom\n\
        \tat TRANSFORMER/create@0.5.1.f/com.simibubi.create.content.kinetics.Foo.tick(Foo.java:42)\n\n\
        A detailed walkthrough of the error, its code path and all known details is as follows:\n\n\
        -- System Details --\n\
        Details:\n\
        \tSuspected Mods: \n\
        \t\tCreate (create), Version: 0.5.1.f\n\
        \t\tFlywheel (flywheel), Version: 0.6.10\n\
        \tStacktrace:\n";

    fn run(text: &str, instance: &Instance) -> Option<CrashDiagnosis> {
        diagnose(&context(text, instance))
    }

    #[test]
    fn a_suspect_in_the_stacktrace_can_be_switched_off() {
        let found = run(FABRIC_REPORT, &instance(vec![installed("PtjYWJkn", "Sodium")])).unwrap();
        assert_eq!(found.id, "suspectMods");
        assert_eq!(found.params["mods"], "Sodium");
        assert_eq!(found.actions, [disable("PtjYWJkn")]);
        assert_eq!(found.evidence, ["java.lang.NullPointerException: Cannot invoke \"Object.hashCode()\" because \"key\" is null"]);
    }

    #[test]
    fn every_installed_suspect_gets_its_own_action() {
        let mods = vec![installed("create", "Create"), installed("flywheel", "Flywheel")];
        let found = run(FORGE_REPORT, &instance(mods)).unwrap();
        assert_eq!(found.params["mods"], "Create, Flywheel");
        assert_eq!(found.actions, [disable("create"), disable("flywheel")]);
    }

    #[test]
    fn a_named_suspect_that_is_not_installed_is_still_mentioned() {
        let found = run(FORGE_REPORT, &instance(vec![installed("create", "Create")])).unwrap();
        assert_eq!(found.params["mods"], "Create, Flywheel");
        assert_eq!(found.actions, [disable("create")]);
    }

    #[test]
    fn a_crash_without_suspects_gives_nothing() {
        assert!(run("java.lang.RuntimeException\n\tat net.minecraft.Foo.bar(Foo.java:1)\n", &instance(Vec::new())).is_none());
    }
}
