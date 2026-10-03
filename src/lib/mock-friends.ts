// Nur im Browser-Dev-Modus dynamisch geladen (siehe api.ts); im Release-Build nicht enthalten.
import { t } from "@/i18n";
import type { Backend } from "./backend";
import { normalizeFriendCode } from "./friendCode";
import { FRIENDS_LIMITS } from "./friends-types";
import { clone, newId, wait, type MockContext } from "./mock-util";
import { DAY, HOUR, MINUTE } from "./time";
import type {
  BlockedPeer, Friend, FriendCode, FriendRequest, FriendsEnableInput, FriendsSettings, FriendsState, HostSession, InstanceSummary, Invite,
  JoinPlan, JoinTicket, LanStatus, ModRef, ModStatus, PathKind, Presence, SessionGuest,
} from "./types";

const SECOND_MS = 1000;
const DAY_SECS = DAY / SECOND_MS;
const HOUR_SECS = HOUR / SECOND_MS;
const MINUTE_SECS = MINUTE / SECOND_MS;
const nowSecs = () => Math.floor(Date.now() / SECOND_MS);

const MOCK_RELAY_HOST = "relay-eu1.pumpkin.example";
const MOCK_PLAYER_NAME = "Jonax1337";
const MOCK_HOST_INSTANCE = "inst-survival";
const MOCK_GAME_PID = 4242;
const MOCK_PORT = 52114;
const MOCK_LOCAL_RTT_MS = 38;
const MOCK_RELAY_RTT_MS = 64;
const BASE32 = "abcdefghijklmnopqrstuvwxyz234567";

/** Pausen der vorgetäuschten Abläufe: Anmeldung beim Relay, Zustellung einer Anfrage, Mod-Installation, Verbindung zum Gastgeber. */
const ONLINE_AFTER_MS = 800;
const DELIVERY_MS = 1000;
const MOD_INSTALL_MS = 1500;
const JOIN_CONNECT_MS = 1200;

/** `pumpkinMock.cycle()`: so viele Runden im Abstand von `CYCLE_STEP_MS`, die RTT wächst je Runde um `CYCLE_RTT_STEP_MS`. */
const CYCLE_ROUNDS = 5;
const CYCLE_STEP_MS = 400;
const CYCLE_RTT_STEP_MS = 11;
const CYCLE_PRESENCE: Presence[] = ["online", "playing", "offline"];

const MOCK_SODIUM: ModRef = { title: "Sodium", fileName: "sodium-fabric-0.7.0+mc26.3.jar", projectId: "AANobbMI" };
const MOCK_LITHIUM: ModRef = { title: "Lithium", fileName: "lithium-fabric-0.14.8+mc26.3.jar", projectId: "gvQqBUqZ" };
const MOCK_EXTRA_MOD: ModRef = { title: "mein-hud-1.2.jar", fileName: "mein-hud-1.2.jar", projectId: null };

/** Welches Urteil `invitePlan` einer Einladung gibt; die Einladungen reihen die Szenarien auf, damit jedes vorkommt. */
type PlanScenario = "ready" | "missing" | "vanilla" | "unsupported" | "lookupFailed";
const PLAN_ORDER: PlanScenario[] = ["ready", "missing", "vanilla", "unsupported", "lookupFailed"];

const FABRIC_26_3: InstanceSummary = { name: "Fabric 26.3", minecraftVersion: "26.3", loader: "fabric", loaderVersion: "0.19.5", modCount: 42 };
const SUMMARIES: Record<PlanScenario, InstanceSummary> = {
  ready: FABRIC_26_3,
  missing: FABRIC_26_3,
  vanilla: { name: "Vanilla 26.3", minecraftVersion: "26.3", loader: "vanilla", loaderVersion: null, modCount: 0 },
  unsupported: { name: "Vanilla 1.19.4", minecraftVersion: "1.19.4", loader: "vanilla", loaderVersion: null, modCount: 0 },
  lookupFailed: { ...FABRIC_26_3, modCount: 12 },
};

type Scenario = "disabled" | "full" | "empty" | "identityLost" | "noSecretStore";

/** `?mock=freunde`, `freunde-leer`, `freunde-verloren`, `freunde-keyring`; ohne eine davon sind Freunde aus. */
function scenarioFromUrl(): Scenario {
  switch (new URLSearchParams(location.search).get("mock")) {
    case "freunde": return "full";
    case "freunde-leer": return "empty";
    case "freunde-verloren": return "identityLost";
    case "freunde-keyring": return "noSecretStore";
    default: return "disabled";
  }
}

const newPeerId = () => (crypto.randomUUID() + crypto.randomUUID()).replaceAll("-", "");

/** Die ersten 16 Zeichen der ID in Vierergruppen, wie das Backend. */
const fingerprintOf = (peerId: string) => peerId.slice(0, 16).replace(/(.{4})(?=.)/g, "$1 ");

const randomFriendCode = () =>
  FRIENDS_LIMITS.codePrefix +
  Array.from(crypto.getRandomValues(new Uint8Array(FRIENDS_LIMITS.codeBodyLength)), (byte) => BASE32[byte % BASE32.length]).join("");

function friendOf(name: string, over: Partial<Friend> = {}): Friend {
  const id = over.id ?? newPeerId();
  return {
    id, displayName: name, alias: null, mcName: name, mcUuid: crypto.randomUUID().replaceAll("-", ""), fingerprint: fingerprintOf(id),
    addedAt: nowSecs() - 10 * DAY_SECS, lastSeen: nowSecs() - HOUR_SECS, confirmed: true, removedByPeer: false, notice: null,
    presence: "offline", path: null, ...over,
  };
}

function incomingRequestOf(name: string): FriendRequest {
  const peerId = newPeerId();
  const createdAt = nowSecs();
  return {
    id: newId("req"), direction: "incoming", state: "pending", peerId, fingerprint: fingerprintOf(peerId), displayName: name, mcName: name,
    codeTail: null, createdAt, expiresAt: createdAt + FRIENDS_LIMITS.requestTtlSecs,
  };
}

/** Eine eigene Anfrage, deren Code vor `ageSecs` eingelöst wurde und noch beim Besitzer wartet. */
function deliveringRequestOf(codeTail: string, ageSecs: number): FriendRequest {
  const createdAt = nowSecs() - ageSecs;
  return {
    id: newId("req"), direction: "outgoing", state: "delivering", peerId: null, fingerprint: null, displayName: null, mcName: null,
    codeTail, createdAt, expiresAt: createdAt + FRIENDS_LIMITS.requestTtlSecs,
  };
}

function inviteOf(from: Friend, scenario: PlanScenario): Invite {
  const receivedAt = nowSecs();
  return {
    id: crypto.randomUUID(), sessionId: crypto.randomUUID(), from: from.id, fromName: from.displayName, fromFingerprint: from.fingerprint,
    title: "Inselwelt", instance: SUMMARIES[scenario], receivedAt, expiresAt: receivedAt + FRIENDS_LIMITS.inviteTtlSecs, hostOnline: true,
  };
}

const guestOf = (friend: Friend, over: Partial<SessionGuest> = {}): SessionGuest => ({
  friendId: friend.id, displayName: friend.displayName, state: "invited", kicked: false, path: null, rttMs: null, ...over,
});

interface FriendsDb {
  state: FriendsState;
  friends: Friend[];
  requests: FriendRequest[];
  codes: FriendCode[];
  blocked: BlockedPeer[];
  invites: Invite[];
  sessions: HostSession[];
  lan: Map<string, LanStatus>;
  joins: Map<string, JoinTicket>;
  planScenarios: Map<string, PlanScenario>;
  modInstalled: Set<string>;
}

const mockMe = (displayName: string) => {
  const peerId = newPeerId();
  return { peerId, fingerprint: fingerprintOf(peerId), displayName };
};

function initialState(scenario: Scenario): FriendsState {
  const enabled = scenario !== "disabled" && scenario !== "noSecretStore";
  const identityKnown = enabled && scenario !== "identityLost";
  return {
    availability: scenario === "identityLost" ? "identityLost" : scenario === "noSecretStore" ? "noSecretStore" : "available",
    enabled,
    me: identityKnown ? mockMe(MOCK_PLAYER_NAME) : null,
    settings: { displayName: MOCK_PLAYER_NAME, alwaysRelay: false },
    network: identityKnown ? { type: "online", relayHost: MOCK_RELAY_HOST } : { type: "off" },
    relays: [{ host: MOCK_RELAY_HOST, operator: "pumpkin", thirdParty: false }],
    thirdPartyRelaysAccepted: false,
  };
}

/** `?mock=freunde`: fünf Freunde, drei Anfragen, eine Einladung, ein Hinweis und eine laufende geteilte Welt. */
function seedFullScenario(db: FriendsDb) {
  const alex = friendOf("Alex", { presence: "online", path: "direct" });
  const bea = friendOf("Bea", { presence: "playing", path: "relay" });
  const chris = friendOf("Chris", { lastSeen: nowSecs() - 2 * HOUR_SECS, notice: { type: "renamed", previousName: "Chrissi" } });
  const dana = friendOf("Dana", { confirmed: false, lastSeen: null, mcName: null, mcUuid: null });
  const eli = friendOf("Eli", { presence: "online", path: "direct" });
  db.friends = [alex, bea, chris, dana, eli];
  db.requests = [incomingRequestOf("Fynn"), deliveringRequestOf("k7qm", 2 * HOUR_SECS), deliveringRequestOf("x2ab", 8 * DAY_SECS)];
  const invite = inviteOf(alex, "ready");
  db.invites = [invite];
  db.planScenarios.set(invite.id, "ready");
  const lan: LanStatus = { port: MOCK_PORT, source: "mod", pid: MOCK_GAME_PID };
  db.lan.set(MOCK_HOST_INSTANCE, lan);
  db.sessions = [{
    id: crypto.randomUUID(), instanceId: MOCK_HOST_INSTANCE, port: lan.port, portSource: lan.source, pid: lan.pid, worldName: "Inselwelt",
    showWorldName: true, startedAt: nowSecs() - 25 * MINUTE_SECS,
    guests: [
      guestOf(bea, { state: "connected", path: "relay", rttMs: MOCK_RELAY_RTT_MS }),
      guestOf(chris, { state: "left", kicked: true }),
      guestOf(eli, { state: "declined" }),
    ],
  }];
}

function createDb(scenario: Scenario): FriendsDb {
  const db: FriendsDb = {
    state: initialState(scenario), friends: [], requests: [], codes: [], blocked: [], invites: [], sessions: [], lan: new Map(),
    joins: new Map(), planScenarios: new Map(), modInstalled: new Set(),
  };
  if (scenario === "full") seedFullScenario(db);
  return db;
}

/** Summe der `layout-shift`-Werte seit dem letzten Abruf; ohne Browser-Unterstützung immer 0. */
function createLayoutShiftMeter() {
  let sum = 0;
  if (!PerformanceObserver.supportedEntryTypes?.includes("layout-shift")) return () => 0;
  new PerformanceObserver((list) => {
    for (const entry of list.getEntries() as unknown as { value: number; hadRecentInput: boolean }[]) {
      if (!entry.hadRecentInput) sum += entry.value;
    }
  }).observe({ type: "layout-shift", buffered: true });
  return () => {
    const taken = sum;
    sum = 0;
    return taken;
  };
}

/** Hängt die Vorführ-Hooks an `pumpkinMock`, wo schon die des Spiel-Mocks liegen. */
const registerHooks = (hooks: Record<string, unknown>) =>
  Object.assign(globalThis, { pumpkinMock: { ...(globalThis as { pumpkinMock?: object }).pumpkinMock, ...hooks } });

type SkinSource = Pick<Backend, "skinLibrary" | "skinTexture">;
type NotFound = "friend" | "request" | "code" | "invite" | "session";
type LocalInstance = { instanceId: string; name: string };

/** Freunde im Browser: alles im Speicher, mit den Szenarien `?mock=freunde…` und den Hooks von `pumpkinMock` (Spec 10.10). */
export function createFriendsMock({ db: appDb, emit }: MockContext, skins: SkinSource) {
  const db = createDb(scenarioFromUrl());
  const takeLayoutShift = createLayoutShiftMeter();
  const changed = () => emit("friends-changed", null);

  const find = <T extends { id: string }>(items: T[], id: string, kind: NotFound): T => {
    const found = items.find((item) => item.id === id);
    if (!found) throw new Error(t(`mock.friends.notFound.${kind}`, { id }));
    return found;
  };
  const without = <T extends { id: string }>(items: T[], id: string, kind: NotFound) => {
    const target = find(items, id, kind);
    return items.filter((item) => item !== target);
  };
  const friendNamed = (name: string) => {
    const found = db.friends.find((f) => f.displayName.toLowerCase() === name.toLowerCase());
    if (!found) throw new Error(t("mock.friends.notFound.friend", { id: name }));
    return found;
  };

  /** Wie das Backend: ohne Schlüsselbund geht nur `friendsState`, bei verlorener Identität zusätzlich `friendsReset`. */
  function checkUsable(allowLostIdentity: boolean) {
    if (db.state.availability === "noSecretStore") throw new Error(t("mock.friends.unavailable"));
    if (db.state.availability === "identityLost" && !allowLostIdentity) throw new Error(t("mock.friends.identityLost"));
  }

  /** Ein Command: kurze Antwortzeit, Verfügbarkeit prüfen, Ergebnis als Kopie liefern. */
  const command = <A extends unknown[], R>(run: (...args: A) => R, { allowLostIdentity = false, needsEnabled = false } = {}) =>
    async (...args: A): Promise<R> => {
      await wait();
      checkUsable(allowLostIdentity);
      if (needsEnabled && !db.state.enabled) throw new Error(t("mock.friends.disabled"));
      return clone(run(...args));
    };

  function endSessions(reason: "stopped" | "disabled" | "lanClosed") {
    for (const session of db.sessions) emit("host-session-ended", { sessionId: session.id, reason });
    db.sessions = [];
  }

  function setNetwork(network: FriendsState["network"]) {
    db.state.network = network;
    emit("friends-network", clone(network));
  }

  function setPresence(friend: Friend, presence: Presence, path: PathKind | null) {
    Object.assign(friend, { presence, path: presence === "offline" ? null : path });
    emit("friend-presence", { friendId: friend.id, presence: friend.presence, path: friend.path });
  }

  // --- Identität und Einstellungen ---

  /** Nach dem Einschalten steht die Verbindung zum Relay erst nach einem Moment. */
  function enable({ displayName, alwaysRelay, acceptThirdPartyRelays }: FriendsEnableInput) {
    const name = displayName.trim();
    if (name.length < FRIENDS_LIMITS.displayNameMin || name.length > FRIENDS_LIMITS.displayNameMax) {
      throw new Error(t("mock.friends.displayNameInvalid", { min: FRIENDS_LIMITS.displayNameMin, max: FRIENDS_LIMITS.displayNameMax }));
    }
    if (!appDb.accounts.some((a) => a.kind === "microsoft")) throw new Error(t("mock.friends.msAccountRequired"));
    Object.assign(db.state, { enabled: true, settings: { displayName: name, alwaysRelay }, thirdPartyRelaysAccepted: acceptThirdPartyRelays });
    db.state.me ??= mockMe(name);
    setNetwork({ type: "starting" });
    setTimeout(() => setNetwork({ type: "online", relayHost: MOCK_RELAY_HOST }), ONLINE_AFTER_MS);
    return db.state;
  }

  function disable() {
    db.state.enabled = false;
    endSessions("disabled");
    setNetwork({ type: "off" });
    return db.state;
  }

  function updateSettings(settings: FriendsSettings) {
    if (settings.alwaysRelay !== db.state.settings.alwaysRelay) endSessions("stopped");
    db.state.settings = settings;
    if (db.state.me) db.state.me.displayName = settings.displayName;
    changed();
    return db.state;
  }

  function startNewIdentity() {
    endSessions("stopped");
    db.state.availability = "available";
    db.state.me = mockMe(db.state.settings.displayName);
    changed();
    return db.state;
  }

  /** Wie das Backend: offene Codes und Anfragen, die an die alte ID gebunden sind, verfallen; wartende eigene bleiben. */
  function rotateIdentity() {
    db.codes = [];
    db.requests = db.requests.filter((r) => r.direction === "outgoing" && r.state === "delivering");
    return startNewIdentity();
  }

  function reset() {
    Object.assign(db, { friends: [], requests: [], codes: [], blocked: [], invites: [] });
    return startNewIdentity();
  }

  // --- Codes, Anfragen, Freunde ---

  function createCode(): FriendCode {
    if (db.codes.filter((c) => !c.used).length >= FRIENDS_LIMITS.maxActiveCodes) {
      throw new Error(t("mock.friends.tooManyCodes", { max: FRIENDS_LIMITS.maxActiveCodes }));
    }
    const code = randomFriendCode();
    const createdAt = nowSecs();
    const record = { id: newId("code"), code: null, tail: code.slice(-4), createdAt, expiresAt: createdAt + FRIENDS_LIMITS.codeTtlSecs, used: false };
    db.codes.push(record);
    changed();
    return { ...record, code };
  }

  function addFriend(input: string) {
    const code = normalizeFriendCode(input);
    if (!code) throw new Error(t("mock.friends.codeInvalid"));
    if (db.friends.length + db.requests.filter((r) => r.direction === "outgoing").length >= FRIENDS_LIMITS.maxFriends) {
      throw new Error(t("mock.friends.friendLimit", { max: FRIENDS_LIMITS.maxFriends }));
    }
    const request = deliveringRequestOf(code.slice(-4), 0);
    db.requests.push(request);
    changed();
    return request;
  }

  function answerRequest(requestId: string, accept: boolean) {
    const request = find(db.requests, requestId, "request");
    db.requests = without(db.requests, requestId, "request");
    if (accept) {
      db.friends.push(friendOf(request.displayName ?? "?", { id: request.peerId ?? newPeerId(), confirmed: false, lastSeen: null }));
    }
    changed();
  }

  function blockPeer(peerId: string) {
    const friend = db.friends.find((f) => f.id === peerId);
    const request = db.requests.find((r) => r.peerId === peerId);
    db.friends = db.friends.filter((f) => f !== friend);
    db.requests = db.requests.filter((r) => r !== request);
    db.blocked.push({ peerId, displayName: friend?.displayName ?? request?.displayName ?? peerId.slice(0, 8), blockedAt: nowSecs() });
    changed();
  }

  function deliver(request: FriendRequest) {
    const peerId = newPeerId();
    Object.assign(request, { state: "awaitingAnswer", peerId, fingerprint: fingerprintOf(peerId), displayName: "Gwen", mcName: "Gwen" });
  }

  /** Stellt jede Anfrage zu, deren Code noch gilt; zu einem abgelaufenen Code kommt nie eine Antwort. */
  function retryDeliveries() {
    const fresh = db.requests.filter((r) => r.state === "delivering" && nowSecs() - r.createdAt <= FRIENDS_LIMITS.codeTtlSecs);
    if (fresh.length === 0) return;
    setTimeout(() => {
      fresh.forEach(deliver);
      changed();
    }, DELIVERY_MS);
  }

  async function skinOf(friendId: string) {
    const friend = find(db.friends, friendId, "friend");
    if (!friend.mcUuid) return null;
    const library = await skins.skinLibrary();
    const pick = [...friend.displayName].reduce((sum, char) => sum + char.charCodeAt(0), 0) % library.length;
    return skins.skinTexture(library[pick].id);
  }

  // --- Welt teilen ---

  function checkedManualPort(instanceId: string, port: number): LanStatus {
    if (port < FRIENDS_LIMITS.portMin || port > FRIENDS_LIMITS.portMax) {
      throw new Error(t("mock.friends.portInvalid", { min: FRIENDS_LIMITS.portMin, max: FRIENDS_LIMITS.portMax }));
    }
    if (!appDb.running.has(instanceId)) throw new Error(t("mock.friends.gameNotRunning"));
    return { port, source: "manual", pid: MOCK_GAME_PID };
  }

  function startHosting(instanceId: string, port: number | null, showWorldName: boolean): HostSession {
    if (db.sessions.length > 0) throw new Error(t("mock.friends.sessionActive"));
    const lan = port === null ? db.lan.get(instanceId) : checkedManualPort(instanceId, port);
    if (!lan) throw new Error(t("mock.friends.lanPortUnknown"));
    const session: HostSession = {
      id: crypto.randomUUID(), instanceId, port: lan.port, portSource: lan.source, pid: lan.pid, worldName: showWorldName ? "Inselwelt" : null,
      showWorldName, startedAt: nowSecs(), guests: [],
    };
    db.sessions.push(session);
    return session;
  }

  const sessionOf = (id: string) => find(db.sessions, id, "session");

  /** Ein Gast zählt zum Limit, solange er nicht abgelehnt hat oder entfernt wurde. */
  const holdsSeat = (guest: SessionGuest) => guest.state !== "declined" && !(guest.state === "left" && guest.kicked);

  function inviteGuests(sessionId: string, friendIds: string[]) {
    const session = sessionOf(sessionId);
    for (const friend of friendIds.map((id) => find(db.friends, id, "friend"))) {
      if (session.guests.filter(holdsSeat).length >= FRIENDS_LIMITS.maxGuests) {
        throw new Error(t("mock.friends.guestLimit", { max: FRIENDS_LIMITS.maxGuests }));
      }
      session.guests = [...session.guests.filter((g) => g.friendId !== friend.id), guestOf(friend)];
    }
    emit("host-session", { session: clone(session) });
    return session;
  }

  function kickGuest(sessionId: string, friendId: string) {
    const session = sessionOf(sessionId);
    const guest = session.guests.find((g) => g.friendId === friendId);
    if (guest) Object.assign(guest, { state: "left", kicked: true, path: null, rttMs: null });
    emit("host-session", { session: clone(session) });
    return session;
  }

  function stopHosting(sessionId: string) {
    sessionOf(sessionId);
    db.sessions = db.sessions.filter((s) => s.id !== sessionId);
    emit("host-session-ended", { sessionId, reason: "stopped" });
  }

  // --- Einladungen und Beitritt ---

  function planFor(invite: Invite): JoinPlan {
    const scenario = db.planScenarios.get(invite.id) ?? "ready";
    const base = { inviteId: invite.id, summary: invite.instance, candidates: [], createVanilla: false, lookupFailed: false };
    const local = appDb.instances.map(({ id, name }): LocalInstance => ({ instanceId: id, name }));
    const match = (instance: LocalInstance) => ({ ...instance, matches: true, missing: [], extra: [] });
    const mismatch = (instance: LocalInstance) => ({ ...instance, matches: false, missing: [MOCK_LITHIUM, MOCK_SODIUM], extra: [MOCK_EXTRA_MOD] });
    switch (scenario) {
      case "ready":
        return { ...base, verdict: "ready", candidates: local.slice(0, 2).map(match) };
      case "missing":
        return { ...base, verdict: "missingContent", candidates: local.slice(0, 1).map(mismatch) };
      case "lookupFailed":
        return { ...base, verdict: "missingContent", lookupFailed: true, candidates: local.slice(0, 1).map(mismatch) };
      case "unsupported":
        return { ...base, verdict: "versionUnsupported" };
      case "vanilla": {
        const vanilla = appDb.instances.find((i) => i.loader === "vanilla" && i.minecraftVersion === invite.instance.minecraftVersion);
        return vanilla
          ? { ...base, verdict: "ready", candidates: [match({ instanceId: vanilla.id, name: vanilla.name })] }
          : { ...base, verdict: "noInstance", createVanilla: true };
      }
    }
  }

  const joinEventBase = ({ joinId, inviteId, instanceId }: JoinTicket) => ({ joinId, inviteId, instanceId });

  /** Das Ticket des Tunnels; das Spiel startet erst danach, `joinSpawned` führt den Beitritt dann weiter. */
  function openJoin(inviteId: string, instanceId: string): JoinTicket {
    find(db.invites, inviteId, "invite");
    const octet = () => 1 + Math.floor(Math.random() * 254);
    const ticket = { joinId: newId("join"), inviteId, instanceId, address: `127.${octet()}.${octet()}.${octet()}:${40000 + octet()}` };
    db.joins.set(ticket.joinId, ticket);
    setTimeout(() => emit("join-session", { ...joinEventBase(ticket), state: { type: "waitingForGame" } }));
    return ticket;
  }

  /** Der Mock-Start der Instanz meldet, dass das Spiel zum Tunnel verbindet. */
  function joinSpawned(friendJoin: { joinId: string } | undefined) {
    const ticket = friendJoin && db.joins.get(friendJoin.joinId);
    if (!ticket) return;
    emit("join-session", { ...joinEventBase(ticket), state: { type: "connecting" } });
    setTimeout(
      () => emit("join-session", { ...joinEventBase(ticket), state: { type: "connected", path: "direct", rttMs: MOCK_LOCAL_RTT_MS } }),
      JOIN_CONNECT_MS,
    );
  }

  function leaveJoin(joinId: string) {
    const ticket = db.joins.get(joinId);
    if (!ticket) return;
    db.joins.delete(joinId);
    emit("join-session", { ...joinEventBase(ticket), state: { type: "ended", reason: "left" } });
  }

  function modState(instanceId: string): ModStatus {
    const instance = appDb.instances.find((i) => i.id === instanceId);
    if (instance?.loader !== "fabric") return { state: "unavailable" };
    if (!db.modInstalled.has(instanceId)) return { state: "notInstalled" };
    return { state: appDb.running.has(instanceId) ? "connected" : "installed" };
  }

  // --- Vorführ-Hooks (`pumpkinMock`) ---

  /** Eine Einladung von `from`; die Szenarien reihen sich auf, damit jedes Urteil von `invitePlan` vorkommt. */
  function receiveInvite(from: Friend) {
    const scenario = PLAN_ORDER[db.planScenarios.size % PLAN_ORDER.length];
    const invite = inviteOf(from, scenario);
    db.invites.push(invite);
    db.planScenarios.set(invite.id, scenario);
    emit("friend-invite", { invite: clone(invite) });
  }

  function receiveRequest(name: string) {
    const request = incomingRequestOf(name);
    db.requests.push(request);
    emit("friend-request", { request: clone(request) });
  }

  function openLan(port: number) {
    const lan: LanStatus = { port, source: "mod", pid: MOCK_GAME_PID };
    db.lan.set(MOCK_HOST_INSTANCE, lan);
    emit("lan-changed", { instanceId: MOCK_HOST_INSTANCE, lan });
  }

  function closeHostedWorld() {
    db.lan.delete(MOCK_HOST_INSTANCE);
    endSessions("lanClosed");
    emit("lan-changed", { instanceId: MOCK_HOST_INSTANCE, lan: null });
  }

  function joinGuest(name: string) {
    const [session] = db.sessions;
    if (!session) throw new Error(t("mock.friends.noSession"));
    const friend = friendNamed(name);
    const connected = { state: "connected", kicked: false, path: "direct", rttMs: MOCK_LOCAL_RTT_MS } as const;
    const guest = session.guests.find((g) => g.friendId === friend.id);
    if (guest) Object.assign(guest, connected);
    else session.guests.push(guestOf(friend, connected));
    emit("host-session", { session: clone(session) });
  }

  function confirmMod() {
    emit("friends-mod-confirm", {
      requestId: newId("confirm"), instanceId: MOCK_HOST_INSTANCE, instanceName: "Survival 1.21",
      friends: db.friends.filter((f) => f.presence !== "offline").map((f) => ({ friendId: f.id, displayName: f.displayName })),
    });
  }

  function setNotice(name: string, kind: "renamed" | "identityChanged") {
    const friend = friendNamed(name);
    friend.notice = kind === "renamed"
      ? { type: "renamed", previousName: `${friend.displayName}_alt` }
      : { type: "identityChanged", previousFingerprint: fingerprintOf(newPeerId()) };
    changed();
  }

  /** Schaltet in `CYCLE_ROUNDS` Runden Anwesenheit und RTT aller Zeilen um: so zeigt sich, ob die Seite dabei springt. */
  async function cycle() {
    for (let round = 0; round < CYCLE_ROUNDS; round++) {
      db.friends.filter((f) => f.confirmed).forEach((friend, i) =>
        setPresence(friend, CYCLE_PRESENCE[(i + round) % CYCLE_PRESENCE.length], "direct"));
      for (const session of db.sessions) {
        session.guests.filter((g) => g.state === "connected").forEach((g) => { g.rttMs = MOCK_LOCAL_RTT_MS + round * CYCLE_RTT_STEP_MS; });
        emit("host-session", { session: clone(session) });
      }
      await wait(CYCLE_STEP_MS);
    }
  }

  registerHooks({
    invite: (name: string) => receiveInvite(friendNamed(name)),
    friendOnline: (name: string) => setPresence(friendNamed(name), "online", "direct"),
    friendOffline: (name: string) => setPresence(friendNamed(name), "offline", null),
    request: receiveRequest,
    lanOpened: openLan,
    guestJoined: joinGuest,
    hostGone: closeHostedWorld,
    network: (status: "online" | "degraded") =>
      setNetwork(status === "online" ? { type: "online", relayHost: MOCK_RELAY_HOST } : { type: "degraded", reason: "relayUnreachable" }),
    modConfirm: confirmMod,
    notice: setNotice,
    cycle,
    layoutShift: takeLayoutShift,
  });

  const api = {
    friendsState: async () => {
      await wait();
      return clone(db.state);
    },
    friendsEnable: command(enable),
    friendsDisable: command(disable),
    friendsUpdateSettings: command(updateSettings),
    friendsRotateIdentity: command(rotateIdentity),
    friendsReset: command(reset, { allowLostIdentity: true }),
    friendsList: command(() => db.friends),
    friendRequests: command(() => db.requests),
    friendCodeCreate: command(createCode, { needsEnabled: true }),
    friendCodes: command(() => db.codes),
    friendCodeRevoke: command((codeId: string) => {
      db.codes = without(db.codes, codeId, "code");
      changed();
    }),
    friendAdd: command(addFriend, { needsEnabled: true }),
    friendRequestAnswer: command(answerRequest),
    friendRequestCancel: command((requestId: string) => {
      db.requests = without(db.requests, requestId, "request");
      changed();
    }),
    friendRename: command((friendId: string, alias: string | null) => {
      find(db.friends, friendId, "friend").alias = alias?.trim().slice(0, FRIENDS_LIMITS.aliasMax) || null;
      changed();
    }),
    friendAcknowledge: command((friendId: string) => {
      find(db.friends, friendId, "friend").notice = null;
      changed();
    }),
    friendRemove: command((friendId: string) => {
      db.friends = without(db.friends, friendId, "friend");
      changed();
    }),
    friendBlock: command(blockPeer),
    friendUnblock: command((peerId: string) => {
      db.blocked = db.blocked.filter((b) => b.peerId !== peerId);
      changed();
    }),
    friendsBlocked: command(() => db.blocked),
    friendsRetryNow: command(retryDeliveries),
    friendSkin: skinOf,

    lanStatus: command((instanceId: string) => db.lan.get(instanceId) ?? null),
    hostSessions: command(() => db.sessions),
    hostStart: command(startHosting, { needsEnabled: true }),
    hostInvite: command(inviteGuests),
    hostKick: command(kickGuest),
    hostStop: command(stopHosting),
    invitesList: command(() => db.invites),
    inviteDecline: command((inviteId: string) => {
      db.invites = without(db.invites, inviteId, "invite");
      changed();
    }),
    invitePlan: command((inviteId: string) => planFor(find(db.invites, inviteId, "invite"))),
    inviteJoin: command(openJoin, { needsEnabled: true }),
    joinLeave: command(leaveJoin),
    friendsModStatus: command(modState),
    friendsModInstall: async (instanceId: string) => {
      await wait(MOD_INSTALL_MS);
      db.modInstalled.add(instanceId);
    },
    friendsModConfirm: command(() => undefined),
  } satisfies Partial<Backend>;

  return { api, joinSpawned };
}
