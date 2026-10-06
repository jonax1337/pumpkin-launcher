// Friends directory for Pumpkin Launcher: checks Minecraft accounts offline with Mojang-signed player certificates,
// keeps the list of those who want to be findable by name, and holds friend requests for up to 14 days.
// Design: docs/friends/SPEC.md#directory-api. The Worker makes no subrequests and never sees Minecraft
// credentials, presence, connections or the outcome of a request.
import { authenticate, issueChallenge, openSession } from "./auth.js";
import { answerLetter, listInbox, retractLetter, sendLetter } from "./letters.js";
import { addBlock, purgeStale, readBlockFacts, registerUser, removeBlock, unregisterUser } from "./store.js";
import { concat, fail, json, noContent, nowSeconds, parseObject } from "./util.js";

const MAX_BODY = 2048;
// A2 carries a player certificate (BYNAME-ATTEST 1.3): 1,974 bytes today, 2,658 with an RSA-4096 certificate key.
const MAX_SESSION_BODY = 4096;
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

const route = (method, path, handler, { authenticated = true, maxBody = MAX_BODY } = {}) => ({
  method,
  pattern: new RegExp(`^/${path}$`),
  handler,
  authenticated,
  maxBody,
});
const OPEN = { authenticated: false };

// Ids in den Pfaden sind Teil des Musters: Eine falsch geformte Id ist ein unbekannter Pfad.
const ROUTES = [
  route("POST", "v2/auth/challenge", issueChallenge, OPEN),
  route("POST", "v2/auth/session", openSession, { ...OPEN, maxBody: MAX_SESSION_BODY }),
  route("PUT", "v1/me", register),
  route("DELETE", "v1/me", unregister),
  route("POST", "v1/outbox", sendLetter),
  route("DELETE", `v1/outbox/(?<id>${LETTER_ID})`, retractLetter),
  route("GET", "v1/inbox", listInbox),
  route("DELETE", `v1/inbox/(?<id>${LETTER_ID})`, answerLetter),
  route("PUT", `v1/blocks/(?<uuid>${UUID})`, block),
  route("DELETE", `v1/blocks/(?<uuid>${UUID})`, unblock),
];

// Retired login routes required a Mojang call from the Worker, which cannot succeed.
// Refuse the first step before clients make an unnecessary Mojang `join`.
const RETIRED = [
  ["POST", "/v1/auth/challenge"],
  ["POST", "/v1/auth/session"],
];
const isRetired = (method, pathname) => RETIRED.some(([retiredMethod, path]) => retiredMethod === method && path === pathname);

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

/** The request body as text, null when it is larger than `maxBody` bytes; a declared oversize is refused unread. */
async function readBody(request, maxBody) {
  if (Number(request.headers.get("content-length")) > maxBody) return null;
  const bytes = request.body ? await readAtMost(request.body, maxBody) : new Uint8Array(0);
  return bytes && new TextDecoder().decode(bytes);
}

/** The stream's bytes, or null as soon as more than `maxBytes` arrived (the rest is never read). */
async function readAtMost(stream, maxBytes) {
  const reader = stream.getReader();
  const chunks = [];
  let size = 0;
  for (let read = await reader.read(); !read.done; read = await reader.read()) {
    size += read.value.length;
    if (size > maxBytes) {
      await reader.cancel();
      return null;
    }
    chunks.push(read.value);
  }
  return concat(chunks);
}

async function serve(request, env, { handler, authenticated, maxBody, params, host }) {
  // Schlüssel der Begrenzung ist die IP des Nutzers; Anfragen ohne `cf-connecting-ip` teilen sich einen Eimer.
  if (await overLimit(env.LIMITER_IP, request.headers.get("cf-connecting-ip") ?? "unbekannt")) return tooManyRequests();
  const text = await readBody(request, maxBody);
  if (text === null) return fail("tooLarge", 413);

  const now = nowSeconds(env);
  const context = { env, now, text, params, host };
  if (!authenticated) return handler(context);

  const claims = await authenticate(request, env, now);
  if (!claims) return fail("unauthorized", 401);
  if (await overLimit(env.LIMITER_ACCOUNT, claims.u)) return tooManyRequests();
  return handler({ ...context, claims });
}

async function handleRequest(request, env) {
  // Der Launcher ist keine Webseite; Browser-Anfragen anderer Seiten sollen das Verzeichnis nicht mitnutzen.
  if (request.headers.has("origin")) return fail("forbidden", 403);
  const url = new URL(request.url);
  if (isRetired(request.method, url.pathname)) return fail("gone", 410);
  const found = matchRoute(request.method, url.pathname);
  if (!found) return fail("notFound", 404);
  // Ohne Datenbank, Begrenzung oder Schlüssel lieber gar nicht antworten als ungeschützt.
  if (BINDINGS.some((name) => !env[name])) return fail("notConfigured", 503);
  try {
    return await serve(request, env, { ...found, host: url.hostname });
  } catch {
    return fail("internal", 500);
  }
}

export default {
  fetch: handleRequest,

  async scheduled(_event, env) {
    await purgeStale(env.DB, nowSeconds(env));
  },
};
