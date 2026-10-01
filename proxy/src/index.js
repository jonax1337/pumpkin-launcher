// CurseForge-Proxy für Pumpkin Launcher. Der Schlüssel liegt als Secret `CURSEFORGE_API_KEY` in Cloudflare,
// nie im Code. Nur die Abfragen des Launchers werden durchgelassen, alles andere ist 404.
// Nichts wird zwischengespeichert: Die API-Bedingungen von CurseForge (3e) verbieten das Speichern der Daten.
const API = "https://api.curseforge.com";
// CurseForge soll sehen, wer fragt.
const USER_AGENT = "pumpkin-launcher-proxy (+https://github.com/jonax1337/pumpkin-launcher)";
const TIMEOUT_MS = 15_000;
const MINECRAFT = "432";
const CLASSES = new Set(["6", "4471", "12", "6552"]); // Mods, Modpacks, Ressourcenpakete, Shader
const PARAMS = new Set(["gameId", "classId", "searchFilter", "sortField", "sortOrder", "gameVersion", "modLoaderType", "index", "pageSize"]);
// Grenzen von CurseForge: höchstens 50 je Seite, index + pageSize höchstens 10 000.
const MAX_PAGE = 50;
const MAX_RESULTS = 10_000;
const MAX_IDS = 200;
const MAX_BODY = 20_000;
// Zeitraum der Begrenzung aus wrangler.toml (Sekunden): Nach so langer Pause hat ein gedrosselter Launcher wieder Luft.
const LIMIT_PERIOD = "60";

const ROUTES = [
  ["GET", /^\/v1\/mods\/search$/],
  ["GET", /^\/v1\/mods\/\d+$/],
  ["GET", /^\/v1\/mods\/\d+\/description$/],
  ["GET", /^\/v1\/mods\/\d+\/files$/],
  ["GET", /^\/v1\/mods\/\d+\/files\/\d+$/],
  ["POST", /^\/v1\/mods$/],
  ["POST", /^\/v1\/mods\/files$/],
];

const json = (body, status, headers = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json; charset=utf-8", ...headers } });

/** Nicht negative ganze Zahl, sonst NaN (dann scheitert jeder Vergleich). */
const count = (text) => (/^\d{1,5}$/.test(text) ? Number(text) : NaN);

/** Nur bekannte Parameter und eine Seite innerhalb der CurseForge-Grenzen; die Suche nur in Minecraft und den vier Kategorien. */
function validQuery(url) {
  const q = url.searchParams;
  const index = count(q.get("index") ?? "0");
  const pageSize = count(q.get("pageSize") ?? "20");
  const known = [...q.keys()].every((key) => PARAMS.has(key));
  const paged = pageSize >= 1 && pageSize <= MAX_PAGE && index + pageSize <= MAX_RESULTS;
  const search = url.pathname !== "/v1/mods/search" || (q.get("gameId") === MINECRAFT && CLASSES.has(q.get("classId") ?? ""));
  return known && paged && search;
}

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
  async fetch(request, env) {
    const url = new URL(request.url);
    // Der Launcher ist keine Webseite; Browser-Anfragen anderer Seiten sollen den Schlüssel nicht mitnutzen.
    if (request.headers.has("origin")) return json({ error: "Nur für Pumpkin Launcher" }, 403);
    if (!ROUTES.some(([method, re]) => method === request.method && re.test(url.pathname))) return json({ error: "Nicht erlaubt" }, 404);
    if (!env.CURSEFORGE_API_KEY) return json({ error: "Proxy ist nicht eingerichtet" }, 500);

    if (env.LIMITER) {
      const { success } = await env.LIMITER.limit({ key: request.headers.get("cf-connecting-ip") ?? "unbekannt" });
      if (!success) return json({ error: "Zu viele Anfragen, bitte kurz warten" }, 429, { "retry-after": LIMIT_PERIOD });
    }

    if (!validQuery(url)) return json({ error: "Ungültige Anfrage" }, 400);

    let body;
    if (request.method === "POST") {
      const text = await request.text();
      if (text.length > MAX_BODY) return json({ error: "Anfrage zu groß" }, 413);
      body = idList(text, url.pathname.endsWith("/files") ? "fileIds" : "modIds");
      if (!body) return json({ error: "Ungültige Anfrage" }, 400);
    }

    let upstream;
    try {
      upstream = await fetch(`${API}${url.pathname}${url.search}`, {
        method: request.method,
        headers: {
          "x-api-key": env.CURSEFORGE_API_KEY,
          "user-agent": USER_AGENT,
          accept: "application/json",
          ...(body ? { "content-type": "application/json" } : {}),
        },
        body,
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch {
      return json({ error: "CurseForge antwortet nicht" }, 504);
    }
    const headers = { "content-type": upstream.headers.get("content-type") ?? "application/json" };
    // Drosselt CurseForge selbst, soll der Launcher dessen Wartezeit sehen.
    const retryAfter = upstream.headers.get("retry-after");
    if (retryAfter) headers["retry-after"] = retryAfter;
    return new Response(upstream.body, { status: upstream.status, headers });
  },
};
