// Freunde-Verzeichnis für Pumpkin Launcher: weist Minecraft-Konten über Mojang nach, führt die Liste derer, die per Name
// auffindbar sein wollen, und verwahrt Freundesanfragen bis zu 14 Tage. Entwurf und Begründung: docs/friends/BYNAME.md.
// Der Worker sieht nie Minecraft-Zugangsdaten, Anwesenheit, Verbindungen oder den Ausgang einer Anfrage.
import { authenticate, issueChallenge, openSession } from "./auth.js";
import { answerLetter, listInbox, retractLetter, sendLetter } from "./letters.js";
import { addBlock, purgeStale, readBlockFacts, registerUser, removeBlock, unregisterUser } from "./store.js";
import { fail, json, noContent, nowSeconds, parseObject } from "./util.js";

const MAX_BODY = 2048;
const MAX_BLOCKS = 1000;
// Zeitraum der Begrenzung in Sekunden, muss zu `period` in wrangler.toml passen (der Worker kann ihn aus der Bindung nicht lesen).
const LIMIT_PERIOD = "60";
const LETTER_ID = "[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}";
const UUID = "[0-9a-f]{32}";
const BINDINGS = ["DB", "LIMITER_IP", "LIMITER_ACCOUNT", "TOKEN_KEY"];

async function register({ env, now, claims, text }) {
  if (text !== "" && !parseObject(text)) return fail("invalid", 400);
  await registerUser(env.DB, claims.u, now);
  return json({ findable: true, refreshedAt: now }, 200);
}

async function unregister({ env, claims }) {
  await unregisterUser(env.DB, claims.u);
  return noContent();
}

async function block({ env, now, claims, params }) {
  const facts = await readBlockFacts(env.DB, claims.u, params.uuid);
  if (!facts.registered) return fail("notRegistered", 404);
  if (!facts.alreadyBlocked && facts.blockCount >= MAX_BLOCKS) return fail("blockListFull", 409);
  await addBlock(env.DB, claims.u, params.uuid, now);
  return noContent();
}

async function unblock({ env, claims, params }) {
  await removeBlock(env.DB, claims.u, params.uuid);
  return noContent();
}

const route = (method, path, handler, authenticated = true) => ({ method, pattern: new RegExp(`^/v1/${path}$`), handler, authenticated });

// Ids in den Pfaden sind Teil des Musters: Eine falsch geformte Id ist ein unbekannter Pfad.
const ROUTES = [
  route("POST", "auth/challenge", issueChallenge, false),
  route("POST", "auth/session", openSession, false),
  route("PUT", "me", register),
  route("DELETE", "me", unregister),
  route("POST", "outbox", sendLetter),
  route("DELETE", `outbox/(?<id>${LETTER_ID})`, retractLetter),
  route("GET", "inbox", listInbox),
  route("DELETE", `inbox/(?<id>${LETTER_ID})`, answerLetter),
  route("PUT", `blocks/(?<uuid>${UUID})`, block),
  route("DELETE", `blocks/(?<uuid>${UUID})`, unblock),
];

function matchRoute(method, pathname) {
  for (const candidate of ROUTES) {
    const match = candidate.method === method && candidate.pattern.exec(pathname);
    if (match) return { ...candidate, params: match.groups ?? {} };
  }
  return null;
}

async function overLimit(limiter, key) {
  const { success } = await limiter.limit({ key });
  return !success;
}

const tooManyRequests = () => fail("rateLimited", 429, { "retry-after": LIMIT_PERIOD });

/** Der Text der Anfrage, null wenn er größer als MAX_BODY Bytes ist. */
async function readBody(request) {
  const bytes = new Uint8Array(await request.arrayBuffer());
  return bytes.length > MAX_BODY ? null : new TextDecoder().decode(bytes);
}

async function serve(request, env, { handler, authenticated, params }) {
  // Schlüssel der Begrenzung ist die IP des Nutzers; Anfragen ohne `cf-connecting-ip` teilen sich einen Eimer.
  if (await overLimit(env.LIMITER_IP, request.headers.get("cf-connecting-ip") ?? "unbekannt")) return tooManyRequests();
  const text = await readBody(request);
  if (text === null) return fail("tooLarge", 413);

  const now = nowSeconds(env);
  const context = { env, now, text, params };
  if (!authenticated) return handler(context);

  const claims = await authenticate(request, env, now);
  if (!claims) return fail("unauthorized", 401);
  if (await overLimit(env.LIMITER_ACCOUNT, claims.u)) return tooManyRequests();
  return handler({ ...context, claims });
}

export default {
  async fetch(request, env) {
    // Der Launcher ist keine Webseite; Browser-Anfragen anderer Seiten sollen das Verzeichnis nicht mitnutzen.
    if (request.headers.has("origin")) return fail("forbidden", 403);
    const found = matchRoute(request.method, new URL(request.url).pathname);
    if (!found) return fail("notFound", 404);
    // Ohne Datenbank, Begrenzung oder Schlüssel lieber gar nicht antworten als ungeschützt.
    if (BINDINGS.some((name) => !env[name])) return fail("notConfigured", 503);
    try {
      return await serve(request, env, found);
    } catch {
      return fail("internal", 500);
    }
  },

  async scheduled(_event, env) {
    await purgeStale(env.DB, nowSeconds(env));
  },
};
