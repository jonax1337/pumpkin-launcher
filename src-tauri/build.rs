//! Build-Skript: Tauri und die Einbettung der Mod (docs/friends/INGAME.md, 3.2).
//!
//! Liegt im Mod-Ordner (Umgebungsvariable `PUMPKIN_MOD_DIST`, sonst `<Repo>/mod/build/mod-index`) ein gültiger
//! `mod-index.json` samt JARs, bettet `ingame/embedded.rs` sie ein; sonst trägt der Build keine Mod und die
//! Einspeisung meldet „in diesem Build nicht verfügbar“. Der Index wird mit denselben Regeln geprüft wie zur Laufzeit.
use std::path::{Path, PathBuf};
use std::{env, fs};

use embed::{Embedding, JarEntry};

#[path = "build_support/embed.rs"]
mod embed;
// Die Regeldatei des Index, von Laufzeit und Build gemeinsam benutzt.
#[allow(dead_code)]
#[path = "src/services/friends/ingame/index.rs"]
mod index;
#[allow(dead_code)]
#[path = "src/services/friends/ingame/validate.rs"]
mod validate;
#[allow(dead_code)]
#[path = "src/services/friends/ingame/version.rs"]
mod version;

const DIST_ENV: &str = "PUMPKIN_MOD_DIST";
const DEFAULT_DIST: &str = "../mod/build/mod-index";
const GENERATED_FILE: &str = "embedded_mod.rs";

fn main() {
    tauri_build::build();
    if let Err(reason) = embed_friends_mod() {
        println!("cargo:warning=Freunde-Mod nicht eingebettet: {reason}");
    }
}

fn embed_friends_mod() -> Result<(), String> {
    println!("cargo:rerun-if-env-changed={DIST_ENV}");
    println!("cargo:rerun-if-changed=build_support/embed.rs");
    let dist = dist_folder();
    println!("cargo:rerun-if-changed={}", dist.display());
    let embedding = embed::inspect(&dist, jars_of_index);
    let (source, outcome) = match embed::render(&embedding) {
        Ok(source) => (source, rejection_of(&embedding)),
        Err(reason) => (embed::render_without_mod(), Err(reason)),
    };
    write_if_changed(&out_dir().join(GENERATED_FILE), &source)?;
    outcome
}

fn rejection_of(embedding: &Embedding) -> Result<(), String> {
    match embedding {
        Embedding::Rejected(reason) => Err(reason.clone()),
        Embedding::Absent | Embedding::Embedded { .. } => Ok(()),
    }
}

fn dist_folder() -> PathBuf {
    match env::var_os(DIST_ENV) {
        Some(folder) if !folder.is_empty() => PathBuf::from(folder),
        _ => Path::new(&env::var_os("CARGO_MANIFEST_DIR").expect("Cargo setzt CARGO_MANIFEST_DIR")).join(DEFAULT_DIST),
    }
}

fn out_dir() -> PathBuf {
    PathBuf::from(env::var_os("OUT_DIR").expect("Cargo setzt OUT_DIR"))
}

fn jars_of_index(text: &str) -> Result<Vec<JarEntry>, String> {
    let index = index::ModIndex::parse(text).map_err(|error| error.to_string())?;
    Ok(index.nodes.into_iter().map(|node| JarEntry { file: node.file, sha256: node.sha256 }).collect())
}

/// Schreibt die Datei nur bei geändertem Inhalt, damit ein unveränderter Build nichts neu übersetzen muss.
fn write_if_changed(path: &Path, content: &str) -> Result<(), String> {
    if fs::read_to_string(path).is_ok_and(|current| current == content) {
        return Ok(());
    }
    fs::write(path, content).map_err(|error| format!("{} ließ sich nicht schreiben: {error}", path.display()))
}
