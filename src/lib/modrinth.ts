import type { Mod } from "./types";

// Modrinth-Katalog bleibt snake_case; Instanzen und Events sind camelCase.
export interface ContentHit {
  project_id: string; slug: string; title: string; description: string;
  icon_url: string | null; project_type: string; downloads: number; author: string; categories: string[];
}
export type CatalogType = "mod" | "modpack" | "resourcepack" | "shader";
/** Sortierung der Modrinth-Suche. */
export type SearchIndex = "relevance" | "downloads" | "follows" | "newest" | "updated";
export interface ContentSearch { hits: ContentHit[]; total_hits: number; offset: number; limit: number }
export interface ContentProject {
  id: string; slug: string; title: string; description: string; body: string;
  icon_url: string | null; project_type: string; client_side: string; server_side: string;
}
export interface ContentVersion {
  id: string; project_id: string; name: string; version_number: string;
  game_versions: string[]; loaders: string[]; version_type: "release" | "beta" | "alpha";
  files: { filename: string; primary: boolean; url: string; size: number; hashes: Record<string, string> }[];
  dependencies: { project_id: string | null; version_id: string | null; dependency_type: string }[];
}
export interface ContentProgress { operationId: string; phase: string; done: number; total: number }
export interface ModUpdate { modId: string; currentVersion: string; versionId: string; versionNumber: string }

/** Fortschritt in Alltagssprache statt „resolve: 0 / 1“. */
export function progressLabel(p: ContentProgress | null): string {
  if (!p || p.phase === "resolve" || p.phase === "validate") return "Wird geprüft…";
  if (p.phase === "download") return p.total ? `Lädt ${Math.min(p.done + 1, p.total)} von ${p.total}…` : "Lädt…";
  if (p.phase === "extract") return "Wird entpackt…";
  return "Fertig";
}

export const formatDownloads = (n: number) => new Intl.NumberFormat("de", { notation: "compact" }).format(n);

export const projectOf = (m: Mod): string | null => (m.source.type === "modrinth" ? m.source.projectId : null);

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
  const project = projectOf(target);
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

// Voxlet installiert Packs mit jedem unterstützten Loader.
const PACK_LOADERS = ["fabric", "quilt", "forge", "neoforge", "minecraft", "vanilla"];

/** Modrinth-Loader, deren Mods eine Instanz ausführt: Quilt lädt auch Fabric-Mods (wie `ModLoader::modrinth_loaders` im Backend). */
export const modLoadersFor = (loader: string): string[] => (loader === "quilt" ? ["quilt", "fabric"] : loader === "vanilla" ? [] : [loader]);

export const isPackVersionSupported = (v: ContentVersion) => v.loaders.some((l) => PACK_LOADERS.includes(l));

/** Pack-Version für eine neue Instanz: neueste stabile mit unterstütztem Loader, sonst ein kurzer Grund. */
export function pickPackVersion(versions: ContentVersion[]): { version: ContentVersion | null; reason: string | null } {
  const version = pickVersion(versions.filter(isPackVersionSupported));
  if (version) return { version, reason: null };
  return { version: null, reason: versions.length ? "Keine unterstützte Version" : "Keine Version verfügbar" };
}
