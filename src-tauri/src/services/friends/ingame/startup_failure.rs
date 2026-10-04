//! Erkennt, ob ein Spielstart wegen der eingespeisten Mod gescheitert ist (INGAME 3.8). Die Erkennung ist eine
//! Tabelle von Mustern ([`PATTERNS`]); neue Loader-Meldungen sind eine neue Zeile samt Fixture-Log, kein neuer Code.
use std::time::Duration;

use super::breaker::FailureKind;

/// So lange nach dem Start zählt ein Fehler als Startfehler.
pub const STARTUP_WINDOW: Duration = Duration::from_secs(90);

/// Woran eine Logzeile die Mod erkennt: ihre Id und ihr Paket (JVM-Schreibweise mit Punkten und mit Schrägstrichen).
const MOD_IDENTITY: [&str; 3] = ["pumpkin_friends", "dev.laux.pumpkin", "dev/laux/pumpkin"];

/// So viele Zeilen nach der Fehlerzeile darf die Mod noch genannt werden. Loader schreiben die Ursache oft in die
/// Zeilen unter der Überschrift („Incompatible mod set!“); die Liste aller Mods im Absturzbericht steht weiter hinten.
pub(super) const NAMING_LOOKAHEAD_LINES: usize = 25;

/// Ein Fehlerbild: Zeilen, die einen der `markers` enthalten, sind Startfehler dieser Art, sobald die Mod in
/// derselben oder einer der folgenden Zeilen genannt wird.
struct Pattern {
    kind: FailureKind,
    markers: &'static [&'static str],
}

const PATTERNS: [Pattern; 4] = [
    Pattern { kind: FailureKind::FabricIncompatibleModSet, markers: &["Incompatible mod set"] },
    Pattern {
        kind: FailureKind::MixinApplyFailed,
        markers: &["Mixin apply", "Mixin transformation", "MixinApplyError", "InvalidInjectionException", "InjectionError", "Critical injection failure"],
    },
    Pattern { kind: FailureKind::ModLoadingError, markers: &["ModLoadingException", "ModLoadingIssue", "mod loading error", "Error during mod loading"] },
    Pattern { kind: FailureKind::UnsupportedClassVersion, markers: &["UnsupportedClassVersionError"] },
];

/// Der Startfehler, den das Log zeigt, sofern er die Mod nennt. Der Aufrufer darf es schon während der ersten
/// [`STARTUP_WINDOW`] lesen: Fabric etwa zeigt seine Fehlerseite und beendet den Prozess erst, wenn sie geschlossen wird.
pub fn analyze_log<S: AsRef<str>>(lines: &[S]) -> Option<FailureKind> {
    (0..lines.len()).find_map(|at| failure_at(lines, at))
}

/// Der Startfehler nach dem Ende des Spiels, oder `None`, wenn kein Grund vorliegt, die Mod zu beschuldigen.
///
/// Das Spiel muss mit einem Fehlercode (`None` heißt: von außen beendet) innerhalb von [`STARTUP_WINDOW`] geendet
/// sein, und das Log muss die Mod nennen. Ein früher Absturz ohne solchen Hinweis (Speichermangel, kaputtes Pack, eine
/// fremde Mod) schaltet die Einspeisung nicht aus: INGAME 3.8 nennt den Fehlercode allein als Grund, aber ein
/// Absturz, den die Mod nicht verursacht hat, soll sie nicht kosten.
pub fn analyze_exit<S: AsRef<str>>(exit_code: Option<i32>, uptime: Duration, lines: &[S]) -> Option<FailureKind> {
    if exit_code == Some(0) || uptime > STARTUP_WINDOW {
        return None;
    }
    analyze_log(lines)
}

fn failure_at<S: AsRef<str>>(lines: &[S], at: usize) -> Option<FailureKind> {
    let line = lines[at].as_ref();
    let pattern = PATTERNS.iter().find(|pattern| pattern.markers.iter().any(|marker| line.contains(marker)))?;
    let reach = lines.len().min(at + 1 + NAMING_LOOKAHEAD_LINES);
    lines[at..reach].iter().any(|candidate| names_the_mod(candidate.as_ref())).then_some(pattern.kind)
}

fn names_the_mod(line: &str) -> bool {
    MOD_IDENTITY.iter().any(|identity| line.contains(identity))
}

#[cfg(test)]
mod tests {
    use super::*;

    // Die Logs unter fixtures/ sind nach den Meldungsformaten der Loader nachgebaut (Fabric Loader, Mixin, FML,
    // JVM), nicht mitgeschnitten. Der Rauchtest (Paket S2) ersetzt sie durch echte Mitschnitte der Zellen.
    const FABRIC_INCOMPATIBLE: &str = include_str!("fixtures/fabric_incompatible_mod_set.txt");
    const MIXIN_FAILED: &str = include_str!("fixtures/mixin_apply_failed.txt");
    const NEOFORGE_LOADING: &str = include_str!("fixtures/neoforge_mod_loading_error.txt");
    const CLASS_VERSION: &str = include_str!("fixtures/unsupported_class_version.txt");
    const UNRELATED_CRASH: &str = include_str!("fixtures/unrelated_crash.txt");

    const QUICK: Duration = Duration::from_secs(12);

    fn lines(log: &str) -> Vec<&str> {
        log.lines().collect()
    }

    const FAILURES: [(&str, FailureKind); 4] = [
        (FABRIC_INCOMPATIBLE, FailureKind::FabricIncompatibleModSet),
        (MIXIN_FAILED, FailureKind::MixinApplyFailed),
        (NEOFORGE_LOADING, FailureKind::ModLoadingError),
        (CLASS_VERSION, FailureKind::UnsupportedClassVersion),
    ];

    #[test]
    fn logs_that_blame_the_mod_are_recognised_by_kind() {
        for (log, kind) in FAILURES {
            assert_eq!(analyze_log(&lines(log)), Some(kind), "{kind:?}");
        }
    }

    #[test]
    fn a_quick_crash_with_such_a_log_trips_the_breaker() {
        for (log, kind) in FAILURES {
            assert_eq!(analyze_exit(Some(1), QUICK, &lines(log)), Some(kind), "{kind:?}");
        }
    }

    #[test]
    fn a_crash_of_another_mod_does_not_trip_the_breaker() {
        let log = lines(UNRELATED_CRASH);
        assert_eq!(analyze_log(&log), None);
        assert_eq!(analyze_exit(Some(1), QUICK, &log), None);
    }

    #[test]
    fn a_quick_crash_without_any_log_evidence_does_not_trip_the_breaker() {
        let silent: [&str; 2] = ["[12:00:01] [main/INFO] Loading", "[12:00:02] [main/ERROR] java.lang.OutOfMemoryError: Java heap space"];
        assert_eq!(analyze_exit(Some(1), QUICK, &silent), None);
        assert_eq!(analyze_exit::<&str>(Some(1), QUICK, &[]), None);
    }

    #[test]
    fn exit_code_and_uptime_decide_whether_the_log_counts() {
        let log = lines(FABRIC_INCOMPATIBLE);
        let cases = [
            (Some(0), QUICK, false),
            (Some(1), QUICK, true),
            (Some(-1), QUICK, true),
            (None, QUICK, true),
            (Some(1), STARTUP_WINDOW, true),
            (Some(1), STARTUP_WINDOW + Duration::from_millis(1), false),
            (Some(1), Duration::from_secs(600), false),
            (Some(0), Duration::from_secs(600), false),
        ];
        for (code, uptime, trips) in cases {
            assert_eq!(analyze_exit(code, uptime, &log).is_some(), trips, "{code:?} nach {uptime:?}");
        }
    }

    #[test]
    fn the_mod_must_be_named_close_to_the_error_line() {
        let marker = "Mixin apply for mod othermod failed";
        let mention = "(pumpkin_friends) wurde geladen";
        let last_reached_gap = NAMING_LOOKAHEAD_LINES - 1;
        for (gap, trips) in [(0, true), (last_reached_gap, true), (last_reached_gap + 1, false)] {
            let mut log = vec![marker];
            log.extend(std::iter::repeat_n("\tat some.Frame(Frame.java:1)", gap));
            log.push(mention);
            assert_eq!(analyze_log(&log).is_some(), trips, "Abstand {gap}");
        }
    }

    #[test]
    fn mentioning_the_mod_before_the_error_line_is_not_enough() {
        let log = ["(pumpkin_friends) wurde geladen", "Mixin apply for mod othermod failed"];
        assert_eq!(analyze_log(&log), None);
    }

    #[test]
    fn the_package_of_the_mod_counts_as_naming_it() {
        for line in ["java.lang.UnsupportedClassVersionError: dev/laux/pumpkin/friends/X", "UnsupportedClassVersionError at dev.laux.pumpkin.friends.X"] {
            assert_eq!(analyze_log(&[line]), Some(FailureKind::UnsupportedClassVersion), "{line}");
        }
        assert_eq!(analyze_log(&["java.lang.UnsupportedClassVersionError: com/other/mod/X"]), None);
    }

    #[test]
    fn the_class_version_error_of_another_mod_does_not_trip() {
        assert_eq!(analyze_log(&["java.lang.UnsupportedClassVersionError: dev/other/OtherMod has been compiled by a more recent version"]), None);
    }
}
