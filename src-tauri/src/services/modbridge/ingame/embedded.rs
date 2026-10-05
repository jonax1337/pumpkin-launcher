//! Die ins Programm eingebetteten Mod-JARs (INGAME 3.2). `build.rs` liest den Mod-Ordner und erzeugt `embedded_mod.rs`
//! mit `include_str!` und `include_bytes!`; hier wird daraus die [`ModSource`] des Builds. Ohne gültigen Mod-Ordner
//! (`tauri dev`) ist sie leer, und die Einspeisung meldet „in diesem Build nicht verfügbar“.
use std::sync::OnceLock;

use super::index::{EmptySource, IndexError, ModIndex, ModSource};

mod generated {
    include!(concat!(env!("OUT_DIR"), "/embedded_mod.rs"));
}

/// Jar-Datei und Bytes, wie `build.rs` sie einbettet.
type EmbeddedJar = (&'static str, &'static [u8]);

/// Indextext und JAR-Bytes aus dem Build.
#[derive(Clone, Copy)]
pub struct EmbeddedParts {
    pub index_json: &'static str,
    pub jars: &'static [EmbeddedJar],
}

/// Die Quelle aus eingebetteten Bytes. Der Index ist geprüft, die Prüfsummen der JARs prüft [`materialise`](super::materialise)
/// vor jedem Start.
pub struct EmbeddedSource {
    index: ModIndex,
    jars: &'static [EmbeddedJar],
}

impl EmbeddedSource {
    pub fn open(parts: EmbeddedParts) -> Result<Self, IndexError> {
        Ok(Self {
            index: ModIndex::parse(parts.index_json)?,
            jars: parts.jars,
        })
    }
}

impl ModSource for EmbeddedSource {
    fn index(&self) -> &ModIndex {
        &self.index
    }

    fn jar_bytes(&self, file: &str) -> Option<&[u8]> {
        self.jars
            .iter()
            .find(|(name, _)| *name == file)
            .map(|(_, bytes)| *bytes)
    }
}

/// Die Quelle dieses Builds.
pub fn build_source() -> &'static (dyn ModSource + Send + Sync) {
    static SOURCE: OnceLock<Box<dyn ModSource + Send + Sync>> = OnceLock::new();
    SOURCE
        .get_or_init(|| source_of(generated::parts()))
        .as_ref()
}

/// Ein Index, der nicht gilt, wird wie ein fehlender behandelt: lieber keine Einspeisung als eine mit geratenen Werten.
fn source_of(parts: Option<EmbeddedParts>) -> Box<dyn ModSource + Send + Sync> {
    match parts.map(EmbeddedSource::open) {
        Some(Ok(source)) => Box::new(source),
        Some(Err(error)) => {
            tracing::warn!(%error, "Eingebetteter Mod-Index ungültig, die Einspeisung ist in diesem Build aus");
            Box::new(EmptySource::default())
        }
        None => Box::new(EmptySource::default()),
    }
}

#[cfg(test)]
#[path = "../../../../build_support/embed.rs"]
mod generator;

#[cfg(test)]
mod tests {
    use super::*;
    use crate::services::modbridge::ingame::materialise::sha256_hex;

    const JAR_FILE: &str = "pumpkin_bridge-2.1.0+1.21.1-fabric.jar";
    const JAR_BYTES: &[u8] = b"jar bytes";

    fn index_json() -> String {
        format!(
            r#"{{ "modVersion": "2.1.0", "nodes": [ {{ "id": "1.21.1-fabric", "loader": "fabric", "loaderMin": "0.16.0",
               "minecraft": ["1.21.1"], "javaMin": 21, "strategy": "fabricAddMods", "file": "{JAR_FILE}",
               "sha256": "{}", "verified": null }} ] }}"#,
            sha256_hex(JAR_BYTES)
        )
    }

    fn parts_with(index_json: String) -> EmbeddedParts {
        let jars: &'static [EmbeddedJar] = Box::leak(Box::new([(JAR_FILE, JAR_BYTES)]));
        EmbeddedParts {
            index_json: Box::leak(index_json.into_boxed_str()),
            jars,
        }
    }

    #[test]
    fn embedded_parts_become_a_source_with_the_nodes_and_their_jars() {
        let source = source_of(Some(parts_with(index_json())));

        assert_eq!(source.index().nodes.len(), 1);
        assert_eq!(source.jar_bytes(JAR_FILE), Some(JAR_BYTES));
        assert_eq!(source.jar_bytes("other.jar"), None);
    }

    #[test]
    fn a_build_without_a_mod_folder_offers_nothing() {
        let source = source_of(None);

        assert!(source.index().nodes.is_empty());
        assert_eq!(source.jar_bytes(JAR_FILE), None);
    }

    #[test]
    fn an_embedded_index_the_launcher_refuses_leaves_the_build_without_a_mod() {
        let source = source_of(Some(parts_with(
            r#"{ "modVersion": "2.1.0", "nodes": "kaputt" }"#.to_owned(),
        )));

        assert!(source.index().nodes.is_empty());
    }

    #[test]
    fn this_build_reports_what_the_generator_embedded() {
        let source = build_source();

        assert!(source
            .index()
            .nodes
            .iter()
            .all(|node| source.jar_bytes(&node.file).is_some()));
    }

    #[test]
    fn the_generator_accepts_what_the_launcher_accepts_and_nothing_else() {
        let dist = std::env::temp_dir().join(format!(
            "pumpkin-embedded-{}",
            uuid::Uuid::new_v4().simple()
        ));
        std::fs::create_dir_all(&dist).unwrap();
        std::fs::write(dist.join(JAR_FILE), JAR_BYTES).unwrap();
        std::fs::write(dist.join(generator::INDEX_FILE), index_json()).unwrap();
        let parse = |text: &str| {
            let index = ModIndex::parse(text).map_err(|error| error.to_string())?;
            Ok(index
                .nodes
                .into_iter()
                .map(|node| generator::JarEntry {
                    file: node.file,
                    sha256: node.sha256,
                })
                .collect())
        };

        let embedding = generator::inspect(&dist, parse);

        assert!(
            matches!(embedding, generator::Embedding::Embedded { .. }),
            "{embedding:?}"
        );
        std::fs::write(dist.join(JAR_FILE), b"tampered").unwrap();
        assert!(matches!(
            generator::inspect(&dist, parse),
            generator::Embedding::Rejected(_)
        ));
        let _ = std::fs::remove_dir_all(dist);
    }
}
