import { projectOf } from "@/lib/mods";
import type { Instance, ModLoader } from "@/lib/types";

/** Modrinth-Projekt „Iris Shaders“: Ohne sie bleiben Shader in einer Instanz ohne Wirkung. */
export const IRIS_PROJECT_ID = "YL57xq9U";

/** Loader, für die der Launcher Iris anbietet; auf Forge und NeoForge laufen Shader über andere Mods (etwa Oculus), die er nicht anbietet. */
const IRIS_LOADERS: ModLoader[] = ["fabric", "quilt"];

export const irisSupported = ({ loader }: Pick<Instance, "loader">) => IRIS_LOADERS.includes(loader);

/** Hat die Instanz Iris? Bei CurseForge-Einträgen gibt nur der Name Auskunft. */
export const hasIris = (instance: Instance) =>
  instance.mods.some((m) => projectOf(m) === IRIS_PROJECT_ID || (m.source.type === "curseforge" && /iris/i.test(m.name)));
