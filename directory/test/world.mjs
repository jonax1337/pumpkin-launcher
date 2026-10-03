// Prüfstand des Verzeichnis-Workers: D1 auf SQLite, aufzeichnende Begrenzungen, eine vorstellbare Uhr und Konten mit
// echten Ed25519-Schlüsseln (WebCrypto). Player certificates come from a certificate factory with fake Mojang keys
// (node:crypto RSA); `fetch` records and throws, because the Worker must make no subrequest. Kein Netz, kein Cloudflare-Konto.
import { createPrivateKey, generateKeyPairSync, sign } from "node:crypto";
import { readFileSync } from "node:fs";
import worker from "../src/index.js";
import { loginParts, setPinnedKeysForTest } from "../src/auth.js";
import { letterParts } from "../src/letters.js";
import { bigEndian64, concat, fromHex, randomHex, toHex, utf8 } from "../src/util.js";
import { createD1 } from "./d1.mjs";

export const START = 1_790_000_000;
export const HOST = "directory.example";
export const AUTH_DOMAIN = "pumpkin/directory-auth/2";
export const CERT_DOMAIN = "pumpkin/directory-cert/1";
const LETTER_DOMAIN = "pumpkin/name-request/1";
const CERTIFICATE_LIFETIME_MS = 48 * 60 * 60 * 1000;
const CONSOLE_METHODS = ["log", "info", "warn", "error", "debug"];

/** Fixed test keys and golden vectors shared with the launcher's tests (BYNAME-ATTEST section 2). */
export const CERT_VECTORS = JSON.parse(readFileSync(new URL("./cert-vectors.json", import.meta.url), "utf8"));

const fixedKey = ({ pkcs8, spki }) => ({ privateKey: createPrivateKey({ key: Buffer.from(pkcs8, "base64"), format: "der", type: "pkcs8" }), spki });

function freshKey() {
  const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  return { privateKey, spki: publicKey.export({ type: "spki", format: "der" }).toString("base64") };
}

/** RSA keys by role: fake Mojang keys A and B (pinned), an unpinned one, and certificate keys of players. */
export const RSA_KEYS = {
  mojangA: fixedKey(CERT_VECTORS.fakeMojang),
  mojangB: freshKey(),
  unpinned: freshKey(),
  certificate: fixedKey(CERT_VECTORS.certificate),
  other: fixedKey(CERT_VECTORS.other),
};
export const PINNED_TEST_KEYS = [RSA_KEYS.mojangA.spki, RSA_KEYS.mojangB.spki];

export const toBase64 = (bytes) => Buffer.from(bytes).toString("base64");
/** RSASSA-PKCS1-v1_5 with `hash` ("sha1" like Mojang, "sha256" like the launcher), base64. */
export const rsaSignature = (hash, data, key) => toBase64(sign(hash, data, key.privateKey));

/** L3, the bytes Mojang signs: uuid (16) || expiresAt (int64 BE) || SPKI. */
export const mojangPayload = (uuid, expiresAt, spki) => concat([fromHex(uuid), bigEndian64(expiresAt), Buffer.from(spki, "base64")]);

/** A player certificate for `uuid` as the launcher sends it (`wire`), plus the private key it signs L2 with. */
export function issueCertificate(uuid, { expiresAt, key = RSA_KEYS.certificate, issuer = RSA_KEYS.mojangA }) {
  const mojangSignature = rsaSignature("sha1", mojangPayload(uuid, expiresAt, key.spki), issuer);
  return { key, wire: { publicKey: key.spki, expiresAt, mojangSignature } };
}

/** Every `fetch` the Worker attempted during the whole run (there must be none). */
export const subrequests = [];
globalThis.fetch = async (input) => {
  subrequests.push(String(input?.url ?? input));
  throw new Error("the directory Worker must not make subrequests");
};

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

let accounts = 0;

/** A Minecraft account with a friends key; `name` only serves as the display name of its letters. */
export async function createAccount(name = `Spieler${++accounts}`, uuid = randomHex(16)) {
  return { uuid, name, identity: await randomIdentity(), token: null, tokenExpiresAt: 0 };
}

const signedLayout = async (domain, { host, serverId, peerId, uuid }) => concat([utf8(domain), ...(await loginParts(host, serverId, peerId, uuid))]);

/**
 * The A2 body for `account` over an A1 answer. By default everything is genuine; `certificate` replaces the player
 * certificate, `l1`/`l2` change what the friends key or the certificate key signs, and `sent` replaces fields of the
 * body after signing, so a test can break exactly one link.
 */
export async function signSession({ challenge, serverId, expiresAt }, account, { certificate, l1 = {}, l2 = {}, sent = {} } = {}) {
  const proven = certificate ?? issueCertificate(account.uuid, { expiresAt: expiresAt * 1000 + CERTIFICATE_LIFETIME_MS });
  const covered = { host: HOST, serverId, peerId: account.identity.peerId, uuid: sent.uuid ?? account.uuid };
  const auth = { domain: AUTH_DOMAIN, identity: account.identity, ...covered, ...l1 };
  const cert = { domain: CERT_DOMAIN, key: proven.key, ...covered, ...l2 };
  return {
    challenge,
    uuid: account.uuid,
    certificate: proven.wire,
    certSignature: rsaSignature("sha256", await signedLayout(cert.domain, cert), cert.key),
    signature: await auth.identity.sign(auth.domain, await loginParts(auth.host, auth.serverId, auth.peerId, auth.uuid)),
    ...sent,
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
  setPinnedKeysForTest(PINNED_TEST_KEYS);
  const db = createD1();
  const limits = { ip: [], account: [], ipBlocked: false, accountBlocked: false };
  const env = {
    DB: db,
    LIMITER_IP: limiter(limits.ip, () => limits.ipBlocked),
    LIMITER_ACCOUNT: limiter(limits.account, () => limits.accountBlocked),
    TOKEN_KEY: "test-token-key",
    NOW: START,
  };

  /** Eine Anfrage an den Worker. `body` ist ein Objekt (als JSON), ein fertiger Text oder ein Stream. */
  async function call(method, path, { body, token, headers = {}, env: overrides = {}, host = HOST } = {}) {
    const init = { method, headers: { ...headers }, body: isJson(body) ? JSON.stringify(body) : body, duplex: "half" };
    if (token) init.headers.authorization = `Bearer ${token}`;
    const spy = spyOnConsole();
    let response;
    try {
      response = await worker.fetch(new Request(`https://${host}${path}`, init), { ...env, ...overrides });
    } finally {
      spy.restore();
      consoleCalls.push(...spy.calls);
    }
    const text = await response.text();
    return { status: response.status, text, headers: response.headers, json: text ? JSON.parse(text) : null };
  }

  const challengeFor = async (account) => (await call("POST", "/v2/auth/challenge", { body: { peerId: account.identity.peerId } })).json;

  /** A1 and the signatures of BYNAME-ATTEST 3.2: the body for /v2/auth/session (see `signSession` for `change`). */
  async function sessionBody(account, change) {
    return signSession(await challengeFor(account), account, change);
  }

  async function handshake(account, change) {
    return call("POST", "/v2/auth/session", { body: await sessionBody(account, change) });
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
    const account = await createAccount(name, uuid);
    await call("PUT", "/v1/me", { token: await tokenOf(account), body: "{}" });
    return account;
  }

  const authed = async (account, method, path) => call(method, path, { token: await tokenOf(account) });

  return {
    env,
    db,
    limits,
    call,
    authed,
    newAccount: createAccount,
    challengeFor,
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

const isJson = (body) => body !== null && typeof body === "object" && !(body instanceof ReadableStream);
