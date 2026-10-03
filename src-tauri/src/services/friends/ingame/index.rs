//! Der Mod-Index (`mod-index.json`): welche Mod-JARs der Launcher mitbringt und für welche Instanzen sie taugen.
//! Das Gradle-Projekt unter `mod/` schreibt ihn, der Launcher liest ihn nur (INGAME 3.2). Das Schema liegt in
//! `mod/index.schema.json`; die Regeln, die ein Schema nicht ausdrückt, prüft [`validate`](super::validate).
use serde::{Deserialize, Serialize};

use super::validate;

/// Der ganze Index: die Mod-Version und ein Knoten je Bauziel.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ModIndex {
    pub mod_version: String,
    pub nodes: Vec<Node>,
}

/// Ein Bauziel `<Minecraft-Bereich>-<Loader>` mit genau einem JAR.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Node {
    pub id: String,
    pub loader: Loader,
    /// Kleinste Loader-Version (Fabric Loader, NeoForge, Forge), mit der das JAR läuft.
    pub loader_min: String,
    /// Ausdrückliche Mojang-Release-Ids, nie ein Bereich und nie ein Snapshot.
    pub minecraft: Vec<String>,
    pub java_min: u32,
    pub strategy: Strategy,
    /// Reiner Dateiname des JARs, unter dem es der Index-Quelle bekannt ist.
    pub file: String,
    /// SHA-256 des JARs, 64 Hexzeichen in Kleinbuchstaben.
    pub sha256: String,
    #[serde(default)]
    pub verified: Option<Verified>,
}

impl Node {
    /// Ob der Rauchtest dieses Knotens bestanden ist; ein Knoten ohne Eintrag ist aus (INGAME 2.1, Punkt 3).
    pub fn is_verified(&self) -> bool {
        self.verified.is_some()
    }

    /// Ob der Knoten genau diese Minecraft-Release-Id bedient.
    pub fn serves_minecraft(&self, release_id: &str) -> bool {
        self.minecraft.iter().any(|id| id == release_id)
    }
}

/// Die Loader, in die der Launcher einspeisen kann.
#[derive(Debug, Clone, Copy, PartialEq, Eq, std::hash::Hash, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Loader {
    Fabric,
    Neoforge,
    Forge,
}

/// Wie das JAR dem Loader übergeben wird (INGAME 3.5); die Zuordnung steht im Index, nicht im Code.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Strategy {
    FabricAddMods,
    FmlMavenRoot,
    FmlModFolders,
}

impl Strategy {
    /// Alle Strategien mit ihrer Id im Index, in der Reihenfolge des Schemas.
    pub const IDS: [&'static str; 3] = ["fabricAddMods", "fmlMavenRoot", "fmlModFolders"];

    /// Ob der Loader diese Strategie versteht.
    pub fn suits(self, loader: Loader) -> bool {
        matches!((self, loader), (Self::FabricAddMods, Loader::Fabric) | (Self::FmlMavenRoot | Self::FmlModFolders, Loader::Neoforge | Loader::Forge))
    }
}

/// Der Beleg, dass der Rauchtest dieses Knotens auf dem Commit bestanden hat, der ihn gebaut hat.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Verified {
    /// Tag des Rauchtests, `JJJJ-MM-TT`.
    pub smoke: String,
    /// Tag, an dem der Besitzer die Zelle von Hand geprüft hat.
    #[serde(default)]
    pub owner: Option<String>,
}

/// Warum ein Index nicht angenommen wird.
#[derive(Debug, thiserror::Error, PartialEq, Eq)]
pub enum IndexError {
    #[error("Der Mod-Index ist kein gültiges JSON in der erwarteten Form: {0}")]
    Malformed(String),
    #[error("Die Mod-Version \"{0}\" ist kein reiner Versionsname")]
    ModVersionInvalid(String),
    #[error("Die Knoten-Id \"{0}\" ist kein reiner Name")]
    NodeIdInvalid(String),
    #[error("Die Knoten-Id \"{0}\" kommt mehrfach vor")]
    NodeIdDuplicate(String),
    #[error("Knoten {node}: loaderMin \"{value}\" ist keine Versionsnummer")]
    LoaderMinInvalid { node: String, value: String },
    #[error("Knoten {node}: minecraft muss ausdrückliche Release-Ids nennen, nicht \"{value}\"")]
    MinecraftIdInvalid { node: String, value: String },
    #[error("Knoten {node}: minecraft darf nicht leer sein und keine Id doppelt nennen")]
    MinecraftListInvalid { node: String },
    #[error("Knoten {node}: die Release-Id {minecraft} wird für {loader:?} schon von {other} bedient")]
    MinecraftIdClaimedTwice { node: String, minecraft: String, loader: Loader, other: String },
    #[error("Knoten {node}: javaMin {value} liegt außerhalb von {min} bis {max}")]
    JavaMinInvalid { node: String, value: u32, min: u32, max: u32 },
    #[error("Knoten {node}: die Strategie {strategy:?} passt nicht zum Loader {loader:?}")]
    StrategyMismatch { node: String, strategy: Strategy, loader: Loader },
    #[error("Knoten {node}: \"{value}\" ist kein reiner JAR-Dateiname")]
    FileNameInvalid { node: String, value: String },
    #[error("Knoten {node}: die Datei {file} gehört schon zu {other}")]
    FileNameDuplicate { node: String, file: String, other: String },
    #[error("Knoten {node}: sha256 muss 64 Hexzeichen in Kleinbuchstaben sein")]
    Sha256Invalid { node: String },
    #[error("Knoten {node}: verified.smoke \"{value}\" ist kein Datum JJJJ-MM-TT")]
    VerifiedDateInvalid { node: String, value: String },
}

impl ModIndex {
    /// Liest und prüft einen Index. Unbekannte Felder, unbekannte Loader oder Strategien und jede Regelverletzung
    /// lehnen den ganzen Index ab: lieber keine Einspeisung als eine mit geratenen Werten.
    pub fn parse(json: &str) -> Result<Self, IndexError> {
        let index: Self = serde_json::from_str(json).map_err(|error| IndexError::Malformed(error.to_string()))?;
        validate::index(&index)?;
        Ok(index)
    }

    /// Der Knoten mit dieser Id.
    pub fn node(&self, id: &str) -> Option<&Node> {
        self.nodes.iter().find(|node| node.id == id)
    }

    /// Der Knoten, der diese Minecraft-Release-Id für diesen Loader bedient. Höchstens einer: die Prüfung
    /// verbietet Überschneidungen.
    pub fn node_serving(&self, loader: Loader, release_id: &str) -> Option<&Node> {
        self.nodes.iter().find(|node| node.loader == loader && node.serves_minecraft(release_id))
    }
}

/// Woher Index und JAR-Bytes kommen. Der Launcher bettet beides ein; Tests schieben eine Attrappe unter.
pub trait ModSource {
    fn index(&self) -> &ModIndex;

    /// Die Bytes des JARs mit diesem Dateinamen aus dem Index.
    fn jar_bytes(&self, file: &str) -> Option<&[u8]>;
}

/// Die Quelle ohne Mod: Entwicklungsbuilds (`tauri dev`) tragen keine JARs, die Einspeisung meldet dann „in diesem
/// Build nicht verfügbar“. Eine spätere Welle ersetzt sie durch die eingebetteten JARs.
#[derive(Debug, Default)]
pub struct EmptySource {
    index: ModIndex,
}

impl ModSource for EmptySource {
    fn index(&self) -> &ModIndex {
        &self.index
    }

    fn jar_bytes(&self, _file: &str) -> Option<&[u8]> {
        None
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_empty_source_offers_nothing() {
        let source = EmptySource::default();
        assert!(source.index().nodes.is_empty());
        assert_eq!(source.jar_bytes("pumpkin_friends-2.1.0+1.21.1-neoforge.jar"), None);
    }

    #[test]
    fn strategy_ids_match_the_serde_names() {
        for (strategy, id) in [(Strategy::FabricAddMods, Strategy::IDS[0]), (Strategy::FmlMavenRoot, Strategy::IDS[1]), (Strategy::FmlModFolders, Strategy::IDS[2])] {
            assert_eq!(serde_json::to_value(strategy).unwrap(), id);
        }
    }

    #[test]
    fn each_strategy_suits_only_its_loaders() {
        let cases = [
            (Strategy::FabricAddMods, Loader::Fabric, true),
            (Strategy::FabricAddMods, Loader::Neoforge, false),
            (Strategy::FabricAddMods, Loader::Forge, false),
            (Strategy::FmlMavenRoot, Loader::Neoforge, true),
            (Strategy::FmlMavenRoot, Loader::Forge, true),
            (Strategy::FmlMavenRoot, Loader::Fabric, false),
            (Strategy::FmlModFolders, Loader::Neoforge, true),
            (Strategy::FmlModFolders, Loader::Forge, true),
            (Strategy::FmlModFolders, Loader::Fabric, false),
        ];
        for (strategy, loader, expected) in cases {
            assert_eq!(strategy.suits(loader), expected, "{strategy:?} {loader:?}");
        }
    }
}
