// Prüfstand des Verzeichnis-Workers: D1 auf SQLite, ein falsches Mojang, aufzeichnende Begrenzungen, eine vorstellbare Uhr
// und Konten mit echten Ed25519-Schlüsseln (WebCrypto). Kein Netz, kein Cloudflare-Konto.
import worker from "../src/index.js";
import { authParts } from "../src/auth.js";
import { letterParts } from "../src/letters.js";
import { concat, fromHex, randomHex, toHex, utf8 } from "../src/util.js";
import { createD1 } from "./d1.mjs";

export const START = 1_790_000_000;
const AUTH_DOMAIN = "pumpkin/directory-auth/1";
const LETTER_DOMAIN = "pumpkin/name-request/1";
const CONSOLE_METHODS = ["log", "info", "warn", "error", "debug"];

/** Alle console-Aufrufe, die der Worker während der Anfragen aller Prüfstände gemacht hat (es soll keine geben). */
export const consoleCalls = [];

/** Schlüsselpaar mit Peer-ID (öffentlicher Schlüssel als Hex) und `sign(domain, teile)` wie `Identity::sign` im Launcher. */
export async function createIdentity(privateKey, publicKey) {
  const peerId = toHex(new Uint8Array(await crypto.subtle.exportKey("raw", publicKey)));
  const sign = async (domain, parts) =>
    toHex(new Uint8Array(await crypto.subtle.sign("Ed25519", privateKey, concat([utf8(domain), ...parts]))));
  return { peerId, sign };
}

export async function randomIdentity() {
  const { privateKey, publicKey } = await crypto.subtle.generateKey("Ed25519", true, ["sign", "verify"]);
  return createIdentity(privateKey, publicKey);
}

/** Der Schlüssel aus SPEC Anhang B: Seed `40 41 … 5f`. */
export async function seededIdentity() {
  const pkcs8 = concat([fromHex("302e020100300506032b657004220420"), Uint8Array.from({ length: 32 }, (_, i) => 0x40 + i)]);
  const privateKey = await crypto.subtle.importKey("pkcs8", pkcs8, { name: "Ed25519" }, true, ["sign"]);
  const jwk = await crypto.subtle.exportKey("jwk", privateKey);
  const publicKey = await crypto.subtle.importKey("jwk", { kty: jwk.kty, crv: jwk.crv, x: jwk.x }, { name: "Ed25519" }, true, ["verify"]);
  return createIdentity(privateKey, publicKey);
}

/** Mojang-Ersatz: `join` merkt sich (Konto, serverId), `hasJoined` antwortet wie Mojang (200 mit Profil oder 204). */
function createMojang() {
  const joins = [];
  const requests = [];
  let failure = null;

  const respond = (url) => {
    if (failure === "timeout") throw new DOMException("timeout", "TimeoutError");
    if (failure) return new Response("{}", { status: failure });
    const query = new URL(url).searchParams;
    const joined = joins.find((entry) => entry.name.toLowerCase() === query.get("username").toLowerCase() && entry.serverId === query.get("serverId"));
    if (!joined) return new Response(null, { status: 204 });
    return new Response(JSON.stringify({ id: joined.uuid, name: joined.name, properties: [] }), { status: 200, headers: { "content-type": "application/json" } });
  };

  return {
    requests,
    join: (account, serverId) => joins.push({ uuid: account.uuid, name: account.name, serverId }),
    /** `null` für normales Verhalten, sonst ein Statuscode oder "timeout". */
    failWith: (mode) => {
      failure = mode;
    },
    fetch: async (url, init) => {
      requests.push({ url: String(url), init });
      return respond(url);
    },
  };
}

const limiter = (keys, isBlocked) => ({
  async limit({ key }) {
    keys.push(key);
    return { success: !isBlocked() };
  },
});

function spyOnConsole() {
  const originals = CONSOLE_METHODS.map((method) => console[method]);
  const calls = [];
  CONSOLE_METHODS.forEach((method) => {
    console[method] = (...args) => calls.push({ method, args });
  });
  return { calls, restore: () => CONSOLE_METHODS.forEach((method, i) => (console[method] = originals[i])) };
}

export async function createWorld() {
  const db = createD1();
  const mojang = createMojang();
  globalThis.fetch = mojang.fetch;
  const limits = { ip: [], account: [], ipBlocked: false, accountBlocked: false };
  const env = {
    DB: db,
    LIMITER_IP: limiter(limits.ip, () => limits.ipBlocked),
    LIMITER_ACCOUNT: limiter(limits.account, () => limits.accountBlocked),
    TOKEN_KEY: "test-token-key",
    NOW: START,
  };
  let accounts = 0;

  /** Eine Anfrage an den Worker. `body` ist ein Objekt (als JSON) oder ein fertiger Text. */
  async function call(method, path, { body, token, headers = {}, env: overrides = {} } = {}) {
    const init = { method, headers: { ...headers }, body: typeof body === "object" ? JSON.stringify(body) : body };
    if (token) init.headers.authorization = `Bearer ${token}`;
    const spy = spyOnConsole();
    let response;
    try {
      response = await worker.fetch(new Request(`https://directory.example${path}`, init), { ...env, ...overrides });
    } finally {
      spy.restore();
      consoleCalls.push(...spy.calls);
    }
    const text = await response.text();
    return { status: response.status, text, headers: response.headers, json: text ? JSON.parse(text) : null };
  }

  async function newAccount(name = `Spieler${++accounts}`, uuid = randomHex(16)) {
    return { uuid, name, identity: await randomIdentity(), token: null, tokenExpiresAt: 0 };
  }

  /** Der Anfangsteil von BYNAME 3.1 bis zum Abschicken: Herausforderung, Mojang-join, Signatur. Gibt den Körper für /v1/auth/session zurück. */
  async function sessionBody(account, { name = account.name, join = true } = {}) {
    const { json: challenge } = await call("POST", "/v1/auth/challenge", { body: { peerId: account.identity.peerId } });
    if (join) mojang.join(account, challenge.serverId);
    const signature = await account.identity.sign(AUTH_DOMAIN, authParts(challenge.serverId, account.identity.peerId));
    return { challenge: challenge.challenge, name, signature };
  }

  async function handshake(account, options) {
    return call("POST", "/v1/auth/session", { body: await sessionBody(account, options) });
  }

  /** Ein gültiges Token des Kontos; es wird wiederverwendet, bis die Uhr seinen Ablauf erreicht. */
  async function tokenOf(account) {
    if (account.tokenExpiresAt <= env.NOW) {
      const { json: session } = await handshake(account);
      Object.assign(account, { token: session.token, tokenExpiresAt: session.expiresAt });
    }
    return account.token;
  }

  async function signedLetter(sender, toUuid, overrides = {}) {
    const letter = {
      to: toUuid,
      nonce: randomHex(16),
      helloId: randomHex(32),
      relayIndex: 0,
      secret: randomHex(9),
      displayName: sender.name,
      createdAt: env.NOW,
      ...overrides,
    };
    const signature = await sender.identity.sign(LETTER_DOMAIN, letterParts(sender.uuid, letter));
    return { ...letter, signature, ...overrides };
  }

  async function send(sender, toUuid, overrides) {
    return call("POST", "/v1/outbox", { token: await tokenOf(sender), body: await signedLetter(sender, toUuid, overrides) });
  }

  /** Ein Konto, das auffindbar ist (hat sich registriert). */
  async function findable(name, uuid) {
    const account = await newAccount(name, uuid);
    await call("PUT", "/v1/me", { token: await tokenOf(account), body: "{}" });
    return account;
  }

  const authed = async (account, method, path) => call(method, path, { token: await tokenOf(account) });

  return {
    env,
    db,
    mojang,
    limits,
    call,
    authed,
    newAccount,
    sessionBody,
    handshake,
    tokenOf,
    signedLetter,
    send,
    findable,
    advance: (seconds) => {
      env.NOW += seconds;
    },
    runCron: () => worker.scheduled({}, env),
    count: (table, where = "1 = 1") => db.raw.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE ${where}`).get().n,
  };
}
