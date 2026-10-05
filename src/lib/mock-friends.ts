// Nur im Browser-Dev-Modus dynamisch geladen (siehe api.ts); im Release-Build nicht enthalten.
import { t } from "@/i18n";
import type { Backend } from "./backend";
import { BackendError } from "./errors";
import { normalizeFriendCode } from "./friendCode";
import { FRIENDS_LIMITS } from "./friends-types";
import { clone, newId, wait, type MockContext } from "./mock-util";
import { DAY, HOUR, MINUTE } from "./time";
import type {
  BlockedPeer, DirectoryState, DirectoryStatus, Friend, FriendCode, FriendRequest, FriendsEnableInput, FriendsSettings, FriendsState,
  HostSession, InstanceSummary, Invite, JoinPlan, JoinTicket, IngameFailureKind, IngameNode, IngameReason, IngameStatus, LanStatus, ModActivityEntry, ModConfirmEvent, ModOpenTarget, ModRef, ModScope, PathKind, Presence, RequestRefusal, RequestVia, SessionGuest,
} from "./types";

const SECOND_MS = 1000;
const DAY_SECS = DAY / SECOND_MS;
const HOUR_SECS = HOUR / SECOND_MS;
const MINUTE_SECS = MINUTE / SECOND_MS;
const nowSecs = () => Math.floor(Date.now() / SECOND_MS);

const MOCK_RELAY_HOST = "relay-eu1.pumpkin.example";
const MOCK_DIRECTORY_HOST = "verzeichnis.pumpkin.example";
const MOCK_HOST_INSTANCE = "inst-survival";
const MOCK_GAME_PID = 4242;
const MOCK_PORT = 52114;
const MOCK_LOCAL_RTT_MS = 38;
const MOCK_RELAY_RTT_MS = 64;
const BASE32 = "abcdefghijklmnopqrstuvwxyz234567";
const MC_NAME_PATTERN = new RegExp(`^[A-Za-z0-9_]{1,${FRIENDS_LIMITS.mcNameMax}}$`);

/** Minecraft-Namen, die `friendAddByName` wie das Verzeichnis beantwortet; jeder andere gültige Name wird zugestellt. */
const MOCK_UNKNOWN_NAME = "herobrine";
const MOCK_HIDDEN_NAME = "versteckt";
const MOCK_COOLDOWN_NAME = "spammer";

/** Die Zellen der Mod im Spiel, die der Mock kennt (wie `mod-index.json`); `verified: false` ist eine Zelle ohne bestandenen Rauchtest. */
interface MockNode { id: string; loader: IngameNode["loader"]; minecraft: string[]; loaderMin: string; verified: boolean }
const MOCK_NODES: MockNode[] = [
  { id: "26.3-fabric", loader: "fabric", minecraft: ["26.3"], loaderMin: "0.19.5", verified: true },
  { id: "1.21.1-fabric", loader: "fabric", minecraft: ["1.21", "1.21.1"], loaderMin: "0.16.0", verified: true },
  { id: "1.20.4-fabric", loader: "fabric", minecraft: ["1.20.4"], loaderMin: "0.15.0", verified: false },
  { id: "1.21.1-neoforge", loader: "neoforge", minecraft: ["1.21", "1.21.1"], loaderMin: "21.1.0", verified: true },
  { id: "1.20.1-forge", loader: "forge", minecraft: ["1.20.1"], loaderMin: "47.4.0", verified: true },
];

/** Ob die Loader-Version `version` unter `minimum` liegt, Teil für Teil als Zahl verglichen. */
function isOlder(version: string, minimum: string): boolean {
  const parts = (text: string) => text.split(".").map((part) => Number.parseInt(part, 10) || 0);
  const [have, need] = [parts(version), parts(minimum)];
  for (let i = 0; i < Math.max(have.length, need.length); i++) {
    const [a, b] = [have[i] ?? 0, need[i] ?? 0];
    if (a !== b) return a < b;
  }
  return false;
}

/** Pausen der vorgetäuschten Abläufe: Anmeldung beim Relay, Zustellung einer Anfrage, Verbindung zum Gastgeber. */
const ONLINE_AFTER_MS = 800;
const DELIVERY_MS = 1000;
const JOIN_CONNECT_MS = 1200;

/** So viele Vorgänge aus dem Spiel behält der Launcher (INGAME 5.7). */
const MOD_ACTIVITY_LIMIT = 100;

/** So viele Zeichen behält der Launcher von `summary.targetName` (`sanitize::world_or_instance_name`); die Rückfrage darf sich nicht darauf stützen. */
const MOD_SUMMARY_NAME_CAP = 64;

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

type Scenario = "disabled" | "full" | "empty" | "identityLost" | "noSecretStore" | "noDirectory";

/** `?mock=freunde`, `freunde-leer`, `freunde-ohne-verzeichnis`, `freunde-verloren`, `freunde-keyring`; ohne eine davon sind Freunde aus. */
function scenarioFromUrl(): Scenario {
  switch (new URLSearchParams(location.search).get("mock")) {
    case "freunde": return "full";
    case "freunde-leer": return "empty";
    case "freunde-ohne-verzeichnis": return "noDirectory";
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

function incomingRequestOf(name: string, via: RequestVia = "code"): FriendRequest {
  const peerId = newPeerId();
  const createdAt = nowSecs();
  return {
    id: newId("req"), direction: "incoming", state: "pending", peerId, fingerprint: fingerprintOf(peerId), displayName: name, mcName: name,
    codeTail: null, createdAt, expiresAt: createdAt + FRIENDS_LIMITS.requestTtlSecs, via,
  };
}

/** Eine eigene Anfrage per Name: im Verzeichnis hinterlegt, `name` hat noch nicht geantwortet. */
function nameOutgoingRequestOf(name: string): FriendRequest {
  const createdAt = nowSecs();
  return {
    id: newId("req"), direction: "outgoing", state: "awaitingAnswer", peerId: null, fingerprint: null, displayName: null, mcName: name,
    codeTail: null, createdAt, expiresAt: createdAt + FRIENDS_LIMITS.requestTtlSecs, via: "name",
  };
}

/** Eine eigene Anfrage, deren Code vor `ageSecs` eingelöst wurde und noch beim Besitzer wartet. */
function deliveringRequestOf(codeTail: string, ageSecs: number): FriendRequest {
  const createdAt = nowSecs() - ageSecs;
  return {
    id: newId("req"), direction: "outgoing", state: "delivering", peerId: null, fingerprint: null, displayName: null, mcName: null,
    codeTail, createdAt, expiresAt: createdAt + FRIENDS_LIMITS.requestTtlSecs, via: "code",
  };
}

function inviteOf(from: Friend, scenario: PlanScenario): Invite {
  const receivedAt = nowSecs();
  return {
    id: crypto.randomUUID(), sessionId: crypto.randomUUID(), from: from.id, fromName: from.mcName ?? from.displayName, fromFingerprint: from.fingerprint,
    title: "Inselwelt", instance: SUMMARIES[scenario], receivedAt, expiresAt: receivedAt + FRIENDS_LIMITS.inviteTtlSecs, hostOnline: true,
  };
}

const guestOf = (friend: Friend, over: Partial<SessionGuest> = {}): SessionGuest => ({
  friendId: friend.id, displayName: friend.mcName ?? friend.displayName, state: "invited", kicked: false, path: null, rttMs: null, ...over,
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
  /** Was der Nutzer oder ein Startfehler an der Einspeisung der Instanz ausgeschaltet hat; ohne Eintrag ist sie an. */
  ingameOff: Map<string, "user" | IngameFailureKind>;
  /** Vorgeführte Zustände (`pumpkinMock.ingame`), die den berechneten ersetzen. */
  ingameForced: Map<string, IngameStatus>;
  /** Offene Bitten der Mod: eine beantwortete oder unbekannte `requestId` ist wie im Backend nicht mehr gültig. */
  pendingModConfirms: Map<string, ModConfirmEvent>;
  /** Die Vorgänge aus dem Spiel, neueste zuerst. */
  modActivity: ModActivityEntry[];
}

const mockMe = (displayName: string) => {
  const peerId = newPeerId();
  return { peerId, fingerprint: fingerprintOf(peerId), displayName };
};

function initialDirectory(scenario: Scenario): DirectoryStatus {
  if (scenario === "identityLost" || scenario === "noDirectory") return { state: "unavailable", host: null };
  return { state: scenario === "full" ? "active" : "off", host: MOCK_DIRECTORY_HOST };
}

function initialState(scenario: Scenario): FriendsState {
  const enabled = scenario !== "disabled" && scenario !== "noSecretStore";
  const identityKnown = enabled && scenario !== "identityLost";
  return {
    availability: scenario === "identityLost" ? "identityLost" : scenario === "noSecretStore" ? "noSecretStore" : "available",
    enabled,
    me: identityKnown ? mockMe("") : null,
    settings: { alwaysRelay: false, findableByName: scenario === "full", ingameMenu: true, ingameActions: "ask" },
    network: identityKnown ? { type: "online", relayHost: MOCK_RELAY_HOST } : { type: "off" },
    relays: [{ host: MOCK_RELAY_HOST, operator: "pumpkin", thirdParty: false }],
    thirdPartyRelaysAccepted: false,
    directory: initialDirectory(scenario),
  };
}

/** `?mock=freunde`: fünf Freunde, fünf Anfragen (zwei davon per Name), eine Einladung, ein Hinweis und eine laufende geteilte Welt. */
function seedFullScenario(db: FriendsDb) {
  const alex = friendOf("Alex", { presence: "online", path: "direct" });
  const bea = friendOf("Bea", { presence: "playing", path: "relay" });
  const chris = friendOf("Chris", { lastSeen: nowSecs() - 2 * HOUR_SECS, notice: { type: "renamed", previousName: "Chrissi" } });
  const dana = friendOf("Dana", { confirmed: false, lastSeen: null, mcName: null, mcUuid: null });
  const eli = friendOf("Eli", { presence: "online", path: "direct" });
  db.friends = [alex, bea, chris, dana, eli];
  db.requests = [
    incomingRequestOf("Fynn"), deliveringRequestOf("k7qm", 2 * HOUR_SECS), deliveringRequestOf("x2ab", 8 * DAY_SECS),
    incomingRequestOf("Hanna", "name"), nameOutgoingRequestOf("Ida"),
  ];
  const invite = inviteOf(alex, "ready");
  db.invites = [invite];
  db.planScenarios.set(invite.id, "ready");
  const lan: LanStatus = { port: MOCK_PORT, source: "mod", pid: MOCK_GAME_PID };
  db.lan.set(MOCK_HOST_INSTANCE, lan);
  db.modActivity = [
    modActivityOf({ op: "friend.addByName", targetName: "Hanna" }, 3 * MINUTE_SECS),
    modActivityOf({ op: "request.answer", targetName: "Fynn", ok: false }, 12 * MINUTE_SECS),
    modActivityOf({ op: "host.invite", scope: "share", targetName: "Bea, Eli" }, 25 * MINUTE_SECS),
  ];
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

/** Ein Vorgang aus dem Spiel, der `agoSecs` Sekunden zurückliegt; ohne Angaben ein erledigter im Bereich `social`. */
function modActivityOf(over: Partial<ModActivityEntry>, agoSecs = 0): ModActivityEntry {
  return {
    at: new Date(Date.now() - agoSecs * SECOND_MS).toISOString(), instanceId: MOCK_HOST_INSTANCE, scope: "social", op: "friend.addByName",
    targetName: null, ok: true, ...over,
  };
}

function createDb(scenario: Scenario): FriendsDb {
  const db: FriendsDb = {
    state: initialState(scenario), friends: [], requests: [], codes: [], blocked: [], invites: [], sessions: [], lan: new Map(),
    joins: new Map(), planScenarios: new Map(), ingameOff: new Map(), ingameForced: new Map(), pendingModConfirms: new Map(), modActivity: [],
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
  const accountName = () => appDb.accounts.find((account) => account.kind === "microsoft")?.username ?? "";
  function accountChanged() {
    if (db.state.me) db.state.me.displayName = accountName();
    changed();
  }
  if (db.state.me) db.state.me.displayName = accountName();

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
  function enable({ alwaysRelay, acceptThirdPartyRelays, findableByName }: FriendsEnableInput) {
    const name = accountName();
    if (!name) throw new Error(t("mock.friends.msAccountRequired"));
    const settings = { ...db.state.settings, alwaysRelay, findableByName };
    Object.assign(db.state, { enabled: true, settings, thirdPartyRelaysAccepted: acceptThirdPartyRelays });
    db.state.me ??= mockMe(name);
    db.state.me.displayName = name;
    setNetwork({ type: "starting" });
    setTimeout(() => setNetwork({ type: "online", relayHost: MOCK_RELAY_HOST }), ONLINE_AFTER_MS);
    applyFindability(findableByName);
    return db.state;
  }

  function disable() {
    db.state.enabled = false;
    endSessions("disabled");
    setNetwork({ type: "off" });
    return db.state;
  }

  /** Das Verzeichnis trägt die Person erst nach einem Moment ein; wieder aus ist es sofort. Ohne Verzeichnis ändert sich nichts. */
  function applyFindability(findable: boolean) {
    const { directory } = db.state;
    if (directory.state === "unavailable") return;
    if (!findable) {
      directory.state = "off";
      return;
    }
    setTimeout(() => {
      if (!db.state.settings.findableByName) return;
      directory.state = "active";
      changed();
    }, ONLINE_AFTER_MS);
  }

  function updateSettings(settings: FriendsSettings) {
    if (settings.alwaysRelay !== db.state.settings.alwaysRelay) endSessions("stopped");
    if (settings.findableByName !== db.state.settings.findableByName) applyFindability(settings.findableByName);
    db.state.settings = settings;
    changed();
    return db.state;
  }

  function startNewIdentity() {
    endSessions("stopped");
    db.state.availability = "available";
    db.state.me = mockMe(accountName());
    changed();
    return db.state;
  }

  /** An die alte ID gebunden sind alle Anfragen außer den wartenden eigenen und den eingegangenen per Name (die gehören zur ID des Absenders). */
  const survivesRotation = (r: FriendRequest) =>
    (r.direction === "outgoing" && r.state === "delivering") || (r.direction === "incoming" && r.via === "name");

  /** Wie das Backend: offene Codes und Anfragen, die an die alte ID gebunden sind, verfallen. */
  function rotateIdentity() {
    db.codes = [];
    db.requests = db.requests.filter(survivesRotation);
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

  function checkFriendCapacity() {
    if (db.friends.length + db.requests.filter((r) => r.direction === "outgoing").length >= FRIENDS_LIMITS.maxFriends) {
      throw new Error(t("mock.friends.friendLimit", { max: FRIENDS_LIMITS.maxFriends }));
    }
  }

  function addFriend(input: string) {
    const code = normalizeFriendCode(input);
    if (!code) throw new Error(t("mock.friends.codeInvalid"));
    checkFriendCapacity();
    const request = deliveringRequestOf(code.slice(-4), 0);
    db.requests.push(request);
    changed();
    return request;
  }

  const sameName = (a: string | null, b: string) => a?.toLowerCase() === b.toLowerCase();
  const openNameRequests = () => db.requests.filter((r) => r.direction === "outgoing" && r.via === "name");

  /** Wie das Backend: erst die Prüfungen auf dieser Seite, dann die Anmeldung am Verzeichnis, zuletzt dessen Antwort. */
  function checkNameRequestAllowed(name: string) {
    if (!MC_NAME_PATTERN.test(name)) throw new Error(t("mock.friends.nameInvalid"));
    if (db.state.directory.state === "unavailable") throw new Error(t("mock.friends.directoryUnavailable"));
    if (sameName(name, MOCK_UNKNOWN_NAME)) throw new Error(t("mock.friends.nameUnknown", { name }));
    if (sameName(name, accountName())) throw new Error(t("mock.friends.nameOwn"));
    if (db.friends.some((f) => sameName(f.mcName, name))) throw new Error(t("mock.friends.alreadyFriends"));
    if (openNameRequests().some((r) => sameName(r.mcName, name))) throw new Error(t("mock.friends.alreadyRequestedName", { name }));
    if (openNameRequests().length >= FRIENDS_LIMITS.maxNameRequests) {
      throw new Error(t("mock.friends.tooManyNameRequests", { max: FRIENDS_LIMITS.maxNameRequests }));
    }
    checkFriendCapacity();
  }

  function checkDirectoryAnswer(name: string) {
    switch (db.state.directory.state) {
      case "unreachable": throw new Error(t("mock.friends.directoryUnavailable"));
      case "notAllowed": throw new Error(t("mock.friends.directoryNotAllowed"));
    }
    if (sameName(name, MOCK_HIDDEN_NAME)) {
      throw new BackendError(t("mock.friends.nameNotFindable", { name }), "invalid", { key: "errors.friends.nameNotFindable" });
    }
    if (sameName(name, MOCK_COOLDOWN_NAME)) throw new Error(t("mock.friends.nameCooldown", { name, days: FRIENDS_LIMITS.nameCooldownDays }));
  }

  function addFriendByName(input: string) {
    const name = input.trim();
    checkNameRequestAllowed(name);
    checkDirectoryAnswer(name);
    const request = nameOutgoingRequestOf(name);
    db.requests.push(request);
    changed();
    return request;
  }

  function answerRequest(requestId: string, accept: boolean) {
    const request = find(db.requests, requestId, "request");
    if (accept && request.via === "name") {
      Object.assign(request, { direction: "outgoing", state: "delivering" });
    } else {
      db.requests = without(db.requests, requestId, "request");
      if (accept) db.friends.push(friendOf(request.mcName ?? request.displayName ?? "?", {
        id: request.peerId ?? newPeerId(), mcName: request.mcName, confirmed: false, lastSeen: null,
      }));
    }
    changed();
  }

  function blockPeer(peerId: string) {
    const friend = db.friends.find((f) => f.id === peerId);
    const request = db.requests.find((r) => r.peerId === peerId);
    db.friends = db.friends.filter((f) => f !== friend);
    db.requests = db.requests.filter((r) => r !== request);
    db.blocked.push({ peerId, displayName: friend?.mcName ?? friend?.displayName ?? request?.mcName ?? request?.displayName ?? peerId.slice(0, 8), blockedAt: nowSecs() });
    changed();
  }

  function deliver(request: FriendRequest) {
    const peerId = newPeerId();
    Object.assign(request, { state: "awaitingAnswer", peerId, fingerprint: fingerprintOf(peerId), displayName: "Gwen", mcName: "Gwen" });
  }

  /** Die Gegenseite hat angenommen: erst unbestätigt, nach einem Moment bestätigt und online. */
  function becomeFriend(request: FriendRequest) {
    db.requests = db.requests.filter((r) => r !== request);
    const friend = friendOf(request.mcName ?? request.displayName ?? "?", {
      id: request.peerId ?? newPeerId(), mcName: request.mcName, confirmed: false, lastSeen: null,
    });
    db.friends.push(friend);
    setTimeout(() => {
      if (!db.friends.includes(friend)) return;
      Object.assign(friend, { confirmed: true, lastSeen: nowSecs() });
      setPresence(friend, "online", "direct");
      changed();
    }, DELIVERY_MS);
  }

  /** Stellt jede Anfrage zu, deren Code noch gilt; zu einem abgelaufenen Code kommt nie eine Antwort. Per Name hat die Gegenseite schon angenommen. */
  function retryDeliveries() {
    const deliverable = db.requests.filter(
      (r) => r.state === "delivering" && (r.via === "name" || nowSecs() - r.createdAt <= FRIENDS_LIMITS.codeTtlSecs),
    );
    if (deliverable.length === 0) return;
    setTimeout(() => {
      deliverable.forEach((r) => (r.via === "name" ? becomeFriend(r) : deliver(r)));
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

  // --- Freunde-Menü im Spiel (INGAME 3.9) ---

  const unavailable = (reason: IngameReason, node: IngameNode | null = null): IngameStatus => ({ state: "unavailable", reason, node });

  /** Wie das Backend ohne Start: erst die Zelle (Loader, Version, Loader-Version), dann die Konten, dann die Schalter. */
  function ingameStatus(instanceId: string): IngameStatus {
    const forced = db.ingameForced.get(instanceId);
    if (forced) return forced;
    const instance = appDb.instances.find((i) => i.id === instanceId);
    if (!instance) throw new Error(t("mock.friends.notFound.instance", { id: instanceId }));
    if (!db.state.enabled) return unavailable({ type: "friendsOff" });
    if (!appDb.accounts.some((a) => a.kind === "microsoft")) return unavailable({ type: "offlineAccount" });
    if (instance.loader === "vanilla") return unavailable({ type: "vanilla" });
    if (instance.loader === "quilt") return unavailable({ type: "quilt" });
    const cell = MOCK_NODES.find((n) => n.loader === instance.loader && n.minecraft.includes(instance.minecraftVersion));
    if (!cell) return unavailable({ type: "noNode" });
    const node: IngameNode = { id: cell.id, minecraft: instance.minecraftVersion, loader: cell.loader };
    if (!cell.verified) return unavailable({ type: "unverified" });
    if (!instance.loaderVersion) return unavailable({ type: "loaderVersionUnknown" });
    if (isOlder(instance.loaderVersion, cell.loaderMin)) return unavailable({ type: "loaderTooOld", need: cell.loaderMin });
    return ingameStatusOfFit(instanceId, node);
  }

  function ingameStatusOfFit(instanceId: string, node: IngameNode): IngameStatus {
    const off = db.ingameOff.get(instanceId);
    if (appDb.running.has(instanceId)) return { state: "connected", reason: null, node };
    if (!db.state.settings.ingameMenu) return { state: "off", reason: { type: "globallyOff" }, node };
    if (off === "user") return { state: "off", reason: { type: "instanceOff" }, node };
    if (off) return { state: "autoOff", reason: { type: "breaker", reason: off }, node };
    return { state: "active", reason: null, node };
  }

  /** Ändert den Zustand der Einspeisung und meldet den neuen Status wie das Backend als `friends-ingame`. */
  function changeIngame(instanceId: string, change: () => void) {
    change();
    const status = ingameStatus(instanceId);
    emit("friends-ingame", { instanceId, status: clone(status) });
    return status;
  }

  function setIngameEnabled(instanceId: string, enabled: boolean) {
    return changeIngame(instanceId, () => (enabled ? db.ingameOff.delete(instanceId) : db.ingameOff.set(instanceId, "user")));
  }

  function retryIngame(instanceId: string) {
    return changeIngame(instanceId, () => {
      if (db.ingameOff.get(instanceId) !== "user") db.ingameOff.delete(instanceId);
    });
  }

  /** Ein Startfehler wie im Backend: `friends-ingame-failed` für den Dialog, danach der neue Status. */
  function failIngame(instanceId: string, reason: IngameFailureKind = "mixinApplyFailed") {
    ingameStatus(instanceId);
    if (db.ingameOff.get(instanceId) === "user") return;
    db.ingameOff.set(instanceId, reason);
    emit("friends-ingame-failed", { instanceId, reason });
    changeIngame(instanceId, () => {});
  }

  /** Zeigt einen Zustand, den der Mock nicht berechnet (`pumpkinMock.ingame(id, status)`); `null` stellt die Berechnung wieder her. */
  function forceIngame(instanceId: string, status: IngameStatus | null) {
    changeIngame(instanceId, () => (status ? db.ingameForced.set(instanceId, status) : db.ingameForced.delete(instanceId)));
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

  function receiveRequest(name: string, via: RequestVia) {
    const request = incomingRequestOf(name, via);
    db.requests.push(request);
    emit("friend-request", { request: clone(request) });
  }

  function acceptNameRequest(name: string) {
    const request = openNameRequests().find((r) => sameName(r.mcName, name));
    if (!request) throw new Error(t("mock.friends.notFound.request", { id: name }));
    becomeFriend(request);
    changed();
  }

  /** Wie das Backend: die älteste eigene Anfrage verschwindet, `friends-changed` und dann `friend-request-refused`. */
  function refuseOutgoingRequest(reason: RequestRefusal) {
    const request = db.requests.find((r) => r.direction === "outgoing");
    if (!request) throw new Error(t("mock.friends.notFound.request", { id: "outgoing" }));
    db.requests = db.requests.filter((r) => r !== request);
    changed();
    emit("friend-request-refused", { request: clone(request), reason });
  }

  function setDirectoryState(state: Extract<DirectoryState, "active" | "unreachable" | "notAllowed">) {
    db.state.directory.state = state;
    changed();
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

  /** Die Bitte der Mod: im Bereich `share` die Welt mit den Freunden, die online sind, im Bereich `social` eine Anfrage an `targetName`. */
  function confirmMod(scope: ModScope = "share", targetName = "Anna") {
    const online = scope === "share" ? db.friends.filter((f) => f.presence !== "offline") : [];
    const confirm: ModConfirmEvent = {
      requestId: newId("confirm"), instanceId: MOCK_HOST_INSTANCE, instanceName: "Survival 1.21",
      friends: online.map((f) => ({ friendId: f.id, displayName: f.mcName ?? f.displayName })),
      scope,
      summary: scope === "share"
        ? { op: "host.invite", targetName: online.map((f) => f.mcName ?? f.displayName).join(", ").slice(0, MOD_SUMMARY_NAME_CAP) || null }
        : { op: "friend.addByName", targetName },
    };
    db.pendingModConfirms.set(confirm.requestId, confirm);
    emit("friends-mod-confirm", confirm);
  }

  /** Ein Vorgang aus dem Spiel, den der Launcher ausgeführt (oder abgelehnt) hat: in die Liste und als `friends-mod-activity`. */
  function recordModActivity(op: string, targetName: string | null = null, ok = true) {
    const entry = modActivityOf({ op, targetName, ok, scope: op === "host.invite" ? "share" : "social" });
    db.modActivity = [entry, ...db.modActivity].slice(0, MOD_ACTIVITY_LIMIT);
    emit("friends-mod-activity", entry);
  }

  /** `launcher.open` der Mod: die Oberfläche geht an die Stelle, die `target` nennt. */
  const openFromMod = (target: ModOpenTarget) => emit("friends-mod-open", { instanceId: MOCK_HOST_INSTANCE, target });

  function answerModConfirm(requestId: string, allow: boolean) {
    const confirm = db.pendingModConfirms.get(requestId);
    if (!confirm) throw new Error(t("mock.friends.notFound.request", { id: requestId }));
    db.pendingModConfirms.delete(requestId);
    recordModActivity(confirm.summary.op, confirm.summary.targetName, allow);
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
    request: (name: string) => receiveRequest(name, "code"),
    nameRequest: (name: string) => receiveRequest(name, "name"),
    nameAccepted: acceptNameRequest,
    requestRefused: refuseOutgoingRequest,
    directory: setDirectoryState,
    lanOpened: openLan,
    guestJoined: joinGuest,
    hostGone: closeHostedWorld,
    network: (status: "online" | "degraded") =>
      setNetwork(status === "online" ? { type: "online", relayHost: MOCK_RELAY_HOST } : { type: "degraded", reason: "relayUnreachable" }),
    modConfirm: confirmMod,
    modActivity: recordModActivity,
    modOpen: openFromMod,
    ingameFailed: failIngame,
    ingame: forceIngame,
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
    friendAddByName: command(addFriendByName, { needsEnabled: true }),
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
    friendsIngameStatus: async (instanceId: string) => {
      await wait();
      return clone(ingameStatus(instanceId));
    },
    friendsIngameSetEnabled: async (instanceId: string, enabled: boolean) => {
      await wait();
      return clone(setIngameEnabled(instanceId, enabled));
    },
    friendsIngameRetry: async (instanceId: string) => {
      await wait();
      return clone(retryIngame(instanceId));
    },
    friendsModConfirm: command(answerModConfirm),
    friendsModActivity: command(() => db.modActivity),
  } satisfies Partial<Backend>;

  return { api, joinSpawned, accountChanged };
}
