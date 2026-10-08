// Beispieldaten des Browser-Mocks; nur im Dev-Modus dynamisch geladen (siehe api.ts).
import { t } from "@/i18n";
import { DAY, HOUR } from "./time";
import { EMPTY_LAUNCH } from "./launchSettings";
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
    fileName: `${slug}-${version}.${kind === "mod" ? "jar" : "zip"}`,
    sha1: null,
    enabled: true,
    kind,
    requiredBy,
    pinned: false,
    packManaged: false,
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
  mod("faithful", "Faithful 32x", "1.21.4", "local", "resourcepack"),
  mod("complementary", "Complementary Reimagined", "r5.4", "local", "shader"),
];

/** Wie das Backend einen Pack-Import einträgt: alles vom Pack verwaltet. */
const fromPack = (m: Mod): Mod => ({ ...m, packManaged: true });

const byId = (slug: string): Mod => {
  const found = MOCK_MODS.find((m) => m.id === (PROJECT_IDS[slug] ?? slug));
  if (!found) throw new Error(t("mock.mods.missingEntry", { slug }));
  return { ...found };
};

/** Was eine neue Instanz wie im Backend (`Instance::from_new`) ohne eigene Werte mitbringt. */
type DerivedInstanceFields = "id" | "name" | "minecraftVersion" | "loader" | "loaderVersion" | "mods" | "createdAt";

export const blankInstanceFields = (): Omit<Instance, DerivedInstanceFields> => ({
  modpack: null,
  memoryMb: null,
  minMemoryMb: null,
  jvmArgs: [],
  javaPath: null,
  window: { type: "default" },
  gameArgs: [],
  launch: { ...EMPTY_LAUNCH },
  playtimeSecs: 0,
  group: null,
  notes: "",
  importedFrom: null,
  icon: null,
  scene: null,
  backupWorlds: null,
  lastPlayedAt: null,
  lastQuickPlay: null,
  defaultAccount: null,
  modProfiles: [],
  activeModProfile: null,
});

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
      // Echte, ältere Versionen der Packs: so zeigt der Browser verfügbare Pack-Updates.
      modpack: { type: "modrinth", projectId: "1KVo5zza", versionId: "ycMG7i3Q" },
      mods: ["lithium", "iris", "modmenu", "fabric-api", "appleskin", "fresh-animations", "faithful", "complementary"].map(byId).map(fromPack),
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
      modpack: { type: "modrinth", projectId: "shFhR8Vx", versionId: "Ur9uoHH5" },
      mods: ["create", "jei", "xaeros-minimap", "ferritecore"].map(byId).map(fromPack),
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
        [
          "inst-neo", "NeoForge Abenteuer mit sehr langem Namen für den Test", "1.21.1", "neoforge",
          ["jei", "xaeros-minimap", "ferritecore"], 20, "Modpacks",
        ],
        ["inst-pvp", "PvP Training", "1.21.4", "fabric", ["sodium", "lithium", "fabric-api", "custom-hud"], 30, "Mit Freunden"],
        ["inst-retro", "Retro 1.16", "1.16.5", "vanilla", [], 60, null],
      ] as const
    ).map(([id, name, minecraftVersion, loader, mods, days, group]): Instance => ({
      ...blankInstanceFields(),
      id, name, minecraftVersion, loader, loaderVersion: null, group, playtimeSecs: days * 1800,
      mods: mods.map(byId), createdAt: now - (days + 10) * DAY, lastPlayedAt: now - days * DAY,
    })),
  ];
}

const CROWDED_MOD_COUNT = 400;

/** `?mock=viele`: eine Instanz mit sehr vielen Inhalten, um lange Listen zu prüfen. */
export function crowdedInstance(): Instance {
  const mods = Array.from({ length: CROWDED_MOD_COUNT }, (_, i): Mod => {
    const slug = `beispiel-${String(i + 1).padStart(3, "0")}`;
    const source = i % 10 === 0 ? "local" : i % 5 === 0 ? "curseforge" : "modrinth";
    const made = mod(slug, `Beispiel-Mod ${i + 1}`, `1.${i % 7}.0`, source);
    const origin: Mod["source"] = source === "modrinth" ? { type: "modrinth", projectId: slug, versionId: made.version } : made.source;
    return { ...made, id: slug, source: origin, enabled: i % 13 !== 0, packManaged: i % 3 === 0 };
  });
  return {
    ...blankInstanceFields(),
    id: "inst-crowded",
    name: "Mega-Pack (400 Mods)",
    minecraftVersion: "1.21.4",
    loader: "fabric",
    loaderVersion: "0.16.10",
    mods,
    createdAt: now - 3 * DAY,
    lastPlayedAt: now - DAY,
  };
}

export const MOCK_VERSIONS: VersionEntry[] = (
  [
    ["1.21.11", "release"],
    ["25w41a", "snapshot"],
    ["1.21.10", "release"],
    ["1.21.8", "release"],
    ["1.21.4", "release"],
    ["1.21.1", "release"],
    ["1.20.4", "release"],
    ["1.20.1", "release"],
    ["1.19.4", "release"],
    ["1.18.2", "release"],
    ["1.16.5", "release"],
    ["1.12.2", "release"],
    ["1.8.9", "release"],
    ["1.7.10", "release"],
  ] as const
).map(([id, type], i) => ({ id, type, url: "", sha1: "", releaseTime: new Date(now - i * 40 * DAY).toISOString() }));

const GIB = 1024 ** 3;
const MIB = 1024 ** 2;
const PRISM_ROOT = "C:\\Users\\Steve\\AppData\\Roaming\\PrismLauncher";
const MODRINTH_ROOT = "C:\\Users\\Steve\\AppData\\Roaming\\ModrinthApp";
const CURSEFORGE_ROOT = "C:\\Users\\Steve\\curseforge\\minecraft";
const ATLAUNCHER_ROOT = "C:\\Users\\Steve\\AppData\\Roaming\\ATLauncher";
/** 16×16-Bild, wie ein eigenes Prism-Icon als `data:`-URL ankäme. */
const MOCK_ICON =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAIAAACQkWg2AAAANUlEQVR4nGOocJMjCTFUuMmdyAOhZz0az3o08LMRGohR/axHA6qBSNUoGoh01agfRpgfSEIA5VJSdsQZAegAAAAASUVORK5CYII=";

/** Eine erkannte Instanz: Ordner wie bei dem jeweiligen Launcher (Prism legt das Spiel in `minecraft` ab), ohne eigene Einstellungen. */
function foreign(
  launcher: ForeignInstance["launcher"],
  root: string,
  folder: string,
  found: Pick<ForeignInstance, "name" | "minecraftVersion" | "loader" | "loaderVersion" | "contents"> & Partial<ForeignInstance>,
): ForeignInstance {
  const path = `${root}\\${launcher === "modrinth" ? "profiles" : launcher === "curseforge" ? "Instances" : "instances"}\\${folder}`;
  return {
    launcher, root, path, gameDir: launcher === "prism" ? `${path}\\minecraft` : path,
    imported: false, unsupported: null, memoryMb: null, jvmArgs: [], javaPath: null, window: { type: "default" },
    group: null, notes: "", icon: null, notAdopted: [], ...found,
  };
}

/** Instanzen anderer Launcher, wie `import_detect` sie an den Standardorten fände. */
export const mockForeign = (): ForeignInstance[] => [
  foreign("prism", PRISM_ROOT, "Create Above & Beyond", {
    name: "Create Above & Beyond", minecraftVersion: "1.18.2", loader: "forge", loaderVersion: "40.2.0",
    contents: { sizeBytes: 1.8 * GIB, mods: 11, worlds: 3 }, memoryMb: 8192,
    jvmArgs: ["-Xms512M", "-XX:+UseG1GC"], group: "Modpacks",
    notAdopted: ["preLaunchCommand", "wrapperCommand"],
  }),
  foreign("prism", PRISM_ROOT, "Survival mit Freunden", {
    name: "Survival mit Freunden", minecraftVersion: "1.21.1", loader: "fabric", loaderVersion: "0.16.10",
    contents: { sizeBytes: 612 * MIB, mods: 8, worlds: 2 }, memoryMb: 6144,
    javaPath: "C:\\Program Files\\Java\\jdk-21\\bin\\javaw.exe", window: { type: "size", width: 1600, height: 900 },
    group: "Mit Freunden", notes: t("mock.import.notes"), icon: MOCK_ICON,
  }),
  foreign("prism", PRISM_ROOT, "Tekkit Classic", {
    name: "Tekkit Classic", minecraftVersion: "1.7.10", loader: "forge", loaderVersion: "10.13.4.1614",
    contents: { sizeBytes: 940 * MIB, mods: 11, worlds: 1 }, memoryMb: 4096,
    unsupported: t("mock.import.oldForge", { mc: "1.7.10" }),
  }),
  foreign("modrinth", MODRINTH_ROOT, "Fabulously Optimized", {
    name: "Fabulously Optimized", minecraftVersion: "1.21.4", loader: "fabric", loaderVersion: "0.16.14",
    contents: { sizeBytes: 305 * MIB, mods: 11, worlds: 0 },
  }),
  foreign("curseforge", CURSEFORGE_ROOT, "All the Mods 10", {
    name: "All the Mods 10", minecraftVersion: "1.21.1", loader: "neoforge", loaderVersion: "21.1.172",
    contents: { sizeBytes: 4.2 * GIB, mods: 11, worlds: 2 }, memoryMb: 10240,
  }),
  foreign("atlauncher", ATLAUNCHER_ROOT, "Better MC", {
    name: "Better MC", minecraftVersion: "1.20.1", loader: "forge", loaderVersion: "47.3.0",
    contents: { sizeBytes: 1.1 * GIB, mods: 9, worlds: 1 }, memoryMb: 6144, notAdopted: ["jvmArgs"],
  }),
];

/** Mods, die der Import-Mock für eine erkannte Instanz anlegt: so viele, wie `contents.mods` nennt (die Beispiele sind klein). */
export const importedMods = (found: ForeignInstance): Mod[] =>
  MOCK_MODS.filter((m) => m.kind === "mod").slice(0, found.contents.mods).map((m) => ({ ...m }));

