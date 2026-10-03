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

/** Ein JSON-Objekt (kein Array, kein null) oder null. */
export function parseObject(text) {
  try {
    const value = JSON.parse(text);
    return value !== null && typeof value === "object" && !Array.isArray(value) ? value : null;
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
