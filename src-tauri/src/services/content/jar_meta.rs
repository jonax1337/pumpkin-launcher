//! Liest aus einer Mod-JAR, was sie über sich selbst sagt: für welchen Loader sie gebaut ist, welche Mod-IDs sie
//! mitbringt und was sie braucht (`fabric.mod.json`, `quilt.mod.json`, `META-INF/mods.toml`,
//! `META-INF/neoforge.mods.toml`), dazu die IDs der eingebetteten JARs. Gelesen wird nur das Nötige, mit den Grenzen
//! aus `limits` und `zip_guard`.
use std::{
    fs,
    io::{Cursor, Read, Seek},
    path::Path,
};

use serde_json::Value;
use zip::{result::ZipError, ZipArchive};

use crate::{
    error::AppResult,
    models::ModLoader,
    services::{
        limits::{MIB, PROVIDER_ZIP_ENTRIES},
        zip_guard::{check_entry_count, read_entry, reject_special, ExpandedSize},
    },
};

/// Größte Metadatei, die gelesen wird.
const META_LIMIT: u64 = MIB;
/// Größte eingebettete JAR, deren IDs gelesen werden; größere bleiben außen vor.
const NESTED_JAR_LIMIT: u64 = 16 * MIB;
/// Eingebettete JARs je Datei, die gelesen werden.
const MAX_NESTED_JARS: usize = 256;
/// Entpackte Bytes je Datei, die das Lesen insgesamt anfassen darf.
const READ_BUDGET: u64 = 64 * MIB;
/// ZIP-Ordner, in denen Loader eingebettete JARs ablegen (Fabric, Forge und NeoForge).
const NESTED_FOLDERS: [&str; 2] = ["META-INF/jars/", "META-INF/jarjar/"];

/// Eine Abhängigkeit aus den Metadaten. `ranges` sind die Versionsbedingungen, mehrere gelten als „oder“.
#[derive(Debug, Clone, PartialEq)]
pub(super) struct Dependency {
    pub id: String,
    pub required: bool,
    pub ranges: Vec<String>,
}

/// Was die Metadaten eines Loaders sagen: die erste ID ist die der Mod selbst, die übrigen sind Aliase (`provides`).
#[derive(Debug, Clone, PartialEq)]
pub(super) struct Declared {
    pub loader: ModLoader,
    pub ids: Vec<String>,
    pub depends: Vec<Dependency>,
}

/// Alles, was eine JAR über sich verrät. Ohne `declared` (kein Loader erkannt) gibt es nichts zu prüfen.
#[derive(Debug, Default, Clone, PartialEq)]
pub(super) struct JarInfo {
    pub declared: Vec<Declared>,
    /// Mod-IDs eingebetteter JARs (z. B. die Module der Fabric API): auch sie erfüllen Abhängigkeiten.
    pub nested_ids: Vec<String>,
}

pub(super) fn read_jar(path: &Path) -> AppResult<JarInfo> {
    let mut zip = ZipArchive::new(fs::File::open(path)?)?;
    check_entry_count(zip.len(), PROVIDER_ZIP_ENTRIES)?;
    let mut budget = ExpandedSize::new(READ_BUDGET);
    let declared = declared_in(&mut zip, &mut budget)?;
    let nested_ids = nested_ids(&mut zip, &mut budget)?;
    Ok(JarInfo { declared, nested_ids })
}

/// Die Metadaten der Loader in der JAR; eine JAR für mehrere Loader hat mehrere.
fn declared_in<R: Read + Seek>(zip: &mut ZipArchive<R>, budget: &mut ExpandedSize) -> AppResult<Vec<Declared>> {
    let mut text = |name: &str| -> AppResult<Option<String>> {
        Ok(entry_bytes(zip, name, META_LIMIT, budget)?.and_then(|bytes| String::from_utf8(bytes).ok()))
    };
    let declared = [
        text("fabric.mod.json")?.and_then(|json| fabric(&json)),
        text("quilt.mod.json")?.and_then(|json| quilt(&json)),
        text("META-INF/mods.toml")?.and_then(|toml| forge_like(&toml, ModLoader::Forge)),
        text("META-INF/neoforge.mods.toml")?.and_then(|toml| forge_like(&toml, ModLoader::NeoForge)),
    ];
    Ok(declared.into_iter().flatten().collect())
}

/// Der Inhalt des Eintrags `name`; `None`, wenn es ihn nicht gibt, er ein Ordner ist oder über `limit` liegt.
fn entry_bytes<R: Read + Seek>(
    zip: &mut ZipArchive<R>,
    name: &str,
    limit: u64,
    budget: &mut ExpandedSize,
) -> AppResult<Option<Vec<u8>>> {
    let mut entry = match zip.by_name(name) {
        Ok(entry) => entry,
        Err(ZipError::FileNotFound) => return Ok(None),
        Err(err) => return Err(err.into()),
    };
    if entry.is_dir() || entry.size() > limit {
        return Ok(None);
    }
    reject_special(&entry)?;
    budget.add_entry(&entry)?;
    Ok(Some(read_entry(&mut entry, limit)?))
}

/// IDs der eingebetteten JARs, eine Ebene tief.
fn nested_ids<R: Read + Seek>(zip: &mut ZipArchive<R>, budget: &mut ExpandedSize) -> AppResult<Vec<String>> {
    let names: Vec<String> = zip
        .file_names()
        .filter(|name| NESTED_FOLDERS.iter().any(|folder| name.starts_with(folder)) && name.ends_with(".jar"))
        .take(MAX_NESTED_JARS)
        .map(String::from)
        .collect();
    let mut ids = Vec::new();
    for name in names {
        let Some(bytes) = entry_bytes(zip, &name, NESTED_JAR_LIMIT, budget)? else { continue };
        let Ok(mut inner) = ZipArchive::new(Cursor::new(bytes)) else { continue };
        // Eine kaputte eingebettete JAR macht die äußere nicht unlesbar.
        if let Ok(found) = declared_in(&mut inner, budget) {
            ids.extend(found.into_iter().flat_map(|declared| declared.ids));
        }
    }
    Ok(ids)
}

/// Strings eines JSON-Werts: ein Text oder eine Liste von Texten.
fn strings(value: Option<&Value>) -> Vec<String> {
    match value {
        Some(Value::String(text)) => vec![text.clone()],
        Some(Value::Array(items)) => items.iter().filter_map(Value::as_str).map(String::from).collect(),
        _ => Vec::new(),
    }
}

fn fabric(json: &str) -> Option<Declared> {
    let json: Value = serde_json::from_str(json).ok()?;
    let id = json.get("id")?.as_str()?;
    let ids = [vec![id.to_owned()], strings(json.get("provides"))].concat();
    let depends = json
        .get("depends")
        .and_then(Value::as_object)
        .into_iter()
        .flatten()
        .map(|(id, range)| Dependency { id: id.clone(), required: true, ranges: strings(Some(range)) })
        .collect();
    Some(Declared { loader: ModLoader::Fabric, ids, depends })
}

fn quilt(json: &str) -> Option<Declared> {
    let json: Value = serde_json::from_str(json).ok()?;
    let loader = json.get("quilt_loader")?;
    let id = loader.get("id")?.as_str()?;
    let provided = loader.get("provides").and_then(Value::as_array).into_iter().flatten();
    let ids = std::iter::once(id.to_owned())
        .chain(provided.filter_map(|p| p.as_str().or_else(|| p.get("id")?.as_str()).map(String::from)))
        .collect();
    let depends = loader.get("depends").and_then(Value::as_array).into_iter().flatten().filter_map(quilt_dependency).collect();
    Some(Declared { loader: ModLoader::Quilt, ids, depends })
}

/// Eine Quilt-Abhängigkeit: nur die ID oder ein Objekt mit `versions` und `optional`.
fn quilt_dependency(entry: &Value) -> Option<Dependency> {
    if let Some(id) = entry.as_str() {
        return Some(Dependency { id: id.to_owned(), required: true, ranges: Vec::new() });
    }
    Some(Dependency {
        id: entry.get("id")?.as_str()?.to_owned(),
        required: !entry.get("optional").and_then(Value::as_bool).unwrap_or(false),
        ranges: strings(entry.get("versions")),
    })
}

/// `mods.toml` (Forge) und `neoforge.mods.toml`: `[[mods]]` mit `modId`, `[[dependencies.<modId>]]` mit den Abhängigkeiten.
fn forge_like(text: &str, loader: ModLoader) -> Option<Declared> {
    let table: toml::Table = text.parse().ok()?;
    let ids: Vec<String> =
        table.get("mods")?.as_array()?.iter().filter_map(|m| Some(m.get("modId")?.as_str()?.to_owned())).collect();
    if ids.is_empty() {
        return None;
    }
    let depends = table
        .get("dependencies")
        .and_then(toml::Value::as_table)
        .into_iter()
        .flat_map(|by_mod| by_mod.values())
        .filter_map(toml::Value::as_array)
        .flatten()
        .filter_map(forge_dependency)
        .collect();
    Some(Declared { loader, ids, depends })
}

/// Eine Forge-Abhängigkeit; eine, die nur der Server braucht, zählt nicht. `type` (NeoForge) schlägt `mandatory` (Forge).
fn forge_dependency(entry: &toml::Value) -> Option<Dependency> {
    if entry.get("side").and_then(toml::Value::as_str) == Some("SERVER") {
        return None;
    }
    let required = match entry.get("type").and_then(toml::Value::as_str) {
        Some(kind) => kind == "required",
        None => entry.get("mandatory").and_then(toml::Value::as_bool).unwrap_or(true),
    };
    let ranges = entry.get("versionRange").and_then(toml::Value::as_str).map(String::from).into_iter().collect();
    Some(Dependency { id: entry.get("modId")?.as_str()?.to_owned(), required, ranges })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    fn jar(entries: &[(&str, &[u8])]) -> Vec<u8> {
        let mut writer = zip::ZipWriter::new(Cursor::new(Vec::new()));
        for (name, data) in entries {
            writer.start_file(*name, zip::write::SimpleFileOptions::default()).unwrap();
            writer.write_all(data).unwrap();
        }
        writer.finish().unwrap().into_inner()
    }

    fn info(entries: &[(&str, &[u8])]) -> JarInfo {
        let path = std::env::temp_dir().join(format!("launcher-jar-{}.jar", crate::models::new_id()));
        fs::write(&path, jar(entries)).unwrap();
        let info = read_jar(&path).unwrap();
        fs::remove_file(path).unwrap();
        info
    }

    const FABRIC: &str = r#"{"id":"sodium","provides":["sodium-extra"],"depends":{"fabricloader":">=0.15","minecraft":["1.21.1","1.21.2"],"fabric-api":"*"}}"#;

    #[test]
    fn fabric_metadata_gives_ids_and_dependencies() {
        let info = info(&[("fabric.mod.json", FABRIC.as_bytes())]);

        let [declared] = info.declared.as_slice() else { panic!("{info:?}") };
        assert_eq!(declared.loader, ModLoader::Fabric);
        assert_eq!(declared.ids, ["sodium", "sodium-extra"]);
        let minecraft = declared.depends.iter().find(|d| d.id == "minecraft").unwrap();
        assert_eq!(minecraft.ranges, ["1.21.1", "1.21.2"]);
        assert!(declared.depends.iter().all(|d| d.required));
    }

    #[test]
    fn quilt_metadata_knows_optional_dependencies() {
        let json = r#"{"quilt_loader":{"id":"qmod","provides":["alias",{"id":"other","version":"1"}],
            "depends":["quilt_loader",{"id":"minecraft","versions":">=1.21"},{"id":"extra","optional":true}]}}"#;
        let info = info(&[("quilt.mod.json", json.as_bytes())]);

        let [declared] = info.declared.as_slice() else { panic!("{info:?}") };
        assert_eq!(declared.loader, ModLoader::Quilt);
        assert_eq!(declared.ids, ["qmod", "alias", "other"]);
        let required: Vec<_> = declared.depends.iter().map(|d| (d.id.as_str(), d.required)).collect();
        assert_eq!(required, [("quilt_loader", true), ("minecraft", true), ("extra", false)]);
    }

    #[test]
    fn forge_and_neoforge_dependencies_read_mandatory_or_type() {
        let forge = br#"
            [[mods]]
            modId = "create"
            [[dependencies.create]]
            modId = "forge"
            mandatory = true
            versionRange = "[47,)"
            [[dependencies.create]]
            modId = "flywheel"
            mandatory = false
            [[dependencies.create]]
            modId = "serveronly"
            mandatory = true
            side = "SERVER"
        "#;
        let neoforge = br#"
            [[mods]]
            modId = "neo"
            [[dependencies.neo]]
            modId = "needed"
            type = "required"
            [[dependencies.neo]]
            modId = "nice"
            type = "optional"
        "#;
        let info = info(&[("META-INF/mods.toml", forge), ("META-INF/neoforge.mods.toml", neoforge)]);

        let [forge, neoforge] = info.declared.as_slice() else { panic!("{info:?}") };
        assert_eq!((forge.loader, forge.ids.as_slice()), (ModLoader::Forge, ["create".to_owned()].as_slice()));
        let forge_deps: Vec<_> = forge.depends.iter().map(|d| (d.id.as_str(), d.required)).collect();
        assert_eq!(forge_deps, [("forge", true), ("flywheel", false)]);
        assert_eq!(forge.depends[0].ranges, ["[47,)"]);
        let neoforge_deps: Vec<_> = neoforge.depends.iter().map(|d| (d.id.as_str(), d.required)).collect();
        assert_eq!(neoforge_deps, [("needed", true), ("nice", false)]);
    }

    #[test]
    fn embedded_jars_provide_their_ids() {
        let module = jar(&[("fabric.mod.json", br#"{"id":"fabric-api-base"}"#)]);
        let outer = br#"{"id":"fabric-api"}"#;
        let info = info(&[("fabric.mod.json", outer), ("META-INF/jars/base.jar", &module), ("META-INF/jars/readme.txt", b"x")]);

        assert_eq!(info.nested_ids, ["fabric-api-base"]);
        assert_eq!(info.declared[0].ids, ["fabric-api"]);
    }

    #[test]
    fn unreadable_or_missing_metadata_declares_nothing() {
        assert!(info(&[("pack.mcmeta", b"{}")]).declared.is_empty());
        assert!(info(&[("fabric.mod.json", b"not json"), ("META-INF/mods.toml", b"[[[")]).declared.is_empty());
    }

    #[test]
    fn a_file_that_is_no_zip_is_an_error() {
        let path = std::env::temp_dir().join(format!("launcher-jar-{}.jar", crate::models::new_id()));
        fs::write(&path, b"nope").unwrap();
        assert!(read_jar(&path).is_err());
        fs::remove_file(path).unwrap();
    }
}
