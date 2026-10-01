//! Datenmodelle. Serialisierung in camelCase, passend zu `src/lib/types.ts`.
use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};


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

impl ModLoader {
    /// Loader mit ihrem Schlüssel unter `dependencies` in `modrinth.index.json`.
    pub const PACK_KEYS: [(ModLoader, &'static str); 4] =
        [(Self::Fabric, "fabric-loader"), (Self::Quilt, "quilt-loader"), (Self::Forge, "forge"), (Self::NeoForge, "neoforge")];

    pub fn pack_key(self) -> Option<&'static str> {
        Self::PACK_KEYS.iter().find(|(l, _)| *l == self).map(|(_, k)| *k)
    }

    /// Modrinth-Loader-Namen, deren Mods in dieser Instanz laufen (Quilt lädt auch Fabric-Mods).
    pub fn modrinth_loaders(self) -> &'static [&'static str] {
        match self {
            Self::Vanilla => &[],
            Self::Fabric => &["fabric"],
            Self::Quilt => &["quilt", "fabric"],
            Self::Forge => &["forge"],
            // ponytail: NeoForge für 1.20.1 lädt auch reine Forge-Mods; der Katalog findet dort nur als NeoForge markierte.
            // Upgrade: Loader-Liste abhängig von der Minecraft-Version.
            Self::NeoForge => &["neoforge"],
        }
    }

    /// `true`, wenn eine Mod-Version mit diesen Modrinth-Loadern hier läuft.
    pub fn runs(self, loaders: &[String]) -> bool {
        loaders.iter().any(|l| self.modrinth_loaders().contains(&l.as_str()))
    }
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

/// Inhaltsart und Zielordner im Spielverzeichnis. Fehlt das Feld (alte JSON), ist es eine Mod.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ModKind {
    #[default]
    Mod,
    ResourcePack,
    Shader,
}

impl ModKind {
    pub fn folder(self) -> &'static str {
        match self {
            Self::Mod => "mods",
            Self::ResourcePack => "resourcepacks",
            Self::Shader => "shaderpacks",
        }
    }

    pub fn extension(self) -> &'static str {
        match self {
            Self::Mod => ".jar",
            Self::ResourcePack | Self::Shader => ".zip",
        }
    }
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
    #[serde(default)]
    pub kind: ModKind,
    /// Modrinth-Projekt-IDs der direkt installierten Mods, die diese als Pflicht-Abhängigkeit
    /// mitgebracht haben. Leer = vom Nutzer direkt hinzugefügt.
    #[serde(default)]
    pub required_by: Vec<String>,
}

/// Aus welchem Modpack eine Instanz installiert wurde (für Pack-Updates).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "lowercase", rename_all_fields = "camelCase")]
pub enum ModpackOrigin {
    Modrinth { project_id: String, version_id: String },
    CurseForge { project_id: u32, file_id: u32 },
    /// Pack eines Anbieters ohne Schlüssel (`source` z. B. "ftb"), siehe `services::providers`.
    Provider { source: String, project_id: String, version_id: String },
}

/// Spielfenster beim Start. Getaggt als `{"type": "size", "width": …, "height": …}`.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "lowercase")]
pub enum GameWindow {
    /// Wie Minecraft es selbst öffnet.
    #[default]
    Default,
    Size { width: u32, height: u32 },
    Fullscreen,
}

/// Quick Play: direkt in eine Welt (ID = Ordnername unter `saves/`) oder auf einen Server (`host[:port]`).
/// Getaggt als `{"type": "world", "id": …}`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "lowercase")]
pub enum QuickPlay {
    World { id: String },
    Server { address: String },
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Instance {
    pub id: String,
    pub name: String,
    pub minecraft_version: String,
    pub loader: ModLoader,
    pub loader_version: Option<String>,
    #[serde(default)]
    pub modpack: Option<ModpackOrigin>,
    pub memory_mb: Option<u32>,
    pub jvm_args: Vec<String>,
    /// Eigene Java-Programmdatei; ohne gilt die Einstellung des Launchers bzw. die mitgelieferte Runtime.
    #[serde(default)]
    pub java_path: Option<String>,
    #[serde(default)]
    pub window: GameWindow,
    /// Eigene Spielargumente, angehängt nach denen der Version.
    #[serde(default)]
    pub game_args: Vec<String>,
    /// Summe aller beendeten Sitzungen in Sekunden. Zählt nur das Backend.
    #[serde(default)]
    pub playtime_secs: u64,
    /// Gruppe in der Bibliothek; Gruppen gibt es nur über die Instanzen, die sie tragen.
    #[serde(default)]
    pub group: Option<String>,
    pub mods: Vec<Mod>,
    pub created_at: u64,
    pub last_played_at: Option<u64>,
    /// Ziel des letzten Starts per Quick Play.
    #[serde(default)]
    pub last_quick_play: Option<QuickPlay>,
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
            modpack: None,
            memory_mb: None,
            jvm_args: Vec::new(),
            java_path: None,
            window: GameWindow::Default,
            game_args: Vec::new(),
            playtime_secs: 0,
            group: None,
            mods: Vec::new(),
            created_at: now_ms(),
            last_played_at: None,
            last_quick_play: None,
        }
    }

}

/// Vorlage: Schnappschuss einer Instanz als `templates/<id>.mrpack`, ohne Verbindung zur Instanz.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Template {
    pub id: String,
    pub name: String,
    pub minecraft_version: String,
    pub loader: ModLoader,
    pub mod_count: usize,
    pub created_at: u64,
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

/// Gespeichertes Microsoft-Konto in `accounts.json`: nur Metadaten. Der Refresh-Token liegt im
/// OS-Schlüsselbund (Windows-Anmeldeinformationsverwaltung), der Minecraft-Token nur im Speicher.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MsAccount {
    /// Minecraft-Spieler-UUID (mit Bindestrichen).
    pub id: String,
    pub username: String,
    pub kind: AccountKind,
    /// Azure-App, mit der angemeldet wurde; der Refresh-Token gilt nur für sie.
    pub client_id: String,
}

impl MsAccount {
    pub fn account(&self) -> Account {
        Account { id: self.id.clone(), username: self.username.clone(), kind: AccountKind::Microsoft, active: false }
    }
}

/// Spielermodell eines Skins: breite (Steve) oder schmale Arme (Alex). Die Minecraft-API schreibt es groß.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum SkinVariant {
    #[default]
    #[serde(alias = "CLASSIC")]
    Classic,
    #[serde(alias = "SLIM")]
    Slim,
}

impl SkinVariant {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Classic => "classic",
            Self::Slim => "slim",
        }
    }
}

/// Skin in der lokalen Bibliothek (`skins.json`); die ID ist der SHA-1 der Datei `skins/<id>.png`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LibrarySkin {
    pub id: String,
    pub name: String,
    pub variant: SkinVariant,
    pub added_at: u64,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn old_instance_json_with_preset_id_loads() {
        let i: Instance = serde_json::from_value(serde_json::json!({
            "id": "i", "name": "Alt", "minecraftVersion": "1.21.1", "loader": "fabric", "loaderVersion": null,
            "presetId": "p", "memoryMb": null, "jvmArgs": [], "mods": [], "createdAt": 1, "lastPlayedAt": null
        }))
        .unwrap();
        assert_eq!((i.name.as_str(), i.loader), ("Alt", ModLoader::Fabric));
        assert_eq!((i.java_path, i.window, i.game_args.len(), i.playtime_secs, i.group), (None, GameWindow::Default, 0, 0, None));
    }

    #[test]
    fn game_window_json_shape() {
        assert_eq!(
            serde_json::to_value(GameWindow::Size { width: 1280, height: 720 }).unwrap(),
            serde_json::json!({"type": "size", "width": 1280, "height": 720})
        );
        assert_eq!(serde_json::to_value(GameWindow::Fullscreen).unwrap(), serde_json::json!({"type": "fullscreen"}));
    }

    #[test]
    fn quick_play_json_shape() {
        assert_eq!(
            serde_json::to_value(QuickPlay::World { id: "Neue Welt".into() }).unwrap(),
            serde_json::json!({"type": "world", "id": "Neue Welt"})
        );
        assert_eq!(
            serde_json::to_value(QuickPlay::Server { address: "mc.example.net:25570".into() }).unwrap(),
            serde_json::json!({"type": "server", "address": "mc.example.net:25570"})
        );
    }

    #[test]
    fn ms_account_json_has_no_token() {
        let a = MsAccount { id: "u".into(), username: "Steve".into(), kind: AccountKind::Microsoft, client_id: "c".into() };
        let json = serde_json::to_value(&a).unwrap();
        let keys: Vec<_> = json.as_object().unwrap().keys().map(String::as_str).collect();
        assert_eq!(keys, ["clientId", "id", "kind", "username"]);
        assert_eq!(serde_json::to_value(a.account()).unwrap()["kind"], "microsoft");
    }

    #[test]
    fn skin_variant_reads_api_spelling() {
        assert_eq!(serde_json::from_value::<SkinVariant>(serde_json::json!("SLIM")).unwrap(), SkinVariant::Slim);
        assert_eq!(serde_json::from_value::<SkinVariant>(serde_json::json!("classic")).unwrap(), SkinVariant::Classic);
        assert_eq!(serde_json::to_value(SkinVariant::Slim).unwrap(), "slim");
    }

    #[test]
    fn loader_names() {
        let names = |v: &[&str]| v.iter().map(|s| s.to_string()).collect::<Vec<_>>();
        assert!(ModLoader::Quilt.runs(&names(&["fabric"])));
        assert!(!ModLoader::Fabric.runs(&names(&["quilt"])));
        assert!(!ModLoader::Vanilla.runs(&names(&["fabric"])));
        assert_eq!(ModLoader::NeoForge.pack_key(), Some("neoforge"));
        assert_eq!(serde_json::to_value(ModLoader::NeoForge).unwrap(), "neoforge");
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

    #[test]
    fn old_mod_json_gets_defaults() {
        let m: Mod = serde_json::from_value(serde_json::json!({
            "id": "sodium", "name": "Sodium", "version": "1", "source": {"type": "local"},
            "fileName": "sodium.jar", "enabled": true
        }))
        .unwrap();
        assert_eq!((m.kind, m.required_by.len(), m.sha1.is_none()), (ModKind::Mod, 0, true));
        let v = serde_json::to_value(Mod { kind: ModKind::ResourcePack, required_by: vec!["p".into()], ..m }).unwrap();
        assert_eq!((&v["kind"], &v["requiredBy"]), (&serde_json::json!("resourcepack"), &serde_json::json!(["p"])));
    }
}
