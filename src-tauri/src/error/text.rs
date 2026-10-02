//! Fehlermeldungen als stabiler Code mit Parametern. Das Frontend übersetzt den Code in die Sprache der Oberfläche;
//! das Backend selbst (Protokoll, `to_string`) zeigt den deutschen Text aus demselben Wörterbuch (`src/i18n/de`).
use std::collections::{BTreeMap, HashMap};
use std::fmt;
use std::sync::LazyLock;

use regex::{Captures, Regex};
use serde::Serialize;

/// Deutsche Fehlertexte des Frontends, beim Bauen eingelesen; `coded!` prüft gegen sie, ob es einen Code gibt.
const GERMAN_SOURCES: [&str; 6] = [
    include_str!("../../../src/i18n/de/errors.ts"),
    include_str!("../../../src/i18n/de/errors.app.ts"),
    include_str!("../../../src/i18n/de/errors.game.ts"),
    include_str!("../../../src/i18n/de/errors.modrinth.ts"),
    include_str!("../../../src/i18n/de/errors.packs.ts"),
    include_str!("../../../src/i18n/de/errors.providers.ts"),
];

/// Erzeugt eine [`Coded`]-Meldung; ein Code, den das deutsche Wörterbuch nicht kennt, kompiliert nicht.
/// `coded!("errors.notInstalled", what = version)` setzt `{what}` im Text ein.
#[macro_export]
macro_rules! coded {
    ($key:literal $(, $name:ident = $value:expr)* $(,)?) => {{
        const _: () = assert!($crate::error::is_translated($key), concat!("Fehlercode ohne Übersetzung: ", $key));
        $crate::error::Coded::new($key, [$((stringify!($name), $value.to_string())),*])
    }};
}

/// Text einer Fehlermeldung: noch roh (deutscher Satz) oder schon als Code, den das Frontend übersetzt.
#[derive(Debug, Clone, Serialize)]
#[serde(untagged)]
pub enum ErrorText {
    Raw(String),
    Coded(Coded),
}

impl ErrorText {
    pub fn as_coded(&self) -> Option<&Coded> {
        match self {
            Self::Coded(coded) => Some(coded),
            Self::Raw(_) => None,
        }
    }
}

impl fmt::Display for ErrorText {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Raw(text) => f.write_str(text),
            Self::Coded(coded) => coded.fmt(f),
        }
    }
}

impl From<String> for ErrorText {
    fn from(text: String) -> Self {
        Self::Raw(text)
    }
}

impl From<&str> for ErrorText {
    fn from(text: &str) -> Self {
        Self::Raw(text.to_owned())
    }
}

impl From<Coded> for ErrorText {
    fn from(coded: Coded) -> Self {
        Self::Coded(coded)
    }
}

/// Fehlercode (Schlüssel im Wörterbuch) mit den Werten seiner `{platzhalter}` und optional technischen Details,
/// die nach dem Satz folgen. Erzeugen mit `coded!`, das den Code beim Bauen prüft.
#[derive(Debug, Clone, Serialize)]
pub struct Coded {
    key: &'static str,
    #[serde(skip_serializing_if = "BTreeMap::is_empty")]
    params: BTreeMap<&'static str, String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    details: Option<Box<ErrorText>>,
}

impl Coded {
    /// Nur für `coded!`, das den Code vorher prüft.
    pub fn new<const N: usize>(key: &'static str, params: [(&'static str, String); N]) -> Self {
        Self { key, params: params.into(), details: None }
    }

    /// Hängt technische Details an („… – Details: …“).
    pub fn with_details(mut self, details: impl Into<ErrorText>) -> Self {
        self.details = Some(Box::new(details.into()));
        self
    }
}

impl fmt::Display for Coded {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        let message = fill(german(self.key), |name| self.params.get(name).cloned());
        match &self.details {
            None => f.write_str(&message),
            Some(details) => {
                let details = details.to_string();
                f.write_str(&fill(german("errors.withDetails"), |name| match name {
                    "message" => Some(message.clone()),
                    "details" => Some(details.clone()),
                    _ => None,
                }))
            }
        }
    }
}

/// Ersetzt `{name}` durch den Wert aus `value`; fehlende Platzhalter bleiben sichtbar (wie `t` im Frontend).
fn fill(template: &str, value: impl Fn(&str) -> Option<String>) -> String {
    static PLACEHOLDER: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"\{(\w+)\}").unwrap());
    PLACEHOLDER.replace_all(template, |c: &Captures| value(&c[1]).unwrap_or_else(|| c[0].to_owned())).into_owned()
}

fn german(key: &'static str) -> &'static str {
    GERMAN.get(key).map_or(key, String::as_str)
}

static GERMAN: LazyLock<HashMap<&'static str, String>> = LazyLock::new(|| {
    let entry = Regex::new(r#""(errors\.[\w.]+)":\s*("(?:[^"\\]|\\.)*")"#).unwrap();
    GERMAN_SOURCES
        .iter()
        .flat_map(|source| entry.captures_iter(source))
        .map(|c| {
            let key = c.get(1).unwrap().as_str();
            (key, serde_json::from_str(&c[2]).unwrap_or_else(|_| panic!("Fehlertext zu {key} ist kein JSON-String")))
        })
        .collect()
});

/// Gibt es `key` als Schlüssel (`"key":`) im deutschen Wörterbuch? Läuft beim Bauen (`coded!`).
pub const fn is_translated(key: &str) -> bool {
    let mut i = 0;
    while i < GERMAN_SOURCES.len() {
        if defines_key(GERMAN_SOURCES[i].as_bytes(), key.as_bytes()) {
            return true;
        }
        i += 1;
    }
    false
}

const fn defines_key(source: &[u8], key: &[u8]) -> bool {
    let mut at = 0;
    while at + key.len() + 3 <= source.len() {
        let end = at + 1 + key.len();
        if source[at] == b'"' && source[end] == b'"' && source[end + 1] == b':' && bytes_at(source, at + 1, key) {
            return true;
        }
        at += 1;
    }
    false
}

const fn bytes_at(source: &[u8], start: usize, expected: &[u8]) -> bool {
    let mut i = 0;
    while i < expected.len() {
        if source[start + i] != expected[i] {
            return false;
        }
        i += 1;
    }
    true
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn every_german_text_is_readable() {
        let key = Regex::new(r#""errors\.[\w.]+":"#).unwrap();
        let keys: usize = GERMAN_SOURCES.iter().map(|source| key.find_iter(source).count()).sum();
        assert_eq!(GERMAN.len(), keys, "jeder Schlüssel braucht einen \"…\"-Text direkt dahinter");
        assert_eq!(german("errors.cancelled"), "Vorgang abgebrochen");
    }

    #[test]
    fn known_keys_pass_the_build_check() {
        assert!(is_translated("errors.notInstalled"));
        assert!(!is_translated("errors.notInstalle"));
        assert!(!is_translated("errors.gibtEsNicht"));
    }

    #[test]
    fn coded_texts_read_german_with_params_and_details() {
        assert_eq!(coded!("errors.notInstalled", what = "Version 1.21").to_string(), "Version 1.21 ist nicht installiert");
        let detailed = coded!("errors.download").with_details(coded!("errors.notInstalled", what = 7));
        assert_eq!(detailed.to_string(), "Ein Download ist fehlgeschlagen – Details: 7 ist nicht installiert");
        assert_eq!(coded!("errors.notInstalled").to_string(), "{what} ist nicht installiert");
    }

    #[test]
    fn coded_texts_serialize_compactly() {
        let json = |text: ErrorText| serde_json::to_value(text).unwrap();
        assert_eq!(json("roh".into()), serde_json::json!("roh"));
        assert_eq!(json(coded!("errors.cancelled").into()), serde_json::json!({ "key": "errors.cancelled" }));
        assert_eq!(
            json(coded!("errors.notInstalled", what = "Fabric").with_details("kaputt").into()),
            serde_json::json!({ "key": "errors.notInstalled", "params": { "what": "Fabric" }, "details": "kaputt" })
        );
    }
}
