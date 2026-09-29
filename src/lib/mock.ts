import type { Instance, Mod, Modpack, NewsItem, Preset, VersionEntry } from "@/lib/types";

const DAY = 86_400_000;
const now = Date.now();

function mod(
  id: string,
  name: string,
  version: string,
  source: Mod["source"]["type"] = "modrinth",
  enabled = true,
): Mod {
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
    fileName: `${id}-${version}.jar`,
    sha1: null,
    enabled,
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
];

const byId = (id: string): Mod => {
  const found = MOCK_MODS.find((m) => m.id === id);
  if (!found) throw new Error(`Mock-Mod ${id} fehlt`);
  return { ...found };
};

export function initialInstances(): Instance[] {
  return [
    {
      id: "inst-survival",
      name: "Survival 1.21",
      minecraftVersion: "1.21.4",
      loader: "fabric",
      loaderVersion: "0.16.10",
      presetId: "preset-performance",
      modpack: null,
      memoryMb: 6144,
      jvmArgs: ["-XX:+UseG1GC", "-XX:MaxGCPauseMillis=50"],
      mods: ["sodium", "lithium", "iris", "modmenu", "appleskin"].map(byId),
      createdAt: now - 40 * DAY,
      lastPlayedAt: now - 2 * 3_600_000,
    },
    {
      id: "inst-create",
      name: "Create-Fabrik",
      minecraftVersion: "1.20.1",
      loader: "forge",
      loaderVersion: "47.3.0",
      presetId: null,
      modpack: null,
      memoryMb: 8192,
      jvmArgs: [],
      mods: ["create", "jei", "xaeros-minimap", "ferritecore"].map(byId),
      createdAt: now - 90 * DAY,
      lastPlayedAt: now - 3 * DAY,
    },
    {
      id: "inst-vanilla",
      name: "Vanilla Snapshot",
      minecraftVersion: "1.21.5",
      loader: "vanilla",
      loaderVersion: null,
      presetId: null,
      modpack: null,
      memoryMb: null,
      jvmArgs: [],
      mods: [],
      createdAt: now - 5 * DAY,
      lastPlayedAt: null,
    },
  ];
}

export function initialPresets(): Preset[] {
  return [
    {
      id: "preset-performance",
      name: "Performance",
      description: "Sodium, Lithium und FerriteCore mit G1GC-Tuning für flüssige Frameraten.",
      inheritsFrom: null,
      excludeMods: [],
      mods: ["sodium", "lithium", "ferritecore"].map(byId),
      jvmArgs: ["-XX:+UseG1GC", "-XX:MaxGCPauseMillis=50", "-XX:+ParallelRefProcEnabled"],
      memoryMb: 6144,
      gameSettings: { renderDistance: "16", maxFps: "240", graphicsMode: "fancy" },
      createdAt: now - 60 * DAY,
    },
    {
      id: "preset-qol",
      name: "Komfort",
      description: "Minimap, AppleSkin und Mod Menu – kleine Helfer für den Alltag.",
      inheritsFrom: null,
      excludeMods: [],
      mods: ["xaeros-minimap", "appleskin", "modmenu"].map(byId),
      jvmArgs: [],
      memoryMb: null,
      gameSettings: { guiScale: "3" },
      createdAt: now - 20 * DAY,
    },
  ];
}

export const MOCK_MODPACKS: Modpack[] = [
  {
    id: "pack-cobblemon",
    name: "Cobblemon Official",
    description: "Fangen, trainieren und kämpfen – Kreaturen-Abenteuer in der Blockwelt.",
    minecraftVersion: "1.21.1",
    loader: "fabric",
    mods: ["sodium", "modmenu", "appleskin"].map(byId),
  },
  {
    id: "pack-create-above",
    name: "Create: Above and Beyond",
    description: "Automatisierung und Technik rund um Create – mit Questbuch.",
    minecraftVersion: "1.16.5",
    loader: "forge",
    mods: ["create", "jei"].map(byId),
  },
  {
    id: "pack-fabulously",
    name: "Fabulously Optimized",
    description: "Leichtgewichtiges Performance-Paket, nah am Vanilla-Gefühl.",
    minecraftVersion: "1.21.4",
    loader: "fabric",
    mods: ["sodium", "lithium", "iris", "ferritecore", "modmenu"].map(byId),
  },
  {
    id: "pack-atm",
    name: "All the Mods 10",
    description: "Hunderte Mods, Magie und Technik – für lange Nächte.",
    minecraftVersion: "1.21.1",
    loader: "neoforge",
    mods: ["jei", "create", "xaeros-minimap"].map(byId),
  },
];

export const MOCK_NEWS: NewsItem[] = [
  {
    id: "n1",
    title: "Minecraft 1.21.5 ist da",
    excerpt: "Neue Tier-Varianten, fallende Blätter und überarbeitete Spawn-Eier.",
    tag: "Update",
    date: now - 2 * DAY,
  },
  {
    id: "n2",
    title: "Presets: Setups in Sekunden",
    excerpt: "Mods, JVM-Argumente und RAM als Vorlage speichern und auf Instanzen anwenden.",
    tag: "Launcher",
    date: now - 6 * DAY,
  },
  {
    id: "n3",
    title: "Modrinth-Anbindung in Arbeit",
    excerpt: "Bald durchsuchst und installierst du Mods direkt aus dem Launcher.",
    tag: "Vorschau",
    date: now - 12 * DAY,
  },
];

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
