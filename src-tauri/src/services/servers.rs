//! Serverliste des Spiels: `servers.dat` im Spielordner, NBT ohne Kompression mit der Liste `servers`.
//! Der Launcher ändert nur Name, Adresse und `acceptTextures`; alle anderen Tags (Icon, `hidden` …) bleiben erhalten.
use std::{collections::HashMap, fs, io, path::Path};

use fastnbt::Value;
use serde::{Deserialize, Serialize};

use super::modrinth::invalid;
use crate::error::{AppError, AppResult};

const FILE: &str = "servers.dat";

type Compound = HashMap<String, Value>;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Server {
    pub name: String,
    /// `host[:port]`, wie im Spiel eingegeben.
    pub address: String,
    /// Servericon als `data:`-URL. Schreibt nur das Spiel (beim Anpingen); beim Speichern bleibt das alte.
    #[serde(default)]
    pub icon: Option<String>,
    /// Ressourcenpakete des Servers annehmen bzw. ablehnen; `None` = im Spiel nachfragen.
    #[serde(default)]
    pub accept_textures: Option<bool>,
}

/// Die Server, die das Spiel zeigt, in seiner Reihenfolge.
pub fn list(game_dir: &Path) -> AppResult<Vec<Server>> {
    let mut root = read(&game_dir.join(FILE))?;
    Ok(visible(entries(&mut root)?).map(|(_, entry)| server(entry)).collect())
}

/// Legt einen Server an (`index` = None) oder ändert den Eintrag an Stelle `index` der Liste aus [`list`].
pub fn save(game_dir: &Path, index: Option<usize>, server: &Server) -> AppResult<()> {
    let name = server.name.trim();
    if name.is_empty() {
        return Err(invalid("Gib dem Server einen Namen"));
    }
    let address = require_address(&server.address)?;
    update(game_dir, |list| {
        let at = match index {
            Some(index) => position(list, index)?,
            None => {
                list.push(Value::Compound(Compound::new()));
                list.len() - 1
            }
        };
        if let Value::Compound(entry) = &mut list[at] {
            entry.insert("name".into(), Value::String(name.into()));
            entry.insert("ip".into(), Value::String(address.into()));
            match server.accept_textures {
                Some(accept) => entry.insert("acceptTextures".into(), Value::Byte(accept.into())),
                None => entry.remove("acceptTextures"),
            };
        }
        Ok(())
    })
}

pub fn remove(game_dir: &Path, index: usize) -> AppResult<()> {
    update(game_dir, |list| {
        list.remove(position(list, index)?);
        Ok(())
    })
}

/// Serveradresse wie im Spiel: `host[:port]` ohne Leerzeichen. Sie wird zum Startargument und darf
/// deshalb nicht wie eine Option (`--…`) aussehen.
pub fn require_address(address: &str) -> AppResult<&str> {
    let address = address.trim();
    if address.is_empty() || address.len() > 255 || address.starts_with('-') || address.contains(|c: char| c.is_whitespace() || c.is_control()) {
        return Err(invalid("Gib eine Serveradresse wie play.example.net oder play.example.net:25565 ein"));
    }
    Ok(address)
}

/// Liest die Serverliste, ändert sie und schreibt sie zurück.
fn update(game_dir: &Path, change: impl FnOnce(&mut Vec<Value>) -> AppResult<()>) -> AppResult<()> {
    let path = game_dir.join(FILE);
    let mut root = read(&path)?;
    change(entries(&mut root)?)?;
    fs::create_dir_all(game_dir)?;
    // Erst vollständig schreiben, dann umbenennen: ein Abbruch hinterlässt nie eine halbe Serverliste.
    let tmp = path.with_extension("dat.tmp");
    fs::write(&tmp, fastnbt::to_bytes(&root)?)?;
    fs::rename(&tmp, &path)?;
    Ok(())
}

fn read(path: &Path) -> AppResult<Compound> {
    match fs::read(path) {
        Ok(bytes) => Ok(fastnbt::from_bytes(&bytes)?),
        Err(e) if e.kind() == io::ErrorKind::NotFound => Ok(Compound::new()),
        Err(e) => Err(e.into()),
    }
}

/// Die Liste `servers` der Datei; fehlt sie, wird sie angelegt.
fn entries(root: &mut Compound) -> AppResult<&mut Vec<Value>> {
    match root.entry("servers".into()).or_insert_with(|| Value::List(Vec::new())) {
        Value::List(list) => Ok(list),
        _ => Err(invalid("servers.dat hat ein unbekanntes Format")),
    }
}

/// Einträge mit ihrer Stelle in der Datei, ohne versteckte: die legt das Spiel selbst für Quick Play an
/// und zeigt sie nicht in der Serverliste.
fn visible(list: &[Value]) -> impl Iterator<Item = (usize, &Compound)> {
    list.iter().enumerate().filter_map(|(at, entry)| match entry {
        Value::Compound(c) if !matches!(c.get("hidden"), Some(Value::Byte(hidden)) if *hidden != 0) => Some((at, c)),
        _ => None,
    })
}

/// Stelle des sichtbaren Eintrags `index` in der Datei.
fn position(list: &[Value], index: usize) -> AppResult<usize> {
    visible(list)
        .nth(index)
        .map(|(at, _)| at)
        .ok_or_else(|| AppError::NotFound { kind: "Server", id: (index + 1).to_string() })
}

fn server(entry: &Compound) -> Server {
    let text = |key: &str| match entry.get(key) {
        Some(Value::String(s)) => s.clone(),
        _ => String::new(),
    };
    Server {
        name: text("name"),
        address: text("ip"),
        icon: match entry.get("icon") {
            Some(Value::String(png)) if !png.is_empty() => Some(format!("data:image/png;base64,{png}")),
            _ => None,
        },
        accept_textures: match entry.get("acceptTextures") {
            Some(Value::Byte(accept)) => Some(*accept != 0),
            _ => None,
        },
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::new_id;

    fn compound(pairs: Vec<(&str, Value)>) -> Value {
        Value::Compound(pairs.into_iter().map(|(k, v)| (k.to_owned(), v)).collect())
    }

    fn string(s: &str) -> Value {
        Value::String(s.into())
    }

    /// Spielordner mit einer `servers.dat`, wie das Spiel sie schreibt: Icon, versteckter Eintrag, unbekannter Tag.
    fn game_dir() -> std::path::PathBuf {
        let dir = std::env::temp_dir().join(new_id());
        fs::create_dir_all(&dir).unwrap();
        let root = compound(vec![(
            "servers",
            Value::List(vec![
                compound(vec![("name", string("Lobby")), ("ip", string("lobby.example.net")), ("icon", string("iVBORw0KGgo=")), ("acceptTextures", Value::Byte(1))]),
                compound(vec![("name", string("Quick")), ("ip", string("quick.example.net")), ("hidden", Value::Byte(1))]),
                compound(vec![("name", string("Bau")), ("ip", string("bau.example.net:25570")), ("preventsChatReports", Value::Byte(1))]),
            ]),
        )]);
        fs::write(dir.join(FILE), fastnbt::to_bytes(&root).unwrap()).unwrap();
        dir
    }

    fn raw(dir: &Path) -> Vec<Value> {
        let mut root = read(&dir.join(FILE)).unwrap();
        entries(&mut root).unwrap().clone()
    }

    fn input(name: &str, address: &str, accept_textures: Option<bool>) -> Server {
        Server { name: name.into(), address: address.into(), icon: None, accept_textures }
    }

    #[test]
    fn lists_visible_servers_with_icon() {
        let dir = game_dir();
        let servers = list(&dir).unwrap();
        assert_eq!(
            servers,
            [
                Server { icon: Some("data:image/png;base64,iVBORw0KGgo=".into()), ..input("Lobby", "lobby.example.net", Some(true)) },
                input("Bau", "bau.example.net:25570", None),
            ]
        );
        assert!(list(&dir.join("neu")).unwrap().is_empty());
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn edits_keep_unknown_tags_and_hidden_entries() {
        let dir = game_dir();
        // Index 1 ist „Bau“: der versteckte Eintrag dazwischen zählt nicht mit.
        save(&dir, Some(1), &input(" Baustelle ", "bau.example.net", Some(false))).unwrap();
        save(&dir, Some(0), &input("Lobby", "lobby.example.net", None)).unwrap();
        save(&dir, None, &input("Neu", "neu.example.net", None)).unwrap();

        let entries = raw(&dir);
        assert_eq!(entries.len(), 4);
        assert_eq!(
            entries[2],
            compound(vec![("name", string("Baustelle")), ("ip", string("bau.example.net")), ("preventsChatReports", Value::Byte(1)), ("acceptTextures", Value::Byte(0))])
        );
        assert_eq!(entries[0], compound(vec![("name", string("Lobby")), ("ip", string("lobby.example.net")), ("icon", string("iVBORw0KGgo="))]));
        assert_eq!(list(&dir).unwrap().iter().map(|s| s.name.as_str()).collect::<Vec<_>>(), ["Lobby", "Baustelle", "Neu"]);

        remove(&dir, 0).unwrap();
        assert_eq!(list(&dir).unwrap().iter().map(|s| s.name.as_str()).collect::<Vec<_>>(), ["Baustelle", "Neu"]);
        assert_eq!(raw(&dir).len(), 3, "der versteckte Eintrag bleibt");
        assert!(remove(&dir, 5).is_err());
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn rejects_unusable_input() {
        let dir = game_dir();
        assert!(save(&dir, None, &input(" ", "a.example.net", None)).is_err());
        for address in ["", "mit leerzeichen", "--demo", "a\nb"] {
            assert!(require_address(address).is_err(), "{address:?}");
        }
        assert_eq!(require_address(" play.example.net:25565 ").unwrap(), "play.example.net:25565");
        assert_eq!(raw(&dir).len(), 3);
        fs::remove_dir_all(dir).unwrap();
    }
}
