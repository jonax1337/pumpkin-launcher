// Nur im Browser-Dev-Modus dynamisch geladen (siehe api.ts); im Release-Build nicht enthalten.
import { t } from "@/i18n";
import type { Backend } from "./backend";
import type { ContentVersion } from "./content-types";
import { blankInstanceFields } from "./mock-data";
import { clone, modrinthFetch, newId, wait, type MockContext } from "./mock-util";
import type { ContentPhase } from "./progress";
import { CANCELLED, type Instance, type ModLoader } from "./types";

// Stellvertreter für die Pack-Inhalte: echte .mrpack-Dateien werden im Browser nicht gelesen.
const PACK_MODS = [
  ["AANobbMI", "Sodium"], ["gvQqBUqZ", "Lithium"], ["P7dR8mSH", "Fabric API"], ["mOgUt4GM", "Mod Menu"], ["YL57xq9U", "Iris Shaders"],
] as const;

/** Pause je vorgetäuschtem Mod-Download. */
const MOD_DOWNLOAD_MS = 900;

/** Simuliert `modrinth_install_pack`: neue Instanz mit ein paar Mods und Fortschritts-Events. */
export function createPackMock({ db, emit }: MockContext) {
  return {
    async modrinthInstallPack(versionId, name, operationId): Promise<Instance> {
      const progress = (phase: ContentPhase, done: number, total: number) => emit("content-progress", { operationId, phase, done, total });
      progress("resolve", 0, 1);
      const version = await modrinthFetch<ContentVersion>(`/version/${versionId}`);
      const loader: ModLoader = version.loaders.includes("fabric") ? "fabric" : "vanilla";
      if (loader === "vanilla" && !version.loaders.some((l) => l === "minecraft" || l === "vanilla"))
        throw new Error(t("mock.pack.loaderUnsupported"));
      const mods = loader === "fabric" ? PACK_MODS : [];
      for (let i = 0; i < mods.length; i++) {
        if (db.cancelled.delete(operationId)) throw new Error(CANCELLED);
        progress("download", i, mods.length);
        await wait(MOD_DOWNLOAD_MS);
      }
      const inst: Instance = {
        ...blankInstanceFields(),
        id: newId("inst"),
        name,
        minecraftVersion: version.game_versions.at(-1) ?? "1.21.1",
        loader,
        loaderVersion: null,
        modpack: { type: "modrinth", projectId: version.project_id, versionId },
        mods: mods.map(([id, modName]) => ({
          id, name: modName, version: "1.0.0", kind: "mod", requiredBy: [], enabled: true, sha1: null,
          source: { type: "modrinth", projectId: id, versionId: `mock-${id}` }, fileName: `${id}.jar`,
        })),
        createdAt: Date.now(),
      };
      db.instances.push(inst);
      progress("complete", mods.length, mods.length);
      return clone(inst);
    },
  } satisfies Partial<Backend>;
}
