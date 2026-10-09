//! Regel „Arbeitsspeicher zu knapp“: Der Java-Heap lief voll. Der Vorschlag verdoppelt den RAM der Instanz, höchstens bis
//! zu dem, was der PC hergibt (so wie der Regler in den Einstellungen); steht die Instanz schon dort, bleibt es bei der
//! Erklärung.
use super::text::{contains_any, evidence_containing};
use super::{CrashContext, CrashDiagnosis, FixAction, Severity};

const MARKERS: [&str; 2] = ["OutOfMemoryError: Java heap space", "GC overhead limit exceeded"];

// Die Grenzen spiegeln den Regler der Einstellungen (`MEMORY_*` in src/lib/format.ts).
/// Schrittweite, auf die Vorschlag und Obergrenze gerundet werden.
const STEP_MB: u32 = 512;
/// Untergrenze der Obergrenze: auch auf kleinen PCs bleibt der Regler nutzbar.
const MIN_LIMIT_MB: u32 = 2048;
/// So viel bleibt dem System und anderen Programmen.
const SYSTEM_RESERVE_MB: u64 = 2048;
/// Obergrenze, solange der Arbeitsspeicher des PCs unbekannt ist.
const UNKNOWN_SYSTEM_LIMIT_MB: u32 = 16384;

pub(super) fn diagnose(context: &CrashContext<'_>) -> Option<CrashDiagnosis> {
    if !contains_any(context.text, &MARKERS) {
        return None;
    }
    let evidence = evidence_containing(context.text, &MARKERS);
    let current = context.current_memory_mb();
    let limit = memory_limit_mb(context.machine.total_memory_mb);
    Some(match suggested_mb(current, limit) {
        Some(suggested) => CrashDiagnosis::new("outOfMemory", Severity::Error, evidence)
            .with_param("currentMb", current)
            .with_param("suggestedMb", suggested)
            .with_actions([FixAction::RaiseMemory { suggested_mb: suggested }]),
        None => CrashDiagnosis::new("outOfMemoryAtLimit", Severity::Error, evidence)
            .with_param("currentMb", current)
            .with_param("limitMb", limit),
    })
}

/// Das Meiste, was einer Instanz auf diesem PC zugeteilt werden soll.
fn memory_limit_mb(total_mb: Option<u64>) -> u32 {
    let Some(total_mb) = total_mb else { return UNKNOWN_SYSTEM_LIMIT_MB };
    let step = u64::from(STEP_MB);
    let usable = total_mb.saturating_sub(SYSTEM_RESERVE_MB) / step * step;
    u32::try_from(usable).unwrap_or(u32::MAX).max(MIN_LIMIT_MB)
}

/// Das Doppelte von `current`, auf einen Schritt aufgerundet und durch `limit` begrenzt; `None`, wenn das nicht mehr
/// ist als `current`.
fn suggested_mb(current: u32, limit: u32) -> Option<u32> {
    let step = u64::from(STEP_MB);
    let doubled = u64::from(current) * 2;
    let capped = (doubled.div_ceil(step) * step).min(u64::from(limit));
    let suggested = u32::try_from(capped).expect("durch das Limit begrenzt");
    (suggested > current).then_some(suggested)
}

#[cfg(test)]
mod tests {
    use super::super::testing::*;
    use super::super::Machine;
    use super::*;
    use crate::models::Instance;

    const HEAP_REPORT: &str = "---- Minecraft Crash Report ----\n\
        // Why did you do that?\n\n\
        Time: 2026-10-01 20:15:42\n\
        Description: Exception in server tick loop\n\n\
        java.lang.OutOfMemoryError: Java heap space\n\
        \tat java.base/java.util.Arrays.copyOf(Arrays.java:3481)\n\
        \tat net.minecraft.class_2540.method_10795(class_2540.java:402)\n";

    fn with_memory(memory_mb: Option<u32>) -> Instance {
        Instance { memory_mb, ..instance(Vec::new()) }
    }

    fn run(text: &str, instance: &Instance, machine: Machine) -> Option<CrashDiagnosis> {
        diagnose(&CrashContext { text, instance, machine })
    }

    #[test]
    fn a_full_heap_suggests_double_the_memory() {
        let found = run(HEAP_REPORT, &with_memory(Some(4096)), MACHINE).unwrap();
        assert_eq!(found.id, "outOfMemory");
        assert_eq!(found.actions, [FixAction::RaiseMemory { suggested_mb: 8192 }]);
        assert_eq!(found.evidence, ["java.lang.OutOfMemoryError: Java heap space"]);
        assert_eq!(found.params["currentMb"], "4096");
    }

    #[test]
    fn instances_without_their_own_value_start_from_the_launcher_default() {
        let found = run(HEAP_REPORT, &with_memory(None), Machine { default_memory_mb: 3072, ..MACHINE }).unwrap();
        assert_eq!(found.actions, [FixAction::RaiseMemory { suggested_mb: 6144 }]);
    }

    #[test]
    fn the_suggestion_stops_at_what_the_pc_can_give() {
        let machine = Machine { total_memory_mb: Some(12288), ..MACHINE };
        let found = run(HEAP_REPORT, &with_memory(Some(8192)), machine).unwrap();
        assert_eq!(found.actions, [FixAction::RaiseMemory { suggested_mb: 10240 }]);
    }

    #[test]
    fn at_the_limit_the_cause_is_only_explained() {
        let machine = Machine { total_memory_mb: Some(12288), ..MACHINE };
        let found = run(HEAP_REPORT, &with_memory(Some(10240)), machine).unwrap();
        assert_eq!(found.id, "outOfMemoryAtLimit");
        assert!(found.actions.is_empty());
        assert_eq!((found.params["currentMb"].as_str(), found.params["limitMb"].as_str()), ("10240", "10240"));
    }

    #[test]
    fn more_than_the_pc_has_is_not_raised_further() {
        let machine = Machine { total_memory_mb: Some(8192), ..MACHINE };
        assert!(run(HEAP_REPORT, &with_memory(Some(12288)), machine).unwrap().actions.is_empty());
    }

    #[test]
    fn an_unknown_pc_allows_up_to_sixteen_gigabytes() {
        let machine = Machine { total_memory_mb: None, ..MACHINE };
        let found = run(HEAP_REPORT, &with_memory(Some(12288)), machine).unwrap();
        assert_eq!(found.actions, [FixAction::RaiseMemory { suggested_mb: 16384 }]);
    }

    #[test]
    fn small_pcs_keep_a_usable_limit() {
        assert_eq!(memory_limit_mb(Some(3000)), 2048);
        assert_eq!(memory_limit_mb(Some(16384)), 14336);
        assert_eq!(memory_limit_mb(Some(16000)), 13824);
    }

    #[test]
    fn suggestions_are_rounded_up_to_a_step() {
        assert_eq!(suggested_mb(3000, 14336), Some(6144));
        assert_eq!(suggested_mb(1, 14336), Some(512));
        assert_eq!(suggested_mb(4096, 4096), None);
    }

    #[test]
    fn the_gc_overhead_error_counts_as_well() {
        let log = "[12:00:01] [Server thread/ERROR]: java.lang.OutOfMemoryError: GC overhead limit exceeded\n";
        assert_eq!(run(log, &with_memory(Some(2048)), MACHINE).unwrap().id, "outOfMemory");
    }

    #[test]
    fn other_memory_errors_are_not_a_full_heap() {
        let metaspace = "java.lang.OutOfMemoryError: Metaspace\n";
        assert!(run(metaspace, &with_memory(None), MACHINE).is_none());
        assert!(run("", &with_memory(None), MACHINE).is_none());
    }
}
