// Import mit Endung: Dieses Modul lädt auch das plain-node-Prüf-Skript (kein Bundler, der Auflösung macht).
import { t } from "../i18n/core.ts";
import type { ContentVersion } from "./content-types";
import type { Mod } from "./types";

/** Modpack-Datei im Modrinth-Format; wird immer eine eigene Instanz. */
export const MRPACK_EXT = /\.mrpack$/i;
export const isMrpack = (path: string) => MRPACK_EXT.test(path);

export const projectOf = (m: Mod): string | null => (m.source.type === "modrinth" ? m.source.projectId : null);

/** Wie `projectOf`, aber auch für CurseForge (`cf-<Nummer>`): so verweisen `requiredBy` und Besitzer aufeinander. */
export const ownerKey = (m: Mod): string | null => projectOf(m) ?? (m.source.type === "curseforge" ? `cf-${m.source.projectId}` : null);

/** Automatische Versionswahl: neueste stabile Version, sonst die neueste überhaupt (Liste kommt neueste zuerst). */
export function pickVersion(versions: ContentVersion[]): ContentVersion | null {
  return versions.find((v) => v.version_type === "release") ?? versions[0] ?? null;
}

/**
 * Entfernt `id`, streicht es aus `requiredBy` aller anderen und nimmt Abhängigkeiten mit,
 * die dadurch niemand mehr braucht. `removed[0]` ist der Eintrag selbst.
 */
export function removeWithDependencies(mods: Mod[], id: string): { mods: Mod[]; removed: Mod[] } {
  const target = mods.find((m) => m.id === id);
  if (!target) return { mods, removed: [] };
  const project = ownerKey(target);
  const removed = [target];
  const kept: Mod[] = [];
  for (const m of mods) {
    if (m === target) continue;
    const requiredBy = m.requiredBy.filter((p) => p !== project);
    if (m.requiredBy.length > 0 && requiredBy.length === 0) removed.push(m);
    else kept.push(requiredBy.length === m.requiredBy.length ? m : { ...m, requiredBy });
  }
  return { mods: kept, removed };
}

/** Rückgängig: Stand von vorher, aber Änderungen seit dem Entfernen (Schalter, neue Inhalte, anderes Entfernen) bleiben. */
export function undoRemove(current: Mod[], before: Mod[], removed: Mod[]): Mod[] {
  const gone = new Set(removed.map((m) => m.id));
  const now = new Map(current.map((m) => [m.id, m]));
  const known = new Set(before.map((m) => m.id));
  return [
    ...before.flatMap((m) => {
      if (gone.has(m.id)) return [m];
      const cur = now.get(m.id);
      return cur ? [{ ...cur, requiredBy: m.requiredBy }] : [];
    }),
    ...current.filter((m) => !known.has(m.id)),
  ];
}

// Pumpkin Launcher installiert Packs mit jedem unterstützten Loader.
const PACK_LOADERS = ["fabric", "quilt", "forge", "neoforge", "minecraft", "vanilla"];

/** Modrinth-Loader, deren Mods eine Instanz ausführt: Quilt lädt auch Fabric-Mods (wie `ModLoader::modrinth_loaders` im Backend). */
export const modLoadersFor = (loader: string): string[] => (loader === "quilt" ? ["quilt", "fabric"] : loader === "vanilla" ? [] : [loader]);

/** Ohne Loader-Angabe (Technic) erkennt das Backend den Loader erst beim Laden des Packs. */
export const isPackVersionSupported = (v: ContentVersion) => v.loaders.length === 0 || v.loaders.some((l) => PACK_LOADERS.includes(l));

/** Pack-Version für eine neue Instanz: neueste stabile mit unterstütztem Loader, sonst ein kurzer Grund. */
export function pickPackVersion(versions: ContentVersion[]): { version: ContentVersion | null; reason: string | null } {
  const version = pickVersion(versions.filter(isPackVersionSupported));
  if (version) return { version, reason: null };
  return { version: null, reason: versions.length ? t("components.pack.noSupportedVersion") : t("components.pack.noVersionAvailable") };
}
