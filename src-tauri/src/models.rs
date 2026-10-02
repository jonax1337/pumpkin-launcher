//! Datenmodelle. Serialisierung in camelCase, passend zu `src/lib/types.ts`.
use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};

use crate::coded;
use crate::error::{AppError, AppResult, ErrorText};
use crate::services::limits::ICON_DATA_URL_LIMIT;

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

/// Längster Instanzname (in Zeichen), den Packs und Imports mitbringen dürfen.
pub const MAX_NAME_LEN: usize = 200;
/// Längster Name einer Vorlage (in Zeichen).
pub const MAX_TEMPLATE_NAME_LEN: usize = 100;
/// Längster Name eines Skins der Bibliothek (in Zeichen).
pub const MAX_SKIN_NAME_LEN: usize = 64;
/// Längste Notiz einer Instanz (in Zeichen).
pub const MAX_NOTES_LEN: usize = 10_000;
/// Für Namen, die nur nicht leer sein müssen.
pub const NO_NAME_LIMIT: usize = usize::MAX;

/// Der Name ohne Randleerraum; leer oder länger als `max_chars` Zeichen lehnt er mit `message` ab.
pub fn require_name(name: &str, max_chars: usize, message: impl Into<ErrorText>) -> AppResult<&str> {
    let name = name.trim();
    if name.is_empty() || name.chars().count() > max_chars {
        return Err(AppError::invalid(message));
    }
    Ok(name)
}

/// Name einer neuen Instanz aus einem Pack oder Anbieter.
pub fn instance_name(raw: &str) -> AppResult<&str> {
    require_name(raw, MAX_NAME_LEN, coded!("errors.app.instanceNameInvalid"))
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
    const ALL: [ModLoader; 5] = [Self::Vanilla, Self::Fabric, Self::Quilt, Self::Forge, Self::NeoForge];

    /// Schlüssel in JSON und Schnittstellen, kleingeschrieben wie der serde-Name.
    pub fn name(self) -> &'static str {
        match self {
            Self::Vanilla => "vanilla",
            Self::Fabric => "fabric",
            Self::Quilt => "quilt",
            Self::Forge => "forge",
            Self::NeoForge => "neoforge",
        }
    }

    /// Der Loader zu einem Namen wie [`name`](Self::name); Unbekanntes ist keiner.
    pub fn from_name(name: &str) -> Option<Self> {
        Self::ALL.into_iter().find(|loader| loader.name() == name)
    }

    /// Wie [`from_name`](Self::from_name), aber ohne Vanilla: so nennen Anbieter und Packs ihre Mod-Loader.
    pub fn from_modded_name(name: &str) -> Option<Self> {
        Self::from_name(name).filter(|loader| *loader != Self::Vanilla)
    }

    /// Schreibweise für Menschen (Berichte, Meldungen).
    pub fn display_name(self) -> &'static str {
        match self {
            Self::Vanilla => "Vanilla",
            Self::Fabric => "Fabric",
            Self::Quilt => "Quilt",
            Self::Forge => "Forge",
            Self::NeoForge => "NeoForge",
        }
    }

    /// Loader mit ihrem Schlüssel unter `dependencies` in `modrinth.index.json`.
    pub const PACK_KEYS: [(ModLoader, &str); 4] =
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
    pub const ALL: [ModKind; 3] = [Self::Mod, Self::ResourcePack, Self::Shader];

    /// Modrinth-Loader-Namen, unter denen Updates dieser Art gesucht werden: Mods laufen unter den Loadern der
    /// Instanz, Ressourcenpakete unter `minecraft`, Shader unter den Shader-Loadern.
    pub fn update_loaders(self, loader: ModLoader) -> &'static [&'static str] {
        match self {
            Self::Mod => loader.modrinth_loaders(),
            Self::ResourcePack => &["minecraft"],
            Self::Shader => &["iris", "optifine", "canvas", "vanilla"],
        }
    }

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
    /// Festgehalten: Die Update-Prüfung überspringt den Eintrag, er bleibt auf seiner Version.
    #[serde(default)]
    pub pinned: bool,
    /// Kam mit einem Modpack oder einer Vorlage in die Instanz; für solche Inhalte sind Pack-Updates der vorgesehene Weg.
    #[serde(default)]
    pub pack_managed: bool,
}

/// Aus welchem Modpack eine Instanz installiert wurde (für Pack-Updates).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "lowercase", rename_all_fields = "camelCase")]
pub enum ModpackOrigin {
    Modrinth { project_id: String, version_id: String },
    CurseForge { project_id: u32, file_id: u32 },
    /// Pack eines Anbieters ohne Schlüssel (`source` z. B. "ftb"), siehe `services::providers`.
    Provider { source: String, project_id: String, version_id: String },
    /// Selbst gewählte `.mrpack`-Datei: Name und Version aus ihrem `modrinth.index.json`.
    File { name: String, version: String },
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

/// Was das Frontend zum Start mitgibt; die Startoptionen der Instanz selbst liest das Backend aus ihr.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LaunchOptions {
    /// Offline-Spielername; mit `account_id` (Microsoft-Konto) ohne Bedeutung.
    pub username: String,
    pub account_id: Option<String>,
    /// Java-Einstellung des Launchers; der Pfad der Instanz geht vor.
    pub java_path: Option<String>,
    /// RAM-Standard des Launchers für Instanzen ohne eigenen Wert.
    pub default_memory_mb: Option<u32>,
    /// Launcher-Einstellung „Welten vor dem Start sichern“; die Wahl der Instanz geht vor.
    pub backup_worlds: Option<bool>,
    /// So viele automatische Sicherungen je Welt bleiben erhalten.
    pub backup_keep: Option<u32>,
    /// Minimaler RAM (`-Xms`) des Launchers für Instanzen ohne eigenen Wert.
    pub default_min_memory_mb: Option<u32>,
    /// JVM-Argumente des Launchers für Instanzen ohne eigene.
    #[serde(default)]
    pub default_jvm_args: Vec<String>,
    /// Fenster des Launchers für Instanzen, die ihres nicht selbst festlegen.
    pub default_window: Option<GameWindow>,
    /// Direkt in eine Welt oder auf einen Server.
    pub quick_play: Option<QuickPlay>,
}

/// Namen, die das Frontend zeichnen kann; sie müssen mit ihm übereinstimmen, sonst stürzt die Ansicht ab bzw. ein gültiges
/// Icon wird verworfen. Biome: Schlüssel von `BIOMES` in `src/pixel/sceneConfig.ts`; Glyphen und Paletten: Schlüssel von
/// `GLYPHS` und `GLYPH_PALETTES` in `src/pixel/icons.tsx`.
const BIOMES: [&str; 7] = ["forest", "nether", "end", "snow", "cave", "sea", "plains"];
const GLYPHS: [&str; 19] = [
    "cube", "spool", "gear", "eye", "list", "apple", "picture", "bubble", "mountain", "sun", "rocket", "ball", "star",
    "chest", "compass", "bolt", "leaf", "brush", "hammer",
];
const GLYPH_PALETTES: [&str; 9] = ["copper", "steel", "sand", "violet", "teal", "coral", "ice", "gold", "rose"];
/// Bildformate, die das Frontend als Instanz-Icon liefert.
const ICON_IMAGE_FORMATS: [&str; 4] = ["png", "jpeg", "webp", "gif"];

/// Eigenes Icon einer Instanz: ein Pixel-Icon in einer Farbpalette oder ein Bild als `data:`-URL.
/// Getaggt als `{"type": "glyph", "glyph": …, "palette": …}` bzw. `{"type": "image", "src": …}`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "lowercase")]
pub enum InstanceIcon {
    Glyph { glyph: String, palette: String },
    Image { src: String },
}

impl InstanceIcon {
    /// Das Icon, wenn es eine Glyphe aus [`GLYPHS`] in einer Palette aus [`GLYPH_PALETTES`] bzw. ein begrenztes Bild in
    /// einem der Formate von [`ICON_IMAGE_FORMATS`] ist; Icons kommen auch aus fremden Packs.
    pub fn validated(self) -> AppResult<Self> {
        let valid = match &self {
            Self::Glyph { glyph, palette } => GLYPHS.contains(&glyph.as_str()) && GLYPH_PALETTES.contains(&palette.as_str()),
            Self::Image { src } => src.len() <= ICON_DATA_URL_LIMIT && is_image_data_url(src),
        };
        if valid { Ok(self) } else { Err(AppError::invalid(coded!("errors.app.iconInvalid"))) }
    }
}

fn is_image_data_url(src: &str) -> bool {
    ICON_IMAGE_FORMATS.iter().any(|format| src.strip_prefix(&format!("data:image/{format};base64,")).is_some_and(|data| !data.is_empty()))
}

/// Szene einer Instanz: Biom (Name wie im Frontend) und Variante des Aufbaus.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct InstanceScene {
    pub biome: String,
    pub seed: u32,
}

impl InstanceScene {
    /// Die Szene, wenn ihr Biom eines aus [`BIOMES`] ist.
    pub fn validated(self) -> AppResult<Self> {
        if BIOMES.contains(&self.biome.as_str()) { Ok(self) } else { Err(AppError::invalid(coded!("errors.app.sceneInvalid"))) }
    }
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
    /// Minimaler RAM (`-Xms`) in MiB; ohne gilt der Wert des Launchers, sonst entscheidet die JVM.
    #[serde(default)]
    pub min_memory_mb: Option<u32>,
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
    /// Eigene Notizen zur Instanz, höchstens `MAX_NOTES_LEN` Zeichen.
    #[serde(default)]
    pub notes: String,
    /// Instanzordner im anderen Launcher, aus dem die Instanz importiert wurde.
    #[serde(default)]
    pub imported_from: Option<String>,
    /// Eigenes Icon; ohne gilt das des Modpacks, sonst ein Pixel-Icon aus der ID.
    #[serde(default)]
    pub icon: Option<InstanceIcon>,
    /// Gewählte Szene; ohne ergibt sie sich aus der ID.
    #[serde(default)]
    pub scene: Option<InstanceScene>,
    /// Welten vor dem Start sichern: die Wahl dieser Instanz; ohne gilt die Einstellung des Launchers.
    #[serde(default)]
    pub backup_worlds: Option<bool>,
    pub mods: Vec<Mod>,
    pub created_at: u64,
    pub last_played_at: Option<u64>,
    /// Ziel des letzten Starts per Quick Play.
    #[serde(default)]
    pub last_quick_play: Option<QuickPlay>,
    /// Konto, mit dem diese Instanz startet (Schlüssel, den das Frontend vergibt); ohne gilt das aktive Konto.
    #[serde(default)]
    pub default_account: Option<String>,
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
            min_memory_mb: None,
            jvm_args: Vec::new(),
            java_path: None,
            window: GameWindow::Default,
            game_args: Vec::new(),
            playtime_secs: 0,
            group: None,
            notes: String::new(),
            imported_from: None,
            icon: None,
            scene: None,
            backup_worlds: None,
            mods: Vec::new(),
            created_at: now_ms(),
            last_played_at: None,
            last_quick_play: None,
            default_account: None,
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
/// OS-Schlüsselbund (Windows-Anmeldeinformationsverwaltung, macOS-Schlüsselbund, Secret Service unter Linux),
/// der Minecraft-Token nur im Speicher.
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
        assert_eq!((i.min_memory_mb, i.default_account), (None, None));
    }

    #[test]
    fn old_instance_json_has_no_look_and_follows_the_launcher_backup_setting() {
        let i: Instance = serde_json::from_value(serde_json::json!({
            "id": "i", "name": "Alt", "minecraftVersion": "1.21.1", "loader": "vanilla", "loaderVersion": null,
            "memoryMb": null, "jvmArgs": [], "mods": [], "createdAt": 1, "lastPlayedAt": null
        }))
        .unwrap();
        assert_eq!((i.icon, i.scene, i.backup_worlds), (None, None, None));
    }

    #[test]
    fn instance_icon_json_shape() {
        let glyph: InstanceIcon = serde_json::from_value(serde_json::json!({"type": "glyph", "glyph": "sword", "palette": "teal"})).unwrap();
        assert_eq!(glyph, InstanceIcon::Glyph { glyph: "sword".into(), palette: "teal".into() });
        let image = InstanceIcon::Image { src: "data:image/webp;base64,AAAA".into() };
        assert_eq!(serde_json::to_value(&image).unwrap(), serde_json::json!({"type": "image", "src": "data:image/webp;base64,AAAA"}));
    }

    #[test]
    fn only_plain_icons_and_scenes_are_valid() {
        let glyph = |glyph: &str, palette: &str| InstanceIcon::Glyph { glyph: glyph.into(), palette: palette.into() };
        let image = |src: &str| InstanceIcon::Image { src: src.into() };
        assert!(glyph("hammer", "teal").validated().is_ok());
        for bad in [glyph("", "teal"), glyph("nope", "teal"), glyph("hammer", "nope"), glyph("Hammer", "teal"), glyph("hammer", "../x")] {
            assert!(bad.validated().is_err());
        }
        assert!(image("data:image/png;base64,iVBOR").validated().is_ok());
        for bad in ["javascript:alert(1)", "data:image/svg+xml;base64,AAAA", "data:text/html;base64,AAAA", "data:image/png;base64,", "https://example.net/a.png"] {
            assert!(image(bad).validated().is_err(), "{bad}");
        }
        assert!(image(&format!("data:image/png;base64,{}", "A".repeat(ICON_DATA_URL_LIMIT))).validated().is_err());
        assert!(InstanceScene { biome: "forest".into(), seed: 7 }.validated().is_ok());
        assert!(InstanceScene { biome: "für est".into(), seed: 7 }.validated().is_err());
        assert!(InstanceScene { biome: "xyz".into(), seed: 7 }.validated().is_err());
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
    fn loader_name_matches_the_serialized_name_and_reads_back() {
        for loader in ModLoader::ALL {
            assert_eq!(serde_json::to_value(loader).unwrap(), loader.name());
            assert_eq!(ModLoader::from_name(loader.name()), Some(loader));
            assert_eq!(ModLoader::from_modded_name(loader.name()), (loader != ModLoader::Vanilla).then_some(loader));
        }
        assert_eq!(ModLoader::from_name("NeoForge"), None, "nur kleingeschrieben");
        assert_eq!(ModLoader::NeoForge.display_name(), "NeoForge");
        assert_eq!(format!("{:?}", ModLoader::Quilt), ModLoader::Quilt.display_name(), "der Installations-Marker hängt daran");
    }

    #[test]
    fn content_kinds_search_updates_under_their_own_loaders() {
        assert_eq!(ModKind::ALL.map(ModKind::folder), ["mods", "resourcepacks", "shaderpacks"]);
        assert_eq!(ModKind::Mod.update_loaders(ModLoader::Quilt), ["quilt", "fabric"]);
        assert_eq!(ModKind::ResourcePack.update_loaders(ModLoader::Forge), ["minecraft"]);
        assert_eq!(ModKind::Shader.update_loaders(ModLoader::Vanilla), ["iris", "optifine", "canvas", "vanilla"]);
    }

    #[test]
    fn names_are_trimmed_and_bounded_in_characters() {
        assert_eq!(require_name("  Technik ", 10, "x").unwrap(), "Technik");
        assert_eq!(require_name(&"ä".repeat(10), 10, "x").unwrap().chars().count(), 10);
        assert_eq!(require_name(&"ä".repeat(11), 10, "zu lang").unwrap_err().to_string(), "zu lang");
        assert_eq!(require_name("   ", NO_NAME_LIMIT, "leer").unwrap_err().to_string(), "leer");
        assert_eq!(instance_name("").unwrap_err().to_string(), "Ungültiger Instanzname");
        assert!(instance_name(&"a".repeat(MAX_NAME_LEN)).is_ok());
        assert!(instance_name(&"a".repeat(MAX_NAME_LEN + 1)).is_err());
    }

    #[test]
    fn pack_file_origin_json_shape() {
        let origin = ModpackOrigin::File { name: "Abenteuer".into(), version: "1.2".into() };
        assert_eq!(
            serde_json::to_value(origin).unwrap(),
            serde_json::json!({"type": "file", "name": "Abenteuer", "version": "1.2"})
        );
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
