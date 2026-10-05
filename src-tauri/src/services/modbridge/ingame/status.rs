//! Der Status der Einspeisung einer Instanz, berechnet ohne zu starten (INGAME 3.9): dieselbe Entscheidung wie beim
//! Start ([`decide`]), nur mit einer Beschreibung statt einer Einspeisung. So zeigt die Instanzseite, was der nächste
//! Start tut und warum.
use super::breaker::FailureKind;
use super::gate::{decide, target_of, Decision, LaunchFacts, SkipReason};
use super::index::ModIndex;
use super::select::{select, Selection, Unfit};
use crate::services::friends::contract::{IngameNode, IngameReason, IngameState, IngameStatus};

/// Der Status für `facts`. Eine verbundene Mod geht vor: sie läuft jetzt, auch wenn ein Schalter inzwischen umgelegt ist.
pub fn status_of(index: &ModIndex, facts: &LaunchFacts, connected: bool) -> IngameStatus {
    let node = chosen_node(index, facts);
    if connected {
        return IngameStatus {
            state: IngameState::Connected,
            reason: None,
            node,
        };
    }
    match decide(index, facts) {
        Decision::Inject(_) => IngameStatus {
            state: IngameState::Active,
            reason: None,
            node,
        },
        Decision::Skip(skip) => {
            let (state, reason) = describe(skip, index);
            IngameStatus {
                state,
                reason: Some(reason),
                node,
            }
        }
    }
}

/// Der Knoten, der für die Instanz gilt, auch wenn ein Schalter die Einspeisung gerade verhindert.
fn chosen_node(index: &ModIndex, facts: &LaunchFacts) -> Option<IngameNode> {
    match select(index, &target_of(facts)) {
        Selection::Fit(node) => Some(IngameNode {
            id: node.id.clone(),
            minecraft: facts.minecraft.to_owned(),
            loader: node.loader,
        }),
        Selection::Unfit(_) => None,
    }
}

fn describe(skip: SkipReason, index: &ModIndex) -> (IngameState, IngameReason) {
    match skip {
        SkipReason::GloballyOff => (IngameState::Off, IngameReason::GloballyOff),
        SkipReason::InstanceOff => (IngameState::Off, IngameReason::InstanceOff),
        SkipReason::Tripped(reason) => (IngameState::AutoOff, breaker(reason)),
        SkipReason::BridgeNotRunning => (IngameState::Unavailable, IngameReason::BridgeNotRunning),
        SkipReason::OfflineAccount => (IngameState::Unavailable, IngameReason::OfflineAccount),
        SkipReason::IdCollision => (IngameState::Unavailable, IngameReason::IdCollision),
        SkipReason::Unfit(unfit) => (IngameState::Unavailable, unfit_reason(unfit, index)),
    }
}

fn breaker(reason: FailureKind) -> IngameReason {
    IngameReason::Breaker { reason }
}

fn unfit_reason(unfit: Unfit, index: &ModIndex) -> IngameReason {
    match unfit {
        Unfit::NoNode if index.nodes.is_empty() => IngameReason::NotInBuild,
        Unfit::NoNode => IngameReason::NoNode,
        Unfit::Unverified => IngameReason::Unverified,
        Unfit::LoaderTooOld { need } => IngameReason::LoaderTooOld { need },
        Unfit::LoaderVersionUnknown => IngameReason::LoaderVersionUnknown,
        Unfit::JavaTooOld { need } => IngameReason::JavaTooOld { need },
        Unfit::JavaUnknown => IngameReason::JavaUnknown,
        Unfit::VanillaNeedsLoader => IngameReason::Vanilla,
        Unfit::QuiltUnsupported => IngameReason::Quilt,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::ModLoader;
    use crate::services::modbridge::ingame::breaker::InjectionState;
    use crate::services::modbridge::ingame::index::Loader;
    use crate::services::modbridge::ingame::test_support::{index_of, node, unverified};

    const LAUNCHER: &str = "2.1.0";
    const NO_MODS: &[String] = &[];
    static ACTIVE: InjectionState = InjectionState::Active;

    fn index() -> ModIndex {
        index_of(vec![
            node(
                "1.21.1-fabric",
                Loader::Fabric,
                &["1.21", "1.21.1"],
                "0.16.0",
                21,
            ),
            unverified(node(
                "1.20.4-fabric",
                Loader::Fabric,
                &["1.20.4"],
                "0.15.0",
                17,
            )),
        ])
    }

    fn facts<'a>() -> LaunchFacts<'a> {
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

    fn fabric_node() -> Option<IngameNode> {
        Some(IngameNode {
            id: "1.21.1-fabric".into(),
            minecraft: "1.21.1".into(),
            loader: Loader::Fabric,
        })
    }

    fn status(facts: &LaunchFacts) -> IngameStatus {
        status_of(&index(), facts, false)
    }

    #[test]
    fn a_fitting_instance_is_active_with_its_node() {
        assert_eq!(
            status(&facts()),
            IngameStatus {
                state: IngameState::Active,
                reason: None,
                node: fabric_node()
            }
        );
    }

    #[test]
    fn a_connected_mod_is_connected_whatever_the_switches_say() {
        let off = InjectionState::UserOff;
        let facts = LaunchFacts {
            instance_state: &off,
            ..facts()
        };

        let status = status_of(&index(), &facts, true);

        assert_eq!(
            status,
            IngameStatus {
                state: IngameState::Connected,
                reason: None,
                node: fabric_node()
            }
        );
    }

    #[test]
    fn the_switches_give_off_with_the_node_kept() {
        let off = InjectionState::UserOff;
        let instance_off = LaunchFacts {
            instance_state: &off,
            ..facts()
        };
        let globally_off = LaunchFacts {
            global_switch: false,
            ..facts()
        };

        assert_eq!(
            status(&instance_off),
            IngameStatus {
                state: IngameState::Off,
                reason: Some(IngameReason::InstanceOff),
                node: fabric_node()
            }
        );
        assert_eq!(
            status(&globally_off),
            IngameStatus {
                state: IngameState::Off,
                reason: Some(IngameReason::GloballyOff),
                node: fabric_node()
            }
        );
    }

    #[test]
    fn a_start_failure_gives_auto_off_with_the_failure_kind_until_the_launcher_changes() {
        let tripped = InjectionState::Active.tripped(FailureKind::MixinApplyFailed, LAUNCHER);
        let breaker = LaunchFacts {
            instance_state: &tripped,
            ..facts()
        };
        let newer = LaunchFacts {
            launcher_version: "2.1.1",
            ..breaker
        };

        assert_eq!(
            status(&breaker),
            IngameStatus {
                state: IngameState::AutoOff,
                reason: Some(IngameReason::Breaker {
                    reason: FailureKind::MixinApplyFailed
                }),
                node: fabric_node()
            }
        );
        assert_eq!(status(&newer).state, IngameState::Active);
    }

    #[test]
    fn disabled_friends_still_has_an_active_bridge_node() {
        let disabled = LaunchFacts { friends_enabled: false, ..facts() };
        assert_eq!(status(&disabled).state, IngameState::Active);
        assert_eq!(status(&disabled).reason, None);
    }

    #[test]
    fn every_other_reason_is_unavailable_with_its_own_reason() {
        let own_mod = vec!["pumpkin_bridge".to_owned()];
        let cases: Vec<(&str, LaunchFacts, IngameReason)> = vec![
            (
                "bridge",
                LaunchFacts {
                    bridge_running: false,
                    ..facts()
                },
                IngameReason::BridgeNotRunning,
            ),
            (
                "offline",
                LaunchFacts {
                    online_account: false,
                    ..facts()
                },
                IngameReason::OfflineAccount,
            ),
            (
                "vanilla",
                LaunchFacts {
                    loader: ModLoader::Vanilla,
                    ..facts()
                },
                IngameReason::Vanilla,
            ),
            (
                "quilt",
                LaunchFacts {
                    loader: ModLoader::Quilt,
                    ..facts()
                },
                IngameReason::Quilt,
            ),
            (
                "no node",
                LaunchFacts {
                    minecraft: "26.9",
                    ..facts()
                },
                IngameReason::NoNode,
            ),
            (
                "unverified",
                LaunchFacts {
                    minecraft: "1.20.4",
                    java_major: Some(17),
                    ..facts()
                },
                IngameReason::Unverified,
            ),
            (
                "loader",
                LaunchFacts {
                    loader_version: "0.15.0",
                    ..facts()
                },
                IngameReason::LoaderTooOld {
                    need: "0.16.0".into(),
                },
            ),
            (
                "loader unreadable",
                LaunchFacts {
                    loader_version: "",
                    ..facts()
                },
                IngameReason::LoaderVersionUnknown,
            ),
            (
                "java",
                LaunchFacts {
                    java_major: Some(17),
                    ..facts()
                },
                IngameReason::JavaTooOld { need: 21 },
            ),
            (
                "java unknown",
                LaunchFacts {
                    java_major: None,
                    ..facts()
                },
                IngameReason::JavaUnknown,
            ),
            (
                "collision",
                LaunchFacts {
                    mod_ids_in_instance: &own_mod,
                    ..facts()
                },
                IngameReason::IdCollision,
            ),
        ];
        for (name, facts, reason) in cases {
            let status = status(&facts);
            assert_eq!(
                (status.state, status.reason),
                (IngameState::Unavailable, Some(reason)),
                "{name}"
            );
        }
    }

    #[test]
    fn only_a_fitting_cell_has_a_node() {
        assert_eq!(
            status(&LaunchFacts {
                loader: ModLoader::Vanilla,
                ..facts()
            })
            .node,
            None
        );
        assert_eq!(
            status(&LaunchFacts {
                minecraft: "1.20.4",
                java_major: Some(17),
                ..facts()
            })
            .node,
            None
        );
        assert_eq!(
            status(&LaunchFacts {
                online_account: false,
                ..facts()
            })
            .node,
            fabric_node(),
            "das Konto ändert den Knoten nicht"
        );
    }

    #[test]
    fn a_build_without_any_node_says_it_has_no_mod() {
        let status = status_of(&ModIndex::default(), &facts(), false);

        assert_eq!(
            status,
            IngameStatus {
                state: IngameState::Unavailable,
                reason: Some(IngameReason::NotInBuild),
                node: None
            }
        );
    }
}
