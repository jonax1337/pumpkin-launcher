// Beispieldaten des Browser-Mocks; nur im Dev-Modus dynamisch geladen (siehe api.ts).
import { t } from "@/i18n";
import { DAY, HOUR } from "./time";
import type { ForeignInstance, Instance, Mod, ModKind, VersionEntry } from "./types";

const now = Date.now();

// Modrinth-Einträge tragen echte Projekt-IDs (wie im Backend: `id` = Projekt-ID), damit Icons im Browser erscheinen.
export const PROJECT_IDS: Record<string, string> = {
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

const MOCK_MODS: Mod[] = [
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
  if (!found) throw new Error(t("mock.mods.missingEntry", { slug }));
  return { ...found };
};

/** Was eine neue Instanz wie im Backend (`Instance::from_new`) ohne eigene Werte mitbringt. */
export const blankInstanceFields = (): Pick<
  Instance, "modpack" | "memoryMb" | "jvmArgs" | "javaPath" | "window" | "gameArgs" | "playtimeSecs" | "group" | "importedFrom" | "lastPlayedAt" | "lastQuickPlay"
> => ({ modpack: null, memoryMb: null, jvmArgs: [], javaPath: null, window: { type: "default" }, gameArgs: [], playtimeSecs: 0, group: null, importedFrom: null, lastPlayedAt: null, lastQuickPlay: null });

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
      lastPlayedAt: now - 2 * HOUR,
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

/** Instanzen anderer Launcher, wie `import_detect` sie an den Standardorten fände. */
export const MOCK_FOREIGN: ForeignInstance[] = (
  [
    ["prism", "Create Above & Beyond", "1.18.2", "forge", "40.2.0", "AppData\\Roaming\\PrismLauncher\\instances"],
    ["prism", "Survival mit Freunden", "1.21.1", "fabric", "0.16.10", "AppData\\Roaming\\PrismLauncher\\instances"],
    ["modrinth", "Fabulously Optimized", "1.21.4", "fabric", "0.16.14", "AppData\\Roaming\\ModrinthApp\\profiles"],
    ["curseforge", "All the Mods 10", "1.21.1", "neoforge", "21.1.172", "curseforge\\minecraft\\Instances"],
  ] as const
).map(([launcher, name, minecraftVersion, loader, loaderVersion, dir]) => ({
  launcher, name, minecraftVersion, loader, loaderVersion, path: `C:\\Users\\Steve\\${dir}\\${name}`, gameDir: "", imported: false, unsupported: null, memoryMb: 6144, jvmArgs: [],
}));
