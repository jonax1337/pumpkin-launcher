// Prüft den Verzeichnis-Worker ohne Cloudflare-Konto und ohne Netz: D1 auf node:sqlite, echte Ed25519- und RSA-Schlüssel.
// All cases of docs/friends/BYNAME.md 10.1 and BYNAME-ATTEST.md 8.1; exit code 1 as soon as one fails.
// Run: `node directory/test.mjs`; MOJANG_PUBLICKEYS=<file> compares the pinned keys with another saved /publickeys answer.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { issueChallenge, loginParts, openSession, setPinnedKeysForTest } from "./src/auth.js";
import { letterParts } from "./src/letters.js";
import { PLAYER_CERTIFICATE_KEYS } from "./src/mojang-keys.js";
import { concat, fromHex, rsaModulusBits, toHex, unseal, utf8, verifySignature } from "./src/util.js";
import { certificateKeysOf, renderModule } from "./scripts/mojang-keys.mjs";
import {
  AUTH_DOMAIN,
  CERT_DOMAIN,
  CERT_VECTORS,
  HOST,
  PINNED_TEST_KEYS,
  RSA_KEYS,
  START,
  consoleCalls,
  createAccount,
  createWorld,
  issueCertificate,
  mojangPayload,
  rsaSignature,
  seededIdentity,
  signSession,
  subrequests,
  toBase64,
} from "./test/world.mjs";

const DAY = 86_400;
const HOUR = 3_600;
const TOKEN_TTL = 6 * HOUR;
const WEEK = 7 * DAY;
const LETTER_TTL = 14 * DAY;
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

let failures = 0;
/** Gleichheit ohne Rücksicht auf die Reihenfolge der Felder. */
const canonical = (value) =>
  JSON.stringify(value, (_key, item) =>
    item && typeof item === "object" && !Array.isArray(item) ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => (a < b ? -1 : 1))) : item,
  );

function check(label, got, want) {
  const same = canonical(got) === canonical(want);
  if (!same) failures += 1;
  console.log(same ? "ok  " : "FAIL", label, same ? "" : `(erhalten ${JSON.stringify(got)}, erwartet ${JSON.stringify(want)})`);
}

const errorOf = (response) => response.json?.error;
// Das erste Zeichen ändert immer Bytes; im letzten stecken Füllbits, die das Dekodieren ignoriert.
const corrupt = (text) => (text.startsWith("A") ? "B" : "A") + text.slice(1);
const omit = (object, keys) => Object.fromEntries(Object.entries(object).filter(([key]) => !keys.includes(key)));

async function routing() {
  const w = await createWorld();
  const peerId = "ab".repeat(32);
  check("unbekannte Route", (await w.call("GET", "/v1/nichts")).status, 404);
  check("Wurzel", (await w.call("GET", "/")).status, 404);
  check("bekannter Pfad, falsche Methode", (await w.call("GET", "/v1/me")).status, 404);
  check("Pfad mit Schrägstrich am Ende", (await w.call("POST", "/v2/auth/challenge/", { body: { peerId } })).status, 404);
  check("fehlerhafte Brief-Id ist ein unbekannter Pfad", (await w.call("DELETE", "/v1/inbox/nicht-gueltig")).status, 404);
  check("Brief-Id ohne UUID-v4-Form", (await w.call("DELETE", "/v1/outbox/00000000-0000-1000-8000-000000000000")).status, 404);
  check("UUID in Großbuchstaben im Pfad", (await w.call("PUT", `/v1/blocks/${"AB".repeat(16)}`)).status, 404);
  check("404 ist ein Fehlercode", errorOf(await w.call("GET", "/v1/nichts")), "notFound");

  const browser = await w.call("POST", "/v2/auth/challenge", { body: { peerId }, headers: { origin: "https://boese.example" } });
  check("Browser (Origin)", [browser.status, errorOf(browser)], [403, "forbidden"]);

  const body = (bytes) => ({ body: "x".repeat(bytes) });
  check("Körper mit 2048 Bytes ist erlaubt", (await w.call("POST", "/v2/auth/challenge", body(2048))).status, 400);
  check("Körper mit 2049 Bytes", (await w.call("POST", "/v2/auth/challenge", body(2049))).json, { error: "tooLarge" });
  check("Größe zählt Bytes, nicht Zeichen", (await w.call("POST", "/v2/auth/challenge", { body: "ä".repeat(1100) })).status, 413);
}

/** Sizes as BYNAME-ATTEST 1.3 measured them: a 256-character challenge, real key and signature lengths. */
function realSizedSessionBody(spkiBytes, mojangSignatureBytes, certSignatureBytes) {
  const certificate = { publicKey: toBase64(new Uint8Array(spkiBytes)), expiresAt: 1790172800123, mojangSignature: toBase64(new Uint8Array(mojangSignatureBytes)) };
  return JSON.stringify({ challenge: "x".repeat(256), uuid: "ab".repeat(16), certificate, certSignature: toBase64(new Uint8Array(certSignatureBytes)), signature: "a".repeat(128) });
}

/** A body of twenty 1000-byte chunks without a length; `pulls` counts how many the Worker asked for. */
function chunkedStream() {
  const stream = { pulls: 0 };
  stream.body = new ReadableStream({
    pull(controller) {
      stream.pulls += 1;
      if (stream.pulls > 20) controller.close();
      else controller.enqueue(new Uint8Array(1000).fill(0x20));
    },
  });
  return stream;
}

async function bodyLimits() {
  const w = await createWorld();
  const session = (body, headers) => w.call("POST", "/v2/auth/session", { body, headers });
  const rsa4096Certificate = realSizedSessionBody(550, 512, 512);
  check("real-size body with an RSA-4096 certificate key is 2,658 bytes", rsa4096Certificate.length, 2658);
  check("A2: the RSA-4096-certificate body is not too large", (await session(rsa4096Certificate)).status !== 413, true);
  check("A2: 4,096 bytes are allowed", errorOf(await session(" ".repeat(4096))), "invalid");
  check("A2: 4,097 bytes", [(await session(" ".repeat(4097))).status, errorOf(await session(" ".repeat(4097)))], [413, "tooLarge"]);
  check("other routes keep 2,048 bytes: 2,049 on /v1/outbox", (await w.call("POST", "/v1/outbox", { body: " ".repeat(2049) })).status, 413);
  check("a content-length above the limit is refused unread", (await session("{}", { "content-length": "4097" })).status, 413);
  const chunked = chunkedStream();
  check("a body without length stops at the limit", (await session(chunked.body)).status, 413);
  check("reading stopped right after the limit", chunked.pulls <= 6, true);
}

async function failsClosed() {
  const w = await createWorld();
  const account = await w.newAccount("Alex");
  const session = await w.sessionBody(account);
  const fetchCalls = subrequests.length;
  for (const missing of ["DB", "LIMITER_IP", "LIMITER_ACCOUNT", "TOKEN_KEY"]) {
    const response = await w.call("POST", "/v2/auth/session", { body: session, env: { [missing]: undefined } });
    check(`ohne ${missing}`, [response.status, errorOf(response)], [503, "notConfigured"]);
  }
  check("fail closed: no fetch call", subrequests.length, fetchCalls);
  check("derselbe Körper geht mit allen Bindungen durch", (await w.call("POST", "/v2/auth/session", { body: session })).status, 200);
}

async function challenges() {
  const w = await createWorld();
  const account = await w.newAccount("Alex");
  const { peerId } = account.identity;
  const first = await w.call("POST", "/v2/auth/challenge", { body: { peerId } });
  const second = await w.call("POST", "/v2/auth/challenge", { body: { peerId } });
  check("Herausforderung: Status und Felder", [first.status, Object.keys(first.json)], [200, ["challenge", "serverId", "expiresAt"]]);
  check("Herausforderung läuft nach 120 s ab", first.json.expiresAt, START + 120);
  check("serverId hat 40 Hex-Zeichen", /^[0-9a-f]{40}$/.test(first.json.serverId), true);
  check("Herausforderung höchstens 256 Zeichen", first.json.challenge.length <= 256, true);
  check("jede Herausforderung ist neu", first.json.challenge !== second.json.challenge && first.json.serverId !== second.json.serverId, true);

  const invalid = { "zu kurz": { peerId: "ab".repeat(31) }, Großbuchstaben: { peerId: "AB".repeat(32) }, "mit Zusatzfeld": { peerId, extra: 1 }, "ohne Feld": {}, Liste: [peerId] };
  for (const [label, body] of Object.entries(invalid)) check(`Herausforderung ${label}`, errorOf(await w.call("POST", "/v2/auth/challenge", { body })), "invalid");
  check("Herausforderung kein JSON", errorOf(await w.call("POST", "/v2/auth/challenge", { body: "{" })), "invalid");
}

/** Runs before any `createWorld` pins the test keys: the Worker starts with Mojang's real keys and no env can swap them. */
async function productionKeysByDefault() {
  const env = { TOKEN_KEY: "test-token-key", MOJANG_CERT_KEYS: PINNED_TEST_KEYS };
  const account = await createAccount("Alex");
  const issued = await (await issueChallenge({ env, now: START, text: JSON.stringify({ peerId: account.identity.peerId }) })).json();
  const text = JSON.stringify(await signSession(issued, account));
  const open = async () => (await openSession({ env, now: START, text, host: HOST })).json();
  check("production keys by default, env.MOJANG_CERT_KEYS ignored: a test certificate is refused", (await open()).error, "badCertificate");
  setPinnedKeysForTest(PINNED_TEST_KEYS);
  check("the same body passes once the test seam pins the test keys", (await open()).token?.startsWith("v2."), true);
}

async function sessions() {
  const w = await createWorld();
  const steve = await w.newAccount("Steve");
  const session = await w.handshake(steve);
  check("session: status and fields", [session.status, Object.keys(session.json)], [200, ["token", "expiresAt", "uuid"]]);
  check("session: the UUID is the certificate's", session.json.uuid, steve.uuid);
  check("session: token has version v2", session.json.token.startsWith("v2."), true);
  const claims = await unseal(w.env.TOKEN_KEY, "token", session.json.token.slice(3));
  check("token carries exactly u, p and exp", claims, { u: steve.uuid, p: steve.identity.peerId, exp: START + TOKEN_TTL });
  check("token lasts 6 hours when the certificate lives longer", session.json.expiresAt, START + TOKEN_TTL);
  const shortLived = issueCertificate(steve.uuid, { expiresAt: (START + HOUR) * 1000 + 999 });
  check("token ends with a certificate that expires sooner", (await w.handshake(steve, { certificate: shortLived })).json.expiresAt, START + HOUR);

  check("abgelaufene Herausforderung", errorOf(await expiredChallenge(w, 120)), "challengeExpired");
  check("Herausforderung kurz vor Ablauf", (await expiredChallenge(w, 119)).status, 200);
  await tamperedChallenges(w);

  await certificates();
  await certificateStructure();
  await texturesSignatureIsNoCertificate();
  await loginSignatures();
  await sessionShapes();
  await retiredLogin();
  await pinnedKeyImportFailure();
}

async function certificates() {
  const w = await createWorld();
  const [alex, other] = [await w.newAccount("Alex"), await w.newAccount("Other")];
  const expiresAt = (START + 2 * DAY) * 1000;
  const issuedBy = (issuer) => issueCertificate(alex.uuid, { expiresAt, issuer });
  check("certificate signed by pinned key B (rotation)", (await w.handshake(alex, { certificate: issuedBy(RSA_KEYS.mojangB) })).status, 200);
  check("certificate signed by an unpinned key", errorOf(await w.handshake(alex, { certificate: issuedBy(RSA_KEYS.unpinned) })), "badCertificate");

  const genuine = issuedBy(RSA_KEYS.mojangA);
  const tampered = {
    uuid: { certificate: genuine, sent: { uuid: other.uuid } },
    "expiresAt (+1 ms)": { certificate: { ...genuine, wire: { ...genuine.wire, expiresAt: expiresAt + 1 } } },
    publicKey: { certificate: { key: RSA_KEYS.other, wire: { ...genuine.wire, publicKey: RSA_KEYS.other.spki } } },
  };
  for (const [field, change] of Object.entries(tampered)) {
    check(`tampered ${field}, L1 and L2 re-signed: only Mojang's signature is wrong`, errorOf(await w.handshake(alex, change)), "badCertificate");
  }
  const notResigned = { certificate: genuine, sent: { uuid: other.uuid }, l1: { uuid: alex.uuid }, l2: { uuid: alex.uuid } };
  check("tampered uuid, not re-signed: L1 fails first", errorOf(await w.handshake(alex, notResigned)), "badSignature");

  const expiringAt = (ms) => ({ certificate: issueCertificate(alex.uuid, { expiresAt: ms }) });
  check("certificate expiring exactly now", errorOf(await w.handshake(alex, expiringAt(START * 1000))), "certificateExpired");
  check("certificate expiring 1 ms after now", (await w.handshake(alex, expiringAt(START * 1000 + 1))).status, 200);
}

const RSA_ALGORITHM = fromHex("300d06092a864886f70d0101010500");
const derLength = (length) => (length < 0x80 ? [length] : length < 0x100 ? [0x81, length] : [0x82, length >> 8, length & 0xff]);
const der = (tag, ...contents) => {
  const body = concat(contents.map((part) => Uint8Array.from(part)));
  return concat([Uint8Array.of(tag, ...derLength(body.length)), body]);
};
const minimalModulus = (bits) => [0, 0x80, ...new Uint8Array(bits / 8 - 2), 1];

/** A structurally valid rsaEncryption SPKI with a `bits`-bit modulus (a multiple of 8); no real key behind it. */
function syntheticRsaSpki(bits, { modulus = minimalModulus(bits), exponent = der(0x02, [1, 0, 1]), unusedBits = 0 } = {}) {
  return der(0x30, RSA_ALGORITHM, der(0x03, [unusedBits], der(0x30, der(0x02, modulus), exponent)));
}

async function certificateStructure() {
  const real = Buffer.from(RSA_KEYS.certificate.spki, "base64");
  check("SPKI parser: the test certificate key has 2048 bits", rsaModulusBits(real), 2048);
  check("SPKI parser: Mojang's pinned keys have 4096 bits", PLAYER_CERTIFICATE_KEYS.map((key) => rsaModulusBits(Buffer.from(key, "base64"))), [4096, 4096]);
  check("SPKI parser: synthetic 2040-bit key", rsaModulusBits(syntheticRsaSpki(2040)), 2040);
  const ed25519 = fromHex(`302a300506032b6570032100${"ab".repeat(32)}`);
  const broken = {
    "a trailing byte": concat([real, [0]]),
    "a truncated key": real.subarray(0, real.length - 1),
    "an Ed25519 SPKI": ed25519,
    "a negative modulus": syntheticRsaSpki(2048, { modulus: [0x80, ...new Uint8Array(255)] }),
    "a zero-padded modulus": syntheticRsaSpki(2048, { modulus: [0, ...minimalModulus(2048)] }),
    "a zero exponent": syntheticRsaSpki(2048, { exponent: [0x02, 0x01, 0x00] }),
    "a length in needless long form": syntheticRsaSpki(2048, { exponent: [0x02, 0x81, 0x03, 1, 0, 1] }),
    "unused bits in the BIT STRING": syntheticRsaSpki(2048, { unusedBits: 1 }),
    "no bytes": new Uint8Array(0),
  };
  for (const [label, bytes] of Object.entries(broken)) check(`SPKI parser rejects ${label}`, rsaModulusBits(bytes), 0);

  const w = await createWorld();
  const alex = await w.newAccount("Alex");
  const withPublicKey = (spki) => {
    const certificate = issueCertificate(alex.uuid, { expiresAt: (START + DAY) * 1000 });
    return { certificate: { ...certificate, wire: { ...certificate.wire, publicKey: toBase64(spki) } } };
  };
  const refused = { "base64 that is no SPKI": utf8("not a key at all"), "an Ed25519 SPKI": ed25519, "a 2040-bit RSA key": syntheticRsaSpki(2040), "a 4104-bit RSA key": syntheticRsaSpki(4104) };
  for (const [label, spki] of Object.entries(refused)) check(`publicKey is ${label}`, errorOf(await w.handshake(alex, withPublicKey(spki))), "invalid");
  check("a 4096-bit RSA SPKI passes the shape check", errorOf(await w.handshake(alex, withPublicKey(syntheticRsaSpki(4096)))), "badCertificate");
}

/**
 * Mojang signs skin textures with the same key it signs certificates with (profilePropertyKeys[0] equals
 * playerCertificateKeys[0]). Read as L3, such a blob must never pass: its expiry slot is ASCII and its "SPKI" no key.
 */
async function texturesSignatureIsNoCertificate() {
  const w = await createWorld();
  const alex = await w.newAccount("Alex");
  const property = { timestamp: START * 1000, profileId: alex.uuid, profileName: "Alex", textures: { SKIN: { url: `http://textures.minecraft.net/texture/${"ab".repeat(32)}` } } };
  const signed = Buffer.from(toBase64(utf8(JSON.stringify(property))), "ascii");
  const mojangSignature = rsaSignature("sha1", signed, RSA_KEYS.mojangA);
  const expirySlot = signed.readBigUInt64BE(16);
  const asL3 = { uuid: toHex(signed.subarray(0, 16)), expiresAt: Number(expirySlot), spki: toBase64(signed.subarray(24)) };
  check("textures blob read as L3 is byte for byte what Mojang signed", Buffer.compare(mojangPayload(asL3.uuid, expirySlot, asL3.spki), signed), 0);
  check("textures blob: its expiry slot is no safe integer", Number.isSafeInteger(asL3.expiresAt), false);

  const account = { ...alex, uuid: asL3.uuid };
  const presenting = (expiresAt) => ({ certificate: { key: RSA_KEYS.certificate, wire: { publicKey: asL3.spki, expiresAt, mojangSignature } } });
  check("textures blob as a certificate", errorOf(await w.handshake(account, presenting(asL3.expiresAt))), "invalid");
  check("textures blob with a safe expiry still fails on its SPKI", errorOf(await w.handshake(account, presenting((START + DAY) * 1000))), "invalid");
}

async function loginSignatures() {
  const w = await createWorld();
  const [alex, stranger] = [await w.newAccount("Alex"), await w.newAccount("Fremd")];
  const elsewhere = "evil.example";
  const wrongCertSignature = {
    "another key": { key: RSA_KEYS.other },
    "another serverId": { serverId: "1".repeat(40) },
    "another peer id": { peerId: stranger.identity.peerId },
    "another uuid": { uuid: stranger.uuid },
    "the friends-key domain": { domain: AUTH_DOMAIN },
    "another directory host": { host: elsewhere },
  };
  for (const [label, l2] of Object.entries(wrongCertSignature)) check(`certSignature with ${label}`, errorOf(await w.handshake(alex, { l2 })), "badSignature");
  const wrongSignature = {
    "another friends key": { identity: stranger.identity },
    "another serverId": { serverId: "1".repeat(40) },
    "another peer id": { peerId: stranger.identity.peerId },
    "another uuid": { uuid: stranger.uuid },
    "the old /1 domain": { domain: "pumpkin/directory-auth/1" },
    "the certificate domain": { domain: CERT_DOMAIN },
    "another directory host": { host: elsewhere },
  };
  for (const [label, l1] of Object.entries(wrongSignature)) check(`Ed25519 signature with ${label}`, errorOf(await w.handshake(alex, { l1 })), "badSignature");

  const forElsewhere = await w.sessionBody(alex, { l1: { host: elsewhere }, l2: { host: elsewhere } });
  check("signatures bind the host the request reached", (await w.call("POST", "/v2/auth/session", { body: forElsewhere, host: elsewhere })).status, 200);
  check("signatures made for another directory are useless here", errorOf(await w.call("POST", "/v2/auth/session", { body: forElsewhere })), "badSignature");
}

async function sessionShapes() {
  const w = await createWorld();
  const alex = await w.newAccount("Alex");
  const body = await w.sessionBody(alex);
  const certificate = body.certificate;
  const withCertificate = (fields) => ({ ...body, certificate: { ...certificate, ...fields } });
  const urlSafe = (text) => text.replaceAll("+", "-").replaceAll("/", "_");
  const hyphenated = body.uuid.replace(/^(.{8})(.{4})(.{4})(.{4})/, "$1-$2-$3-$4-");
  const invalid = {
    "without uuid": omit(body, ["uuid"]),
    "without certificate": omit(body, ["certificate"]),
    "without certSignature": omit(body, ["certSignature"]),
    "without signature": omit(body, ["signature"]),
    "with an extra key": { ...body, name: "Alex" },
    "without publicKey": { ...body, certificate: omit(certificate, ["publicKey"]) },
    "without mojangSignature": { ...body, certificate: omit(certificate, ["mojangSignature"]) },
    "with an extra certificate key": withCertificate({ publicKeySignature: certificate.mojangSignature }),
    "with the certificate as a list": { ...body, certificate: Object.values(certificate) },
    "with a null certificate": { ...body, certificate: null },
    "with an uppercase uuid": { ...body, uuid: body.uuid.toUpperCase() },
    "with a hyphenated uuid": { ...body, uuid: hyphenated },
    "with expiresAt as a string": withCertificate({ expiresAt: String(certificate.expiresAt) }),
    "with expiresAt as a float": withCertificate({ expiresAt: certificate.expiresAt + 0.5 }),
    "with a negative expiresAt": withCertificate({ expiresAt: -certificate.expiresAt }),
    "with expiresAt 0": withCertificate({ expiresAt: 0 }),
    "with expiresAt 2^53": withCertificate({ expiresAt: 2 ** 53 }),
    "with publicKey in base64url": withCertificate({ publicKey: urlSafe(certificate.publicKey) }),
    "with mojangSignature without padding": withCertificate({ mojangSignature: certificate.mojangSignature.replace(/=+$/, "") }),
    "with mojangSignature over two lines": withCertificate({ mojangSignature: `${certificate.mojangSignature.slice(0, 64)}\n${certificate.mojangSignature.slice(64)}` }),
    "with an empty publicKey": withCertificate({ publicKey: "" }),
    "with a publicKey of 801 bytes": withCertificate({ publicKey: toBase64(new Uint8Array(801)) }),
    "with a mojangSignature of 1025 bytes": withCertificate({ mojangSignature: toBase64(new Uint8Array(1025)) }),
    "with an empty certSignature": { ...body, certSignature: "" },
    "with a certSignature of 1025 bytes": { ...body, certSignature: toBase64(new Uint8Array(1025)) },
    "with an uppercase signature": { ...body, signature: body.signature.toUpperCase() },
    "with an empty challenge": { ...body, challenge: "" },
  };
  check("shape cases really change the body (base64url, padding)", [urlSafe(certificate.publicKey) !== certificate.publicKey, certificate.mojangSignature.endsWith("=")], [true, true]);
  for (const [label, shape] of Object.entries(invalid)) check(`session ${label}`, errorOf(await w.call("POST", "/v2/auth/session", { body: shape })), "invalid");
  for (const text of ["[]", "null", "{", ""]) check(`session body ${JSON.stringify(text)}`, errorOf(await w.call("POST", "/v2/auth/session", { body: text })), "invalid");
  const legacy = { challenge: body.challenge, name: "Alex", signature: body.signature };
  check("the 2.0.0 body {challenge, name, signature}", errorOf(await w.call("POST", "/v2/auth/session", { body: legacy })), "invalid");
  check("the genuine body still passes", (await w.call("POST", "/v2/auth/session", { body })).status, 200);
}

/** 2.0.0 launchers fail at their first step, before their Mojang `join`; no binding or rate limit is touched. */
async function retiredLogin() {
  const w = await createWorld();
  const alex = await w.newAccount("Alex");
  const challenge = await w.call("POST", "/v1/auth/challenge", { body: { peerId: alex.identity.peerId }, env: { DB: undefined } });
  check("2.0.0 challenge (A1 v1)", [challenge.status, errorOf(challenge)], [410, "gone"]);
  const session = await w.call("POST", "/v1/auth/session", { body: { challenge: "x", name: "Steve", signature: "00" } });
  check("2.0.0 session (A2 v1)", [session.status, errorOf(session)], [410, "gone"]);
  check("retired routes skip the rate limiter", w.limits.ip, []);
  check("other methods on retired paths are unknown", (await w.call("GET", "/v1/auth/challenge")).status, 404);
}

/** A pinned key that does not import answers 500; a failed import is not cached, so the next request imports again. */
async function pinnedKeyImportFailure() {
  const w = await createWorld();
  const alex = await w.newAccount("Alex");
  setPinnedKeysForTest([toBase64(utf8("not a key"))]);
  const broken = await w.handshake(alex);
  check("pinned key that does not import", [broken.status, errorOf(broken)], [500, "internal"]);

  const issuer = RSA_KEYS.unpinned;
  setPinnedKeysForTest([issuer.spki]);
  const change = { certificate: issueCertificate(alex.uuid, { expiresAt: (START + DAY) * 1000, issuer }) };
  const importKey = crypto.subtle.importKey;
  let failuresLeft = 1;
  crypto.subtle.importKey = function (format, data, algorithm, ...rest) {
    const pinnedImport = format === "spki" && algorithm?.hash === "SHA-1";
    if (pinnedImport && failuresLeft-- > 0) return Promise.reject(new Error("simulated import failure"));
    return importKey.call(this, format, data, algorithm, ...rest);
  };
  try {
    const statuses = [(await w.handshake(alex, change)).status, (await w.handshake(alex, change)).status];
    check("a failed pinned-key import is retried by the next request", statuses, [500, 200]);
  } finally {
    delete crypto.subtle.importKey;
    setPinnedKeysForTest(PINNED_TEST_KEYS);
  }
}

const expiredChallenge = async (w, wait) => {
  const account = await w.newAccount("Spaet");
  const body = await w.sessionBody(account);
  w.advance(wait);
  const response = await w.call("POST", "/v2/auth/session", { body });
  w.advance(-wait);
  return response;
};

async function tamperedChallenges(w) {
  const account = await w.newAccount("Fremdschluessel");
  const body = await w.sessionBody(account);
  const [payload, tag] = body.challenge.split(".");
  const forged = { "Nutzlast verändert": `${corrupt(payload)}.${tag}`, "Prüfwert verändert": `${payload}.${corrupt(tag)}`, "ohne Prüfwert": payload, Unsinn: "###", "zu lang": "A".repeat(257) };
  for (const [label, challenge] of Object.entries(forged)) {
    check(`Herausforderung ${label}`, errorOf(await w.call("POST", "/v2/auth/session", { body: { ...body, challenge } })), "invalid");
  }
  const otherKey = { TOKEN_KEY: "anderer-schluessel" };
  check("Herausforderung mit anderem TOKEN_KEY", errorOf(await w.call("POST", "/v2/auth/session", { body, env: otherKey })), "invalid");
}

async function tokens() {
  const w = await createWorld();
  const alex = await w.newAccount("Alex");
  const token = await w.tokenOf(alex);
  const register = (value, overrides) => w.call("PUT", "/v1/me", { token: value, env: overrides });
  check("Token gilt", (await register(token)).status, 200);
  const [payload, tag] = token.slice(3).split(".");
  check("Token verändert (Prüfwert)", errorOf(await register(`v2.${payload}.${corrupt(tag)}`)), "unauthorized");
  check("Token verändert (Nutzlast)", errorOf(await register(`v2.${corrupt(payload)}.${tag}`)), "unauthorized");
  check("Token mit anderem TOKEN_KEY", (await register(token, { TOKEN_KEY: "anderer-schluessel" })).status, 401);
  const challenge = (await w.call("POST", "/v2/auth/challenge", { body: { peerId: alex.identity.peerId } })).json.challenge;
  check("Herausforderung ist kein Token", (await register(`v2.${challenge}`)).status, 401);
  check("a token with the old v1. prefix", errorOf(await register(`v1.${payload}.${tag}`)), "unauthorized");
  check("ohne Authorization", (await w.call("PUT", "/v1/me")).json, { error: "unauthorized" });
  check("falsches Schema", (await w.call("PUT", "/v1/me", { headers: { authorization: `Basic ${token}` } })).status, 401);
  check("Token ohne Version", (await w.call("PUT", "/v1/me", { headers: { authorization: `Bearer ${token.slice(3)}` } })).status, 401);

  w.advance(6 * 3600 - 1);
  check("Token eine Sekunde vor Ablauf", (await register(token)).status, 200);
  w.advance(1);
  check("Token abgelaufen", errorOf(await register(token)), "unauthorized");
}

async function registry() {
  const w = await createWorld();
  const alex = await w.newAccount("Alex");
  const token = await w.tokenOf(alex);
  const registered = await w.call("PUT", "/v1/me", { token, body: "{}" });
  check("Registrieren", [registered.status, registered.json], [200, { findable: true, refreshedAt: START }]);
  check("gespeichert wird nur UUID und Zeit", w.db.raw.prepare("SELECT * FROM users").all().map((row) => ({ ...row })), [{ uuid: alex.uuid, created_at: START, refreshed_at: START }]);
  w.advance(100);
  const refreshed = await w.call("PUT", "/v1/me", { token });
  check("Auffrischen", [refreshed.json.refreshedAt, w.count("users"), w.count("users", `created_at = ${START} AND refreshed_at = ${START + 100}`)], [START + 100, 1, 1]);
  check("Registrieren mit unbrauchbarem Körper", errorOf(await w.call("PUT", "/v1/me", { token, body: "[1]" })), "invalid");

  await abandonedAccountIsUnknown(w);
  await unregisterCascades();
  await inboxIsPrivate();
  await strangersCannotDelete();
}

async function abandonedAccountIsUnknown(w) {
  const sender = await w.findable("Alex");
  const gone = await w.findable("Weg");
  await w.authed(gone, "DELETE", "/v1/me");
  const toUnregistered = await w.send(sender, gone.uuid);
  const toUnknown = await w.send(sender, "ab".repeat(16));
  check("unregistriert wie unbekannt: 404", [toUnregistered.status, toUnknown.status], [404, 404]);
  check("unregistriert wie unbekannt: gleiche Bytes", toUnregistered.text === toUnknown.text && toUnknown.text === '{"error":"notFindable"}', true);
}

async function unregisterCascades() {
  const w = await createWorld();
  const [alice, bob, carol] = [await w.findable("Alice"), await w.findable("Bob"), await w.findable("Carol")];
  await w.send(alice, bob.uuid);
  await w.send(bob, alice.uuid);
  await w.authed(bob, "PUT", `/v1/blocks/${carol.uuid}`);
  check("vor dem Löschen: Brief an Bob, Sperre", [w.count("letters", `to_uuid = '${bob.uuid}'`), w.count("blocks")], [1, 1]);
  check("Löschen: 204", (await w.authed(bob, "DELETE", "/v1/me")).status, 204);
  check(
    "Löschen entfernt Eintrag, Postfach und Sperren",
    [w.count("users", `uuid = '${bob.uuid}'`), w.count("letters", `to_uuid = '${bob.uuid}'`), w.count("blocks")],
    [0, 0, 0],
  );
  check("Briefe von Bob und das Sendeprotokoll bleiben", [w.count("letters", `from_uuid = '${bob.uuid}'`), w.count("sends")], [1, 2]);
  check("Löschen ohne Eintrag ist auch 204", (await w.authed(bob, "DELETE", "/v1/me")).status, 204);
}

async function inboxIsPrivate() {
  const w = await createWorld();
  const [alice, bob, carol] = [await w.findable("Alice"), await w.findable("Bob"), await w.findable("Carol")];
  const nobody = await w.newAccount("Niemand");
  const unregisteredBox = await w.authed(nobody, "GET", "/v1/inbox");
  check("Postfach ohne Eintrag", [unregisteredBox.status, errorOf(unregisteredBox)], [404, "notRegistered"]);
  const sent = await w.send(alice, bob.uuid);
  await w.send(alice, carol.uuid);
  const [bobsBox, carolsBox] = [(await w.authed(bob, "GET", "/v1/inbox")).json.letters, (await w.authed(carol, "GET", "/v1/inbox")).json.letters];
  check("jeder sieht nur seine Briefe", [bobsBox.map((letter) => letter.to), carolsBox.map((letter) => letter.to)], [[bob.uuid], [carol.uuid]]);
  check("der Absender bekommt dadurch keinen Brief",(await w.authed(alice, "GET", "/v1/inbox")).json.letters, []);
  check("202: Id und Ablauf", [Object.keys(sent.json), UUID_V4.test(sent.json.id), sent.json.expiresAt], [["id", "expiresAt"], true, START + LETTER_TTL]);
  await inboxOrderIsOldestFirst();
}

async function inboxOrderIsOldestFirst() {
  const w = await createWorld();
  const bob = await w.findable("Bob");
  const senders = [await w.findable("Eins"), await w.findable("Zwei"), await w.findable("Drei")];
  for (const sender of senders) {
    await w.send(sender, bob.uuid);
    w.advance(60);
  }
  const letters = (await w.authed(bob, "GET", "/v1/inbox")).json.letters;
  check("Postfach: älteste zuerst", letters.map((letter) => letter.from.uuid), senders.map((sender) => sender.uuid));
}

async function strangersCannotDelete() {
  const w = await createWorld();
  const [alice, bob, carol] = [await w.findable("Alice"), await w.findable("Bob"), await w.findable("Carol")];
  const { id } = (await w.send(alice, bob.uuid)).json;
  const attempts = [
    ["Fremde zieht zurück", carol, `/v1/outbox/${id}`],
    ["Fremde antwortet", carol, `/v1/inbox/${id}`],
    ["Empfänger zieht zurück", bob, `/v1/outbox/${id}`],
    ["Absender antwortet", alice, `/v1/inbox/${id}`],
    ["unbekannte Id", alice, "/v1/outbox/00000000-0000-4000-8000-000000000000"],
  ];
  for (const [label, who, path] of attempts) {
    const response = await w.authed(who, "DELETE", path);
    check(label, [response.status, w.count("letters")], [204, 1]);
  }
  check("Absender zieht zurück", [(await w.authed(alice, "DELETE", `/v1/outbox/${id}`)).status, w.count("letters")], [204, 0]);
  const second = (await w.send(await w.findable("Dora"), bob.uuid)).json.id;
  check("Empfänger antwortet", [(await w.authed(bob, "DELETE", `/v1/inbox/${second}`)).status, w.count("letters")], [204, 0]);
}

async function letterStamp() {
  const w = await createWorld();
  const [alex, bob] = [await w.findable("Alex"), await w.findable("Bob")];
  const sent = await w.signedLetter(alex, bob.uuid, { displayName: "Alex ✨" });
  const accepted = await w.call("POST", "/v1/outbox", { token: await w.tokenOf(alex), body: sent });
  const [letter] = (await w.authed(bob, "GET", "/v1/inbox")).json.letters;
  const stamp = { uuid: alex.uuid, peerId: alex.identity.peerId };
  check("Brief im Postfach: Felder wie N 4", Object.keys(letter).sort(), ["createdAt", "displayName", "expiresAt", "from", "helloId", "id", "nonce", "relayIndex", "secret", "signature", "to"]);
  check("the stamp is the token's uuid and peer id, no name", letter.from, stamp);
  const columns = w.db.raw.prepare("PRAGMA table_info(letters)").all().map((column) => column.name);
  check("after all migrations letters has no from_name column", columns.includes("from_name"), false);
  check("Inhalt des Briefs unverändert", omit(letter, ["id", "from", "expiresAt"]), sent);
  check("Id und Ablauf wie in der 202-Antwort", [letter.id, letter.expiresAt], [accepted.json.id, sent.createdAt + LETTER_TTL]);
  const parts = letterParts(letter.from.uuid, letter);
  check("Empfänger kann die Signatur mit dem gestempelten Schlüssel prüfen", await verifySignature(letter.from.peerId, "pumpkin/name-request/1", parts, letter.signature), true);
}

async function letterValidation() {
  const w = await createWorld();
  const [alex, bob] = [await w.findable("Alex"), await w.findable("Bob")];
  const token = await w.tokenOf(alex);
  const post = (body) => w.call("POST", "/v1/outbox", { token, body });
  const base = await w.signedLetter(alex, bob.uuid);
  const withField = (field, value) => ({ ...base, [field]: value });
    const invalid = {
    "Zusatzfeld": { ...base, extra: 1 },
    "ohne Anzeigenamen": omit(base, ["displayName"]),
    "ohne Signatur": omit(base, ["signature"]),
    "leerer Anzeigename": withField("displayName", ""),
    "Anzeigename mit 65 Zeichen": withField("displayName", "a".repeat(65)),
    "Anzeigename mit Steuerzeichen": withField("displayName", "Al\nex"),
    "Anzeigename keine Zeichenkette": withField("displayName", 5),
    "relayIndex 256": withField("relayIndex", 256),
    "relayIndex negativ": withField("relayIndex", -1),
    "relayIndex gebrochen": withField("relayIndex", 1.5),
    "to in Großbuchstaben": withField("to", base.to.toUpperCase()),
    "to zu kurz": withField("to", "ab".repeat(15)),
    "helloId zu kurz": withField("helloId", "ab".repeat(31)),
    "nonce zu lang": withField("nonce", "ab".repeat(17)),
    "secret mit 17 Zeichen": withField("secret", "a".repeat(17)),
    "createdAt als Text": withField("createdAt", String(START)),
    "Signatur zu kurz": withField("signature", "ab".repeat(63)),
  };
  for (const [label, body] of Object.entries(invalid)) check(`Brief ${label}`, errorOf(await post(body)), "invalid");
  for (const body of ["[]", "null", "{", ""]) check(`Brief-Körper ${JSON.stringify(body)}`, errorOf(await post(body)), "invalid");
  check("nichts gespeichert, nichts protokolliert", [w.count("letters"), w.count("sends")], [0, 0]);

  const emoji = (count) => "😀".repeat(count);
  const sender = await w.findable("Grenze");
  check("Anzeigename mit 64 UTF-16-Einheiten", (await w.send(sender, bob.uuid, { displayName: emoji(32) })).status, 202);
  const sender2 = await w.findable("Grenze2");
  check("Anzeigename mit 66 UTF-16-Einheiten", errorOf(await w.send(sender2, bob.uuid, { displayName: emoji(33) })), "invalid");
}

async function letterChecks() {
  const w = await createWorld();
  const [alex, bob, carol] = [await w.findable("Alex"), await w.findable("Bob"), await w.findable("Carol")];
  check("an sich selbst", errorOf(await w.send(alex, alex.uuid)), "self");
  for (const skew of [601, -601]) check(`Uhr ${skew} s daneben`, errorOf(await w.send(alex, bob.uuid, { createdAt: START + skew })), "clock");
  check("Uhr 600 s vor", (await w.send(alex, bob.uuid, { createdAt: START + 600 })).status, 202);
  check("Uhr 600 s nach", (await w.send(alex, carol.uuid, { createdAt: START - 600 })).status, 202);

  const dave = await w.findable("Dave");
  const forged = await w.signedLetter(alex, bob.uuid, { signature: "00".repeat(64) });
  check("falsche Signatur", errorOf(await w.call("POST", "/v1/outbox", { token: await w.tokenOf(dave), body: forged })), "badSignature");
  const forStranger = await w.signedLetter(dave, bob.uuid);
  check("Signatur für einen anderen Empfänger", errorOf(await w.call("POST", "/v1/outbox", { token: await w.tokenOf(dave), body: { ...forStranger, to: carol.uuid } })), "badSignature");
  const bySomeoneElse = await w.signedLetter(carol, bob.uuid);
  check("Signatur eines anderen Schlüssels", errorOf(await w.call("POST", "/v1/outbox", { token: await w.tokenOf(dave), body: bySomeoneElse })), "badSignature");
  check("abgelehnte Briefe hinterlassen nichts", [w.count("letters", `from_uuid = '${dave.uuid}'`), w.count("sends", `from_uuid = '${dave.uuid}'`)], [0, 0]);
}

async function goldenVectors() {
  const identity = await seededIdentity();
  check("Peer-ID des Schlüssels aus Anhang A", identity.peerId, "2543b92ff1095511476adc8369db6ddc933665a11978dda1404ee1066ca9559d");

  const letter = {
    to: "069a79f444e94726a5befca90e38aaf5",
    nonce: toHex(Uint8Array.from({ length: 16 }, (_, i) => i)),
    helloId: toHex(Uint8Array.from({ length: 32 }, (_, i) => 0x20 + i)),
    relayIndex: 0,
    secret: toHex(Uint8Array.from({ length: 9 }, (_, i) => 0xa0 + i)),
    displayName: "Alex",
    createdAt: 1790000000,
  };
  const from = "853c80ef3c3749fdaa49938b674adae6";
  const letterVector =
    "da54bc072f53090eff8de51d3bed6931509fa27d41e4e0cc9d8e80930eba82ce2354b99e3afadbfcb8e61d5ee3aa3a8aebb6b95ce20d4638111f9f5a09ae3c03";
  check("A.1 Brief: Signatur reproduziert", await identity.sign("pumpkin/name-request/1", letterParts(from, letter)), letterVector);
  check("A.1 Brief: Worker prüft die Signatur", await verifySignature(identity.peerId, "pumpkin/name-request/1", letterParts(from, letter), letterVector), true);
  check("A.1 Brief: veränderter Anzeigename fällt durch", await verifySignature(identity.peerId, "pumpkin/name-request/1", letterParts(from, { ...letter, displayName: "Alexa" }), letterVector), false);

  await vectorThroughWorker(identity, letter, from, letterVector);
  await certificateVectors(identity);
}

/** A.2, A.5 and A.6 of BYNAME-ATTEST section 2, with the directory host bound into L1 and L2 (test/cert-vectors.json). */
async function certificateVectors(identity) {
  const { inputs, vectors } = CERT_VECTORS;
  const { host, serverId, peerId, uuid, expiresAtMs } = inputs;
  const parts = await loginParts(host, serverId, peerId, uuid);
  const l1 = concat([utf8(AUTH_DOMAIN), ...parts]);
  const l2 = concat([utf8(CERT_DOMAIN), ...parts]);
  const l3 = mojangPayload(uuid, expiresAtMs, RSA_KEYS.certificate.spki);
  const sha = (algorithm, bytes) => createHash(algorithm).update(bytes).digest("hex");
  const verifies = async (spki, hash, signature, data) => {
    const key = await crypto.subtle.importKey("spki", Buffer.from(spki, "base64"), { name: "RSASSA-PKCS1-v1_5", hash }, false, ["verify"]);
    return crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, Buffer.from(signature, "base64"), data);
  };

  check("vector inputs: peer id of the seeded key, host tag", [identity.peerId, toHex(parts[0])], [peerId, inputs.hostTag]);
  check("A.2 L1: 128 bytes, as recorded", [l1.length, toHex(l1)], [vectors["A.2"].length, vectors["A.2"].message]);
  check("A.2 L1: Ed25519 signature reproduced", await identity.sign(AUTH_DOMAIN, parts), vectors["A.2"].signature);
  check("A.2 L1: the Worker verifies it", await verifySignature(peerId, AUTH_DOMAIN, parts, vectors["A.2"].signature), true);
  check("A.5 L2: 128 bytes and SHA-256, as recorded", [l2.length, toHex(l2), sha("sha256", l2)], [vectors["A.5"].length, vectors["A.5"].message, vectors["A.5"].sha256]);
  check("A.5 L2: PKCS#1 v1.5 signature reproduced", rsaSignature("sha256", l2, RSA_KEYS.certificate), vectors["A.5"].signature);
  check("A.5 L2: WebCrypto verifies it with the certificate key", await verifies(RSA_KEYS.certificate.spki, "SHA-256", vectors["A.5"].signature, l2), true);
  check("A.6 L3: 318 bytes and SHA-1, as recorded", [l3.length, sha("sha1", l3)], [vectors["A.6"].length, vectors["A.6"].sha1]);
  check("A.6 L3: Mojang-style signature reproduced", rsaSignature("sha1", l3, RSA_KEYS.mojangA), vectors["A.6"].signature);
  check("A.6 L3: WebCrypto SHA-1 verifies it with fakeMojang", await verifies(CERT_VECTORS.fakeMojang.spki, "SHA-1", vectors["A.6"].signature, l3), true);
  await certificateVectorThroughWorker(uuid, expiresAtMs, vectors["A.6"].signature);
}

/** The A.6 certificate opens a session: the vector layouts are the ones the route checks. */
async function certificateVectorThroughWorker(uuid, expiresAt, mojangSignature) {
  const w = await createWorld();
  const account = await w.newAccount("Vektor", uuid);
  const certificate = { key: RSA_KEYS.certificate, wire: { publicKey: RSA_KEYS.certificate.spki, expiresAt, mojangSignature } };
  check("A.6 certificate opens a session", (await w.handshake(account, { certificate })).json?.uuid, uuid);
}

/** Der Brief aus A.1 geht unverändert durch die Route: Sein Absender ist der aus dem Token, seine Signatur ist die des Vektors. */
async function vectorThroughWorker(identity, letter, from, signature) {
  const w = await createWorld();
  const alex = { ...(await w.newAccount("Alex", from)), identity };
  const bob = await w.findable("Bob", letter.to);
  const accepted = await w.call("POST", "/v1/outbox", { token: await w.tokenOf(alex), body: { ...letter, signature } });
  const [stored] = (await w.authed(bob, "GET", "/v1/inbox")).json.letters;
  check("A.1 Brief geht durch die Route", [accepted.status, stored.signature, stored.from.uuid], [202, signature, from]);
}

async function abuse() {
  await blockedSendLooksDelivered();
  await pairCooldown();
  await dailyQuota();
  await probesCostQuota();
  await recipientFull();
  await blockList();
}

async function blockedSendLooksDelivered() {
  const w = await createWorld();
  const [alice, bob, carol] = [await w.findable("Alice"), await w.findable("Bob"), await w.findable("Carol")];
  check("Sperren: 204", (await w.authed(bob, "PUT", `/v1/blocks/${alice.uuid}`)).status, 204);
  await w.tokenOf(alice);
  const measured = async (recipient) => {
    const before = { ...w.db.stats };
    const response = await w.send(alice, recipient.uuid);
    return { response, statements: w.db.stats.statements - before.statements, roundTrips: w.db.stats.roundTrips - before.roundTrips };
  };
  const real = await measured(carol);
  const blocked = await measured(bob);
  const shape = ({ response }) => [response.status, Object.keys(response.json), response.headers.get("content-type"), UUID_V4.test(response.json.id), response.json.expiresAt];
  check("gesperrter Brief: gleiche Antwort wie eine Zustellung", shape(blocked), shape(real));
  check("gesperrter Brief: gleiche D1-Anweisungen und Rundläufe", [blocked.statements, blocked.roundTrips], [real.statements, real.roundTrips]);
  check("gesperrter Brief: Postfach bleibt leer", (await w.authed(bob, "GET", "/v1/inbox")).json.letters, []);
  check("gesperrter Brief: eigene Kennung, nichts abgelegt", [blocked.response.json.id !== real.response.json.id, w.count("letters", `to_uuid = '${bob.uuid}'`)], [true, 0]);
  check(
    "gesperrt oder nicht: erneutes Senden hat dieselbe Wartezeit",
    [errorOf(await w.send(alice, bob.uuid)), errorOf(await w.send(alice, carol.uuid))],
    ["pairCooldown", "pairCooldown"],
  );
  await w.authed(bob, "DELETE", `/v1/blocks/${alice.uuid}`);
  w.advance(WEEK + 1);
  check("nach Entsperren und Wartezeit kommt der Brief an", [(await w.send(alice, bob.uuid)).status, w.count("letters", `to_uuid = '${bob.uuid}'`)], [202, 1]);
}

async function pairCooldown() {
  const w = await createWorld();
  const [alice, bob] = [await w.findable("Alice"), await w.findable("Bob")];
  const { id } = (await w.send(alice, bob.uuid)).json;
  await w.authed(alice, "DELETE", `/v1/outbox/${id}`);
  check("Wartezeit gilt auch nach dem Zurückziehen", errorOf(await w.send(alice, bob.uuid)), "pairCooldown");
  w.advance(WEEK - 1);
  check("eine Sekunde vor Ende der Wartezeit", errorOf(await w.send(alice, bob.uuid)), "pairCooldown");
  w.advance(1);
  check("nach 7 Tagen geht es wieder", (await w.send(alice, bob.uuid)).status, 202);
  w.advance(WEEK);
  const replaced = (await w.send(alice, bob.uuid)).json.id;
  const letters = (await w.authed(bob, "GET", "/v1/inbox")).json.letters;
  check("neuer Brief ersetzt den alten (ein Brief je Paar)", [letters.length, letters[0].id], [1, replaced]);
}

async function dailyQuota() {
  const w = await createWorld();
  const alice = await w.findable("Alice");
  const recipients = [];
  for (let i = 0; i < 11; i += 1) recipients.push(await w.findable(`Empfaenger${i}`));
  for (const recipient of recipients.slice(0, 10)) await w.send(alice, recipient.uuid);
  check("10 Briefe in 24 Stunden sind erlaubt", w.count("letters"), 10);
  check("der 11. Brief", errorOf(await w.send(alice, recipients[10].uuid)), "sendQuota");
  check("Kontingent geht vor Auffindbarkeit (verrät nur den Absender)", errorOf(await w.send(alice, "cd".repeat(16))), "sendQuota");
  w.advance(DAY);
  check("nach 24 Stunden wieder frei", (await w.send(alice, recipients[10].uuid)).status, 202);
}

async function probesCostQuota() {
  const w = await createWorld();
  const alice = await w.findable("Alice");
  for (let i = 1; i <= 10; i += 1) await w.send(alice, String(i).padStart(2, "0").repeat(16));
  check("Fehlversuche zählen: Protokoll mit '-'", w.count("sends", "to_uuid = '-'"), 10);
  const bob = await w.findable("Bob");
  check("10 Fehlversuche verbrauchen das Tageskontingent", errorOf(await w.send(alice, bob.uuid)), "sendQuota");

  const dave = await w.findable("Dave");
  const laterFindable = "ee".repeat(16);
  check("noch unbekannter Empfänger", errorOf(await w.send(dave, laterFindable)), "notFindable");
  await w.findable("Spaeter", laterFindable);
  check("Fehlversuch startet keine Wartezeit", (await w.send(dave, laterFindable)).status, 202);
}

async function recipientFull() {
  const w = await createWorld();
  const bob = await w.findable("Bob");
  const senders = [];
  for (let i = 0; i < 21; i += 1) senders.push(await w.findable(`Absender${i}`));
  for (const sender of senders.slice(0, 20)) await w.send(sender, bob.uuid);
  const refused = await w.send(senders[20], bob.uuid);
  check("21. Brief", [refused.status, errorOf(refused)], [409, "recipientFull"]);
  check("Ablehnung wegen vollem Postfach wird nicht protokolliert", w.count("sends", `from_uuid = '${senders[20].uuid}'`), 0);
  const [oldest] = (await w.authed(bob, "GET", "/v1/inbox")).json.letters;
  await w.authed(bob, "DELETE", `/v1/inbox/${oldest.id}`);
  check("nach einer Antwort ist wieder Platz", (await w.send(senders[20], bob.uuid)).status, 202);

  w.advance(WEEK + 1);
  check("ein erneuter Brief ersetzt seinen alten, auch bei vollem Postfach", [(await w.send(senders[1], bob.uuid)).status, w.count("letters", `to_uuid = '${bob.uuid}'`)], [202, 20]);
  w.advance(LETTER_TTL);
  check("abgelaufene Briefe sind nicht mehr im Postfach", (await w.authed(bob, "GET", "/v1/inbox")).json.letters, []);
  check("abgelaufene Briefe füllen das Postfach nicht", (await w.send(senders[0], bob.uuid)).status, 202);
}

async function blockList() {
  const w = await createWorld();
  const [alice, bob] = [await w.findable("Alice"), await w.findable("Bob")];
  const stranger = await w.newAccount("Fremd");
  check("Sperren ohne Eintrag", [(await w.authed(stranger, "PUT", `/v1/blocks/${alice.uuid}`)).status, errorOf(await w.authed(stranger, "PUT", `/v1/blocks/${alice.uuid}`))], [404, "notRegistered"]);

  const carol = await w.findable("Carol");
  await w.send(alice, bob.uuid);
  await w.send(carol, bob.uuid);
  await w.authed(bob, "PUT", `/v1/blocks/${alice.uuid}`);
  const remaining = (await w.authed(bob, "GET", "/v1/inbox")).json.letters.map((letter) => letter.from.uuid);
  check("Sperren löscht wartende Briefe dieser UUID", remaining, [carol.uuid]);
  check("Sperren ist wiederholbar", [(await w.authed(bob, "PUT", `/v1/blocks/${alice.uuid}`)).status, w.count("blocks")], [204, 1]);

  const insert = w.db.raw.prepare("INSERT INTO blocks (owner_uuid, blocked_uuid, created_at) VALUES (?, ?, ?)");
  for (let i = 1; i < 1000; i += 1) insert.run(bob.uuid, i.toString(16).padStart(32, "0"), START);
  const overflow = await w.authed(bob, "PUT", `/v1/blocks/${"ff".repeat(16)}`);
  check("1001. Sperre", [overflow.status, errorOf(overflow)], [409, "blockListFull"]);
  check("bestehende Sperre bei voller Liste", (await w.authed(bob, "PUT", `/v1/blocks/${alice.uuid}`)).status, 204);
  check("Entsperren", [(await w.authed(bob, "DELETE", `/v1/blocks/${alice.uuid}`)).status, w.count("blocks")], [204, 999]);
  check("Entsperren ohne Sperre", (await w.authed(bob, "DELETE", `/v1/blocks/${"ee".repeat(16)}`)).status, 204);
}

async function rateLimits() {
  const w = await createWorld();
  const alex = await w.newAccount("Alex");
  const peerId = alex.identity.peerId;
  await w.call("POST", "/v2/auth/challenge", { body: { peerId }, headers: { "cf-connecting-ip": "203.0.113.7" } });
  await w.call("POST", "/v2/auth/challenge", { body: { peerId } });
  check("IP-Begrenzung: Schlüssel ist die IP, ohne IP ein gemeinsamer Eimer", w.limits.ip.join(","), "203.0.113.7,unbekannt");
  check("offene Routen berühren die Konto-Begrenzung nicht", w.limits.account, []);

  const token = await w.tokenOf(alex);
  w.limits.ip.length = 0;
  await w.call("PUT", "/v1/me", { token, headers: { "cf-connecting-ip": "203.0.113.8" } });
  check("Konto-Begrenzung: Schlüssel ist die UUID", [w.limits.ip, w.limits.account], [["203.0.113.8"], [alex.uuid]]);
  await w.call("PUT", "/v1/me", { token: `v2.${corrupt(token.slice(3))}` });
  check("ungültiges Token erreicht die Konto-Begrenzung nicht", w.limits.account.length, 1);

  const known = [["POST", "/v2/auth/challenge"], ["PUT", "/v1/me"], ["GET", "/v1/inbox"], ["POST", "/v1/outbox"], ["PUT", `/v1/blocks/${"ab".repeat(16)}`]];
  w.limits.ipBlocked = true;
  for (const [method, path] of known) {
    const response = await w.call(method, path, { token, body: method === "GET" ? undefined : "{}" });
    check(`IP-Grenze: ${method} ${path}`, [response.status, errorOf(response), response.headers.get("retry-after")], [429, "rateLimited", "60"]);
  }
  const oversize = await w.call("POST", "/v2/auth/challenge", { body: "x".repeat(3000) });
  check("IP-Grenze kommt vor der Größenprüfung", oversize.status, 429);
  const unauthorized = await w.call("PUT", "/v1/me");
  check("IP-Grenze kommt vor der Anmeldeprüfung", unauthorized.status, 429);
  w.limits.ipBlocked = false;
  w.limits.accountBlocked = true;
  const accountLimited = await w.call("PUT", "/v1/me", { token });
  check("Konto-Grenze", [accountLimited.status, errorOf(accountLimited), accountLimited.headers.get("retry-after")], [429, "rateLimited", "60"]);
  check("Konto-Grenze gilt erst nach der Anmeldeprüfung", (await w.call("PUT", "/v1/me")).status, 401);
  w.limits.accountBlocked = false;
}

async function cleanup() {
  await cleanupLettersAndSends();
  await cleanupStaleUsers();
  await cleanupInBatches();
}

async function cleanupLettersAndSends() {
  const w = await createWorld();
  const [alice, bob] = [await w.findable("Alice"), await w.findable("Bob")];
  await w.send(alice, bob.uuid);
  await w.runCron();
  check("Aufräumen: frische Daten bleiben", [w.count("letters"), w.count("sends"), w.count("users")], [1, 1, 2]);
  w.advance(WEEK);
  await w.runCron();
  check("Aufräumen: Sendeprotokoll älter als 7 Tage fällt weg, Brief bleibt", [w.count("sends"), w.count("letters")], [0, 1]);
  w.advance(LETTER_TTL - WEEK);
  await w.runCron();
  check("Aufräumen: abgelaufener Brief fällt weg, Einträge bleiben", [w.count("letters"), w.count("users")], [0, 2]);
}

async function cleanupStaleUsers() {
  const w = await createWorld();
  const [alice, dave, erin] = [await w.findable("Alice"), await w.findable("Dave"), await w.findable("Erin")];
  await w.authed(dave, "PUT", `/v1/blocks/${alice.uuid}`);
  w.advance(18 * DAY);
  await w.send(alice, dave.uuid);
  w.advance(2 * DAY);
  await w.authed(erin, "PUT", "/v1/me");
  w.advance(11 * DAY);
  await w.runCron();
  check(
    "Aufräumen: Eintrag ohne Auffrischung seit 30 Tagen fällt samt Postfach und Sperren weg",
    [w.count("users", `uuid = '${dave.uuid}'`), w.count("letters", `to_uuid = '${dave.uuid}'`), w.count("blocks")],
    [0, 0, 0],
  );
  check("Aufräumen: aufgefrischter Eintrag bleibt", w.count("users", `uuid = '${erin.uuid}'`), 1);
  check("Aufräumen: Alice (nicht aufgefrischt) fällt ebenfalls weg", w.count("users", `uuid = '${alice.uuid}'`), 0);
}

async function cleanupInBatches() {
  const w = await createWorld();
  const letters = w.db.raw.prepare("INSERT INTO letters VALUES (?, ?, ?, 'p', '{}', ?, ?)");
  const users = w.db.raw.prepare("INSERT INTO users VALUES (?, ?, ?)");
  w.db.raw.exec("BEGIN");
  for (let i = 0; i < 5001; i += 1) {
    letters.run(`id${i}`, "to", `from${i}`, START - 2 * LETTER_TTL, START - LETTER_TTL);
    users.run(`user${i}`, START - 60 * DAY, START - 60 * DAY);
  }
  w.db.raw.exec("COMMIT");
  await w.runCron();
  check("Aufräumen: höchstens 5000 je Lauf", [w.count("letters"), w.count("users")], [1, 1]);
  await w.runCron();
  check("Aufräumen: der nächste Lauf räumt den Rest", [w.count("letters"), w.count("users")], [0, 0]);
}

async function failureHandling() {
  const w = await createWorld();
  const alex = await w.newAccount("Alex");
  const token = await w.tokenOf(alex);
  const brokenDb = { prepare: () => { throw new Error("D1 nicht erreichbar"); }, batch: async () => { throw new Error("D1 nicht erreichbar"); } };
  const response = await w.call("PUT", "/v1/me", { token, env: { DB: brokenDb } });
  check("Datenbankfehler: Fehlercode statt Absturz", [response.status, response.json], [500, { error: "internal" }]);
  check("Antworten sind JSON", response.headers.get("content-type"), "application/json; charset=utf-8");
}

/** BYNAME-ATTEST 3.1: the pinned list is Mojang's saved answer, every key imports, and `update` would write the same file. */
async function pinnedKeys() {
  const snapshot = process.env.MOJANG_PUBLICKEYS ?? new URL("./test/mojang-publickeys.json", import.meta.url);
  const saved = certificateKeysOf(JSON.parse(readFileSync(snapshot, "utf8")));
  check(`pinned keys equal playerCertificateKeys of ${snapshot}, in order`, PLAYER_CERTIFICATE_KEYS, saved);
  check("the pinned list is frozen", Object.isFrozen(PLAYER_CERTIFICATE_KEYS), true);
  for (const [index, key] of PLAYER_CERTIFICATE_KEYS.entries()) {
    const der = Buffer.from(key, "base64");
    const imports = await crypto.subtle.importKey("spki", der, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-1" }, false, ["verify"]).then(() => true, () => false);
    check(`pinned key #${index} imports as RSASSA-PKCS1-v1_5/SHA-1 (sha256 ${createHash("sha256").update(der).digest("hex")})`, imports, true);
  }
  const source = readFileSync(new URL("./src/mojang-keys.js", import.meta.url), "utf8");
  const fetchedOn = /fetched (\d{4}-\d{2}-\d{2})/.exec(source)?.[1];
  check("scripts/mojang-keys.mjs update would write src/mojang-keys.js unchanged", renderModule(saved, fetchedOn), source);
}

// productionKeysByDefault must run first: every createWorld pins the test keys for the rest of the run.
const SECTIONS = [productionKeysByDefault, pinnedKeys, routing, bodyLimits, failsClosed, challenges, sessions, tokens, registry, letterStamp, letterValidation, letterChecks, goldenVectors, abuse, rateLimits, cleanup, failureHandling];
for (const section of SECTIONS) await section();
check("keine console-Aufrufe des Workers", consoleCalls, []);
check("the Worker made no subrequest in the whole run", subrequests, []);
if (failures > 0) {
  console.log(`${failures} Fälle fehlgeschlagen`);
  process.exit(1);
}
