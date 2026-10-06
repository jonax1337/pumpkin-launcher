//! Der Sicherungsschalter je Instanz (docs/bridge/README.md, "Startup recovery"): wann die Einspeisung läuft, wann der Spieler sie ausgeschaltet
//! hat und wann der Launcher sie nach einem Startfehler selbst abgeschaltet hat. Der Zustand gehört der Instanz und
//! wird vom Aufrufer gespeichert; hier stehen nur die Übergänge.
use serde::{Deserialize, Serialize};

/// Die Art Startfehler, die der Launcher der Mod zuschreibt. Sie steht im gespeicherten Zustand und im Dialog.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum FailureKind {
    /// Fabric: „Incompatible mod set“ nennt die Mod.
    FabricIncompatibleModSet,
    /// Mixin konnte sich in der Mod nicht anwenden lassen.
    MixinApplyFailed,
    /// Forge oder NeoForge: ein Ladefehler nennt die Mod.
    ModLoadingError,
    /// Das JAR verlangt ein neueres Java als das, das das Spiel startet.
    UnsupportedClassVersion,
    /// Ein Grund, den eine spätere Launcher-Version kennt und diese nicht.
    #[serde(other)]
    Unknown,
}

/// Ob und warum die Mod in die Starts einer Instanz eingespeist wird.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "state", rename_all = "camelCase")]
pub enum InjectionState {
    /// Die Einspeisung ist erlaubt (sie läuft, wenn auch alles andere passt).
    #[default]
    Active,
    /// Der Spieler hat sie für diese Instanz ausgeschaltet.
    UserOff,
    /// Ein Startfehler hat sie ausgeschaltet, unter dieser Launcher-Version.
    #[serde(rename_all = "camelCase")]
    AutoOff {
        reason: FailureKind,
        launcher_version: String,
    },
}

impl InjectionState {
    /// Nach einem Startfehler: aus `Active` wird `AutoOff`. Hat der Spieler die Einspeisung schon ausgeschaltet,
    /// bleibt es dabei; ein schon ausgelöster Schalter nimmt den neueren Grund an.
    pub fn tripped(self, reason: FailureKind, launcher_version: &str) -> Self {
        match self {
            Self::UserOff => Self::UserOff,
            Self::Active | Self::AutoOff { .. } => Self::AutoOff {
                reason,
                launcher_version: launcher_version.to_owned(),
            },
        }
    }

    /// Der Spieler legt den Schalter der Instanz um. Das hebt auch ein `AutoOff` auf („Erneut versuchen“).
    pub fn from_switch(on: bool) -> Self {
        if on {
            Self::Active
        } else {
            Self::UserOff
        }
    }

    /// Ob ein Startfehler die Einspeisung ausgeschaltet hat (gleich unter welcher Launcher-Version).
    pub fn is_tripped(&self) -> bool {
        matches!(self, Self::AutoOff { .. })
    }

    /// Der Grund, aus dem der Schalter unter dieser Launcher-Version ausgelöst ist; `None`, wenn er es nicht ist.
    /// Ein `AutoOff` einer anderen Launcher-Version zählt nicht mehr: dort kann ein behobener Knoten liegen.
    pub fn tripped_reason(&self, launcher_version: &str) -> Option<FailureKind> {
        match self {
            Self::AutoOff {
                reason,
                launcher_version: tripped_under,
            } if tripped_under == launcher_version => Some(*reason),
            _ => None,
        }
    }

    /// Der Zustand, den der Aufrufer speichern soll, wenn der Launcher `launcher_version` heißt: ein `AutoOff`
    /// einer anderen Version fällt auf `Active` zurück, alles andere bleibt.
    pub fn lifted_for(self, launcher_version: &str) -> Self {
        match self {
            Self::AutoOff {
                launcher_version: tripped_under,
                ..
            } if tripped_under != launcher_version => Self::Active,
            other => other,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const NOW: &str = "2.1.0";

    fn auto_off(reason: FailureKind, version: &str) -> InjectionState {
        InjectionState::AutoOff {
            reason,
            launcher_version: version.to_owned(),
        }
    }

    #[test]
    fn a_start_failure_switches_an_active_instance_off() {
        let state = InjectionState::Active.tripped(FailureKind::MixinApplyFailed, NOW);
        assert_eq!(state, auto_off(FailureKind::MixinApplyFailed, NOW));
    }

    #[test]
    fn a_start_failure_never_overrides_the_players_off_switch() {
        assert_eq!(
            InjectionState::UserOff.tripped(FailureKind::ModLoadingError, NOW),
            InjectionState::UserOff
        );
    }

    #[test]
    fn a_second_failure_keeps_the_switch_off_with_the_newer_reason() {
        let state = auto_off(FailureKind::MixinApplyFailed, "2.0.9")
            .tripped(FailureKind::UnsupportedClassVersion, NOW);
        assert_eq!(state, auto_off(FailureKind::UnsupportedClassVersion, NOW));
    }

    #[test]
    fn the_players_switch_wins_over_every_state() {
        assert_eq!(InjectionState::from_switch(true), InjectionState::Active);
        assert_eq!(InjectionState::from_switch(false), InjectionState::UserOff);
    }

    #[test]
    fn only_an_automatic_switch_off_counts_as_tripped() {
        assert!(auto_off(FailureKind::MixinApplyFailed, NOW).is_tripped());
        assert!(!InjectionState::Active.is_tripped());
        assert!(!InjectionState::UserOff.is_tripped());
    }

    #[test]
    fn a_trip_counts_only_under_the_launcher_version_that_caused_it() {
        let state = auto_off(FailureKind::FabricIncompatibleModSet, "2.1.0");
        assert_eq!(
            state.tripped_reason("2.1.0"),
            Some(FailureKind::FabricIncompatibleModSet)
        );
        assert_eq!(state.tripped_reason("2.1.1"), None);
        assert_eq!(InjectionState::Active.tripped_reason(NOW), None);
        assert_eq!(InjectionState::UserOff.tripped_reason(NOW), None);
    }

    #[test]
    fn a_new_launcher_version_lifts_an_automatic_switch_off_only() {
        let tripped = auto_off(FailureKind::ModLoadingError, "2.1.0");
        assert_eq!(tripped.clone().lifted_for("2.1.0"), tripped);
        assert_eq!(tripped.lifted_for("2.2.0"), InjectionState::Active);
        assert_eq!(
            InjectionState::UserOff.lifted_for("2.2.0"),
            InjectionState::UserOff
        );
        assert_eq!(
            InjectionState::Active.lifted_for("2.2.0"),
            InjectionState::Active
        );
    }

    #[test]
    fn the_state_is_stored_as_tagged_camel_case_json() {
        let cases = [
            (InjectionState::Active, r#"{"state":"active"}"#),
            (InjectionState::UserOff, r#"{"state":"userOff"}"#),
            (
                auto_off(FailureKind::UnsupportedClassVersion, NOW),
                r#"{"state":"autoOff","reason":"unsupportedClassVersion","launcherVersion":"2.1.0"}"#,
            ),
        ];
        for (state, json) in cases {
            assert_eq!(serde_json::to_string(&state).unwrap(), json);
            assert_eq!(serde_json::from_str::<InjectionState>(json).unwrap(), state);
        }
    }

    #[test]
    fn a_reason_from_a_newer_launcher_reads_as_unknown() {
        let json = r#"{"state":"autoOff","reason":"somethingNew","launcherVersion":"9.0.0"}"#;
        assert_eq!(
            serde_json::from_str::<InjectionState>(json).unwrap(),
            auto_off(FailureKind::Unknown, "9.0.0")
        );
    }
}
