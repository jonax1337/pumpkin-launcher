//! Erzeugt aus dem Mod-Ordner (`mod-index.json` und die JARs, INGAME 3.2) den Quelltext, der sie ins Programm einbettet.
//! Die Datei wird von `build.rs` eingebunden und, für ihre Tests, vom Crate (`ingame/embedded.rs`); sie kennt deshalb
//! nur die Standardbibliothek und die Hash-Crates. Was ein Index erfüllen muss, entscheidet der Aufrufer über den
//! Parser, den er übergibt: `build.rs` und Laufzeit prüfen mit derselben Regeldatei (`ingame/validate.rs`).
use std::fs;
use std::path::{Path, PathBuf};

use data_encoding::HEXLOWER;
use sha2::{Digest, Sha256};

/// Name der Indexdatei im Mod-Ordner.
pub const INDEX_FILE: &str = "mod-index.json";

/// Was der Index über ein JAR sagt: der Dateiname und der erwartete SHA-256.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct JarEntry {
    pub file: String,
    pub sha256: String,
}

/// Was aus dem Mod-Ordner wird.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Embedding {
    /// Es gibt keinen Mod-Ordner mit Index: der Build trägt keine Mod (`tauri dev`).
    Absent,
    /// Index und alle JARs sind gültig und werden eingebettet.
    Embedded { index: PathBuf, jars: Vec<(String, PathBuf)> },
    /// Der Ordner ist da, aber nicht brauchbar; der Build trägt keine Mod und nennt den Grund.
    Rejected(String),
}

/// Prüft den Ordner. `parse` liest den Indextext und liefert die JARs, die er nennt, oder den Grund der Ablehnung.
pub fn inspect(dist: &Path, parse: impl Fn(&str) -> Result<Vec<JarEntry>, String>) -> Embedding {
    let index = dist.join(INDEX_FILE);
    let Ok(text) = fs::read_to_string(&index) else {
        return if index.exists() { Embedding::Rejected(format!("{} ist nicht lesbar", index.display())) } else { Embedding::Absent };
    };
    match parse(&text).and_then(|entries| locate_jars(dist, &entries)) {
        Ok(jars) => Embedding::Embedded { index, jars },
        Err(reason) => Embedding::Rejected(reason),
    }
}

fn locate_jars(dist: &Path, entries: &[JarEntry]) -> Result<Vec<(String, PathBuf)>, String> {
    entries.iter().map(|entry| locate_jar(dist, entry)).collect()
}

fn locate_jar(dist: &Path, entry: &JarEntry) -> Result<(String, PathBuf), String> {
    let path = dist.join(&entry.file);
    let bytes = fs::read(&path).map_err(|error| format!("{} ist nicht lesbar: {error}", path.display()))?;
    let hash = HEXLOWER.encode(&Sha256::digest(&bytes));
    if hash != entry.sha256 {
        return Err(format!("{} passt nicht zur Prüfsumme im Index", path.display()));
    }
    Ok((entry.file.clone(), path))
}

/// Der Quelltext für `embedded.rs`: `parts()` liefert die eingebetteten Bytes oder `None`.
pub fn render(embedding: &Embedding) -> Result<String, String> {
    match embedding {
        Embedding::Embedded { index, jars } => {
            let jars = jars.iter().map(jar_item).collect::<Result<Vec<_>, _>>()?.join(", ");
            let parts = format!("Some(super::EmbeddedParts {{ index_json: include_str!({}), jars: &[{jars}] }})", literal(index)?);
            Ok(parts_function(&parts))
        }
        Embedding::Absent | Embedding::Rejected(_) => Ok(render_without_mod()),
    }
}

/// Der Quelltext für einen Build ohne Mod.
pub fn render_without_mod() -> String {
    parts_function("None")
}

fn parts_function(body: &str) -> String {
    format!("// Von build.rs erzeugt, nicht von Hand ändern.\npub(super) fn parts() -> Option<super::EmbeddedParts> {{\n    {body}\n}}\n")
}

fn jar_item((file, path): &(String, PathBuf)) -> Result<String, String> {
    Ok(format!("({file:?}, include_bytes!({}))", literal(path)?))
}

/// Ein Pfad als Zeichenkettenliteral (Rückstriche maskiert); ein Pfad, der kein Text ist, lässt sich nicht einbetten.
fn literal(path: &Path) -> Result<String, String> {
    let absolute = std::path::absolute(path).map_err(|error| format!("{}: {error}", path.display()))?;
    absolute.to_str().map(|text| format!("{text:?}")).ok_or_else(|| format!("{} ist kein Text", path.display()))
}

#[cfg(test)]
mod tests {
    use super::*;

    const JAR: &[u8] = b"PK-not-really-a-jar";

    struct Dist(PathBuf);

    impl Dist {
        fn new() -> Self {
            let path = std::env::temp_dir().join(format!("pumpkin-embed-{}", uuid::Uuid::new_v4().simple()));
            fs::create_dir_all(&path).unwrap();
            Self(path)
        }

        fn write(&self, name: &str, content: impl AsRef<[u8]>) {
            fs::write(self.0.join(name), content).unwrap();
        }
    }

    impl Drop for Dist {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    fn hash_of(bytes: &[u8]) -> String {
        HEXLOWER.encode(&Sha256::digest(bytes))
    }

    /// Ein Parser, der den Indextext als `Datei=Prüfsumme`-Zeilen liest; `invalid` lehnt alles ab.
    fn parse_lines(text: &str) -> Result<Vec<JarEntry>, String> {
        if text == "invalid" {
            return Err("Index ungültig".to_owned());
        }
        Ok(text.lines().filter_map(|line| line.split_once('=')).map(|(file, sha256)| JarEntry { file: file.into(), sha256: sha256.into() }).collect())
    }

    #[test]
    fn a_folder_with_a_valid_index_and_matching_jars_is_embedded() {
        let dist = Dist::new();
        dist.write("a.jar", JAR);
        dist.write(INDEX_FILE, format!("a.jar={}", hash_of(JAR)));

        let embedding = inspect(&dist.0, parse_lines);

        let Embedding::Embedded { index, jars } = embedding else { panic!("nicht eingebettet: {embedding:?}") };
        assert_eq!(index, dist.0.join(INDEX_FILE));
        assert_eq!(jars, [("a.jar".to_owned(), dist.0.join("a.jar"))]);
    }

    #[test]
    fn a_jar_whose_hash_differs_from_the_index_rejects_the_folder() {
        let dist = Dist::new();
        dist.write("a.jar", JAR);
        dist.write(INDEX_FILE, format!("a.jar={}", hash_of(b"something else")));

        let Embedding::Rejected(reason) = inspect(&dist.0, parse_lines) else { panic!("nicht abgelehnt") };

        assert!(reason.contains("Prüfsumme"), "{reason}");
    }

    #[test]
    fn a_jar_named_by_the_index_but_missing_rejects_the_folder() {
        let dist = Dist::new();
        dist.write(INDEX_FILE, format!("gone.jar={}", hash_of(JAR)));

        assert!(matches!(inspect(&dist.0, parse_lines), Embedding::Rejected(_)));
    }

    #[test]
    fn an_index_the_parser_refuses_rejects_the_folder() {
        let dist = Dist::new();
        dist.write(INDEX_FILE, "invalid");

        assert_eq!(inspect(&dist.0, parse_lines), Embedding::Rejected("Index ungültig".to_owned()));
    }

    #[test]
    fn a_folder_without_an_index_or_a_missing_folder_means_no_mod_in_this_build() {
        let dist = Dist::new();
        assert_eq!(inspect(&dist.0, parse_lines), Embedding::Absent);
        assert_eq!(inspect(&dist.0.join("gibt-es-nicht"), parse_lines), Embedding::Absent);
    }

    #[test]
    fn an_embedding_renders_include_macros_with_escaped_absolute_paths() {
        let embedding = Embedding::Embedded {
            index: PathBuf::from(r"C:\mod dist\mod-index.json"),
            jars: vec![("a.jar".to_owned(), PathBuf::from(r"C:\mod dist\a.jar"))],
        };

        let source = render(&embedding).unwrap();

        let absolute = std::path::absolute(r"C:\mod dist\mod-index.json").unwrap();
        assert!(source.contains(&format!("include_str!({:?})", absolute.to_str().unwrap())), "{source}");
        assert!(source.contains(r#"("a.jar", include_bytes!("#), "{source}");
        assert!(source.contains("Some(super::EmbeddedParts"), "{source}");
    }

    #[test]
    fn without_an_embedding_the_generated_source_offers_no_parts() {
        for embedding in [Embedding::Absent, Embedding::Rejected("kaputt".to_owned())] {
            let source = render(&embedding).unwrap();
            assert!(source.contains("    None\n"), "{source}");
            assert!(!source.contains("include_"), "{source}");
        }
    }
}
