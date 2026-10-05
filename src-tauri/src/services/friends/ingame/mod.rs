//! Die Freunde-Mod im Spiel, aus Sicht des Launchers (INGAME 2.1, 3.2 bis 3.9): welches eingebettete JAR zu einer
//! Instanz passt, ob eingespeist wird, wie das JAR bereitgestellt und dem Loader übergeben wird und wann der
//! Sicherungsschalter die Einspeisung abschaltet. Die Bausteine sind reine Funktionen und Werte; [`inject`] fügt sie für
//! einen Start zusammen, die Verdrahtung in den Start liegt in `ingame_launch.rs` des Crates:
//!
//! 1. [`decide`] (mit [`ModIndex`] aus einer [`ModSource`], im Build die [`build_source`]) sagt `Inject(node)` oder
//!    `Skip(Grund)`; [`status_of`] beschreibt dieselbe Entscheidung für die Instanzseite.
//! 2. [`materialise`] legt das JAR des Knotens ab und prüft es; der Wert hält es bis zum Spielstart.
//! 3. [`build_args`] liefert die Startoptionen und die um Ersetztes bereinigten Argumente des Nutzers.
//! 4. Die [`StartupWatch`] liest die ersten 90 Sekunden mit ([`analyze_log`]) und nach dem Ende des Spiels
//!    ([`analyze_exit`]); der [`InjectionStore`] bewahrt den Zustand, den [`InjectionState::tripped`] vorgibt.
mod args;
mod breaker;
mod embedded;
mod gate;
mod index;
mod java_cache;
mod java_major;
mod materialise;
mod plan;
mod property;
mod runtime;
mod select;
mod startup_failure;
mod status;
mod store;
mod validate;
mod version;
mod watch;

#[cfg(test)]
mod sample_tests;
#[cfg(test)]
mod test_support;

pub use args::{build as build_args, ArgsError, InjectedArgs, UserArgs, PATH_LIST_SEPARATOR};
pub use breaker::{FailureKind, InjectionState};
pub use embedded::{build_source, EmbeddedParts, EmbeddedSource};
pub use gate::{decide, Decision, LaunchFacts, SkipReason, MOD_ID};
pub use index::{EmptySource, IndexError, Loader, ModIndex, ModSource, Node, Strategy, Verified};
pub use java_cache::JavaMajors;
pub use java_major::{
    from_release_file as java_major_from_release_file,
    from_version_output as java_major_from_version_output,
};
pub use materialise::{materialise, runtime_dir, sha256_hex, MaterialiseError, MaterialisedJar};
pub use plan::{
    inject, Injected, Injection, InjectionError, InjectionRequest, LaunchRegistry, StartArgs,
};
pub use runtime::Ingame;
pub use select::{select, Selection, Target, Unfit};
pub use startup_failure::{analyze_exit, analyze_log, STARTUP_WINDOW};
pub use status::status_of;
pub use store::InjectionStore;
pub use version::{is_release_id, LoaderVersion};
pub use watch::StartupWatch;
