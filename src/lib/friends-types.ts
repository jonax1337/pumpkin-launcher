// Vertrag der Freunde-Funktion mit dem Rust-Backend (docs/friends/SPEC.md, Abschnitt 8.2); Rust-Gegenstück: services/friends/contract.rs.
// Zeiten sind hier Unix-Sekunden (nicht Millisekunden wie sonst im Vertrag).
// Änderungen gehören zuerst in die Spezifikation, dann hierher und in die Fixtures (friends-fixtures.ts).
import type { ModLoader } from "./types";

export const FRIENDS_LIMITS = { codePrefix: "pumpkin-", codeBodyLength: 72, codeLength: 80,
  aliasMax: 32, maxFriends: 50, maxActiveCodes: 3, maxGuests: 7, codeTtlSecs: 604800, requestTtlSecs: 1209600, inviteTtlSecs: 7200,
  minMcReleaseTime: "2023-06-02T08:36:17+00:00", minMcLabel: "1.20", portMin: 1024, portMax: 65535,
  maxNameRequests: 5, mcNameMax: 16, nameCooldownDays: 7 } as const;
export type Availability = "available" | "noSecretStore" | "identityLost";
export interface FriendsState { availability: Availability; enabled: boolean; me: Me | null; settings: FriendsSettings;
  network: NetworkStatus; relays: RelayInfo[]; thirdPartyRelaysAccepted: boolean;
  directory: DirectoryStatus }
export interface Me { peerId: string; fingerprint: string; displayName: string }
export interface FriendsSettings { alwaysRelay: boolean; findableByName: boolean;
  /** „Freunde-Menü im Spiel“: der globale Schalter der Einspeisung (INGAME 3.9). */
  ingameMenu: boolean;
  /** „Aktionen im Spiel“ (INGAME 5.5): einmal je Spielstart fragen oder gleich erlauben. */
  ingameActions: IngameActions }
export type IngameActions = "ask" | "allow";
/** Verzeichnis für Freunde per Minecraft-Namen (docs/friends/BYNAME.md): `host` zeigt die Datenschutzhinweise, null = keins eingebunden. */
export type DirectoryState = "unavailable" | "off" | "active" | "unreachable" | "notAllowed";
export interface DirectoryStatus { state: DirectoryState; host: string | null }
export interface FriendsEnableInput { alwaysRelay: boolean; acceptThirdPartyRelays: boolean; findableByName: boolean }
export interface RelayInfo { host: string; operator: "pumpkin" | "n0"; thirdParty: boolean }
export type NetworkStatus = { type: "off" } | { type: "starting" } | { type: "online"; relayHost: string } | { type: "degraded"; reason: DegradedReason };
export type DegradedReason = "relayUnreachable" | "bindFailed";
export interface Friend { id: string; displayName: string; alias: string | null; mcName: string | null; mcUuid: string | null;
  fingerprint: string; addedAt: number; lastSeen: number | null; confirmed: boolean; removedByPeer: boolean;
  notice: FriendNotice | null; presence: Presence; path: PathKind | null }
export type FriendNotice = { type: "renamed"; previousName: string } | { type: "identityChanged"; previousFingerprint: string };
export type Presence = "offline" | "online" | "playing";
export type PathKind = "direct" | "relay";
export interface FriendRequest { id: string; direction: "incoming" | "outgoing"; state: "pending" | "delivering" | "awaitingAnswer";
  peerId: string | null; fingerprint: string | null; displayName: string | null; mcName: string | null; codeTail: string | null;
  createdAt: number; expiresAt: number; via: RequestVia }
export type RequestVia = "code" | "name";
export interface FriendCode { id: string; code: string | null; tail: string; createdAt: number; expiresAt: number; used: boolean }
export interface BlockedPeer { peerId: string; displayName: string; blockedAt: number }
export type PortSource = "mod" | "log" | "manual";
export interface HostSession { id: string; instanceId: string; port: number; portSource: PortSource; pid: number;
  worldName: string | null; showWorldName: boolean; startedAt: number; guests: SessionGuest[] }
export interface SessionGuest { friendId: string; displayName: string; state: "invited" | "declined" | "connected" | "left";
  kicked: boolean; path: PathKind | null; rttMs: number | null }
export interface InstanceSummary { name: string; minecraftVersion: string; loader: ModLoader; loaderVersion: string | null; modCount: number }
export interface Invite { id: string; sessionId: string; from: string; fromName: string; fromFingerprint: string; title: string;
  instance: InstanceSummary; receivedAt: number; expiresAt: number; hostOnline: boolean }
export type JoinVerdict = "ready" | "missingContent" | "noInstance" | "versionUnsupported";
export interface ModRef { title: string; fileName: string; projectId: string | null }
export interface InstanceCandidate { instanceId: string; name: string; matches: boolean; missing: ModRef[]; extra: ModRef[] }
export interface JoinPlan { inviteId: string; summary: InstanceSummary; verdict: JoinVerdict; candidates: InstanceCandidate[];
  createVanilla: boolean; lookupFailed: boolean }
export interface JoinTicket { joinId: string; inviteId: string; instanceId: string; address: string }
export interface LanStatus { port: number; source: PortSource; pid: number }
export type SessionEnd = "stopped" | "kicked" | "lanClosed" | "hostOffline" | "gameExited" | "left" | "disabled" | "error";
export type JoinState = { type: "waitingForGame" } | { type: "connecting" } | { type: "connected"; path: PathKind; rttMs: number | null }
  | { type: "ended"; reason: SessionEnd };
export interface FriendPresenceEvent { friendId: string; presence: Presence; path: PathKind | null }
export interface FriendRequestEvent { request: FriendRequest }
/** Endgültige Ablehnung einer eigenen Anfrage durch den Besitzer des Codes; die Anfrage ist danach gelöscht. */
export type RequestRefusal = "codeUsed" | "alreadyFriends" | "unsupported";
export interface FriendRequestRefusedEvent { request: FriendRequest; reason: RequestRefusal }
export interface InviteEvent { invite: Invite }
export interface InviteRevokedEvent { inviteId: string; reason: "stopped" | "kicked" | "expired" }
export interface HostSessionEvent { session: HostSession }
export interface HostSessionEndedEvent { sessionId: string; reason: SessionEnd }
export interface JoinSessionEvent { joinId: string; inviteId: string; instanceId: string; state: JoinState }
export interface LanEvent { instanceId: string; lan: LanStatus | null }
export interface ModConnectionEvent { instanceId: string; connected: boolean }
/** Wofür die Mod im Launcher fragt (INGAME 5.5): eine Welt teilen oder die Freundesliste ändern. */
export type ModScope = "share" | "social";
/** Was die Mod tun will: der Vorgang (`friend.addByName`, INGAME 5.4) und die Person, um die es geht. */
export interface ModConfirmSummary { op: string; targetName: string | null }
export interface ModConfirmEvent { requestId: string; instanceId: string; instanceName: string; friends: { friendId: string; displayName: string }[];
  scope: ModScope; summary: ModConfirmSummary }
/** Ein Vorgang der Bereiche `share` und `social`, der aus dem Spiel kam (Aktivitätsliste, INGAME 5.7); `at` ist ISO-8601 in UTC. */
export interface ModActivityEntry { at: string; instanceId: string; scope: ModScope; op: string; targetName: string | null; ok: boolean }
/** Die Seite des Launchers, die `launcher.open` zeigt. */
export type ModOpenTarget = "friends" | "requests" | "invites" | "settings";
/** `friends-mod-open`: die Mod bittet, das Fenster des Launchers nach vorn zu holen und `target` zu zeigen. */
export interface ModOpenEvent { instanceId: string; target: ModOpenTarget }
export interface FriendJoin { joinId: string; address: string }

// --- Freunde-Menü im Spiel (docs/friends/INGAME.md, 3.9); Rust-Gegenstück: Abschnitt am Ende von contract.rs ---
/** `active`: der nächste Start speist die Mod ein; `connected`: die Mod des laufenden Spiels ist verbunden; `off`: vom Spieler
 *  ausgeschaltet; `autoOff`: nach einem Startfehler ausgeschaltet; `unavailable`: gibt es für die Instanz nicht (`reason` sagt warum). */
export type IngameState = "active" | "connected" | "off" | "autoOff" | "unavailable";
/** Die Art Startfehler, die der Launcher der Mod zuschreibt (Sicherungsschalter, INGAME 3.8). */
export type IngameFailureKind = "fabricIncompatibleModSet" | "mixinApplyFailed" | "modLoadingError" | "unsupportedClassVersion" | "unknown";
export type IngameReason =
  | { type: "notInBuild" } | { type: "vanilla" } | { type: "quilt" } | { type: "noNode" } | { type: "unverified" }
  | { type: "loaderTooOld"; need: string } | { type: "loaderVersionUnknown" }
  | { type: "javaTooOld"; need: number } | { type: "javaUnknown" }
  | { type: "idCollision" } | { type: "offlineAccount" } | { type: "bridgeNotRunning" }
  | { type: "instanceOff" } | { type: "globallyOff" }
  | { type: "breaker"; reason: IngameFailureKind };
export interface IngameNode { id: string; minecraft: string; loader: "fabric" | "neoforge" | "forge" }
export interface IngameStatus { state: IngameState; reason: IngameReason | null; node: IngameNode | null }
/** `friends-ingame`: der Status einer Instanz hat sich geändert. */
export interface IngameEvent { instanceId: string; status: IngameStatus }
/** `friends-ingame-failed`: der Start ist wahrscheinlich an der Mod gescheitert, die Einspeisung der Instanz ist aus. */
export interface IngameFailedEvent { instanceId: string; reason: IngameFailureKind }
/** Fixture key -> TS type (8.3). The fixture object uses these flat, dotted keys; `satisfies` rejects missing and extra keys. */
export interface FriendsFixtureTypes {
  constants: typeof FRIENDS_LIMITS;
  "friendsState.available": FriendsState; "friendsState.noSecretStore": FriendsState; "friendsState.identityLost": FriendsState;
  "networkStatus.off": NetworkStatus; "networkStatus.starting": NetworkStatus; "networkStatus.online": NetworkStatus; "networkStatus.degraded": NetworkStatus;
  "friend.online": Friend; "friend.relayRenamed": Friend; "friend.identityChanged": Friend; "friend.unconfirmed": Friend;
  "request.incoming": FriendRequest; "request.delivering": FriendRequest; "request.awaitingAnswer": FriendRequest;
  "request.nameIncoming": FriendRequest; "request.nameOutgoing": FriendRequest; "request.nameDelivering": FriendRequest;
  "code.created": FriendCode; "code.listed": FriendCode; blocked: BlockedPeer;
  hostSession: HostSession; invite: Invite;
  "joinPlan.ready": JoinPlan; "joinPlan.missing": JoinPlan; "joinPlan.vanilla": JoinPlan; joinTicket: JoinTicket;
  lanStatus: LanStatus;
  "ingameStatus.active": IngameStatus; "ingameStatus.connected": IngameStatus; "ingameStatus.off": IngameStatus;
  "ingameStatus.autoOff": IngameStatus; "ingameStatus.unavailable": IngameStatus; "ingameStatus.loaderTooOld": IngameStatus;
  "event.friendPresence": FriendPresenceEvent; "event.friendRequest": FriendRequestEvent; "event.requestRefused": FriendRequestRefusedEvent; "event.invite": InviteEvent;
  "event.inviteRevoked": InviteRevokedEvent; "event.hostSession": HostSessionEvent; "event.hostSessionEnded": HostSessionEndedEvent;
  "event.joinSession.waitingForGame": JoinSessionEvent; "event.joinSession.connecting": JoinSessionEvent;
  "event.joinSession.connected": JoinSessionEvent; "event.joinSession.ended": JoinSessionEvent;
  "event.lan": LanEvent; "event.modConnection": ModConnectionEvent; "event.modConfirm": ModConfirmEvent;
  modActivityEntry: ModActivityEntry; "event.modOpen": ModOpenEvent;
  "event.ingame": IngameEvent; "event.ingameFailed": IngameFailedEvent;
}
