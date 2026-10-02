//! Welche Ressourcenpakete und welcher Shader im Spiel gewählt sind: `options.txt` (`resourcePacks`,
//! `incompatibleResourcePacks`) und Iris (`config/iris.properties`). Geändert werden nur diese Zeilen, alles andere
//! samt Zeilenenden bleibt, wie das Spiel es geschrieben hat.
use std::{fs, path::Path};

use serde::Serialize;

use super::{none_if_missing, require_plain_name, write_atomic, Dirs};
use crate::coded;
use crate::error::{AppError, AppResult};

const OPTIONS_FILE: &str = "options.txt";
const IRIS_FILE: &str = "config/iris.properties";
const RESOURCE_PACKS: &str = "resourcePacks";
const INCOMPATIBLE_PACKS: &str = "incompatibleResourcePacks";
const SHADER_PACK: &str = "shaderPack";
const SHADERS_ENABLED: &str = "enableShaders";
/// Präfix der Pakete aus dem Ordner `resourcepacks/`; andere Einträge (`vanilla`, `fabric`) sind eingebaut.
pub const FILE_PREFIX: &str = "file/";
const MAX_PACKS: usize = 1000;
const MAX_PACK_ID_CHARS: usize = 300;

/// Auswahl im Spiel. `resource_packs` in der Reihenfolge der Datei: das letzte Paket gewinnt.
#[derive(Debug, Default, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PackSelection {
    pub resource_packs: Vec<String>,
    /// Gewählte Pakete, die das Spiel als nicht zur Version passend gemeldet hat.
    pub incompatible: Vec<String>,
    pub shader_pack: Option<String>,
}

pub fn read(dirs: &Dirs, instance_id: &str) -> AppResult<PackSelection> {
    let game = dirs.game_dir(instance_id);
    let options = read_text(&game.join(OPTIONS_FILE))?;
    let iris = read_text(&game.join(IRIS_FILE))?;
    Ok(PackSelection {
        resource_packs: pack_list(&options, RESOURCE_PACKS),
        incompatible: pack_list(&options, INCOMPATIBLE_PACKS),
        shader_pack: line_value(&iris, SHADER_PACK, '=').map(unescape_property).filter(|name| !name.is_empty()),
    })
}

/// Setzt die Ressourcenpakete; „inkompatibel“ behält nur, was gewählt bleibt.
pub fn write_resource_packs(dirs: &Dirs, instance_id: &str, packs: &[String]) -> AppResult<PackSelection> {
    check_packs(packs)?;
    let path = dirs.game_dir(instance_id).join(OPTIONS_FILE);
    let options = read_text(&path)?;
    let incompatible: Vec<String> = pack_list(&options, INCOMPATIBLE_PACKS).into_iter().filter(|id| packs.contains(id)).collect();
    let options = set_line(&options, RESOURCE_PACKS, ':', Some(&pack_array(packs)?));
    let options = set_line(&options, INCOMPATIBLE_PACKS, ':', Some(&pack_array(&incompatible)?));
    write_file(&path, &options)?;
    read(dirs, instance_id)
}

/// Wählt den Iris-Shader `pack` (Dateiname im Ordner `shaderpacks/`) und schaltet Shader ein; `None` wählt keinen.
pub fn write_shader_pack(dirs: &Dirs, instance_id: &str, pack: Option<&str>) -> AppResult<PackSelection> {
    let path = dirs.game_dir(instance_id).join(IRIS_FILE);
    let pack = pack.map(require_plain_name).transpose()?;
    let iris = read_text(&path)?;
    let iris = set_line(&iris, SHADER_PACK, '=', pack.map(escape_property).as_deref());
    let iris = if pack.is_some() { set_line(&iris, SHADERS_ENABLED, '=', Some("true")) } else { iris };
    write_file(&path, &iris)?;
    read(dirs, instance_id)
}

fn check_packs(packs: &[String]) -> AppResult<()> {
    let valid = |id: &String| {
        !id.is_empty()
            && id.chars().count() <= MAX_PACK_ID_CHARS
            && !id.chars().any(char::is_control)
            && id.strip_prefix(FILE_PREFIX).map_or(!id.contains('/'), |name| !name.is_empty() && require_plain_name(name).is_ok())
    };
    if packs.len() > MAX_PACKS || !packs.iter().all(valid) {
        return Err(AppError::invalid(coded!("errors.modrinth.invalidPackList")));
    }
    Ok(())
}

fn read_text(path: &Path) -> AppResult<String> {
    Ok(none_if_missing(fs::read_to_string(path))?.unwrap_or_default())
}

fn write_file(path: &Path, text: &str) -> AppResult<()> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    write_atomic(path, text.as_bytes())
}

fn pack_array(packs: &[String]) -> AppResult<String> {
    Ok(serde_json::to_string(packs)?)
}

/// Die Liste hinter `key` in `options.txt` (ein JSON-Feld mit Texten); fehlt sie oder ist sie unlesbar, ist sie leer.
fn pack_list(options: &str, key: &str) -> Vec<String> {
    line_value(options, key, ':').and_then(|value| serde_json::from_str(value).ok()).unwrap_or_default()
}

/// Der Wert der Zeile `key<separator>wert` ohne Zeilenende.
fn line_value<'t>(text: &'t str, key: &str, separator: char) -> Option<&'t str> {
    text.lines().find_map(|line| line.strip_prefix(key)?.strip_prefix(separator))
}

/// Setzt den Wert der Zeile `key<separator>…`, `None` entfernt sie. Fehlt die Zeile, kommt sie ans Ende. Alle anderen
/// Zeilen bleiben unverändert, auch ihre Zeilenenden.
fn set_line(text: &str, key: &str, separator: char, value: Option<&str>) -> String {
    let is_target = |line: &str| line.strip_prefix(key).is_some_and(|rest| rest.starts_with(separator));
    let ending = if text.contains("\r\n") { "\r\n" } else { "\n" };
    let mut out = String::with_capacity(text.len());
    let mut found = false;
    for line in text.split_inclusive('\n') {
        let content = line.trim_end_matches(['\r', '\n']);
        if !is_target(content) {
            out.push_str(line);
            continue;
        }
        found = true;
        if let Some(value) = value {
            out.push_str(&format!("{key}{separator}{value}{}", &line[content.len()..]));
        }
    }
    if let (false, Some(value)) = (found, value) {
        if !out.is_empty() && !out.ends_with('\n') {
            out.push_str(ending);
        }
        out.push_str(&format!("{key}{separator}{value}{ending}"));
    }
    out
}

/// Wert für `.properties`: Zeichen mit Bedeutung und alles außerhalb von ASCII maskiert, wie Java es schreibt.
fn escape_property(value: &str) -> String {
    let mut escaped = String::with_capacity(value.len());
    for (at, c) in value.chars().enumerate() {
        match c {
            '\\' | ':' | '=' | '#' | '!' => escaped.extend(['\\', c]),
            ' ' if at == 0 => escaped.push_str("\\ "),
            ' '..='~' => escaped.push(c),
            _ => c.encode_utf16(&mut [0; 2]).iter().for_each(|unit| escaped.push_str(&format!("\\u{unit:04x}"))),
        }
    }
    escaped
}

/// Gegenstück zu [`escape_property`]; Unlesbares bleibt stehen.
fn unescape_property(value: &str) -> String {
    let mut chars = value.chars().peekable();
    let mut units: Vec<u16> = Vec::new();
    let mut out = String::new();
    let flush = |units: &mut Vec<u16>, out: &mut String| {
        out.push_str(&String::from_utf16_lossy(units));
        units.clear();
    };
    while let Some(c) = chars.next() {
        if c != '\\' {
            flush(&mut units, &mut out);
            out.push(c);
            continue;
        }
        match chars.next() {
            Some('u') => {
                let hex: String = chars.by_ref().take(4).collect();
                match u16::from_str_radix(&hex, 16).ok().filter(|_| hex.len() == 4) {
                    Some(unit) => units.push(unit),
                    None => {
                        flush(&mut units, &mut out);
                        out.push_str(&format!("\\u{hex}"));
                    }
                }
            }
            Some(other) => {
                flush(&mut units, &mut out);
                out.push(other);
            }
            None => out.push('\\'),
        }
    }
    flush(&mut units, &mut out);
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn dirs() -> Dirs {
        Dirs::new(std::env::temp_dir().join(crate::models::new_id()))
    }

    const OPTIONS: &str = "version:3955\r\nautoJump:false\r\nresourcePacks:[\"vanilla\",\"file/a.zip\"]\r\n\
        incompatibleResourcePacks:[\"file/a.zip\"]\r\nlang:de_de\r\n";

    #[test]
    fn only_the_two_pack_lines_change_and_endings_stay() {
        let packs = vec!["vanilla".to_owned(), "file/b.zip".to_owned()];
        let changed = set_line(OPTIONS, RESOURCE_PACKS, ':', Some(&pack_array(&packs).unwrap()));
        assert_eq!(
            changed,
            "version:3955\r\nautoJump:false\r\nresourcePacks:[\"vanilla\",\"file/b.zip\"]\r\n\
             incompatibleResourcePacks:[\"file/a.zip\"]\r\nlang:de_de\r\n"
        );
        assert_eq!(pack_list(&changed, INCOMPATIBLE_PACKS), ["file/a.zip"]);
    }

    #[test]
    fn a_missing_line_is_appended_with_the_files_line_ending() {
        assert_eq!(set_line("a:1", "b", ':', Some("2")), "a:1\nb:2\n");
        assert_eq!(set_line("a:1\r\n", "b", ':', Some("2")), "a:1\r\nb:2\r\n");
        assert_eq!(set_line("", "b", ':', Some("2")), "b:2\n");
        assert_eq!(set_line("a:1\nb:2\nc:3\n", "b", ':', None), "a:1\nc:3\n");
        assert_eq!(set_line("a:1\n", "b", ':', None), "a:1\n");
    }

    #[test]
    fn a_key_matches_only_whole_names() {
        let text = "incompatibleResourcePacks:[]\nresourcePacks:[\"x\"]\n";
        assert_eq!(pack_list(text, RESOURCE_PACKS), ["x"]);
        assert_eq!(set_line(text, "resource", ':', Some("y")), format!("{text}resource:y\n"));
    }

    #[test]
    fn selection_is_read_and_written_in_the_game_folder() {
        let dirs = dirs();
        let game = dirs.game_dir("i");
        fs::create_dir_all(game.join("config")).unwrap();
        fs::write(game.join(OPTIONS_FILE), OPTIONS).unwrap();
        fs::write(game.join(IRIS_FILE), "#Iris\nenableShaders=false\nshaderPack=BSL\\ v8.zip\nother=1\n").unwrap();

        let read = read(&dirs, "i").unwrap();
        assert_eq!(read.resource_packs, ["vanilla", "file/a.zip"]);
        assert_eq!(read.incompatible, ["file/a.zip"]);
        assert_eq!(read.shader_pack.as_deref(), Some("BSL v8.zip"));

        let packs = vec!["file/b.zip".to_owned(), "vanilla".to_owned()];
        let written = write_resource_packs(&dirs, "i", &packs).unwrap();
        assert_eq!(written.resource_packs, packs);
        assert!(written.incompatible.is_empty());
        let options = fs::read_to_string(game.join(OPTIONS_FILE)).unwrap();
        assert!(options.starts_with("version:3955\r\nautoJump:false\r\n") && options.ends_with("lang:de_de\r\n"));

        let shader = write_shader_pack(&dirs, "i", Some("Complementary Ü.zip")).unwrap();
        assert_eq!(shader.shader_pack.as_deref(), Some("Complementary Ü.zip"));
        let iris = fs::read_to_string(game.join(IRIS_FILE)).unwrap();
        assert_eq!(iris, "#Iris\nenableShaders=true\nshaderPack=Complementary \\u00dc.zip\nother=1\n");
        assert_eq!(write_shader_pack(&dirs, "i", None).unwrap().shader_pack, None);
        assert_eq!(fs::read_to_string(game.join(IRIS_FILE)).unwrap(), "#Iris\nenableShaders=true\nother=1\n");
        fs::remove_dir_all(&dirs.root).unwrap();
    }

    #[test]
    fn a_fresh_folder_gets_the_files_it_needs() {
        let dirs = dirs();
        let written = write_resource_packs(&dirs, "i", &["file/a.zip".to_owned()]).unwrap();
        assert_eq!(written.resource_packs, ["file/a.zip"]);
        assert_eq!(read(&dirs, "i").unwrap().shader_pack, None);
        write_shader_pack(&dirs, "i", Some("s.zip")).unwrap();
        assert_eq!(read(&dirs, "i").unwrap().shader_pack.as_deref(), Some("s.zip"));
        fs::remove_dir_all(&dirs.root).unwrap();
    }

    #[test]
    fn unsafe_pack_names_are_rejected() {
        let dirs = dirs();
        for bad in ["file/../x.zip", "file/a/b.zip", "a/b", "", "file/", "x\ny"] {
            assert!(write_resource_packs(&dirs, "i", &[bad.to_owned()]).is_err(), "{bad:?}");
        }
        assert!(write_shader_pack(&dirs, "i", Some("../x.zip")).is_err());
        assert!(!dirs.game_dir("i").exists());
    }

    #[test]
    fn property_values_round_trip() {
        for name in ["plain.zip", " lead.zip", "a=b:c#d!e\\f.zip", "Ünï.zip", "😀.zip"] {
            assert_eq!(unescape_property(&escape_property(name)), name);
        }
        assert_eq!(unescape_property("a\\u00e4b"), "aäb");
        assert_eq!(unescape_property("broken\\u12"), "broken\\u12");
    }
}
