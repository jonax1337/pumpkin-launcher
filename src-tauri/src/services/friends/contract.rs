//! Vertrag zwischen Freunde-Backend und Oberfläche (docs/friends/SPEC.md, 8.1 und 8.2): Konstanten, Zustände,
//! Befehlsantworten und Ereignis-Nutzlasten. Das TypeScript-Gegenstück ist `src/lib/friends-types.ts`;
//! `contract_tests.rs` prüft beide Seiten gegen dieselben Fixtures. Fehler stehen nie in diesen Typen.
use serde::{Deserialize, Serialize};

pub use crate::services::shared_types::{ModLoader, PathKind, PortSource};

pub const FRIEND_CODE_PREFIX: &str = "pumpkin-";
pub const FRIEND_CODE_BODY_LENGTH: usize = 72;
pub const FRIEND_CODE_LENGTH: usize = 80;
pub const DISPLAY_NAME_MIN: usize = 3;
pub const DISPLAY_NAME_MAX: usize = 32;
pub const ALIAS_MAX: usize = 32;
pub const MAX_FRIENDS: usize = 50;
pub const MAX_ACTIVE_CODES: usize = 3;
pub const MAX_GUESTS: usize = 7;
pub const CODE_TTL_SECS: u64 = 604_800;
pub const REQUEST_TTL_SECS: u64 = 1_209_600;
pub const INVITE_TTL_SECS: u64 = 7_200;
pub const MIN_MC_RELEASE_TIME: &str = "2023-06-02T08:36:17+00:00";
pub const MIN_MC_LABEL: &str = "1.20";
pub const PORT_MIN: u16 = 1024;
pub const PORT_MAX: u16 = 65535;
pub const MAX_NAME_REQUESTS: usize = 5;
pub const MC_NAME_MAX: usize = 16;
pub const NAME_COOLDOWN_DAYS: u64 = 7;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Availability {
    Available,
    NoSecretStore,
    IdentityLost,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FriendsState {
    pub availability: Availability,
    pub enabled: bool,
    pub me: Option<Me>,
    pub settings: FriendsSettings,
    pub network: NetworkStatus,
    pub relays: Vec<RelayInfo>,
    pub third_party_relays_accepted: bool,
    pub directory: DirectoryStatus,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DirectoryStatus {
    pub state: DirectoryState,
    /// Für den Datenschutzhinweis; `None`, solange kein Verzeichnis eingebaut ist.
    pub host: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum DirectoryState {
    /// Dieser Build kennt kein Verzeichnis.
    Unavailable,
    /// „Per Minecraft-Namen auffindbar“ ist aus.
    Off,
    Active,
    /// Die letzte Anmeldung oder Abfrage ist gescheitert.
    Unreachable,
    /// Mojang verweigert dem Konto den Mehrspieler-Nachweis.
    NotAllowed,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Me {
    pub peer_id: String,
    pub fingerprint: String,
    pub display_name: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FriendsSettings {
    pub display_name: String,
    pub always_relay: bool,
    /// Fehlt in Dateien aus der Zeit vor der Suche per Name.
    #[serde(default)]
    pub findable_by_name: bool,
    /// „Freunde-Menü im Spiel“ (INGAME 3.9): der globale Schalter der Einspeisung. Fehlt in älteren Dateien: an.
    #[serde(default = "ingame_menu_default")]
    pub ingame_menu: bool,
    /// „Aktionen im Spiel“ (INGAME 5.5). Fehlt in älteren Dateien: fragen.
    #[serde(default)]
    pub ingame_actions: IngameActions,
}

fn ingame_menu_default() -> bool {
    true
}

impl Default for FriendsSettings {
    fn default() -> Self {
        Self {
            display_name: String::new(),
            always_relay: false,
            findable_by_name: false,
            ingame_menu: ingame_menu_default(),
            ingame_actions: IngameActions::default(),
        }
    }
}

/// Ob der Launcher Aktionen der Mod im Spiel (Teilen, Freunde ändern) einmal je Spielstart erfragt oder sie gleich erlaubt.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum IngameActions {
    #[default]
    Ask,
    Allow,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FriendsEnableInput {
    pub display_name: String,
    pub always_relay: bool,
    pub accept_third_party_relays: bool,
    pub findable_by_name: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RelayInfo {
    pub host: String,
    pub operator: RelayOperatorKind,
    pub third_party: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum RelayOperatorKind {
    Pumpkin,
    N0,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase", rename_all_fields = "camelCase")]
pub enum NetworkStatus {
    Off,
    Starting,
    Online { relay_host: String },
    Degraded { reason: DegradedReason },
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum DegradedReason {
    RelayUnreachable,
    BindFailed,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Friend {
    pub id: String,
    pub display_name: String,
    pub alias: Option<String>,
    pub mc_name: Option<String>,
    pub mc_uuid: Option<String>,
    pub fingerprint: String,
    pub added_at: u64,
    pub last_seen: Option<u64>,
    pub confirmed: bool,
    pub removed_by_peer: bool,
    pub notice: Option<FriendNotice>,
    pub presence: Presence,
    pub path: Option<PathKind>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase", rename_all_fields = "camelCase")]
pub enum FriendNotice {
    Renamed { previous_name: String },
    IdentityChanged { previous_fingerprint: String },
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Presence {
    Offline,
    Online,
    Playing,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FriendRequest {
    pub id: String,
    pub direction: RequestDirection,
    pub state: RequestState,
    pub peer_id: Option<String>,
    pub fingerprint: Option<String>,
    pub display_name: Option<String>,
    pub mc_name: Option<String>,
    pub code_tail: Option<String>,
    pub created_at: u64,
    pub expires_at: u64,
    pub via: RequestVia,
}

/// Auf welchem Weg eine Anfrage entstanden ist.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum RequestVia {
    #[default]
    Code,
    Name,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum RequestDirection {
    Incoming,
    Outgoing,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum RequestState {
    /// Eingehend, wartet auf die Antwort des Nutzers.
    Pending,
    /// Ausgehend, noch nicht beim Code-Besitzer angekommen.
    Delivering,
    /// Ausgehend und angekommen, wartet auf die Annahme.
    AwaitingAnswer,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FriendCode {
    pub id: String,
    /// Nur in der Antwort von `friend_code_create`.
    pub code: Option<String>,
    pub tail: String,
    pub created_at: u64,
    pub expires_at: u64,
    pub used: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BlockedPeer {
    pub peer_id: String,
    pub display_name: String,
    pub blocked_at: u64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HostSession {
    pub id: String,
    pub instance_id: String,
    pub port: u16,
    pub port_source: PortSource,
    pub pid: u32,
    pub world_name: Option<String>,
    pub show_world_name: bool,
    pub started_at: u64,
    pub guests: Vec<SessionGuest>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionGuest {
    pub friend_id: String,
    pub display_name: String,
    pub state: GuestState,
    /// Nur mit `state == Left` nach einem Rauswurf (SPEC 5.4).
    pub kicked: bool,
    pub path: Option<PathKind>,
    pub rtt_ms: Option<u32>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum GuestState {
    Invited,
    Declined,
    Connected,
    Left,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Invite {
    pub id: String,
    pub session_id: String,
    pub from: String,
    pub from_name: String,
    pub from_fingerprint: String,
    /// Weltname oder Instanzname, bereinigt.
    pub title: String,
    pub instance: InstanceSummary,
    pub received_at: u64,
    pub expires_at: u64,
    pub host_online: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InstanceSummary {
    pub name: String,
    pub minecraft_version: String,
    pub loader: ModLoader,
    pub loader_version: Option<String>,
    pub mod_count: u32,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct JoinPlan {
    pub invite_id: String,
    pub summary: InstanceSummary,
    pub verdict: JoinVerdict,
    /// Passende zuerst, dann die mit den wenigsten Unterschieden.
    pub candidates: Vec<InstanceCandidate>,
    pub create_vanilla: bool,
    pub lookup_failed: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum JoinVerdict {
    Ready,
    MissingContent,
    NoInstance,
    VersionUnsupported,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InstanceCandidate {
    pub instance_id: String,
    pub name: String,
    pub matches: bool,
    pub missing: Vec<ModRef>,
    pub extra: Vec<ModRef>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModRef {
    pub title: String,
    pub file_name: String,
    pub project_id: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct JoinTicket {
    pub join_id: String,
    pub invite_id: String,
    pub instance_id: String,
    pub address: String,
}

/// Nur geprüfte Ports.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LanStatus {
    pub port: u16,
    pub source: PortSource,
    pub pid: u32,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FriendPresenceEvent {
    pub friend_id: String,
    pub presence: Presence,
    pub path: Option<PathKind>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FriendRequestEvent {
    pub request: FriendRequest,
}

/// Der Besitzer des Codes hat die ausgehende Anfrage endgültig abgelehnt; sie ist gelöscht.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FriendRequestRefusedEvent {
    pub request: FriendRequest,
    pub reason: RequestRefusal,
}

/// Die endgültigen Ablehnungen aus `pumpkin/hello/1` (SPEC 5.2); `full` wird später erneut versucht.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum RequestRefusal {
    CodeUsed,
    AlreadyFriends,
    Unsupported,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InviteEvent {
    pub invite: Invite,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InviteRevokedEvent {
    pub invite_id: String,
    pub reason: RevokeReason,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum RevokeReason {
    Stopped,
    Kicked,
    Expired,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HostSessionEvent {
    pub session: HostSession,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HostSessionEndedEvent {
    pub session_id: String,
    pub reason: SessionEnd,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct JoinSessionEvent {
    pub join_id: String,
    pub invite_id: String,
    pub instance_id: String,
    pub state: JoinState,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase", rename_all_fields = "camelCase")]
pub enum JoinState {
    WaitingForGame,
    Connecting,
    Connected { path: PathKind, rtt_ms: Option<u32> },
    Ended { reason: SessionEnd },
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum SessionEnd {
    Stopped,
    Kicked,
    LanClosed,
    HostOffline,
    GameExited,
    Left,
    Disabled,
    Error,
}

/// `lan: None` heißt: der Port ist zu.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LanEvent {
    pub instance_id: String,
    pub lan: Option<LanStatus>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModConnectionEvent {
    pub instance_id: String,
    pub connected: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModConfirmEvent {
    pub request_id: String,
    pub instance_id: String,
    pub instance_name: String,
    pub friends: Vec<ModConfirmFriend>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModConfirmFriend {
    pub friend_id: String,
    pub display_name: String,
}

// ---------------------------------------------------------------------------------------------------------------------
// Freunde-Menü im Spiel (docs/friends/INGAME.md, 3.9): Status der Einspeisung je Instanz, berechnet ohne Start.
// ---------------------------------------------------------------------------------------------------------------------

use super::ingame::{FailureKind, Loader as IngameLoader};

/// Wie es um das Freunde-Menü im Spiel einer Instanz steht.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum IngameState {
    /// Der nächste Start speist die Mod ein.
    Active,
    /// Die Mod des laufenden Spiels ist mit dem Launcher verbunden.
    Connected,
    /// Der Spieler hat die Einspeisung ausgeschaltet (global oder für die Instanz).
    Off,
    /// Ein Startfehler hat sie ausgeschaltet („Erneut versuchen“).
    AutoOff,
    /// Für diese Instanz gibt es keine Einspeisung; `reason` sagt warum.
    Unavailable,
}

/// Der Grund zu einem Status, den die Oberfläche in die Zeile der Instanzseite übersetzt.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase", rename_all_fields = "camelCase")]
pub enum IngameReason {
    /// Dieser Build trägt keine Mod (Entwicklungsbuild ohne JARs).
    NotInBuild,
    Vanilla,
    Quilt,
    /// Kein Knoten für diese Minecraft-Version mit diesem Loader.
    NoNode,
    /// Es gibt einen Knoten, sein Rauchtest ist aber nicht bestanden.
    Unverified,
    LoaderTooOld { need: String },
    LoaderVersionUnknown,
    JavaTooOld { need: u32 },
    JavaUnknown,
    IdCollision,
    OfflineAccount,
    FriendsOff,
    BridgeNotRunning,
    /// Der Schalter dieser Instanz ist aus.
    InstanceOff,
    /// Der globale Schalter „Freunde-Menü im Spiel“ ist aus.
    GloballyOff,
    Breaker { reason: FailureKind },
}

/// Der Knoten, der für die Instanz gewählt wäre.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IngameNode {
    pub id: String,
    /// Die Minecraft-Version der Instanz.
    pub minecraft: String,
    pub loader: IngameLoader,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IngameStatus {
    pub state: IngameState,
    pub reason: Option<IngameReason>,
    pub node: Option<IngameNode>,
}

/// `friends-ingame`: der Status einer Instanz hat sich geändert.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IngameEvent {
    pub instance_id: String,
    pub status: IngameStatus,
}

/// `friends-ingame-failed`: der Start ist wahrscheinlich an der Mod gescheitert, die Einspeisung ist ausgeschaltet.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IngameFailedEvent {
    pub instance_id: String,
    pub reason: FailureKind,
}
