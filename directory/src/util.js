// Bausteine des Verzeichnis-Workers: JSON-Antworten, Formatprüfungen und die Krypto-Helfer (HMAC, Ed25519).
const encoder = new TextEncoder();
const decoder = new TextDecoder();

export const json = (body, status, headers = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json; charset=utf-8", ...headers } });

/** Fehler sind immer `{"error":"<Code>"}`; der Launcher übersetzt den Code und zeigt nie Worker-Text. */
export const fail = (code, status, headers) => json({ error: code }, status, headers);

export const noContent = () => new Response(null, { status: 204 });

/** Unix-Sekunden; `env.NOW` gibt es nur in den Tests, damit sie die Uhr vorstellen können. */
export const nowSeconds = (env) => env.NOW ?? Math.floor(Date.now() / 1000);

export const utf8 = (text) => encoder.encode(text);

export function concat(chunks) {
  const joined = new Uint8Array(chunks.reduce((total, chunk) => total + chunk.length, 0));
  let offset = 0;
  for (const chunk of chunks) {
    joined.set(chunk, offset);
    offset += chunk.length;
  }
  return joined;
}

export const toHex = (bytes) => Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
export const fromHex = (hex) => Uint8Array.from(hex.match(/../g) ?? [], (pair) => parseInt(pair, 16));
export const randomHex = (bytes) => toHex(crypto.getRandomValues(new Uint8Array(bytes)));

/** Genau `bytes` Bytes als kleingeschriebenes Hex: so sind UUIDs, Peer-IDs, Nonces, Geheimnisse und Signaturen geformt. */
export const isHex = (value, bytes) => typeof value === "string" && value.length === bytes * 2 && /^[0-9a-f]*$/.test(value);

/** A non-negative safe integer as 8 bytes, big-endian (Java `long`). */
export function bigEndian64(value) {
  const bytes = new Uint8Array(8);
  new DataView(bytes.buffer).setBigUint64(0, BigInt(value));
  return bytes;
}

const STANDARD_BASE64 = /^[A-Za-z0-9+/]*={0,2}$/;
const base64Length = (bytes) => 4 * Math.ceil(bytes / 3);

/** The bytes of standard, padded base64 (RFC 4648 section 4) when they are 1 to `maxBytes` long, otherwise null. */
export function fromBase64(text, maxBytes) {
  const wellFormed = typeof text === "string" && text.length % 4 === 0 && text.length <= base64Length(maxBytes) && STANDARD_BASE64.test(text);
  const bytes = wellFormed ? decodeBase64(text) : null;
  return bytes && bytes.length >= 1 && bytes.length <= maxBytes ? bytes : null;
}

function decodeBase64(text) {
  try {
    return Uint8Array.from(atob(text), (char) => char.charCodeAt(0));
  } catch {
    return null;
  }
}

const DER_INTEGER = 0x02;
const DER_BIT_STRING = 0x03;
const DER_SEQUENCE = 0x30;
// SEQUENCE { OBJECT IDENTIFIER rsaEncryption (1.2.840.113549.1.1.1), NULL }
const RSA_ENCRYPTION = fromHex("300d06092a864886f70d0101010500");

class NotRsaKey extends Error {}

/**
 * The modulus size in bits of a DER SubjectPublicKeyInfo holding an rsaEncryption key, 0 for anything else
 * (another algorithm, non-minimal lengths, trailing bytes, a negative or zero integer).
 */
export function rsaModulusBits(spki) {
  try {
    return readRsaModulusBits(spki);
  } catch (error) {
    if (error instanceof NotRsaKey) return 0;
    throw error;
  }
}

function readRsaModulusBits(spki) {
  const info = derElement(spki, 0, DER_SEQUENCE, spki.length);
  const algorithmEnd = info.start + RSA_ENCRYPTION.length;
  if (!sameBytes(spki.subarray(info.start, algorithmEnd), RSA_ENCRYPTION)) throw new NotRsaKey();
  const bitString = derElement(spki, algorithmEnd, DER_BIT_STRING, info.end);
  if (spki[bitString.start] !== 0) throw new NotRsaKey();
  const key = derElement(spki, bitString.start + 1, DER_SEQUENCE, bitString.end);
  const modulus = positiveInteger(spki, key.start);
  positiveInteger(spki, modulus.end, key.end);
  return bitLength(spki.subarray(modulus.start, modulus.end));
}

/** The element at `offset` with `tag` that ends exactly at `end` (or anywhere when `end` is omitted). */
function derElement(bytes, offset, tag, end) {
  if (bytes[offset] !== tag || offset + 2 > bytes.length) throw new NotRsaKey();
  const { start, length } = derLength(bytes, offset + 1);
  if (start + length > bytes.length || (end !== undefined && start + length !== end)) throw new NotRsaKey();
  return { start, end: start + length };
}

/** A DER length in its shortest form (at most two length bytes; an SPKI here is far smaller than 64 KiB). */
function derLength(bytes, offset) {
  const first = bytes[offset];
  if (first < 0x80) return { start: offset + 1, length: first };
  const count = first & 0x7f;
  if (count < 1 || count > 2 || offset + 1 + count > bytes.length) throw new NotRsaKey();
  const length = bytes.subarray(offset + 1, offset + 1 + count).reduce((total, byte) => total * 256 + byte, 0);
  if (length < 0x80 || (count === 2 && length < 0x100)) throw new NotRsaKey();
  return { start: offset + 1 + count, length };
}

/** A minimal DER INTEGER greater than zero. */
function positiveInteger(bytes, offset, end) {
  const integer = derElement(bytes, offset, DER_INTEGER, end);
  const [first, second] = bytes.subarray(integer.start, integer.end);
  const negative = first >= 0x80;
  const padded = first === 0 && (second === undefined || second < 0x80);
  if (first === undefined || negative || padded) throw new NotRsaKey();
  return integer;
}

function bitLength(unsigned) {
  const digits = unsigned[0] === 0 ? unsigned.subarray(1) : unsigned;
  return (digits.length - 1) * 8 + (32 - Math.clz32(digits[0]));
}

const sameBytes = (left, right) => left.length === right.length && left.every((byte, index) => byte === right[index]);

export const toBase64Url = (bytes) =>
  btoa(String.fromCharCode(...bytes)).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");

/** Die Bytes oder null, wenn der Text kein Base64url ist. */
function fromBase64Url(text) {
  try {
    return Uint8Array.from(atob(text.replaceAll("-", "+").replaceAll("_", "/")), (char) => char.charCodeAt(0));
  } catch {
    return null;
  }
}

export const isPlainObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);

/** Ein JSON-Objekt (kein Array, kein null) oder null. */
export function parseObject(text) {
  try {
    const value = JSON.parse(text);
    return isPlainObject(value) ? value : null;
  } catch {
    return null;
  }
}

export const hasExactKeys = (object, keys) => Object.keys(object).length === keys.length && keys.every((key) => Object.hasOwn(object, key));

const hmacKey = (secret) => crypto.subtle.importKey("raw", utf8(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);

/** Die Bezeichnung trennt die Verwendungen: Eine Herausforderung lässt sich so nie als Token einlösen. */
const labelled = (label, bytes) => concat([utf8(label), bytes]);

export async function mac(secret, label, bytes) {
  return new Uint8Array(await crypto.subtle.sign("HMAC", await hmacKey(secret), labelled(label, bytes)));
}

/** `<Nutzlast base64url>.<HMAC base64url>`; die Nutzlast ist lesbar, aber nicht fälschbar. */
export async function seal(secret, label, claims) {
  const payload = utf8(JSON.stringify(claims));
  return `${toBase64Url(payload)}.${toBase64Url(await mac(secret, label, payload))}`;
}

/** Die Nutzlast eines mit `seal` erzeugten Textes, oder null bei jeder Abweichung (Form, Bezeichnung, Schlüssel, Änderung). */
export async function unseal(secret, label, sealed) {
  const parts = String(sealed).split(".");
  const [payload, tag] = parts.map(fromBase64Url);
  if (parts.length !== 2 || !payload || !tag) return null;
  const genuine = await crypto.subtle.verify("HMAC", await hmacKey(secret), tag, labelled(label, payload));
  return genuine ? parseObject(decoder.decode(payload)) : null;
}

/** Ed25519 über `Domäne || Teile` (SPEC 4.1); eine ungültige Peer-ID zählt als falsche Signatur. */
export async function verifySignature(peerId, domain, parts, signature) {
  try {
    const key = await crypto.subtle.importKey("raw", fromHex(peerId), { name: "Ed25519" }, false, ["verify"]);
    return await crypto.subtle.verify({ name: "Ed25519" }, key, fromHex(signature), concat([utf8(domain), ...parts]));
  } catch {
    return false;
  }
}
