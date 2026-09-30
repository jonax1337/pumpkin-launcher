// CurseForge-Proxy für Pumpkin Launcher. Der Schlüssel liegt als Secret `CURSEFORGE_API_KEY` in Cloudflare,
// nie im Code. Nur die Abfragen des Launchers werden durchgelassen, alles andere ist 404.
const API = "https://api.curseforge.com";
const MINECRAFT = "432";
const CLASSES = new Set(["6", "4471", "12", "6552"]); // Mods, Modpacks, Ressourcenpakete, Shader
const CACHE_SECONDS = 600;
const MAX_IDS = 200;
const MAX_BODY = 20_000;

const ROUTES = [
  ["GET", /^\/v1\/mods\/search$/],
  ["GET", /^\/v1\/mods\/\d+$/],
  ["GET", /^\/v1\/mods\/\d+\/description$/],
  ["GET", /^\/v1\/mods\/\d+\/files$/],
  ["GET", /^\/v1\/mods\/\d+\/files\/\d+$/],
  ["POST", /^\/v1\/mods$/],
  ["POST", /^\/v1\/mods\/files$/],
];

const json = (body, status) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json; charset=utf-8" } });

/** `{ [field]: [Nummern] }` mit höchstens MAX_IDS ganzen Zahlen, sonst null. */
function idList(text, field) {
  try {
    const body = JSON.parse(text);
    const ids = body?.[field];
    const ok =
      Object.keys(body).length === 1 && Array.isArray(ids) && ids.length > 0 && ids.length <= MAX_IDS && ids.every((n) => Number.isSafeInteger(n) && n > 0);
    return ok ? JSON.stringify({ [field]: ids }) : null;
  } catch {
    return null;
  }
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (!ROUTES.some(([method, re]) => method === request.method && re.test(url.pathname))) return json({ error: "Nicht erlaubt" }, 404);
    if (!env.CURSEFORGE_API_KEY) return json({ error: "Proxy ist nicht eingerichtet" }, 500);

    if (env.LIMITER) {
      const { success } = await env.LIMITER.limit({ key: request.headers.get("cf-connecting-ip") ?? "unbekannt" });
      if (!success) return json({ error: "Zu viele Anfragen, bitte kurz warten" }, 429);
    }

    // Suche nur in Minecraft und in den vier Kategorien des Launchers, in kleinen Seiten.
    if (url.pathname === "/v1/mods/search") {
      const { searchParams: q } = url;
      if (q.get("gameId") !== MINECRAFT || !CLASSES.has(q.get("classId") ?? "") || Number(q.get("pageSize") ?? 20) > 50) {
        return json({ error: "Ungültige Suche" }, 400);
      }
    }

    let body;
    if (request.method === "POST") {
      const text = await request.text();
      if (text.length > MAX_BODY) return json({ error: "Anfrage zu groß" }, 413);
      body = idList(text, url.pathname.endsWith("/files") ? "fileIds" : "modIds");
      if (!body) return json({ error: "Ungültige Anfrage" }, 400);
    }

    const cache = caches.default;
    const cacheKey = new Request(url.toString(), { method: "GET" });
    if (request.method === "GET") {
      const hit = await cache.match(cacheKey);
      if (hit) return hit;
    }

    const upstream = await fetch(`${API}${url.pathname}${url.search}`, {
      method: request.method,
      headers: { "x-api-key": env.CURSEFORGE_API_KEY, accept: "application/json", ...(body ? { "content-type": "application/json" } : {}) },
      body,
    });
    const response = new Response(upstream.body, { status: upstream.status, headers: { "content-type": upstream.headers.get("content-type") ?? "application/json" } });
    if (request.method === "GET" && upstream.ok) {
      const cached = new Response(response.clone().body, response);
      cached.headers.set("cache-control", `public, max-age=${CACHE_SECONDS}`);
      ctx.waitUntil(cache.put(cacheKey, cached));
    }
    return response;
  },
};
