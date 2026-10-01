//! Serverliste des Spiels: `servers.dat` im Spielordner, NBT ohne Kompression mit der Liste `servers`.
//! Der Launcher ändert nur Name, Adresse und `acceptTextures`; alle anderen Tags (Icon, `hidden` …) bleiben erhalten.
use std::{collections::HashMap, fs, path::Path};

use fastnbt::Value;
use serde::{Deserialize, Serialize};

use super::{none_if_missing, write_atomic, PNG_DATA_URL};
use crate::error::{AppError, AppResult};
use crate::models::{require_name, NO_NAME_LIMIT};

const FILE: &str = "servers.dat";
/// Längste Serveradresse in Bytes.
const MAX_ADDRESS_LEN: usize = 255;

/// Tags der Datei, die der Launcher liest oder schreibt.
const SERVERS: &str = "servers";
const NAME: &str = "name";
const ADDRESS: &str = "ip";
const ICON: &str = "icon";
const ACCEPT_TEXTURES: &str = "acceptTextures";
const HIDDEN: &str = "hidden";

type Compound = HashMap<String, Value>;

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Server {
    pub name: String,
    /// `host[:port]`, wie im Spiel eingegeben.
    pub address: String,
    /// Servericon als `data:`-URL. Schreibt nur das Spiel (beim Anpingen); beim Speichern bleibt das alte.
    pub icon: Option<String>,
    /// Ressourcenpakete des Servers annehmen bzw. ablehnen; `None` = im Spiel nachfragen.
    pub accept_textures: Option<bool>,
}

/// Was der Launcher an einem Server ändert; das Icon gehört dem Spiel.
#[derive(Debug, Clone, PartialEq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ServerInput {
    pub name: String,
    pub address: String,
    #[serde(default)]
    pub accept_textures: Option<bool>,
}

/// Die Server, die das Spiel zeigt, in seiner Reihenfolge.
pub fn list(game_dir: &Path) -> AppResult<Vec<Server>> {
    let mut root = read(&game_dir.join(FILE))?;
    Ok(visible(entries(&mut root)?).map(|(_, entry)| to_server(entry)).collect())
}

/// Hängt einen neuen Server ans Ende der Liste.
pub fn add(game_dir: &Path, server: &ServerInput) -> AppResult<()> {
    let edit = Edit::validated(server)?;
    modify_list(game_dir, |list| {
        let mut entry = Compound::new();
        edit.write_to(&mut entry);
        list.push(Value::Compound(entry));
        Ok(())
    })
}

/// Ändert den Eintrag an Stelle `index` der Liste aus [`list`].
pub fn update(game_dir: &Path, index: usize, server: &ServerInput) -> AppResult<()> {
    let edit = Edit::validated(server)?;
    modify_list(game_dir, |list| {
        edit.write_to(visible_mut(list, index)?);
        Ok(())
    })
}

pub fn remove(game_dir: &Path, index: usize) -> AppResult<()> {
    modify_list(game_dir, |list| {
        list.remove(position(list, index)?);
        Ok(())
    })
}

/// Serveradresse wie im Spiel: `host[:port]` ohne Leerzeichen. Sie wird zum Startargument und darf
/// deshalb nicht wie eine Option (`--…`) aussehen.
pub fn require_address(address: &str) -> AppResult<&str> {
    let address = address.trim();
    if !is_usable_address(address) {
        return Err(AppError::invalid("Gib eine Serveradresse wie play.example.net oder play.example.net:25565 ein"));
    }
    Ok(address)
}

fn is_usable_address(address: &str) -> bool {
    let looks_like_option = address.starts_with('-');
    let has_blank_or_control = address.contains(|c: char| c.is_whitespace() || c.is_control());
    !address.is_empty() && address.len() <= MAX_ADDRESS_LEN && !looks_like_option && !has_blank_or_control
}

/// Geprüfte Eingaben, bereit für einen Eintrag der Datei.
struct Edit<'a> {
    name: &'a str,
    address: &'a str,
    accept_textures: Option<bool>,
}

impl<'a> Edit<'a> {
    fn validated(server: &'a ServerInput) -> AppResult<Self> {
        Ok(Self {
            name: require_name(&server.name, NO_NAME_LIMIT, "Gib dem Server einen Namen")?,
            address: require_address(&server.address)?,
            accept_textures: server.accept_textures,
        })
    }

    /// Setzt nur, was der Launcher ändert; alle anderen Tags des Eintrags bleiben.
    fn write_to(&self, entry: &mut Compound) {
        entry.insert(NAME.into(), Value::String(self.name.into()));
        entry.insert(ADDRESS.into(), Value::String(self.address.into()));
        match self.accept_textures {
            Some(accept) => entry.insert(ACCEPT_TEXTURES.into(), Value::Byte(accept.into())),
            None => entry.remove(ACCEPT_TEXTURES),
        };
    }
}

/// Liest die Serverliste, ändert sie und schreibt sie zurück.
fn modify_list(game_dir: &Path, change: impl FnOnce(&mut Vec<Value>) -> AppResult<()>) -> AppResult<()> {
    let path = game_dir.join(FILE);
    let mut root = read(&path)?;
    change(entries(&mut root)?)?;
    fs::create_dir_all(game_dir)?;
    write_atomic(&path, &fastnbt::to_bytes(&root)?)
}

fn read(path: &Path) -> AppResult<Compound> {
    match none_if_missing(fs::read(path))? {
        Some(bytes) => Ok(fastnbt::from_bytes(&bytes)?),
        None => Ok(Compound::new()),
    }
}

/// Die Liste `servers` der Datei; fehlt sie, wird sie angelegt.
fn entries(root: &mut Compound) -> AppResult<&mut Vec<Value>> {
    match root.entry(SERVERS.into()).or_insert_with(|| Value::List(Vec::new())) {
        Value::List(list) => Ok(list),
        _ => Err(AppError::invalid("servers.dat hat ein unbekanntes Format")),
    }
}

/// Versteckte Einträge legt das Spiel selbst für Quick Play an und zeigt sie nicht in der Serverliste.
fn is_hidden(entry: &Compound) -> bool {
    matches!(entry.get(HIDDEN), Some(Value::Byte(hidden)) if *hidden != 0)
}

/// Einträge mit ihrer Stelle in der Datei, ohne versteckte.
fn visible(list: &[Value]) -> impl Iterator<Item = (usize, &Compound)> {
    list.iter().enumerate().filter_map(|(at, entry)| match entry {
        Value::Compound(c) if !is_hidden(c) => Some((at, c)),
        _ => None,
    })
}

/// Der sichtbare Eintrag `index` der Liste aus [`list`].
fn visible_mut(list: &mut [Value], index: usize) -> AppResult<&mut Compound> {
    list.iter_mut()
        .filter_map(|entry| match entry {
            Value::Compound(c) if !is_hidden(c) => Some(c),
            _ => None,
        })
        .nth(index)
        .ok_or_else(|| server_not_found(index))
}

/// Stelle des sichtbaren Eintrags `index` in der Datei.
fn position(list: &[Value], index: usize) -> AppResult<usize> {
    visible(list).nth(index).map(|(at, _)| at).ok_or_else(|| server_not_found(index))
}

fn server_not_found(index: usize) -> AppError {
    AppError::NotFound { kind: "Server", id: (index + 1).to_string() }
}

fn to_server(entry: &Compound) -> Server {
    let text = |key: &str| match entry.get(key) {
        Some(Value::String(s)) => s.clone(),
        _ => String::new(),
    };
    Server {
        name: text(NAME),
        address: text(ADDRESS),
        icon: match entry.get(ICON) {
            Some(Value::String(png)) if !png.is_empty() => Some(format!("{PNG_DATA_URL}{png}")),
            _ => None,
        },
        accept_textures: match entry.get(ACCEPT_TEXTURES) {
            Some(Value::Byte(accept)) => Some(*accept != 0),
            _ => None,
        },
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::new_id;
    use crate::services::compound;

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

    fn server(name: &str, address: &str, accept_textures: Option<bool>) -> Server {
        Server { name: name.into(), address: address.into(), icon: None, accept_textures }
    }

    fn input(name: &str, address: &str, accept_textures: Option<bool>) -> ServerInput {
        ServerInput { name: name.into(), address: address.into(), accept_textures }
    }

    #[test]
    fn lists_visible_servers_with_icon() {
        let dir = game_dir();
        let servers = list(&dir).unwrap();
        assert_eq!(
            servers,
            [
                Server { icon: Some("data:image/png;base64,iVBORw0KGgo=".into()), ..server("Lobby", "lobby.example.net", Some(true)) },
                server("Bau", "bau.example.net:25570", None),
            ]
        );
        assert!(list(&dir.join("neu")).unwrap().is_empty());
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn edits_keep_unknown_tags_and_hidden_entries() {
        let dir = game_dir();
        // Index 1 ist „Bau“: der versteckte Eintrag dazwischen zählt nicht mit.
        update(&dir, 1, &input(" Baustelle ", "bau.example.net", Some(false))).unwrap();
        update(&dir, 0, &input("Lobby", "lobby.example.net", None)).unwrap();
        add(&dir, &input("Neu", "neu.example.net", None)).unwrap();

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
        assert!(add(&dir, &input(" ", "a.example.net", None)).is_err());
        for address in ["", "mit leerzeichen", "--demo", "a\nb"] {
            assert!(require_address(address).is_err(), "{address:?}");
        }
        assert_eq!(require_address(" play.example.net:25565 ").unwrap(), "play.example.net:25565");
        assert!(require_address(&"a".repeat(MAX_ADDRESS_LEN)).is_ok());
        assert!(require_address(&"a".repeat(MAX_ADDRESS_LEN + 1)).is_err());
        assert_eq!(raw(&dir).len(), 3);
        fs::remove_dir_all(dir).unwrap();
    }
}
