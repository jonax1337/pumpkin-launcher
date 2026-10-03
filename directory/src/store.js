// Alle SQL-Zugriffe auf D1. Lesen, die zusammen entscheiden, gehen als ein Batch in einem Rundlauf hin.
export const DAY = 24 * 60 * 60;
// Zugleich die Aufbewahrungszeit des Sendeprotokolls: Danach zählt eine Sendung für keine Regel mehr.
export const PAIR_COOLDOWN = 7 * DAY;
const USER_RETENTION = 30 * DAY;
// Ein Aufräumlauf bleibt unter dem CPU-Limit des Workers; was übrig bleibt, räumt der nächste Tag weg.
const PURGE_BATCH = 5000;

const statement = (db, sql, ...params) => db.prepare(sql).bind(...params);
const rowsOf = (result) => result.results;
const countOf = (result) => result.results[0].n;
const found = (result) => result.results.length > 0;

export function registerUser(db, uuid, now) {
  return statement(
    db,
    "INSERT INTO users (uuid, created_at, refreshed_at) VALUES (?, ?, ?) ON CONFLICT (uuid) DO UPDATE SET refreshed_at = excluded.refreshed_at",
    uuid,
    now,
    now,
  ).run();
}

/** Löscht den Eintrag samt Postfach und Sperrliste; Briefe an andere und das Sendeprotokoll bleiben. */
export function unregisterUser(db, uuid) {
  return db.batch([
    statement(db, "DELETE FROM users WHERE uuid = ?", uuid),
    statement(db, "DELETE FROM letters WHERE to_uuid = ?", uuid),
    statement(db, "DELETE FROM blocks WHERE owner_uuid = ?", uuid),
  ]);
}

/** Was O1 für die Entscheidung braucht, in einem Rundlauf gelesen. */
export async function readSendFacts(db, from, to, now) {
  const [sentToday, sentToPair, recipient, block, pending] = await db.batch([
    statement(db, "SELECT COUNT(*) AS n FROM sends WHERE from_uuid = ? AND at > ?", from, now - DAY),
    statement(db, "SELECT COUNT(*) AS n FROM sends WHERE from_uuid = ? AND to_uuid = ? AND at > ?", from, to, now - PAIR_COOLDOWN),
    statement(db, "SELECT 1 AS found FROM users WHERE uuid = ?", to),
    statement(db, "SELECT 1 AS found FROM blocks WHERE owner_uuid = ? AND blocked_uuid = ?", to, from),
    // Ein Brief des Absenders selbst zählt nicht mit: Ein erneuter Brief ersetzt ihn, das Postfach wächst nicht.
    statement(db, "SELECT COUNT(*) AS n FROM letters WHERE to_uuid = ? AND from_uuid != ? AND expires_at > ?", to, from, now),
  ]);
  return {
    sentToday: countOf(sentToday),
    sentToPair: countOf(sentToPair),
    recipientRegistered: found(recipient),
    recipientBlocksSender: found(block),
    pendingForRecipient: countOf(pending),
  };
}

const logSend = (db, from, to, now) => statement(db, "INSERT INTO sends (from_uuid, to_uuid, at) VALUES (?, ?, ?)", from, to, now);

/** Ein Brief je Paar: Ein neuer ersetzt den alten (und dessen Kennung). */
export function storeLetter(db, letter, now) {
  return db.batch([
    statement(
      db,
      `INSERT INTO letters (id, to_uuid, from_uuid, from_name, from_peer, body, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (to_uuid, from_uuid) DO UPDATE SET id = excluded.id, from_name = excluded.from_name, from_peer = excluded.from_peer,
         body = excluded.body, created_at = excluded.created_at, expires_at = excluded.expires_at`,
      letter.id,
      letter.to,
      letter.from.uuid,
      letter.from.name,
      letter.from.peerId,
      letter.body,
      letter.createdAt,
      letter.expiresAt,
    ),
    logSend(db, letter.from.uuid, letter.to, now),
  ]);
}

/**
 * Antwort auf einen Brief an jemanden, der den Absender gesperrt hat: Es wird nichts abgelegt, aber die Sendung
 * ins Protokoll geschrieben (sonst verriete die fehlende Wartezeit die Sperre) und mit gleich vielen Anweisungen wie
 * `storeLetter` gearbeitet, damit der Ablauf von einer echten Zustellung nicht zu unterscheiden ist.
 */
export function discardBlockedLetter(db, from, to, now) {
  return db.batch([statement(db, "DELETE FROM letters WHERE to_uuid = ? AND from_uuid = ?", to, from), logSend(db, from, to, now)]);
}

/** Eine Sendung an jemanden ohne Eintrag kostet das Tageskontingent, startet aber keine Wartezeit (`to_uuid = '-'`). */
export function logProbe(db, from, now) {
  return logSend(db, from, "-", now).run();
}

/** Die ungelesenen Briefe an `uuid`, älteste zuerst; null wenn `uuid` keinen Eintrag hat. */
export async function readInbox(db, uuid, now) {
  const [user, letters] = await db.batch([
    statement(db, "SELECT 1 AS found FROM users WHERE uuid = ?", uuid),
    statement(
      db,
      `SELECT id, from_uuid, from_name, from_peer, to_uuid, body, created_at, expires_at FROM letters
       WHERE to_uuid = ? AND expires_at > ? ORDER BY created_at, id LIMIT 20`,
      uuid,
      now,
    ),
  ]);
  return found(user) ? rowsOf(letters) : null;
}

export const deleteLetterFrom = (db, id, from) => statement(db, "DELETE FROM letters WHERE id = ? AND from_uuid = ?", id, from).run();
export const deleteLetterTo = (db, id, to) => statement(db, "DELETE FROM letters WHERE id = ? AND to_uuid = ?", id, to).run();

export async function readBlockFacts(db, owner, blocked) {
  const [user, blocks, existing] = await db.batch([
    statement(db, "SELECT 1 AS found FROM users WHERE uuid = ?", owner),
    statement(db, "SELECT COUNT(*) AS n FROM blocks WHERE owner_uuid = ?", owner),
    statement(db, "SELECT 1 AS found FROM blocks WHERE owner_uuid = ? AND blocked_uuid = ?", owner, blocked),
  ]);
  return { registered: found(user), blockCount: countOf(blocks), alreadyBlocked: found(existing) };
}

/** Sperrt `blocked` und löscht dessen wartende Briefe an `owner`. */
export function addBlock(db, owner, blocked, now) {
  return db.batch([
    statement(db, "INSERT OR IGNORE INTO blocks (owner_uuid, blocked_uuid, created_at) VALUES (?, ?, ?)", owner, blocked, now),
    statement(db, "DELETE FROM letters WHERE to_uuid = ? AND from_uuid = ?", owner, blocked),
  ]);
}

export const removeBlock = (db, owner, blocked) =>
  statement(db, "DELETE FROM blocks WHERE owner_uuid = ? AND blocked_uuid = ?", owner, blocked).run();

/** Tägliches Aufräumen (BYNAME 4, Cron); die Einträge ohne Auffrischung gehen samt Postfach und Sperrliste. */
export function purgeStale(db, now) {
  const staleUsers = `SELECT uuid FROM users WHERE refreshed_at < ? ORDER BY uuid LIMIT ${PURGE_BATCH}`;
  const since = now - USER_RETENTION;
  return db.batch([
    statement(db, `DELETE FROM letters WHERE id IN (SELECT id FROM letters WHERE expires_at <= ? LIMIT ${PURGE_BATCH})`, now),
    statement(db, `DELETE FROM sends WHERE rowid IN (SELECT rowid FROM sends WHERE at <= ? LIMIT ${PURGE_BATCH})`, now - PAIR_COOLDOWN),
    statement(db, `DELETE FROM letters WHERE to_uuid IN (${staleUsers})`, since),
    statement(db, `DELETE FROM blocks WHERE owner_uuid IN (${staleUsers})`, since),
    statement(db, `DELETE FROM users WHERE uuid IN (${staleUsers})`, since),
  ]);
}
