//! Datenmodelle. Serialisierung in camelCase, passend zu `src/lib/types.ts`.
use std::collections::BTreeMap;
use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};

use crate::error::{AppError, AppResult};

pub fn new_id() -> String {
    uuid::Uuid::new_v4().to_string()
}

/// Aktuelle Zeit als Unix-Millisekunden.
pub fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or_default()
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ModLoader {
    Vanilla,
    Fabric,
    Quilt,
    Forge,
    NeoForge,
}

/// Herkunft einer Mod-Datei. Getaggt als `{"type": "modrinth", ...}`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "lowercase", rename_all_fields = "camelCase")]
pub enum ModSource {
    /// Vom Nutzer hinzugefügte JAR.
    Local,
    Url { url: String },
    Modrinth { project_id: String, version_id: String },
    CurseForge { project_id: u32, file_id: u32 },
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Mod {
    pub id: String,
    pub name: String,
    pub version: String,
    pub source: ModSource,
    pub file_name: String,
    /// SHA-1 der JAR: Schlüssel im globalen Mod-Cache und für Update-Lookups.
    #[serde(default)]
    pub sha1: Option<String>,
    pub enabled: bool,
}

/// Aus welchem Modpack eine Instanz installiert wurde (für Pack-Updates).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "lowercase", rename_all_fields = "camelCase")]
pub enum ModpackOrigin {
    Modrinth { project_id: String, version_id: String },
    CurseForge { project_id: u32, file_id: u32 },
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Instance {
    pub id: String,
    pub name: String,
    pub minecraft_version: String,
    pub loader: ModLoader,
    pub loader_version: Option<String>,
    pub preset_id: Option<String>,
    #[serde(default)]
    pub modpack: Option<ModpackOrigin>,
    pub memory_mb: Option<u32>,
    pub jvm_args: Vec<String>,
    pub mods: Vec<Mod>,
    pub created_at: u64,
    pub last_played_at: Option<u64>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NewInstance {
    pub name: String,
    pub minecraft_version: String,
    pub loader: ModLoader,
    pub loader_version: Option<String>,
}

impl Instance {
    pub fn from_new(input: NewInstance) -> Self {
        Self {
            id: new_id(),
            name: input.name,
            minecraft_version: input.minecraft_version,
            loader: input.loader,
            loader_version: input.loader_version,
            preset_id: None,
            modpack: None,
            memory_mb: None,
            jvm_args: Vec::new(),
            mods: Vec::new(),
            created_at: now_ms(),
            last_played_at: None,
        }
    }

    /// Übernimmt Mods, JVM-Args und RAM eines bereits aufgelösten Presets
    /// (`Preset::resolve`). Mods werden anhand ihrer ID ergänzt, nicht dupliziert;
    /// JVM-Args und RAM des Presets ersetzen die der Instanz.
    pub fn apply_preset(&mut self, preset: &Preset) {
        for m in &preset.mods {
            if !self.mods.iter().any(|x| x.id == m.id) {
                self.mods.push(m.clone());
            }
        }
        self.jvm_args = preset.jvm_args.clone();
        if preset.memory_mb.is_some() {
            self.memory_mb = preset.memory_mb;
        }
        self.preset_id = Some(preset.id.clone());
    }
}

/// Sammlung aus Mods, Spieleinstellungen und JVM-Args, die auf Instanzen angewendet wird.
/// Kann von einem anderen Preset erben (siehe `Preset::resolve`).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Preset {
    pub id: String,
    pub name: String,
    pub description: String,
    #[serde(default)]
    pub inherits_from: Option<String>,
    /// Mod-IDs aus Eltern-Presets, die hier nicht übernommen werden.
    #[serde(default)]
    pub exclude_mods: Vec<String>,
    pub mods: Vec<Mod>,
    pub jvm_args: Vec<String>,
    pub memory_mb: Option<u32>,
    /// Schlüssel/Wert-Paare für `options.txt`.
    pub game_settings: BTreeMap<String, String>,
    pub created_at: u64,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NewPreset {
    pub name: String,
    pub description: String,
    #[serde(default)]
    pub inherits_from: Option<String>,
    #[serde(default)]
    pub exclude_mods: Vec<String>,
    pub mods: Vec<Mod>,
    pub jvm_args: Vec<String>,
    pub memory_mb: Option<u32>,
    pub game_settings: BTreeMap<String, String>,
}

impl Preset {
    pub fn from_new(input: NewPreset) -> Self {
        Self {
            id: new_id(),
            name: input.name,
            description: input.description,
            inherits_from: input.inherits_from,
            exclude_mods: input.exclude_mods,
            mods: input.mods,
            jvm_args: input.jvm_args,
            memory_mb: input.memory_mb,
            game_settings: input.game_settings,
            created_at: now_ms(),
        }
    }

    /// Löst die Vererbungskette zu einem flachen Preset auf. Das Kind gewinnt: gleiche
    /// Mod-IDs werden ersetzt, `exclude_mods` entfernt geerbte Mods, Spieleinstellungen
    /// werden zusammengeführt, JVM-Args und RAM der Eltern gelten nur, wenn das Kind keine
    /// setzt. `lookup` liefert Presets per ID.
    pub fn resolve(&self, lookup: impl Fn(&str) -> AppResult<Preset>) -> AppResult<Preset> {
        let mut chain = vec![self.clone()];
        while let Some(parent) = chain.last().and_then(|p| p.inherits_from.clone()) {
            if chain.iter().any(|p| p.id == parent) {
                return Err(AppError::Invalid(format!("Preset-Vererbung ist zyklisch bei '{parent}'")));
            }
            chain.push(lookup(&parent)?);
        }
        // Von der Wurzel zum Kind falten; Identität (ID, Name, …) bleibt die des Kindes.
        let mut resolved = chain.pop().expect("Kette enthält mindestens self");
        while let Some(mut child) = chain.pop() {
            resolved
                .mods
                .retain(|m| !child.exclude_mods.contains(&m.id) && !child.mods.iter().any(|c| c.id == m.id));
            resolved.mods.append(&mut child.mods);
            resolved.game_settings.append(&mut child.game_settings);
            child.mods = resolved.mods;
            child.game_settings = resolved.game_settings;
            if child.jvm_args.is_empty() {
                child.jvm_args = resolved.jvm_args;
            }
            child.memory_mb = child.memory_mb.or(resolved.memory_mb);
            resolved = child;
        }
        Ok(resolved)
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum AccountKind {
    Microsoft,
    Offline,
}

/// Account ohne Tokens – Refresh-Tokens gehören in den OS-Keyring, nie in JSON.
/// `id` ist die Minecraft-Spieler-UUID (bei Offline-Accounts deterministisch aus dem Namen).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Account {
    pub id: String,
    pub username: String,
    pub kind: AccountKind,
    pub active: bool,
}

#[cfg(test)]
mod tests {
    use super::*;

    fn preset(id: &str, parent: Option<&str>, mods: &[&str], exclude: &[&str]) -> Preset {
        let mod_of = |id: &str| Mod {
            id: id.into(),
            name: id.into(),
            version: "1".into(),
            source: ModSource::Local,
            file_name: format!("{id}.jar"),
            sha1: None,
            enabled: true,
        };
        Preset {
            id: id.into(),
            inherits_from: parent.map(Into::into),
            exclude_mods: exclude.iter().map(|s| s.to_string()).collect(),
            mods: mods.iter().map(|s| mod_of(s)).collect(),
            ..Preset::from_new(NewPreset {
                name: id.into(),
                description: String::new(),
                inherits_from: None,
                exclude_mods: Vec::new(),
                mods: Vec::new(),
                jvm_args: Vec::new(),
                memory_mb: None,
                game_settings: BTreeMap::new(),
            })
        }
    }

    fn lookup(presets: &[Preset]) -> impl Fn(&str) -> AppResult<Preset> + '_ {
        |id| presets.iter().find(|p| p.id == id).cloned().ok_or(AppError::NotFound { kind: "Preset", id: id.into() })
    }

    #[test]
    fn preset_inheritance_and_cycle() {
        let base = Preset { memory_mb: Some(4096), ..preset("base", None, &["sodium", "lithium"], &[]) };
        let child = preset("child", Some("base"), &["iris"], &["lithium"]);

        let r = child.resolve(lookup(&[base.clone(), child.clone()])).unwrap();
        let ids: Vec<_> = r.mods.iter().map(|m| m.id.as_str()).collect();
        assert_eq!(ids, ["sodium", "iris"]);
        assert_eq!((r.id.as_str(), r.memory_mb, r.inherits_from.as_deref()), ("child", Some(4096), Some("base")));

        let cyclic_base = Preset { inherits_from: Some("child".into()), ..base };
        assert!(matches!(child.resolve(lookup(&[cyclic_base, child.clone()])), Err(AppError::Invalid(_))));
    }

    #[test]
    fn mod_source_json_shape() {
        let src = ModSource::Modrinth { project_id: "AANobbMI".into(), version_id: "v1".into() };
        assert_eq!(
            serde_json::to_value(&src).unwrap(),
            serde_json::json!({"type": "modrinth", "projectId": "AANobbMI", "versionId": "v1"})
        );
        assert_eq!(serde_json::to_value(ModSource::Local).unwrap(), serde_json::json!({"type": "local"}));
    }
}
