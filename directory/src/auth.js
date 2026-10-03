// Kontonachweis: Der Launcher beweist über Mojangs join/hasJoined, welches Minecraft-Konto er hält, und signiert mit
// seinem Freundeschlüssel. Herausforderung und Token sind zustandslos (HMAC mit TOKEN_KEY), der Worker speichert nichts.
import { fail, fromHex, hasExactKeys, isHex, json, parseObject, randomHex, seal, toHex, unseal, utf8, mac, verifySignature } from "./util.js";

const HAS_JOINED = "https://sessionserver.mojang.com/session/minecraft/hasJoined";
// Mojang soll sehen, wer fragt.
const USER_AGENT = "pumpkin-friends-directory (+https://github.com/jonax1337/pumpkin-launcher)";
const MOJANG_TIMEOUT_MS = 5000;
const CHALLENGE_TTL = 120;
const TOKEN_TTL = 6 * 60 * 60;
const AUTH_DOMAIN = "pumpkin/directory-auth/1";
const TOKEN_PREFIX = "v1.";
const SERVER_ID_LENGTH = 40;
const MINECRAFT_NAME = /^[A-Za-z0-9_]{1,16}$/;
const isMinecraftName = (value) => typeof value === "string" && MINECRAFT_NAME.test(value);

class MojangUnavailable extends Error {}

/** Signierte Bytes der Anmeldung: `serverId` (40 ASCII-Zeichen) und die Peer-ID (32 Bytes). */
export const authParts = (serverId, peerId) => [utf8(serverId), fromHex(peerId)];

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

const validSessionBody = (body) =>
  body !== null &&
  hasExactKeys(body, ["challenge", "name", "signature"]) &&
  typeof body.challenge === "string" &&
  body.challenge.length <= 256 &&
  isMinecraftName(body.name) &&
  isHex(body.signature, 64);

export async function openSession({ env, now, text }) {
  const body = parseObject(text);
  if (!validSessionBody(body)) return fail("invalid", 400);
  const challenge = await unseal(env.TOKEN_KEY, "challenge", body.challenge);
  if (!challenge) return fail("invalid", 400);
  if (challenge.exp <= now) return fail("challengeExpired", 400);

  const serverId = await serverIdFor(env, body.challenge);
  if (!(await verifySignature(challenge.p, AUTH_DOMAIN, authParts(serverId, challenge.p), body.signature))) return fail("badSignature", 401);

  let profile;
  try {
    profile = await joinedProfile(body.name, serverId);
  } catch (error) {
    if (error instanceof MojangUnavailable) return fail("mojangUnavailable", 503);
    throw error;
  }
  if (!profile) return fail("notJoined", 401);
  return json(await mintToken(env, now, profile, challenge.p), 200);
}

/** Das von Mojang bestätigte Profil `{id, name}`, null wenn das Konto mit dieser serverId nicht beigetreten ist. */
async function joinedProfile(name, serverId) {
  const response = await fetchHasJoined(name, serverId);
  if (response.status === 204) return null;
  if (response.status !== 200) throw new MojangUnavailable();
  const profile = parseProfile(await response.json().catch(() => null));
  if (!profile) throw new MojangUnavailable();
  return profile;
}

// Ohne `ip`-Parameter: Mojang prüft dann nur Konto und serverId, nicht die Adresse des Launchers.
async function fetchHasJoined(name, serverId) {
  try {
    return await fetch(`${HAS_JOINED}?username=${encodeURIComponent(name)}&serverId=${serverId}`, {
      headers: { "user-agent": USER_AGENT, accept: "application/json" },
      signal: AbortSignal.timeout(MOJANG_TIMEOUT_MS),
    });
  } catch {
    throw new MojangUnavailable();
  }
}

function parseProfile(body) {
  const id = typeof body?.id === "string" ? body.id.toLowerCase() : "";
  return isHex(id, 16) && isMinecraftName(body.name) ? { id, name: body.name } : null;
}

async function mintToken(env, now, profile, peerId) {
  const expiresAt = now + TOKEN_TTL;
  const token = TOKEN_PREFIX + (await seal(env.TOKEN_KEY, "token", { u: profile.id, n: profile.name, p: peerId, exp: expiresAt }));
  return { token, expiresAt, uuid: profile.id, name: profile.name };
}

/** Die Angaben des Tokens im `Authorization`-Header `{u, n, p, exp}`, null bei fehlendem, abgelaufenem oder verändertem Token. */
export async function authenticate(request, env, now) {
  const token = /^Bearer (v1\.\S+)$/.exec(request.headers.get("authorization") ?? "")?.[1];
  if (!token) return null;
  const claims = await unseal(env.TOKEN_KEY, "token", token.slice(TOKEN_PREFIX.length));
  return claims && claims.exp > now ? claims : null;
}
