//! Bausteine für die Tests der Einspeisung: Knoten und Indizes aus wenigen Angaben, eine Quelle mit Attrappen-JARs
//! und ein Ordner, der sich auch mit schreibgeschützten Dateien wieder löschen lässt.
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};

use super::index::{Loader, ModIndex, ModSource, Node, Strategy, Verified};
use super::materialise::sha256_hex;

pub const MOD_VERSION: &str = "2.1.0";

fn default_strategy(loader: Loader) -> Strategy {
    match loader {
        Loader::Fabric => Strategy::FabricAddMods,
        Loader::Neoforge | Loader::Forge => Strategy::FmlMavenRoot,
    }
}

fn file_of(id: &str) -> String {
    format!("pumpkin_friends-{MOD_VERSION}+{id}.jar")
}

/// Ein geprüfter Knoten mit gültigen, aber beliebigen Prüfsummen.
pub fn node(id: &str, loader: Loader, minecraft: &[&str], loader_min: &str, java_min: u32) -> Node {
    Node {
        id: id.to_owned(),
        loader,
        loader_min: loader_min.to_owned(),
        minecraft: minecraft.iter().map(|&release| release.to_owned()).collect(),
        java_min,
        strategy: default_strategy(loader),
        file: file_of(id),
        sha256: "ab".repeat(32),
        verified: Some(Verified { smoke: "2026-10-03".to_owned(), owner: None }),
    }
}

/// Derselbe Knoten ohne bestandenen Rauchtest.
pub fn unverified(node: Node) -> Node {
    Node { verified: None, ..node }
}

/// Ein geprüfter Knoten, dessen Prüfsumme zu `jar` passt.
pub fn jar_node(id: &str, loader: Loader, jar: &[u8]) -> Node {
    Node { sha256: sha256_hex(jar), ..node(id, loader, &["1.21.1"], "0.16.0", 21) }
}

pub fn index_of(nodes: Vec<Node>) -> ModIndex {
    ModIndex { mod_version: MOD_VERSION.to_owned(), nodes }
}

/// Eine Quelle, die genau die angegebenen JARs kennt.
pub struct FakeSource {
    index: ModIndex,
    jars: HashMap<String, Vec<u8>>,
}

impl FakeSource {
    pub fn empty() -> Self {
        Self { index: index_of(Vec::new()), jars: HashMap::new() }
    }

    /// Der Index nennt den Knoten, die Quelle hat sein JAR aber nicht.
    pub fn indexed_without_jar(node: &Node) -> Self {
        Self { index: index_of(vec![node.clone()]), jars: HashMap::new() }
    }

    pub fn with_jar(node: &Node, bytes: &[u8]) -> Self {
        Self { index: index_of(vec![node.clone()]), jars: HashMap::from([(node.file.clone(), bytes.to_vec())]) }
    }
}

impl ModSource for FakeSource {
    fn index(&self) -> &ModIndex {
        &self.index
    }

    fn jar_bytes(&self, file: &str) -> Option<&[u8]> {
        self.jars.get(file).map(Vec::as_slice)
    }
}

/// Ein frischer Ordner, der beim Verwerfen samt schreibgeschützter Dateien verschwindet.
pub struct TempDir(PathBuf);

impl TempDir {
    pub fn new() -> Self {
        let path = std::env::temp_dir().join(format!("pumpkin-ingame-{}", uuid::Uuid::new_v4().simple()));
        fs::create_dir_all(&path).unwrap();
        Self(path)
    }

    pub fn path(&self) -> &Path {
        &self.0
    }
}

impl Drop for TempDir {
    fn drop(&mut self) {
        make_all_writable(&self.0);
        let _ = fs::remove_dir_all(&self.0);
    }
}

/// Hebt den Schreibschutz einer Datei auf (Tests, die ein abgelegtes JAR verändern).
#[allow(clippy::permissions_set_readonly_false)] // nur Testdateien in einem eigenen Temp-Ordner
pub fn make_writable(path: &Path) {
    if let Ok(meta) = fs::metadata(path) {
        let mut permissions = meta.permissions();
        permissions.set_readonly(false);
        let _ = fs::set_permissions(path, permissions);
    }
}

fn make_all_writable(path: &Path) {
    make_writable(path);
    if let Ok(entries) = fs::read_dir(path) {
        entries.flatten().for_each(|entry| make_all_writable(&entry.path()));
    }
}
