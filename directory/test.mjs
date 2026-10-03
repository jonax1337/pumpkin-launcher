// Prüft den Verzeichnis-Worker ohne Cloudflare-Konto und ohne Netz: D1 auf node:sqlite, falsches Mojang, echte Ed25519-Schlüssel.
// Alle Fälle aus docs/friends/BYNAME.md 10.1; Exit-Code 1, sobald ein Fall scheitert. Aufruf: `node directory/test.mjs`.
import { authParts } from "./src/auth.js";
import { letterParts } from "./src/letters.js";
import { toHex, verifySignature } from "./src/util.js";
import { START, consoleCalls, createWorld, seededIdentity } from "./test/world.mjs";

const DAY = 86_400;
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
  check("Pfad mit Schrägstrich am Ende", (await w.call("POST", "/v1/auth/challenge/", { body: { peerId } })).status, 404);
  check("fehlerhafte Brief-Id ist ein unbekannter Pfad", (await w.call("DELETE", "/v1/inbox/nicht-gueltig")).status, 404);
  check("Brief-Id ohne UUID-v4-Form", (await w.call("DELETE", "/v1/outbox/00000000-0000-1000-8000-000000000000")).status, 404);
  check("UUID in Großbuchstaben im Pfad", (await w.call("PUT", `/v1/blocks/${"AB".repeat(16)}`)).status, 404);
  check("404 ist ein Fehlercode", errorOf(await w.call("GET", "/v1/nichts")), "notFound");

  const browser = await w.call("POST", "/v1/auth/challenge", { body: { peerId }, headers: { origin: "https://boese.example" } });
  check("Browser (Origin)", [browser.status, errorOf(browser)], [403, "forbidden"]);

  const body = (bytes) => ({ body: "x".repeat(bytes) });
  check("Körper mit 2048 Bytes ist erlaubt", (await w.call("POST", "/v1/auth/challenge", body(2048))).status, 400);
  check("Körper mit 2049 Bytes", (await w.call("POST", "/v1/auth/challenge", body(2049))).json, { error: "tooLarge" });
  check("Größe zählt Bytes, nicht Zeichen", (await w.call("POST", "/v1/auth/challenge", { body: "ä".repeat(1100) })).status, 413);
}

async function failsClosed() {
  const w = await createWorld();
  const account = await w.newAccount("Alex");
  const session = await w.sessionBody(account);
  const mojangCalls = w.mojang.requests.length;
  for (const missing of ["DB", "LIMITER_IP", "LIMITER_ACCOUNT", "TOKEN_KEY"]) {
    const response = await w.call("POST", "/v1/auth/session", { body: session, env: { [missing]: undefined } });
    check(`ohne ${missing}`, [response.status, errorOf(response)], [503, "notConfigured"]);
  }
  check("ohne Bindungen kein Mojang-Aufruf", w.mojang.requests.length, mojangCalls);
  check("derselbe Körper geht mit allen Bindungen durch", (await w.call("POST", "/v1/auth/session", { body: session })).status, 200);
}

async function challenges() {
  const w = await createWorld();
  const account = await w.newAccount("Alex");
  const { peerId } = account.identity;
  const first = await w.call("POST", "/v1/auth/challenge", { body: { peerId } });
  const second = await w.call("POST", "/v1/auth/challenge", { body: { peerId } });
  check("Herausforderung: Status und Felder", [first.status, Object.keys(first.json)], [200, ["challenge", "serverId", "expiresAt"]]);
  check("Herausforderung läuft nach 120 s ab", first.json.expiresAt, START + 120);
  check("serverId hat 40 Hex-Zeichen", /^[0-9a-f]{40}$/.test(first.json.serverId), true);
  check("Herausforderung höchstens 256 Zeichen", first.json.challenge.length <= 256, true);
  check("jede Herausforderung ist neu", first.json.challenge !== second.json.challenge && first.json.serverId !== second.json.serverId, true);

  const invalid = { "zu kurz": { peerId: "ab".repeat(31) }, Großbuchstaben: { peerId: "AB".repeat(32) }, "mit Zusatzfeld": { peerId, extra: 1 }, "ohne Feld": {}, Liste: [peerId] };
  for (const [label, body] of Object.entries(invalid)) check(`Herausforderung ${label}`, errorOf(await w.call("POST", "/v1/auth/challenge", { body })), "invalid");
  check("Herausforderung kein JSON", errorOf(await w.call("POST", "/v1/auth/challenge", { body: "{" })), "invalid");
}

async function sessions() {
  const w = await createWorld();
  const steve = await w.newAccount("Steve");
  const session = await w.handshake(steve, { name: "steve" });
  check("Sitzung: Status und Felder", [session.status, Object.keys(session.json)], [200, ["token", "expiresAt", "uuid", "name"]]);
  check("Sitzung: UUID und Name kommen von Mojang (Schreibweise geklärt)", [session.json.uuid, session.json.name], [steve.uuid, "Steve"]);
  check("Token gilt 6 Stunden", session.json.expiresAt, START + 6 * 3600);
  check("Token hat Version v1", session.json.token.startsWith("v1."), true);

  const mojang = w.mojang.requests.at(-1);
  const url = new URL(mojang.url);
  check("hasJoined: Adresse", url.origin + url.pathname, "https://sessionserver.mojang.com/session/minecraft/hasJoined");
  check("hasJoined: kein ip-Parameter", [...url.searchParams.keys()], ["username", "serverId"]);
  check("hasJoined: User-Agent und Zeitlimit", [mojang.init.headers["user-agent"].startsWith("pumpkin-friends-directory"), mojang.init.signal instanceof AbortSignal], [true, true]);

  check("abgelaufene Herausforderung", errorOf(await expiredChallenge(w, 120)), "challengeExpired");
  check("Herausforderung kurz vor Ablauf", (await expiredChallenge(w, 119)).status, 200);
  await tamperedChallenges(w);

  const alex = await w.newAccount("Alex");
  const forged = await w.sessionBody(alex);
  const stranger = await w.newAccount("Fremd");
  const strangerSignature = await stranger.identity.sign("pumpkin/directory-auth/1", authParts("0".repeat(40), alex.identity.peerId));
  check("Signatur eines anderen Schlüssels", errorOf(await w.call("POST", "/v1/auth/session", { body: { ...forged, signature: strangerSignature } })), "badSignature");
  const mismatch = await w.call("POST", "/v1/auth/challenge", { body: { peerId: alex.identity.peerId } });
  const wrongServerId = await alex.identity.sign("pumpkin/directory-auth/1", authParts("1".repeat(40), alex.identity.peerId));
  check("Signatur über eine andere serverId", errorOf(await w.call("POST", "/v1/auth/session", { body: { challenge: mismatch.json.challenge, name: "Alex", signature: wrongServerId } })), "badSignature");
  const otherPeerSignature = await alex.identity.sign("pumpkin/directory-auth/1", authParts(mismatch.json.serverId, stranger.identity.peerId));
  check("Signatur über eine andere Peer-ID", errorOf(await w.call("POST", "/v1/auth/session", { body: { challenge: mismatch.json.challenge, name: "Alex", signature: otherPeerSignature } })), "badSignature");

  check("Mojang kennt keinen Beitritt (204)", errorOf(await w.handshake(await w.newAccount("Nie"), { join: false })), "notJoined");
  const impostor = await w.newAccount("Alex2");
  check("Beitritt unter anderem Namen", errorOf(await w.handshake(impostor, { name: "Herobrine" })), "notJoined");

  for (const failure of [429, 500, 503, "timeout"]) {
    w.mojang.failWith(failure);
    check(`Mojang antwortet mit ${failure}`, errorOf(await w.handshake(await w.newAccount("Mojang"))), "mojangUnavailable");
  }
  w.mojang.failWith(null);
  check("ungültiger Name in der Sitzung", errorOf(await w.handshake(alex, { name: "../etc" })), "invalid");
}

const expiredChallenge = async (w, wait) => {
  const account = await w.newAccount("Spaet");
  const body = await w.sessionBody(account);
  w.advance(wait);
  const response = await w.call("POST", "/v1/auth/session", { body });
  w.advance(-wait);
  return response;
};

async function tamperedChallenges(w) {
  const account = await w.newAccount("Fremdschluessel");
  const body = await w.sessionBody(account);
  const [payload, tag] = body.challenge.split(".");
  const forged = { "Nutzlast verändert": `${corrupt(payload)}.${tag}`, "Prüfwert verändert": `${payload}.${corrupt(tag)}`, "ohne Prüfwert": payload, Unsinn: "###", "zu lang": "A".repeat(257) };
  for (const [label, challenge] of Object.entries(forged)) {
    check(`Herausforderung ${label}`, errorOf(await w.call("POST", "/v1/auth/session", { body: { ...body, challenge } })), "invalid");
  }
  const otherKey = { TOKEN_KEY: "anderer-schluessel" };
  check("Herausforderung mit anderem TOKEN_KEY", errorOf(await w.call("POST", "/v1/auth/session", { body, env: otherKey })), "invalid");
}

async function tokens() {
  const w = await createWorld();
  const alex = await w.newAccount("Alex");
  const token = await w.tokenOf(alex);
  const register = (value, overrides) => w.call("PUT", "/v1/me", { token: value, env: overrides });
  check("Token gilt", (await register(token)).status, 200);
  const [payload, tag] = token.slice(3).split(".");
  check("Token verändert (Prüfwert)", errorOf(await register(`v1.${payload}.${corrupt(tag)}`)), "unauthorized");
  check("Token verändert (Nutzlast)", errorOf(await register(`v1.${corrupt(payload)}.${tag}`)), "unauthorized");
  check("Token mit anderem TOKEN_KEY", (await register(token, { TOKEN_KEY: "anderer-schluessel" })).status, 401);
  const challenge = (await w.call("POST", "/v1/auth/challenge", { body: { peerId: alex.identity.peerId } })).json.challenge;
  check("Herausforderung ist kein Token", (await register(`v1.${challenge}`)).status, 401);
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
  check("Postfach: älteste zuerst", letters.map((letter) => letter.from.name), ["Eins", "Zwei", "Drei"]);
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
  const stamp = { uuid: alex.uuid, name: "Alex", peerId: alex.identity.peerId };
  check("Brief im Postfach: Felder wie N 4", Object.keys(letter).sort(), ["createdAt", "displayName", "expiresAt", "from", "helloId", "id", "nonce", "relayIndex", "secret", "signature", "to"]);
  check("Stempel stammt aus dem Token", letter.from, stamp);
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

  const serverId = "0123456789abcdef0123456789abcdef01234567";
  const authVector =
    "8b7c4551617ee1788f53e6a40929fb1a0bf2a7b1abce3e391740951277a5939c6de27a93afba50d548ef66eb43dd6922fa1f489c75728f7af9f566ce95681000";
  check("A.2 Anmeldung: Signatur reproduziert", await identity.sign("pumpkin/directory-auth/1", authParts(serverId, identity.peerId)), authVector);
  check("A.2 Anmeldung: Worker prüft die Signatur", await verifySignature(identity.peerId, "pumpkin/directory-auth/1", authParts(serverId, identity.peerId), authVector), true);
  check("A.2 Anmeldung: andere serverId fällt durch", await verifySignature(identity.peerId, "pumpkin/directory-auth/1", authParts("f".repeat(40), identity.peerId), authVector), false);
  check("A.2 Anmeldung: serverId sind 40 ASCII-Bytes", authParts(serverId, identity.peerId)[0].length, 40);

  await vectorThroughWorker(identity, letter, from, letterVector);
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
  await w.call("POST", "/v1/auth/challenge", { body: { peerId }, headers: { "cf-connecting-ip": "203.0.113.7" } });
  await w.call("POST", "/v1/auth/challenge", { body: { peerId } });
  check("IP-Begrenzung: Schlüssel ist die IP, ohne IP ein gemeinsamer Eimer", w.limits.ip.join(","), "203.0.113.7,unbekannt");
  check("offene Routen berühren die Konto-Begrenzung nicht", w.limits.account, []);

  const token = await w.tokenOf(alex);
  w.limits.ip.length = 0;
  await w.call("PUT", "/v1/me", { token, headers: { "cf-connecting-ip": "203.0.113.8" } });
  check("Konto-Begrenzung: Schlüssel ist die UUID", [w.limits.ip, w.limits.account], [["203.0.113.8"], [alex.uuid]]);
  await w.call("PUT", "/v1/me", { token: `v1.${corrupt(token.slice(3))}` });
  check("ungültiges Token erreicht die Konto-Begrenzung nicht", w.limits.account.length, 1);

  const known = [["POST", "/v1/auth/challenge"], ["PUT", "/v1/me"], ["GET", "/v1/inbox"], ["POST", "/v1/outbox"], ["PUT", `/v1/blocks/${"ab".repeat(16)}`]];
  w.limits.ipBlocked = true;
  for (const [method, path] of known) {
    const response = await w.call(method, path, { token, body: method === "GET" ? undefined : "{}" });
    check(`IP-Grenze: ${method} ${path}`, [response.status, errorOf(response), response.headers.get("retry-after")], [429, "rateLimited", "60"]);
  }
  const oversize = await w.call("POST", "/v1/auth/challenge", { body: "x".repeat(3000) });
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
  const letters = w.db.raw.prepare("INSERT INTO letters VALUES (?, ?, ?, 'n', 'p', '{}', ?, ?)");
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

for (const section of [routing, failsClosed, challenges, sessions, tokens, registry, letterStamp, letterValidation, letterChecks, goldenVectors, abuse, rateLimits, cleanup, failureHandling]) {
  await section();
}
check("keine console-Aufrufe des Workers", consoleCalls, []);
if (failures > 0) {
  console.log(`${failures} Fälle fehlgeschlagen`);
  process.exit(1);
}
