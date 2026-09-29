// Nur im Browser-Dev-Modus dynamisch geladen (siehe api.ts); im Release-Build nicht enthalten.
import type { ContentProgress, ContentVersion } from "./modrinth";
import { INSTALL_CANCELLED, type Instance, type ModLoader } from "./types";

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Stellvertreter für die Pack-Inhalte: echte .mrpack-Dateien werden im Browser nicht gelesen.
const PACK_MODS = [
  ["AANobbMI", "Sodium"], ["gvQqBUqZ", "Lithium"], ["P7dR8mSH", "Fabric API"], ["mOgUt4GM", "Mod Menu"], ["YL57xq9U", "Iris Shaders"],
] as const;

/** Simuliert `modrinth_install_pack`: neue Instanz mit ein paar Mods und Fortschritts-Events. */
export function createPackMock(db: { instances: Instance[]; cancelled: Set<string> }, emit: (event: string, payload: ContentProgress) => void) {
  return async (versionId: string, name: string, operationId: string): Promise<Instance> => {
    const progress = (phase: string, done: number, total: number) => emit("content-progress", { operationId, phase, done, total });
    progress("resolve", 0, 1);
    const res = await fetch(`https://api.modrinth.com/v2/version/${versionId}`);
    if (!res.ok) throw new Error(`Modrinth antwortet nicht (${res.status})`);
    const version: ContentVersion = await res.json();
    const loader: ModLoader = version.loaders.includes("fabric") ? "fabric" : "vanilla";
    if (loader === "vanilla" && !version.loaders.some((l) => l === "minecraft" || l === "vanilla"))
      throw new Error("Dieses Modpack braucht einen Mod-Loader, den Voxlet noch nicht kann.");
    const mods = loader === "fabric" ? PACK_MODS : [];
    for (let i = 0; i < mods.length; i++) {
      if (db.cancelled.delete(operationId)) throw new Error(INSTALL_CANCELLED);
      progress("download", i, mods.length);
      await wait(900);
    }
    const inst: Instance = {
      id: `inst-${crypto.randomUUID().slice(0, 8)}`,
      name,
      minecraftVersion: version.game_versions.at(-1) ?? "1.21.1",
      loader,
      loaderVersion: null,
      modpack: { type: "modrinth", projectId: version.project_id, versionId },
      memoryMb: null,
      jvmArgs: [],
      mods: mods.map(([id, modName]) => ({
        id, name: modName, version: "1.0.0", kind: "mod", requiredBy: [], enabled: true, sha1: null,
        source: { type: "modrinth", projectId: id, versionId: `mock-${id}` }, fileName: `${id}.jar`,
      })),
      createdAt: Date.now(),
      lastPlayedAt: null,
    };
    db.instances.push(inst);
    progress("complete", mods.length, mods.length);
    return structuredClone(inst);
  };
}
