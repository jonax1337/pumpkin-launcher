//! Die Mod-Quelle des Rauchtests: der Index und die JARs eines Gradle-Laufs (`gradlew modIndex`) statt der
//! eingebetteten. Jeder Knoten gilt hier als geprüft, denn der Rauchtest ist es, der die Prüfung erst liefert.
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};

use launcher_lib::services::friends::ingame::{sha256_hex, ModIndex, ModSource, Verified};

const INDEX_FILE: &str = "mod-index.json";
const SMOKE_DAY: &str = "2000-01-01";

pub struct DistSource {
    index: ModIndex,
    jars: HashMap<String, Vec<u8>>,
}

impl DistSource {
    pub fn open(dist: &Path) -> Result<Self, String> {
        let text = fs::read_to_string(dist.join(INDEX_FILE)).map_err(|error| format!("{}: {error}", dist.join(INDEX_FILE).display()))?;
        let mut index = ModIndex::parse(&text).map_err(|error| error.to_string())?;
        let mut jars = HashMap::new();
        for node in &mut index.nodes {
            let bytes = fs::read(dist.join(&node.file)).map_err(|error| format!("{}: {error}", node.file))?;
            jars.insert(node.file.clone(), bytes);
            node.verified = Some(Verified { smoke: SMOKE_DAY.to_owned(), owner: None });
        }
        Ok(Self { index, jars })
    }

    /// Lässt den Knoten `node_id` das JAR von `jar_of_node` ausliefern, samt dessen Prüfsumme im Index: der Start wird
    /// mit einem JAR versucht, das für diese Zelle nicht gebaut ist.
    pub fn serve_jar_of(&mut self, node_id: &str, jar_of_node: &str) -> Result<(), String> {
        let donor = self.index.node(jar_of_node).ok_or_else(|| format!("Knoten {jar_of_node} fehlt im Index"))?.file.clone();
        let bytes = self.jars[&donor].clone();
        let node = self.index.nodes.iter_mut().find(|node| node.id == node_id).ok_or_else(|| format!("Knoten {node_id} fehlt im Index"))?;
        node.sha256 = sha256_hex(&bytes);
        self.jars.insert(node.file.clone(), bytes);
        Ok(())
    }

    /// Legt eine Kopie des Jars des Knotens in `mods_dir` (Anhang B, Punkt 2): eine zweite `pumpkin_friends` als
    /// Instanzinhalt, neben der die Einspeisung nicht stattfinden darf. Liefert den Pfad, den der Lauf danach wieder
    /// entfernt — die Instanz bleibt für weitere Läufe der Zelle unverändert.
    pub fn place_copy_of(&self, node_id: &str, mods_dir: &Path) -> Result<PathBuf, String> {
        let node = self.index.node(node_id).ok_or_else(|| format!("Knoten {node_id} fehlt im Index"))?;
        let copy = mods_dir.join(format!("copy-of-{}", node.file));
        fs::create_dir_all(mods_dir).map_err(|error| error.to_string())?;
        fs::write(&copy, &self.jars[&node.file]).map_err(|error| format!("{}: {error}", copy.display()))?;
        Ok(copy)
    }
}

impl ModSource for DistSource {
    fn index(&self) -> &ModIndex {
        &self.index
    }

    fn jar_bytes(&self, file: &str) -> Option<&[u8]> {
        self.jars.get(file).map(Vec::as_slice)
    }
}
