//! Welcher Knoten des Index zu einer Instanz passt (INGAME 2.1). Reine Funktion: dieselbe Eingabe wählt immer
//! denselben Knoten oder nennt denselben Grund.
use super::index::{Loader, ModIndex, Node};
use super::version::{is_release_id, LoaderVersion};
use crate::models::ModLoader;

/// Die Instanz, für die ein Knoten gesucht wird.
#[derive(Debug, Clone, Copy)]
pub struct Target<'a> {
    /// Minecraft-Release-Id der Instanz (`1.21.1`); alles andere findet keinen Knoten.
    pub minecraft: &'a str,
    pub loader: ModLoader,
    /// Version des Loaders, wie sie die Instanz festhält (`0.16.14`, `21.1.172`, `47.4.0`).
    pub loader_version: &'a str,
    /// Hauptversion des Javas, das das Spiel starten wird; `None`, wenn sie sich nicht feststellen ließ.
    pub java_major: Option<u32>,
}

/// Das Ergebnis der Wahl: ein passender Knoten oder der Grund, warum keiner passt.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Selection<'a> {
    Fit(&'a Node),
    Unfit(Unfit),
}

impl<'a> Selection<'a> {
    /// Der gewählte Knoten, falls einer passt.
    pub fn fit(self) -> Option<&'a Node> {
        match self {
            Self::Fit(node) => Some(node),
            Self::Unfit(_) => None,
        }
    }
}

/// Warum für eine Instanz kein Knoten gewählt wird; die Instanzseite zeigt daraus ihre Zeile (INGAME 3.9).
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Unfit {
    /// Kein Knoten nennt diese Minecraft-Release-Id für diesen Loader, auch nicht für Snapshots und neuere Versionen.
    NoNode,
    /// Es gibt einen Knoten, sein Rauchtest ist aber nicht bestanden: die Zelle ist aus.
    Unverified,
    /// Der Loader der Instanz ist älter als `need`.
    LoaderTooOld {
        need: String,
    },
    /// Die Version des Loaders der Instanz ließ sich nicht lesen, also auch nicht mit `loaderMin` vergleichen.
    LoaderVersionUnknown,
    /// Das Java des Spiels ist älter als `need`.
    JavaTooOld {
        need: u32,
    },
    /// Die Java-Version ließ sich nicht feststellen; ohne Beweis wird nicht eingespeist (INGAME 3.4).
    JavaUnknown,
    /// Die Instanz hat keinen Loader, in den sich einspeisen ließe.
    VanillaNeedsLoader,
    QuiltUnsupported,
}

/// Wählt den Knoten für `target`.
///
/// Reihenfolge der Gründe: erst ob es die Zelle gibt und sie an ist (`NoNode`, `Unverified`), dann ob die
/// Instanz sie erfüllt (Loader, Java). Eine ungeprüfte Zelle meldet daher nie „Java zu alt“, denn mit neuerem Java
/// wäre sie trotzdem aus.
pub fn select<'a>(index: &'a ModIndex, target: &Target) -> Selection<'a> {
    let loader = match injectable_loader(target.loader) {
        Ok(loader) => loader,
        Err(reason) => return Selection::Unfit(reason),
    };
    if !is_release_id(target.minecraft) {
        return Selection::Unfit(Unfit::NoNode);
    }
    let Some(node) = index.node_serving(loader, target.minecraft) else {
        return Selection::Unfit(Unfit::NoNode);
    };
    match fitness(node, target) {
        None => Selection::Fit(node),
        Some(reason) => Selection::Unfit(reason),
    }
}

fn injectable_loader(loader: ModLoader) -> Result<Loader, Unfit> {
    match loader {
        ModLoader::Fabric => Ok(Loader::Fabric),
        ModLoader::NeoForge => Ok(Loader::Neoforge),
        ModLoader::Forge => Ok(Loader::Forge),
        ModLoader::Vanilla => Err(Unfit::VanillaNeedsLoader),
        ModLoader::Quilt => Err(Unfit::QuiltUnsupported),
    }
}

fn fitness(node: &Node, target: &Target) -> Option<Unfit> {
    if !node.is_verified() {
        return Some(Unfit::Unverified);
    }
    loader_shortfall(node, target.loader_version)
        .or_else(|| java_shortfall(node, target.java_major))
}

fn loader_shortfall(node: &Node, loader_version: &str) -> Option<Unfit> {
    let (Some(have), Some(need)) = (
        LoaderVersion::parse(loader_version),
        LoaderVersion::parse(&node.loader_min),
    ) else {
        return Some(Unfit::LoaderVersionUnknown);
    };
    (have < need).then(|| Unfit::LoaderTooOld {
        need: node.loader_min.clone(),
    })
}

fn java_shortfall(node: &Node, java_major: Option<u32>) -> Option<Unfit> {
    match java_major {
        None => Some(Unfit::JavaUnknown),
        Some(have) if have < node.java_min => Some(Unfit::JavaTooOld {
            need: node.java_min,
        }),
        Some(_) => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::services::friends::ingame::test_support::{index_of, node, unverified};

    fn tracer_index() -> ModIndex {
        index_of(vec![
            node("26.3-fabric", Loader::Fabric, &["26.3"], "0.19.5", 25),
            node(
                "1.21.1-fabric",
                Loader::Fabric,
                &["1.21", "1.21.1"],
                "0.16.0",
                21,
            ),
            node(
                "1.20.1-fabric",
                Loader::Fabric,
                &["1.20", "1.20.1"],
                "0.14.21",
                17,
            ),
            node(
                "1.21.1-neoforge",
                Loader::Neoforge,
                &["1.21", "1.21.1"],
                "21.1.0",
                21,
            ),
            node("1.20.1-forge", Loader::Forge, &["1.20.1"], "47.1.0", 17),
            unverified(node(
                "1.20.4-fabric",
                Loader::Fabric,
                &["1.20.4"],
                "0.15.0",
                17,
            )),
        ])
    }

    fn pick<'a>(
        index: &'a ModIndex,
        minecraft: &str,
        loader: ModLoader,
        loader_version: &str,
        java: Option<u32>,
    ) -> Selection<'a> {
        select(
            index,
            &Target {
                minecraft,
                loader,
                loader_version,
                java_major: java,
            },
        )
    }

    #[test]
    fn a_matching_cell_selects_its_node() {
        let index = tracer_index();
        let cases = [
            ("26.3", ModLoader::Fabric, "0.19.5", 25, "26.3-fabric"),
            ("26.3", ModLoader::Fabric, "0.20.0", 25, "26.3-fabric"),
            ("26.3", ModLoader::Fabric, "0.19.5", 26, "26.3-fabric"),
            ("1.21", ModLoader::Fabric, "0.16.14", 21, "1.21.1-fabric"),
            ("1.21.1", ModLoader::Fabric, "0.16.0", 21, "1.21.1-fabric"),
            (
                "1.21.1",
                ModLoader::NeoForge,
                "21.1.172",
                21,
                "1.21.1-neoforge",
            ),
            ("1.20.1", ModLoader::Forge, "47.4.0", 17, "1.20.1-forge"),
            ("1.20.1", ModLoader::Forge, "47.4.0", 21, "1.20.1-forge"),
            ("1.20", ModLoader::Fabric, "0.16.14", 17, "1.20.1-fabric"),
        ];
        for (minecraft, loader, loader_version, java, expected) in cases {
            let Selection::Fit(node) = pick(&index, minecraft, loader, loader_version, Some(java))
            else {
                panic!("{minecraft} {loader:?} {loader_version} java {java}")
            };
            assert_eq!(node.id, expected);
        }
    }

    #[test]
    fn cells_that_do_not_exist_have_no_node() {
        let index = tracer_index();
        let cases = [
            ("26.4", ModLoader::Fabric),
            ("27.1", ModLoader::Fabric),
            ("1.21.2", ModLoader::Fabric),
            ("1.19.4", ModLoader::Fabric),
            ("1.21.1", ModLoader::Forge),
            ("1.20.1", ModLoader::NeoForge),
            ("26.3", ModLoader::NeoForge),
            ("24w14a", ModLoader::Fabric),
            ("1.21-pre1", ModLoader::Fabric),
            ("1.21.1-rc1", ModLoader::NeoForge),
            ("26.3-snapshot-1", ModLoader::Fabric),
            ("~1.21", ModLoader::Fabric),
            ("", ModLoader::Fabric),
        ];
        for (minecraft, loader) in cases {
            assert_eq!(
                pick(&index, minecraft, loader, "99.0.0", Some(25)),
                Selection::Unfit(Unfit::NoNode),
                "{minecraft} {loader:?}"
            );
        }
    }

    #[test]
    fn an_empty_index_selects_nothing() {
        let index = ModIndex::default();
        assert_eq!(
            pick(&index, "1.21.1", ModLoader::Fabric, "0.16.14", Some(21)),
            Selection::Unfit(Unfit::NoNode)
        );
    }

    #[test]
    fn an_unverified_cell_is_never_selected() {
        let index = tracer_index();
        for java in [Some(17), Some(25), None] {
            assert_eq!(
                pick(&index, "1.20.4", ModLoader::Fabric, "0.16.14", java),
                Selection::Unfit(Unfit::Unverified)
            );
        }
        assert_eq!(
            pick(&index, "1.20.4", ModLoader::Fabric, "0.14.0", Some(8)),
            Selection::Unfit(Unfit::Unverified)
        );
    }

    #[test]
    fn java_below_the_node_minimum_is_too_old() {
        let index = tracer_index();
        let cases = [
            ("1.21.1", ModLoader::Fabric, "0.16.14", 17, 21),
            ("26.3", ModLoader::Fabric, "0.19.5", 21, 25),
            ("1.21.1", ModLoader::NeoForge, "21.1.172", 8, 21),
        ];
        for (minecraft, loader, loader_version, java, need) in cases {
            assert_eq!(
                pick(&index, minecraft, loader, loader_version, Some(java)),
                Selection::Unfit(Unfit::JavaTooOld { need }),
                "{minecraft}"
            );
        }
    }

    #[test]
    fn an_unknown_java_never_selects() {
        let index = tracer_index();
        assert_eq!(
            pick(&index, "1.21.1", ModLoader::Fabric, "0.16.14", None),
            Selection::Unfit(Unfit::JavaUnknown)
        );
    }

    #[test]
    fn a_loader_older_than_the_minimum_is_too_old() {
        let index = tracer_index();
        let cases = [
            ("1.21.1", ModLoader::Fabric, "0.15.11", "0.16.0"),
            ("26.3", ModLoader::Fabric, "0.19.4", "0.19.5"),
            ("1.21.1", ModLoader::NeoForge, "20.4.237", "21.1.0"),
            ("1.20.1", ModLoader::Forge, "47.0.1", "47.1.0"),
        ];
        for (minecraft, loader, loader_version, need) in cases {
            let expected = Selection::Unfit(Unfit::LoaderTooOld {
                need: need.to_owned(),
            });
            assert_eq!(
                pick(&index, minecraft, loader, loader_version, Some(25)),
                expected,
                "{minecraft} {loader_version}"
            );
        }
    }

    #[test]
    fn a_loader_version_that_cannot_be_read_does_not_select() {
        let index = tracer_index();
        for loader_version in ["", "latest", "unknown"] {
            assert_eq!(
                pick(
                    &index,
                    "1.21.1",
                    ModLoader::Fabric,
                    loader_version,
                    Some(21)
                ),
                Selection::Unfit(Unfit::LoaderVersionUnknown),
                "{loader_version:?}"
            );
        }
    }

    #[test]
    fn a_loader_shortfall_is_reported_before_a_java_shortfall() {
        let index = tracer_index();
        assert!(matches!(
            pick(&index, "1.21.1", ModLoader::Fabric, "0.15.0", Some(17)),
            Selection::Unfit(Unfit::LoaderTooOld { .. })
        ));
    }

    #[test]
    fn loaders_without_an_injection_path_say_why() {
        let index = tracer_index();
        assert_eq!(
            pick(&index, "1.21.1", ModLoader::Vanilla, "", Some(21)),
            Selection::Unfit(Unfit::VanillaNeedsLoader)
        );
        assert_eq!(
            pick(&index, "1.21.1", ModLoader::Quilt, "0.26.0", Some(21)),
            Selection::Unfit(Unfit::QuiltUnsupported)
        );
    }
}
