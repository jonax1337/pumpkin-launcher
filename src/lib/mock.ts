import type { Instance, Mod, ModKind, VersionEntry } from "@/lib/types";
import type { CatalogType, ContentProgress, ContentProject, ContentSearch, ContentVersion, ModUpdate } from "@/lib/modrinth";

const DAY = 86_400_000;
const now = Date.now();

// Modrinth-Einträge tragen echte Projekt-IDs (wie im Backend: `id` = Projekt-ID), damit Icons im Browser erscheinen.
const PROJECT_IDS: Record<string, string> = {
  sodium: "AANobbMI", lithium: "gvQqBUqZ", iris: "YL57xq9U", modmenu: "mOgUt4GM", appleskin: "EsAfCjCV",
  ferritecore: "uXXizFIs", "xaeros-minimap": "1bokaNcj", "fabric-api": "P7dR8mSH", "fresh-animations": "50dA9Sha",
};

function mod(
  slug: string,
  name: string,
  version: string,
  source: Mod["source"]["type"] = "modrinth",
  kind: ModKind = "mod",
  requiredBy: string[] = [],
): Mod {
  const id = source === "modrinth" ? PROJECT_IDS[slug] : slug;
  return {
    id,
    name,
    version,
    source:
      source === "modrinth"
        ? { type: "modrinth", projectId: id, versionId: version }
        : source === "curseforge"
          ? { type: "curseforge", projectId: 0, fileId: 0 }
          : { type: "local" },
    fileName: `${slug}-${version}.jar`,
    sha1: null,
    enabled: true,
    kind,
    requiredBy,
  };
}

export const MOCK_MODS: Mod[] = [
  mod("sodium", "Sodium", "0.6.13"),
  mod("lithium", "Lithium", "0.15.1"),
  mod("iris", "Iris Shaders", "1.8.12"),
  mod("modmenu", "Mod Menu", "13.0.3"),
  mod("jei", "Just Enough Items", "19.21.1", "curseforge"),
  mod("create", "Create", "6.0.4", "curseforge"),
  mod("xaeros-minimap", "Xaero's Minimap", "25.2.0"),
  mod("appleskin", "AppleSkin", "3.0.6"),
  mod("ferritecore", "FerriteCore", "7.1.1"),
  mod("custom-hud", "Eigenes HUD", "1.0.0", "local"),
  mod("fabric-api", "Fabric API", "0.119.2+1.21.4", "modrinth", "mod", [PROJECT_IDS.modmenu]),
  mod("fresh-animations", "Fresh Animations", "1.9.3", "modrinth", "resourcepack"),
];

const byId = (slug: string): Mod => {
  const found = MOCK_MODS.find((m) => m.id === (PROJECT_IDS[slug] ?? slug));
  if (!found) throw new Error(`Mock-Mod ${slug} fehlt`);
  return { ...found };
};

/** Was eine neue Instanz wie im Backend (`Instance::from_new`) ohne eigene Werte mitbringt. */
export const blankInstanceFields = (): Pick<
  Instance, "modpack" | "memoryMb" | "jvmArgs" | "javaPath" | "window" | "gameArgs" | "playtimeSecs" | "group" | "lastPlayedAt" | "lastQuickPlay"
> => ({ modpack: null, memoryMb: null, jvmArgs: [], javaPath: null, window: { type: "default" }, gameArgs: [], playtimeSecs: 0, group: null, lastPlayedAt: null, lastQuickPlay: null });

export function initialInstances(): Instance[] {
  return [
    {
      ...blankInstanceFields(),
      id: "inst-survival",
      name: "Survival 1.21",
      minecraftVersion: "1.21.4",
      loader: "fabric",
      loaderVersion: "0.16.10",
      memoryMb: 6144,
      jvmArgs: ["-XX:+UseG1GC", "-XX:MaxGCPauseMillis=50"],
      window: { type: "size", width: 1600, height: 900 },
      playtimeSecs: 37 * 3600 + 25 * 60,
      group: "Mit Freunden",
      mods: ["lithium", "iris", "modmenu", "fabric-api", "appleskin", "fresh-animations"].map(byId),
      createdAt: now - 40 * DAY,
      lastPlayedAt: now - 2 * 3_600_000,
    },
    {
      ...blankInstanceFields(),
      id: "inst-create",
      name: "Create-Fabrik",
      minecraftVersion: "1.20.1",
      loader: "forge",
      loaderVersion: "47.3.0",
      memoryMb: 8192,
      playtimeSecs: 4 * 3600 + 30 * 60,
      group: "Modpacks",
      mods: ["create", "jei", "xaeros-minimap", "ferritecore"].map(byId),
      createdAt: now - 90 * DAY,
      lastPlayedAt: now - 3 * DAY,
    },
    {
      ...blankInstanceFields(),
      id: "inst-vanilla",
      name: "Vanilla Snapshot",
      minecraftVersion: "1.21.5",
      loader: "vanilla",
      loaderVersion: null,
      mods: [],
      createdAt: now - 5 * DAY,
    },
    ...(
      [
        ["inst-quilt", "Quilt Kreativ", "1.21.1", "quilt", ["sodium", "modmenu"], 12, null],
        ["inst-neo", "NeoForge Abenteuer mit sehr langem Namen für den Test", "1.21.1", "neoforge", ["jei", "xaeros-minimap", "ferritecore"], 20, "Modpacks"],
        ["inst-pvp", "PvP Training", "1.21.4", "fabric", ["sodium", "lithium", "fabric-api"], 30, "Mit Freunden"],
        ["inst-retro", "Retro 1.16", "1.16.5", "vanilla", [], 60, null],
      ] as const
    ).map(([id, name, minecraftVersion, loader, mods, days, group]): Instance => ({
      ...blankInstanceFields(),
      id, name, minecraftVersion, loader, loaderVersion: null, group, playtimeSecs: days * 1800,
      mods: mods.map(byId), createdAt: now - (days + 10) * DAY, lastPlayedAt: now - days * DAY,
    })),
  ];
}

// Nur für den Browser-Modus ohne Tauri (siehe api.ts).
export const MOCK_VERSIONS: VersionEntry[] = (
  [
    ["1.21.11", "release"],
    ["25w41a", "snapshot"],
    ["1.21.10", "release"],
    ["1.21.8", "release"],
    ["1.21.4", "release"],
    ["1.21.1", "release"],
    ["1.20.1", "release"],
    ["1.16.5", "release"],
  ] as const
).map(([id, type], i) => ({ id, type, url: "", sha1: "", releaseTime: new Date(now - i * 40 * DAY).toISOString() }));

// ---------- Modrinth im Browser-Modus ----------

const MODRINTH = "https://api.modrinth.com/v2";
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function modrinth<T>(path: string, params: Record<string, string> = {}): Promise<T> {
  const res = await fetch(`${MODRINTH}${path}?${new URLSearchParams(params)}`);
  if (!res.ok) throw new Error(`Modrinth antwortet nicht (${res.status})`);
  return res.json();
}

/** Gleiche Form wie die Backend-Commands: Katalog echt von Modrinth, Installieren und Updates nur simuliert (keine Dateien). */
export function createContentMock(db: { instances: Instance[] }, emit: (event: string, payload: ContentProgress) => void) {
  // Diese Einträge gelten als veraltet, bis sie aktualisiert werden.
  const outdated = new Set([PROJECT_IDS.lithium, PROJECT_IDS.appleskin, PROJECT_IDS.modmenu]);
  const find = (id: string) => {
    const inst = db.instances.find((i) => i.id === id);
    if (!inst) throw new Error(`Instanz "${id}" nicht gefunden`);
    return structuredClone(inst);
  };
  const save = (inst: Instance) => {
    db.instances = db.instances.map((i) => (i.id === inst.id ? inst : i));
    return structuredClone(inst);
  };
  const versions = (projectId: string, mc: string | null, loader: string | null) =>
    modrinth<ContentVersion[]>(`/project/${projectId}/version`, {
      ...(mc && { game_versions: JSON.stringify([mc]) }),
      ...(loader && { loaders: JSON.stringify([loader]) }),
    });
  const bump = (v: string) => v.replace(/(\d+)(?!.*\d)/, (n) => String(Number(n) + 1));
  const progressFor = (operationId: string) => (phase: string, done: number, total: number) =>
    emit("content-progress", { operationId, phase, done, total });

  return {
    async search(query: string, type: CatalogType, mc: string | null, loader: string | null, offset: number, index: string | null = null): Promise<ContentSearch> {
      const facets = [[`project_type:${type}`], ...(mc ? [[`versions:${mc}`]] : []), ...(loader ? [[`categories:${loader}`]] : [])];
      const r = await modrinth<ContentSearch>("/search", {
        query, facets: JSON.stringify(facets), offset: String(offset), limit: "20", index: index ?? (query ? "relevance" : "downloads"),
      });
      return { hits: r.hits, total_hits: r.total_hits, offset: r.offset, limit: r.limit };
    },
    project: (id: string) => modrinth<ContentProject>(`/project/${id}`),
    projects: (ids: string[]) => (ids.length ? modrinth<ContentProject[]>("/projects", { ids: JSON.stringify(ids) }) : Promise.resolve([])),
    versions,
    async installMod(instanceId: string, versionId: string, operationId: string): Promise<Instance> {
      const progress = progressFor(operationId);
      progress("resolve", 0, 1);
      const inst = find(instanceId);
      const root = await modrinth<ContentVersion>(`/version/${versionId}`);
      const project = await modrinth<ContentProject>(`/project/${root.project_id}`);
      const kind = project.project_type as ModKind;
      const have = new Set(inst.mods.map((m) => m.id));
      // Wie das Backend: nur neu mitgebrachte Pflicht-Abhängigkeiten bekommen requiredBy.
      const fresh = [root];
      for (const d of kind === "mod" ? root.dependencies : []) {
        if (d.dependency_type !== "required" || !d.project_id || have.has(d.project_id)) continue;
        const v = (await versions(d.project_id, inst.minecraftVersion, inst.loader))[0];
        if (!v) throw new Error("Eine benötigte Mod gibt es nicht für diese Minecraft-Version.");
        fresh.push(v);
      }
      const todo = fresh.filter((v) => !have.has(v.project_id));
      for (let i = 0; i < todo.length; i++) {
        progress("download", i, todo.length);
        await wait(500);
      }
      for (const v of todo) {
        inst.mods.push({
          id: v.project_id, name: v.name, version: v.version_number, kind: v === root ? kind : "mod",
          requiredBy: v === root ? [] : [root.project_id],
          source: { type: "modrinth", projectId: v.project_id, versionId: v.id },
          fileName: v.files[0]?.filename ?? `${v.project_id}.jar`, sha1: null, enabled: true,
        });
      }
      // Direkt hinzugefügt macht eine vorhandene Abhängigkeit zu einem direkten Eintrag.
      const existing = inst.mods.find((m) => m.id === root.project_id);
      if (existing) existing.requiredBy = [];
      progress("complete", todo.length, todo.length);
      return save(inst);
    },
    async checkUpdates(instanceId: string): Promise<ModUpdate[]> {
      await wait(600);
      return find(instanceId).mods
        .filter((m) => outdated.has(m.id))
        .map((m) => ({ modId: m.id, currentVersion: m.version, versionId: `mock-${m.id}`, versionNumber: bump(m.version) }));
    },
    async updateMods(instanceId: string, modIds: string[], operationId: string): Promise<Instance> {
      const progress = progressFor(operationId);
      progress("resolve", 0, 1);
      await wait(300);
      for (let i = 0; i < modIds.length; i++) {
        progress("download", i, modIds.length);
        await wait(400);
      }
      const inst = find(instanceId);
      for (const m of inst.mods) if (modIds.includes(m.id) && outdated.delete(m.id)) m.version = bump(m.version);
      progress("complete", modIds.length, modIds.length);
      return save(inst);
    },
    /** Im Browser kennt Modrinth keine Datei: die Einträge bleiben lokal. */
    async identify(instanceId: string): Promise<Instance> {
      await wait(600);
      return find(instanceId);
    },
  };
}
