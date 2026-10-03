// Account proof without calling Mojang (docs/friends/BYNAME-ATTEST.md): the launcher presents Mojang's signed player
// certificate and signs the challenge with its friends key (L1) and with the certificate key (L2). The Worker checks
// everything offline against Mojang's pinned keys. Challenge and token stay stateless (HMAC with TOKEN_KEY).
import { PLAYER_CERTIFICATE_KEYS } from "./mojang-keys.js";
import {
  bigEndian64,
  concat,
  fail,
  fromBase64,
  fromHex,
  hasExactKeys,
  isHex,
  isPlainObject,
  json,
  mac,
  parseObject,
  randomHex,
  rsaModulusBits,
  seal,
  toHex,
  unseal,
  utf8,
  verifySignature,
} from "./util.js";

const CHALLENGE_TTL = 120;
const TOKEN_TTL = 6 * 60 * 60;
const AUTH_DOMAIN = "pumpkin/directory-auth/2";
const CERT_DOMAIN = "pumpkin/directory-cert/1";
const TOKEN_PREFIX = "v2.";
const SERVER_ID_LENGTH = 40;
const HOST_TAG_BYTES = 16;
const MAX_CHALLENGE_LENGTH = 256;
const MAX_PUBLIC_KEY_BYTES = 800;
const MAX_SIGNATURE_BYTES = 1024;
const MAX_PINNED_KEY_BYTES = 2048;
const MIN_CERTIFICATE_BITS = 2048;
const MAX_CERTIFICATE_BITS = 4096;
const MILLIS_PER_SECOND = 1000;
const SESSION_FIELDS = ["challenge", "uuid", "certificate", "certSignature", "signature"];
const CERTIFICATE_FIELDS = ["publicKey", "expiresAt", "mojangSignature"];
const RSA_PKCS1 = "RSASSA-PKCS1-v1_5";

let pinnedKeys = PLAYER_CERTIFICATE_KEYS;
// One import per pinned key and isolate; a failed import is dropped, so the next request tries again.
const importedPinnedKeys = new Map();

/** Test seam: replaces Mojang's pinned keys (base64 SPKI) in this isolate. Nothing in production calls it. */
export function setPinnedKeysForTest(keys) {
  pinnedKeys = keys;
}

/**
 * The bytes L1 and L2 sign after their domain: SHA-256(host)[0..16] || serverId (40 ASCII) || peerId (32) || uuid (16).
 * `host` is the directory's hostname, so a signature made for another directory is worthless here.
 */
export async function loginParts(host, serverId, peerId, uuid) {
  const hostTag = new Uint8Array(await crypto.subtle.digest("SHA-256", utf8(host))).slice(0, HOST_TAG_BYTES);
  return [hostTag, utf8(serverId), fromHex(peerId), fromHex(uuid)];
}

async function serverIdFor(env, challenge) {
  return toHex(await mac(env.TOKEN_KEY, "server-id", utf8(challenge))).slice(0, SERVER_ID_LENGTH);
}

export async function issueChallenge({ env, now, text }) {
  const body = parseObject(text);
  if (!body || !hasExactKeys(body, ["peerId"]) || !isHex(body.peerId, 32)) return fail("invalid", 400);
  const expiresAt = now + CHALLENGE_TTL;
  const challenge = await seal(env.TOKEN_KEY, "challenge", { p: body.peerId, exp: expiresAt, r: randomHex(16) });
  return json({ challenge, serverId: await serverIdFor(env, challenge), expiresAt }, 200);
}

/** A2, in the order of BYNAME-ATTEST 3.2: cheap checks first, Mojang's signature only for a bound, unexpired proof. */
export async function openSession({ env, now, text, host }) {
  const proof = parseSessionBody(text);
  if (!proof) return fail("invalid", 400);
  const challenge = await unseal(env.TOKEN_KEY, "challenge", proof.challenge);
  if (!challenge) return fail("invalid", 400);
  if (challenge.exp <= now) return fail("challengeExpired", 400);

  const parts = await loginParts(host, await serverIdFor(env, proof.challenge), challenge.p, proof.uuid);
  if (!(await verifySignature(challenge.p, AUTH_DOMAIN, parts, proof.signature))) return fail("badSignature", 401);
  if (proof.expiresAt <= now * MILLIS_PER_SECOND) return fail("certificateExpired", 401);
  if (!(await signedByMojang(proof))) return fail("badCertificate", 401);
  const certificateKey = await importCertificateKey(proof.publicKey);
  if (!certificateKey) return fail("badCertificate", 401);
  if (!(await verifiesWith(certificateKey, proof.certSignature, concat([utf8(CERT_DOMAIN), ...parts])))) return fail("badSignature", 401);
  return json(await mintToken(env, now, proof, challenge.p), 200);
}

/** The decoded A2 body (BYNAME-ATTEST 1.2), or null when any key, encoding or bound is off. Runs before any crypto. */
function parseSessionBody(text) {
  const body = parseObject(text);
  const certificate = body?.certificate;
  if (!body || !hasExactKeys(body, SESSION_FIELDS) || !isPlainObject(certificate) || !hasExactKeys(certificate, CERTIFICATE_FIELDS)) return null;
  const proof = {
    challenge: body.challenge,
    uuid: body.uuid,
    signature: body.signature,
    expiresAt: certificate.expiresAt,
    publicKey: fromBase64(certificate.publicKey, MAX_PUBLIC_KEY_BYTES),
    mojangSignature: fromBase64(certificate.mojangSignature, MAX_SIGNATURE_BYTES),
    certSignature: fromBase64(body.certSignature, MAX_SIGNATURE_BYTES),
  };
  return isWellFormed(proof) ? proof : null;
}

const isWellFormed = (proof) =>
  typeof proof.challenge === "string" &&
  proof.challenge.length >= 1 &&
  proof.challenge.length <= MAX_CHALLENGE_LENGTH &&
  isHex(proof.uuid, 16) &&
  isHex(proof.signature, 64) &&
  Number.isSafeInteger(proof.expiresAt) &&
  proof.expiresAt > 0 &&
  proof.mojangSignature !== null &&
  proof.certSignature !== null &&
  isCertificateKey(proof.publicKey);

/**
 * Mojang signs other data with the same key (profilePropertyKeys[0], textures). Requiring a real RSA SPKI here (and a
 * safe-integer expiry) keeps such a signature from ever passing as a certificate.
 */
function isCertificateKey(spki) {
  const bits = spki ? rsaModulusBits(spki) : 0;
  return bits >= MIN_CERTIFICATE_BITS && bits <= MAX_CERTIFICATE_BITS;
}

/** L3: uuid (16) || expiresAt (int64 BE) || SPKI, SHA1withRSA by one of the pinned keys, tried in list order. */
async function signedByMojang({ uuid, expiresAt, publicKey, mojangSignature }) {
  const payload = concat([fromHex(uuid), bigEndian64(expiresAt), publicKey]);
  for (const key of pinnedKeys) {
    if (await verifiesWith(await pinnedKey(key), mojangSignature, payload)) return true;
  }
  return false;
}

/** A pinned key that does not import rejects: the request answers 500 and the self-check test fails. */
function pinnedKey(spki) {
  if (!importedPinnedKeys.has(spki)) {
    const imported = importPinnedKey(spki);
    imported.catch(() => importedPinnedKeys.delete(spki));
    importedPinnedKeys.set(spki, imported);
  }
  return importedPinnedKeys.get(spki);
}

async function importPinnedKey(spki) {
  return crypto.subtle.importKey("spki", fromBase64(spki, MAX_PINNED_KEY_BYTES), { name: RSA_PKCS1, hash: "SHA-1" }, false, ["verify"]);
}

async function importCertificateKey(spki) {
  try {
    return await crypto.subtle.importKey("spki", spki, { name: RSA_PKCS1, hash: "SHA-256" }, false, ["verify"]);
  } catch {
    return null;
  }
}

/** A signature WebCrypto refuses outright (for example one longer than the modulus) counts as wrong. */
async function verifiesWith(key, signature, data) {
  try {
    return await crypto.subtle.verify(RSA_PKCS1, key, signature, data);
  } catch {
    return false;
  }
}

/** The token never outlives the certificate that proved its UUID. */
async function mintToken(env, now, proof, peerId) {
  const expiresAt = Math.min(now + TOKEN_TTL, Math.floor(proof.expiresAt / MILLIS_PER_SECOND));
  const token = TOKEN_PREFIX + (await seal(env.TOKEN_KEY, "token", { u: proof.uuid, p: peerId, exp: expiresAt }));
  return { token, expiresAt, uuid: proof.uuid };
}

/** The claims `{u, p, exp}` of the token in the `Authorization` header; null when it is missing, expired or altered. */
export async function authenticate(request, env, now) {
  const token = /^Bearer (v2\.\S+)$/.exec(request.headers.get("authorization") ?? "")?.[1];
  if (!token) return null;
  const claims = await unseal(env.TOKEN_KEY, "token", token.slice(TOKEN_PREFIX.length));
  return claims && claims.exp > now ? claims : null;
}
