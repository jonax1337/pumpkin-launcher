//! Das Tor der Einspeisung (INGAME 3.3): alle Bedingungen an einer Stelle, als reine Funktion über die Tatsachen des
//! Starts. Besteht eine nicht, startet das Spiel byte-identisch zu heute; der Grund füllt die Statuszeile der
//! Instanzseite (3.9).
use super::index::{ModIndex, Node};
use super::select::{select, Selection, Target, Unfit};
use super::breaker::{FailureKind, InjectionState};
use crate::models::ModLoader;

/// Die Mod-Id, die in einer Instanz nicht schon vorhanden sein darf (INGAME 3.3, Punkt 6).
pub const MOD_ID: &str = "pumpkin_friends";

/// Alles, was das Tor über den Start wissen muss.
#[derive(Debug, Clone, Copy)]
pub struct LaunchFacts<'a> {
    pub friends_enabled: bool,
    pub bridge_running: bool,
    /// Der Start läuft mit einem Microsoft-Konto.
    pub online_account: bool,
    pub minecraft: &'a str,
    pub loader: ModLoader,
    pub loader_version: &'a str,
    /// Hauptversion des Javas, das das Spiel startet; `None`, wenn sie sich nicht feststellen ließ.
    pub java_major: Option<u32>,
    /// Der globale Schalter „Freunde-Menü im Spiel“.
    pub global_switch: bool,
    /// Der gespeicherte Zustand der Instanz (Schalter der Instanz und Sicherungsschalter).
    pub instance_state: &'a InjectionState,
    pub launcher_version: &'a str,
    /// Mod-Ids der JARs im Ordner `mods` der Instanz.
    pub mod_ids_in_instance: &'a [String],
}

/// Das Ergebnis: den Knoten einspeisen oder auslassen.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Decision<'a> {
    Inject(&'a Node),
    Skip(SkipReason),
}

/// Warum nicht eingespeist wird, in der Reihenfolge, in der das Tor prüft.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum SkipReason {
    /// Freunde ist aus; davor hört nichts zu und wird nichts eingespeist (SPEC 12.1).
    FriendsOff,
    BridgeNotRunning,
    /// „Nur mit Microsoft-Konto“.
    OfflineAccount,
    /// Der Knoten fehlt oder die Instanz erfüllt ihn nicht (Version, Loader, Java).
    Unfit(Unfit),
    /// Der globale Schalter ist aus.
    GloballyOff,
    /// Der Spieler hat die Einspeisung für die Instanz ausgeschaltet.
    InstanceOff,
    /// Ein Startfehler hat sie ausgeschaltet („Nach einem Startfehler ausgeschaltet“).
    Tripped(FailureKind),
    /// Im Ordner `mods` liegt schon eine `pumpkin_friends`.
    IdCollision,
}

impl SkipReason {
    /// Ein stabiler Schlüssel je Grund für die Statuszeile; die Oberfläche übersetzt ihn.
    pub fn code(&self) -> &'static str {
        match self {
            Self::FriendsOff => "friendsOff",
            Self::BridgeNotRunning => "bridgeNotRunning",
            Self::OfflineAccount => "offlineAccount",
            Self::Unfit(Unfit::NoNode) => "noNode",
            Self::Unfit(Unfit::Unverified) => "unverified",
            Self::Unfit(Unfit::LoaderTooOld { .. }) => "loaderTooOld",
            Self::Unfit(Unfit::LoaderVersionUnknown) => "loaderVersionUnknown",
            Self::Unfit(Unfit::JavaTooOld { .. }) => "javaTooOld",
            Self::Unfit(Unfit::JavaUnknown) => "javaUnknown",
            Self::Unfit(Unfit::VanillaNeedsLoader) => "vanillaNeedsLoader",
            Self::Unfit(Unfit::QuiltUnsupported) => "quiltUnsupported",
            Self::GloballyOff => "globallyOff",
            Self::InstanceOff => "instanceOff",
            Self::Tripped(_) => "tripped",
            Self::IdCollision => "idCollision",
        }
    }
}

/// Entscheidet, ob für diesen Start eingespeist wird.
pub fn decide<'a>(index: &'a ModIndex, facts: &LaunchFacts) -> Decision<'a> {
    if let Some(reason) = launcher_state_blocker(facts) {
        return Decision::Skip(reason);
    }
    let node = match select(index, &target_of(facts)) {
        Selection::Fit(node) => node,
        Selection::Unfit(reason) => return Decision::Skip(SkipReason::Unfit(reason)),
    };
    match switch_blocker(facts).or_else(|| collision_blocker(facts)) {
        Some(reason) => Decision::Skip(reason),
        None => Decision::Inject(node),
    }
}

fn launcher_state_blocker(facts: &LaunchFacts) -> Option<SkipReason> {
    if !facts.friends_enabled {
        Some(SkipReason::FriendsOff)
    } else if !facts.bridge_running {
        Some(SkipReason::BridgeNotRunning)
    } else if !facts.online_account {
        Some(SkipReason::OfflineAccount)
    } else {
        None
    }
}

fn target_of<'a>(facts: &LaunchFacts<'a>) -> Target<'a> {
    Target { minecraft: facts.minecraft, loader: facts.loader, loader_version: facts.loader_version, java_major: facts.java_major }
}

fn switch_blocker(facts: &LaunchFacts) -> Option<SkipReason> {
    if !facts.global_switch {
        return Some(SkipReason::GloballyOff);
    }
    match facts.instance_state {
        InjectionState::UserOff => Some(SkipReason::InstanceOff),
        state => state.tripped_reason(facts.launcher_version).map(SkipReason::Tripped),
    }
}

fn collision_blocker(facts: &LaunchFacts) -> Option<SkipReason> {
    facts.mod_ids_in_instance.iter().any(|id| id == MOD_ID).then_some(SkipReason::IdCollision)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::services::friends::ingame::index::Loader;
    use crate::services::friends::ingame::test_support::{index_of, node, unverified};

    const LAUNCHER: &str = "2.1.0";
    const NO_MODS: &[String] = &[];
    static ACTIVE: InjectionState = InjectionState::Active;

    fn index() -> ModIndex {
        index_of(vec![
            node("1.21.1-fabric", Loader::Fabric, &["1.21", "1.21.1"], "0.16.0", 21),
            node("1.21.1-neoforge", Loader::Neoforge, &["1.21.1"], "21.1.0", 21),
            unverified(node("1.20.4-fabric", Loader::Fabric, &["1.20.4"], "0.15.0", 17)),
        ])
    }

    fn fitting_facts() -> LaunchFacts<'static> {
        LaunchFacts {
            friends_enabled: true,
            bridge_running: true,
            online_account: true,
            minecraft: "1.21.1",
            loader: ModLoader::Fabric,
            loader_version: "0.16.14",
            java_major: Some(21),
            global_switch: true,
            instance_state: &ACTIVE,
            launcher_version: LAUNCHER,
            mod_ids_in_instance: NO_MODS,
        }
    }

    fn skip_reason(index: &ModIndex, facts: &LaunchFacts) -> SkipReason {
        match decide(index, facts) {
            Decision::Skip(reason) => reason,
            Decision::Inject(node) => panic!("eingespeist: {}", node.id),
        }
    }

    #[test]
    fn a_launch_that_meets_every_condition_injects_the_node() {
        let index = index();
        assert_eq!(decide(&index, &fitting_facts()), Decision::Inject(index.node("1.21.1-fabric").unwrap()));
        let neoforge = LaunchFacts { loader: ModLoader::NeoForge, loader_version: "21.1.172", ..fitting_facts() };
        assert_eq!(decide(&index, &neoforge), Decision::Inject(index.node("1.21.1-neoforge").unwrap()));
    }

    #[test]
    fn every_failed_condition_skips_with_its_own_reason() {
        let index = index();
        let off = InjectionState::UserOff;
        let tripped = InjectionState::Active.tripped(FailureKind::MixinApplyFailed, LAUNCHER);
        let own_mod = vec!["fabric-api".to_owned(), MOD_ID.to_owned()];
        let cases: Vec<(&str, LaunchFacts, SkipReason)> = vec![
            ("friends off", LaunchFacts { friends_enabled: false, ..fitting_facts() }, SkipReason::FriendsOff),
            ("bridge not running", LaunchFacts { bridge_running: false, ..fitting_facts() }, SkipReason::BridgeNotRunning),
            ("offline account", LaunchFacts { online_account: false, ..fitting_facts() }, SkipReason::OfflineAccount),
            ("vanilla", LaunchFacts { loader: ModLoader::Vanilla, ..fitting_facts() }, SkipReason::Unfit(Unfit::VanillaNeedsLoader)),
            ("quilt", LaunchFacts { loader: ModLoader::Quilt, ..fitting_facts() }, SkipReason::Unfit(Unfit::QuiltUnsupported)),
            ("newer minecraft", LaunchFacts { minecraft: "26.9", ..fitting_facts() }, SkipReason::Unfit(Unfit::NoNode)),
            ("snapshot", LaunchFacts { minecraft: "24w14a", ..fitting_facts() }, SkipReason::Unfit(Unfit::NoNode)),
            ("unverified cell", LaunchFacts { minecraft: "1.20.4", java_major: Some(17), ..fitting_facts() }, SkipReason::Unfit(Unfit::Unverified)),
            ("loader too old", LaunchFacts { loader_version: "0.15.0", ..fitting_facts() }, SkipReason::Unfit(Unfit::LoaderTooOld { need: "0.16.0".to_owned() })),
            ("loader version unreadable", LaunchFacts { loader_version: "", ..fitting_facts() }, SkipReason::Unfit(Unfit::LoaderVersionUnknown)),
            ("java too old", LaunchFacts { java_major: Some(17), ..fitting_facts() }, SkipReason::Unfit(Unfit::JavaTooOld { need: 21 })),
            ("java unknown", LaunchFacts { java_major: None, ..fitting_facts() }, SkipReason::Unfit(Unfit::JavaUnknown)),
            ("global switch off", LaunchFacts { global_switch: false, ..fitting_facts() }, SkipReason::GloballyOff),
            ("instance switch off", LaunchFacts { instance_state: &off, ..fitting_facts() }, SkipReason::InstanceOff),
            ("breaker tripped", LaunchFacts { instance_state: &tripped, ..fitting_facts() }, SkipReason::Tripped(FailureKind::MixinApplyFailed)),
            ("own mod already in mods", LaunchFacts { mod_ids_in_instance: &own_mod, ..fitting_facts() }, SkipReason::IdCollision),
        ];
        for (name, facts, expected) in cases {
            assert_eq!(skip_reason(&index, &facts), expected, "{name}");
        }
    }

    #[test]
    fn a_trip_from_an_older_launcher_version_no_longer_blocks() {
        let index = index();
        let tripped_before = InjectionState::Active.tripped(FailureKind::ModLoadingError, "2.0.1");
        let facts = LaunchFacts { instance_state: &tripped_before, ..fitting_facts() };
        assert!(matches!(decide(&index, &facts), Decision::Inject(_)));
    }

    #[test]
    fn other_mods_in_the_folder_do_not_collide() {
        let index = index();
        let others = vec!["fabric-api".to_owned(), "pumpkin_friends_extra".to_owned(), "Pumpkin_Friends".to_owned()];
        let facts = LaunchFacts { mod_ids_in_instance: &others, ..fitting_facts() };
        assert!(matches!(decide(&index, &facts), Decision::Inject(_)));
    }

    #[test]
    fn an_empty_index_never_injects() {
        assert_eq!(skip_reason(&ModIndex::default(), &fitting_facts()), SkipReason::Unfit(Unfit::NoNode));
    }

    #[test]
    fn conditions_are_checked_in_the_order_of_the_concept() {
        let index = index();
        let everything_wrong = LaunchFacts {
            friends_enabled: false,
            bridge_running: false,
            online_account: false,
            global_switch: false,
            java_major: None,
            mod_ids_in_instance: &[MOD_ID.to_owned()],
            ..fitting_facts()
        };
        assert_eq!(skip_reason(&index, &everything_wrong), SkipReason::FriendsOff);
        let bridge_on = LaunchFacts { friends_enabled: true, ..everything_wrong };
        assert_eq!(skip_reason(&index, &bridge_on), SkipReason::BridgeNotRunning);
        let bridge_up = LaunchFacts { bridge_running: true, ..bridge_on };
        assert_eq!(skip_reason(&index, &bridge_up), SkipReason::OfflineAccount);
        let online = LaunchFacts { online_account: true, ..bridge_up };
        assert_eq!(skip_reason(&index, &online), SkipReason::Unfit(Unfit::JavaUnknown));
        let java_known = LaunchFacts { java_major: Some(21), ..online };
        assert_eq!(skip_reason(&index, &java_known), SkipReason::GloballyOff);
        let switch_on = LaunchFacts { global_switch: true, ..java_known };
        assert_eq!(skip_reason(&index, &switch_on), SkipReason::IdCollision);
    }

    #[test]
    fn reason_codes_are_stable_and_distinct() {
        let reasons = [
            SkipReason::FriendsOff,
            SkipReason::BridgeNotRunning,
            SkipReason::OfflineAccount,
            SkipReason::Unfit(Unfit::NoNode),
            SkipReason::Unfit(Unfit::Unverified),
            SkipReason::Unfit(Unfit::LoaderTooOld { need: "1".to_owned() }),
            SkipReason::Unfit(Unfit::LoaderVersionUnknown),
            SkipReason::Unfit(Unfit::JavaTooOld { need: 21 }),
            SkipReason::Unfit(Unfit::JavaUnknown),
            SkipReason::Unfit(Unfit::VanillaNeedsLoader),
            SkipReason::Unfit(Unfit::QuiltUnsupported),
            SkipReason::GloballyOff,
            SkipReason::InstanceOff,
            SkipReason::Tripped(FailureKind::Unknown),
            SkipReason::IdCollision,
        ];
        let codes: Vec<&str> = reasons.iter().map(SkipReason::code).collect();
        assert_eq!(
            codes,
            [
                "friendsOff", "bridgeNotRunning", "offlineAccount", "noNode", "unverified", "loaderTooOld", "loaderVersionUnknown", "javaTooOld",
                "javaUnknown", "vanillaNeedsLoader", "quiltUnsupported", "globallyOff", "instanceOff", "tripped", "idCollision"
            ]
        );
    }
}
