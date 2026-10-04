//! Was ein Lauf des Rauchtests wissen muss, aus Umgebungsvariablen (siehe `tools/mod-smoke/README.md`).
use std::env;
use std::path::PathBuf;
use std::time::Duration;

/// Hartes Zeitlimit eines Spielstarts, wenn nichts anderes verlangt wird (INGAME 10, Schicht 4).
const DEFAULT_TIMEOUT_SECS: u64 = 240;
const SCENARIO_SEPARATOR: char = ':';

/// Was der Lauf mit dem Spiel anstellt.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Scenario {
    /// Der Normalfall: die Haltevorrichtung des JARs (`FILE_SHARE_READ`) bleibt bis zum Ende des Spiels offen, das ist
    /// strenger als im Launcher und beantwortet die Frage von Anhang B, Punkt 6.
    HoldGuard,
    /// Wie der Launcher: die Haltevorrichtung fällt, sobald das Spiel gestartet ist.
    ReleaseGuardAtSpawn,
    /// Der Knoten der Zelle liefert das JAR eines anderen Knotens (echter Fehlstart, siehe `fixtures/`).
    WrongJar { jar_of_node: String },
    /// Das Tor sieht das Java der Zelle, das Spiel läuft aber mit diesem (echter Fehlstart durch zu altes Java).
    SpawnWithJava { java: PathBuf },
    /// Eine Kopie des Jars der Zelle liegt im Mods-Ordner der Instanz (Anhang B, Punkt 2): das Tor muss die Einspeisung
    /// verweigern, statt zwei pumpkin_friends zu starten; das Spiel startet unberührt.
    DuplicateId,
}

impl Scenario {
    fn parse(text: &str) -> Result<Self, String> {
        let (name, argument) = text.split_once(SCENARIO_SEPARATOR).map_or((text, ""), |(name, argument)| (name, argument));
        match (name, argument) {
            ("" | "hold", "") => Ok(Self::HoldGuard),
            ("release", "") => Ok(Self::ReleaseGuardAtSpawn),
            ("wrong-jar", node) if !node.is_empty() => Ok(Self::WrongJar { jar_of_node: node.to_owned() }),
            ("spawn-java", path) if !path.is_empty() => Ok(Self::SpawnWithJava { java: PathBuf::from(path) }),
            ("duplicate-id", "") => Ok(Self::DuplicateId),
            _ => Err(format!("unknown scenario '{text}' (hold | release | wrong-jar:<node> | spawn-java:<path> | duplicate-id)")),
        }
    }

    /// Kurzname für Dateinamen und den Bericht.
    pub fn label(&self) -> String {
        match self {
            Self::HoldGuard => "hold".to_owned(),
            Self::ReleaseGuardAtSpawn => "release".to_owned(),
            Self::WrongJar { jar_of_node } => format!("wrong-jar-{jar_of_node}"),
            Self::SpawnWithJava { .. } => "spawn-java".to_owned(),
            Self::DuplicateId => "duplicate-id".to_owned(),
        }
    }

    /// Ein Szenario, das den Start absichtlich scheitern lässt: sein Bestehen heißt, dass der Fehler im Log steht.
    pub fn expects_failed_start(&self) -> bool {
        matches!(self, Self::WrongJar { .. } | Self::SpawnWithJava { .. })
    }
}

pub struct Config {
    pub cell: String,
    /// Ordner mit `mod-index.json` und den JARs (Ergebnis von `gradlew modIndex`).
    pub dist: PathBuf,
    /// Datenordner des Launchers; hier liegen Versionen, Libraries, Assets, Runtimes und die Mod.
    pub data: PathBuf,
    /// Hierhin gehen Bericht und vollständiges Spiel-Log.
    pub out: PathBuf,
    pub timeout: Duration,
    pub scenario: Scenario,
    /// Feste Loader-Version statt der neuesten stabilen.
    pub loader_version: Option<String>,
}

impl Config {
    /// `None`, wenn keine Zelle verlangt ist: dann gibt es nichts zu starten.
    pub fn from_env() -> Result<Option<Self>, String> {
        let Some(cell) = var("PUMPKIN_SMOKE_CELL") else { return Ok(None) };
        let data = var("PUMPKIN_SMOKE_DATA").map(PathBuf::from).ok_or("PUMPKIN_SMOKE_DATA fehlt (Datenordner des Launchers, nie auf E:)")?;
        let dist = var("PUMPKIN_SMOKE_DIST").map(PathBuf::from).unwrap_or_else(default_dist);
        let out = var("PUMPKIN_SMOKE_OUT").map(PathBuf::from).unwrap_or_else(|| data.join("smoke-reports"));
        let timeout = var("PUMPKIN_SMOKE_TIMEOUT_SECS").map_or(Ok(DEFAULT_TIMEOUT_SECS), |text| text.parse().map_err(|_| format!("PUMPKIN_SMOKE_TIMEOUT_SECS '{text}' ist keine Zahl")))?;
        let scenario = Scenario::parse(&var("PUMPKIN_SMOKE_SCENARIO").unwrap_or_default())?;
        Ok(Some(Self { cell, dist, data, out, timeout: Duration::from_secs(timeout), scenario, loader_version: var("PUMPKIN_SMOKE_LOADER_VERSION") }))
    }
}

fn var(name: &str) -> Option<String> {
    env::var(name).ok().filter(|value| !value.trim().is_empty())
}

fn default_dist() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../mod/build/mod-index")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn scenarios_are_read_by_name_with_their_argument() {
        assert_eq!(Scenario::parse(""), Ok(Scenario::HoldGuard));
        assert_eq!(Scenario::parse("release"), Ok(Scenario::ReleaseGuardAtSpawn));
        assert_eq!(Scenario::parse("wrong-jar:26.3-fabric"), Ok(Scenario::WrongJar { jar_of_node: "26.3-fabric".to_owned() }));
        assert_eq!(Scenario::parse(r"spawn-java:C:\jdk\bin\java.exe"), Ok(Scenario::SpawnWithJava { java: PathBuf::from(r"C:\jdk\bin\java.exe") }));
        assert_eq!(Scenario::parse("duplicate-id"), Ok(Scenario::DuplicateId));
    }

    #[test]
    fn a_scenario_without_its_argument_or_unknown_is_refused() {
        for text in ["wrong-jar", "wrong-jar:", "spawn-java:", "hold:1", "dance"] {
            assert!(Scenario::parse(text).is_err(), "{text}");
        }
    }
}
