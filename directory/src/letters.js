// Briefkasten: Freundesanfragen ("Briefe") ablegen, abholen und zurückziehen (BYNAME 4, O1 bis I2).
// Ein Brief trägt den einmaligen Freundescode des Absenders; der Worker stempelt Absender-UUID, Name und Peer-ID aus dem Token dazu.
import { deleteLetterFrom, deleteLetterTo, discardBlockedLetter, logProbe, readInbox, readSendFacts, storeLetter } from "./store.js";
import { fail, fromHex, hasExactKeys, isHex, json, noContent, parseObject, utf8, verifySignature } from "./util.js";

const LETTER_DOMAIN = "pumpkin/name-request/1";
const LETTER_FIELDS = ["to", "nonce", "helloId", "relayIndex", "secret", "displayName", "createdAt", "signature"];
const REQUEST_TTL = 14 * 24 * 60 * 60;
const CLOCK_SKEW = 600;
const DAILY_LIMIT = 10;
const MAX_PENDING = 20;
const DISPLAY_NAME_MAX = 64;
const CONTROL_CHARACTERS = /\p{Cc}/u;

const bigEndian64 = (value) => {
  const bytes = new Uint8Array(8);
  new DataView(bytes.buffer).setBigUint64(0, BigInt(value));
  return bytes;
};

/** Signierte Bytes eines Briefs; alle Teile außer dem Anzeigenamen haben feste Länge, die Aneinanderreihung ist eindeutig. */
export const letterParts = (fromUuid, letter) => [
  fromHex(letter.to),
  fromHex(fromUuid),
  fromHex(letter.nonce),
  fromHex(letter.helloId),
  Uint8Array.of(letter.relayIndex),
  fromHex(letter.secret),
  bigEndian64(letter.createdAt),
  utf8(letter.displayName),
];

const validDisplayName = (name) => typeof name === "string" && name.length >= 1 && name.length <= DISPLAY_NAME_MAX && !CONTROL_CHARACTERS.test(name);

const validLetter = (letter) =>
  letter !== null &&
  hasExactKeys(letter, LETTER_FIELDS) &&
  isHex(letter.to, 16) &&
  isHex(letter.nonce, 16) &&
  isHex(letter.helloId, 32) &&
  Number.isInteger(letter.relayIndex) &&
  letter.relayIndex >= 0 &&
  letter.relayIndex <= 255 &&
  isHex(letter.secret, 9) &&
  validDisplayName(letter.displayName) &&
  Number.isSafeInteger(letter.createdAt) &&
  letter.createdAt >= 0 &&
  isHex(letter.signature, 64);

const accepted = (id, expiresAt) => json({ id, expiresAt }, 202);

/** O1. Die Reihenfolge der Prüfungen ist Absicht: Jede Ablehnung verrät höchstens etwas über den Absender selbst. */
export async function sendLetter({ env, now, text, claims }) {
  const letter = parseObject(text);
  if (!validLetter(letter)) return fail("invalid", 400);
  if (letter.to === claims.u) return fail("self", 400);
  if (Math.abs(letter.createdAt - now) > CLOCK_SKEW) return fail("clock", 400);
  if (!(await verifySignature(claims.p, LETTER_DOMAIN, letterParts(claims.u, letter), letter.signature))) return fail("badSignature", 400);

  const facts = await readSendFacts(env.DB, claims.u, letter.to, now);
  if (facts.sentToday >= DAILY_LIMIT) return fail("sendQuota", 429);
  if (facts.sentToPair > 0) return fail("pairCooldown", 429);
  if (!facts.recipientRegistered) {
    await logProbe(env.DB, claims.u, now);
    return fail("notFindable", 404);
  }

  const expiresAt = letter.createdAt + REQUEST_TTL;
  if (facts.recipientBlocksSender) {
    await discardBlockedLetter(env.DB, claims.u, letter.to, now);
    return accepted(crypto.randomUUID(), expiresAt);
  }
  if (facts.pendingForRecipient >= MAX_PENDING) return fail("recipientFull", 409);

  const id = crypto.randomUUID();
  await storeLetter(env.DB, stampedLetter(id, letter, claims, expiresAt), now);
  return accepted(id, expiresAt);
}

function stampedLetter(id, letter, claims, expiresAt) {
  const { nonce, helloId, relayIndex, secret, displayName, signature } = letter;
  return {
    id,
    to: letter.to,
    from: { uuid: claims.u, name: claims.n, peerId: claims.p },
    body: JSON.stringify({ nonce, helloId, relayIndex, secret, displayName, signature }),
    createdAt: letter.createdAt,
    expiresAt,
  };
}

const inboxLetter = (row) => ({
  id: row.id,
  from: { uuid: row.from_uuid, name: row.from_name, peerId: row.from_peer },
  to: row.to_uuid,
  ...JSON.parse(row.body),
  createdAt: row.created_at,
  expiresAt: row.expires_at,
});

/** I1 */
export async function listInbox({ env, now, claims }) {
  const rows = await readInbox(env.DB, claims.u, now);
  return rows ? json({ letters: rows.map(inboxLetter) }, 200) : fail("notRegistered", 404);
}

/** O2: Zurückziehen; wer nicht Absender ist, bewirkt nichts und erfährt es nicht. */
export async function retractLetter({ env, claims, params }) {
  await deleteLetterFrom(env.DB, params.id, claims.u);
  return noContent();
}

/** I2: Annehmen und Ablehnen sehen für den Worker gleich aus. */
export async function answerLetter({ env, claims, params }) {
  await deleteLetterTo(env.DB, params.id, claims.u);
  return noContent();
}
