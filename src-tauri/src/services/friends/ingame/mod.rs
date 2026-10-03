//! Die Freunde-Mod im Spiel, aus Sicht des Launchers (INGAME 2.1, 3.2 bis 3.9): welches eingebettete JAR zu einer
//! Instanz passt, ob eingespeist wird, wie das JAR bereitgestellt und dem Loader übergeben wird und wann der
//! Sicherungsschalter die Einspeisung abschaltet. Alles hier sind reine Bausteine ohne Verdrahtung in den Start;
//! der Aufrufer fügt sie zusammen:
//!
//! 1. [`decide`] (mit [`ModIndex`] aus einer [`ModSource`]) sagt `Inject(node)` oder `Skip(Grund)`.
//! 2. [`materialise`] legt das JAR des Knotens ab und prüft es; der Wert hält es bis zum Spielstart.
//! 3. [`build_args`] liefert die Startoptionen und die um Ersetztes bereinigten Argumente des Nutzers.
//! 4. Nach dem Ende des Spiels wertet [`analyze_exit`] das Log aus und [`InjectionState::tripped`] schaltet ab.
mod args;
mod breaker;
mod gate;
mod index;
mod java_major;
mod materialise;
mod property;
mod select;
mod startup_failure;
mod validate;
mod version;

#[cfg(test)]
mod sample_tests;
#[cfg(test)]
mod test_support;

pub use args::{build as build_args, ArgsError, InjectedArgs, UserArgs, PATH_LIST_SEPARATOR};
pub use breaker::{FailureKind, InjectionState};
pub use gate::{decide, Decision, LaunchFacts, SkipReason, MOD_ID};
pub use index::{EmptySource, IndexError, Loader, ModIndex, ModSource, Node, Strategy, Verified};
pub use java_major::{from_release_file as java_major_from_release_file, from_version_output as java_major_from_version_output};
pub use materialise::{materialise, runtime_dir, sha256_hex, MaterialiseError, MaterialisedJar};
pub use select::{select, Selection, Target, Unfit};
pub use startup_failure::{analyze_exit, analyze_log, STARTUP_WINDOW};
pub use version::{is_release_id, LoaderVersion};
