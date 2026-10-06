//! Die Wache über die ersten 90 Sekunden eines Starts mit eingespeister Mod (docs/bridge/README.md, "Startup recovery"). Sie liest die Zeilen des Spiels,
//! solange es läuft, und fragt [`analyze_log`], nach dem Ende [`analyze_exit`]. Der Fehlercode und das Zeitfenster
//! lassen nur zu, dass das Log gelesen wird; ob die Mod schuld ist, entscheidet allein das Log.
use std::collections::VecDeque;
use std::time::Duration;

use super::breaker::FailureKind;
use super::startup_failure::{analyze_exit, analyze_log, NAMING_LOOKAHEAD_LINES, STARTUP_WINDOW};

/// So viele Zeilen merkt sich die Wache für die Auswertung nach dem Ende; ein Absturz in den ersten 90 Sekunden schreibt
/// weit weniger.
const KEPT_LINES: usize = 4000;

/// Der Teil des Logs, der beim Eintreffen einer Zeile neu zu prüfen ist: die Zeile mit dem Fehlerbild kann höchstens
/// `NAMING_LOOKAHEAD_LINES` Zeilen vor der Zeile stehen, die die Mod nennt.
const LIVE_WINDOW_LINES: usize = NAMING_LOOKAHEAD_LINES + 1;

#[derive(Debug, Default)]
pub struct StartupWatch {
    lines: VecDeque<String>,
    reported: bool,
}

impl StartupWatch {
    /// Eine neue Zeile des Spiels, `uptime` nach dem Start. Das Ergebnis ist der Fehler, sobald die Zeilen ihn zeigen,
    /// und nur beim ersten Mal. Nach dem Zeitfenster liest die Wache nicht mehr mit.
    pub fn on_line(&mut self, uptime: Duration, line: &str) -> Option<FailureKind> {
        if uptime > STARTUP_WINDOW {
            self.lines.clear();
            return None;
        }
        self.remember(line);
        if self.reported {
            return None;
        }
        let kind = analyze_log(self.recent());
        self.reported = kind.is_some();
        kind
    }

    /// Das Spiel ist zu Ende. `None`, wenn kein Grund vorliegt, die Mod zu beschuldigen oder die Wache sie schon
    /// beschuldigt hat.
    pub fn on_exit(&mut self, exit_code: Option<i32>, uptime: Duration) -> Option<FailureKind> {
        if self.reported {
            return None;
        }
        let kind = analyze_exit(exit_code, uptime, self.lines.make_contiguous());
        self.reported = kind.is_some();
        kind
    }

    fn remember(&mut self, line: &str) {
        if self.lines.len() == KEPT_LINES {
            self.lines.pop_front();
        }
        self.lines.push_back(line.to_owned());
    }

    fn recent(&mut self) -> &[String] {
        let all = self.lines.make_contiguous();
        &all[all.len().saturating_sub(LIVE_WINDOW_LINES)..]
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const FABRIC_INCOMPATIBLE: &str = include_str!("fixtures/fabric_incompatible_mod_set.txt");
    const MIXIN_FAILED: &str = include_str!("fixtures/mixin_apply_failed.txt");
    const NEOFORGE_LOADING: &str = include_str!("fixtures/neoforge_mod_loading_error.txt");
    const CLASS_VERSION: &str = include_str!("fixtures/unsupported_class_version.txt");
    const UNRELATED_CRASH: &str = include_str!("fixtures/unrelated_crash.txt");

    const EARLY: Duration = Duration::from_secs(8);

    /// Gibt die Zeilen nacheinander in die Wache und liefert, was sie beim Mitlesen gemeldet hat.
    fn feed(watch: &mut StartupWatch, log: &str, uptime: Duration) -> Vec<FailureKind> {
        log.lines()
            .filter_map(|line| watch.on_line(uptime, line))
            .collect()
    }

    const BLAMING_LOGS: [(&str, FailureKind); 4] = [
        (FABRIC_INCOMPATIBLE, FailureKind::FabricIncompatibleModSet),
        (MIXIN_FAILED, FailureKind::MixinApplyFailed),
        (NEOFORGE_LOADING, FailureKind::ModLoadingError),
        (CLASS_VERSION, FailureKind::UnsupportedClassVersion),
    ];

    #[test]
    fn a_failure_that_names_the_mod_is_reported_once_while_the_game_still_runs() {
        for (log, kind) in BLAMING_LOGS {
            let mut watch = StartupWatch::default();
            assert_eq!(feed(&mut watch, log, EARLY), [kind], "{kind:?}");
        }
    }

    #[test]
    fn a_failure_reported_live_is_not_reported_again_at_the_exit() {
        let mut watch = StartupWatch::default();
        feed(&mut watch, FABRIC_INCOMPATIBLE, EARLY);

        assert_eq!(watch.on_exit(Some(1), EARLY), None);
    }

    /// Eine Wache, die das Log schon gelesen hat, ohne dass sie beim Mitlesen etwas gemeldet hätte.
    fn watch_that_read(log: &str) -> StartupWatch {
        StartupWatch {
            lines: log.lines().map(str::to_owned).collect(),
            ..StartupWatch::default()
        }
    }

    #[test]
    fn the_exit_alone_blames_the_mod_when_the_log_names_it() {
        for (log, kind) in BLAMING_LOGS {
            assert_eq!(
                watch_that_read(log).on_exit(Some(1), EARLY),
                Some(kind),
                "{kind:?}"
            );
        }
    }

    #[test]
    fn a_crash_of_another_mod_trips_nothing() {
        let mut watch = StartupWatch::default();

        assert!(feed(&mut watch, UNRELATED_CRASH, EARLY).is_empty());
        assert_eq!(watch.on_exit(Some(1), EARLY), None);
    }

    #[test]
    fn a_clean_exit_or_a_late_one_never_blames_the_mod() {
        let mut watch = watch_that_read(FABRIC_INCOMPATIBLE);

        assert_eq!(watch.on_exit(Some(0), EARLY), None);
        assert_eq!(
            watch.on_exit(Some(1), STARTUP_WINDOW + Duration::from_secs(1)),
            None
        );
        assert_eq!(
            watch.on_exit(Some(1), EARLY),
            Some(FailureKind::FabricIncompatibleModSet)
        );
    }

    #[test]
    fn lines_after_the_startup_window_are_not_read() {
        let mut watch = StartupWatch::default();

        let late = STARTUP_WINDOW + Duration::from_secs(1);

        assert!(feed(&mut watch, FABRIC_INCOMPATIBLE, late).is_empty());
        assert!(watch.lines.is_empty());
    }

    #[test]
    fn the_naming_line_may_come_after_the_error_line_as_far_as_the_lookahead_reaches() {
        let mut watch = StartupWatch::default();
        watch.on_line(EARLY, "Mixin apply for mod othermod failed");
        for _ in 0..NAMING_LOOKAHEAD_LINES - 1 {
            assert_eq!(watch.on_line(EARLY, "\tat some.Frame(Frame.java:1)"), None);
        }

        assert_eq!(
            watch.on_line(EARLY, "(pumpkin_bridge) wurde geladen"),
            Some(FailureKind::MixinApplyFailed)
        );
    }

    #[test]
    fn the_watch_keeps_a_bounded_number_of_lines() {
        let mut watch = StartupWatch::default();
        for number in 0..KEPT_LINES + 10 {
            watch.on_line(EARLY, &format!("Zeile {number}"));
        }

        assert_eq!(watch.lines.len(), KEPT_LINES);
        assert_eq!(watch.lines.front().map(String::as_str), Some("Zeile 10"));
    }
}
