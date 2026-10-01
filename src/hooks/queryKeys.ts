// Alle Query-Schlüssel an einer Stelle (eigene Datei, damit sich die Hook-Module nicht gegenseitig importieren müssen).
// Wer eine Abfrage auffrischen will, nennt den Schlüssel hier statt eine Zeichenkette zu tippen.
import type { CatalogType, SearchIndex, Source, SourceChoice } from "@/lib/content-types";
import type { ModLoader } from "@/lib/types";

export const instanceKeys = {
  all: ["instances"] as const,
  detail: (id: string) => ["instances", id] as const,
  /** Status aller Instanzen (Präfix von `status`). */
  statuses: ["instance-status"] as const,
  status: (id: string) => ["instance-status", id] as const,
  /** Mutationsschlüssel: Änderungen an den Inhalten einer Instanz laufen der Reihe nach. */
  mods: (id: string) => ["instance-mods", id] as const,
  exportEntries: (id: string) => ["export-entries", id] as const,
};

export const templateKeys = { all: ["templates"] as const };

/** Alles, was ein Umbau der Instanzen im Backend (Migration, Ereignis `instances-changed`) veraltet. */
export const instanceRelatedKeys = [instanceKeys.all, instanceKeys.statuses, templateKeys.all] as const;

export const worldKeys = {
  /** Welten, Sicherungen und Serverliste einer Instanz (z. B. nach dem Spielen neu laden). */
  all: (instanceId: string) => ["worlds", instanceId] as const,
  list: (instanceId: string) => ["worlds", instanceId, "list"] as const,
  backups: (instanceId: string) => ["worlds", instanceId, "backups"] as const,
  servers: (instanceId: string) => ["worlds", instanceId, "servers"] as const,
  datapacks: (instanceId: string, worldId: string) => ["worlds", instanceId, "datapacks", worldId] as const,
  quickPlay: (instanceId: string, minecraftVersion: string) => ["world-quick-play", instanceId, minecraftVersion] as const,
};

export const screenshotKeys = { list: (instanceId: string) => ["screenshots", instanceId] as const };

export const skinKeys = {
  library: ["skins"] as const,
  texture: (id: string) => ["skins", "texture", id] as const,
  profile: (accountId: string) => ["skin-profile", accountId] as const,
};

export const accountKeys = { microsoft: ["ms-accounts"] as const };

export const importKeys = { foreign: ["foreign-instances"] as const };

export const appKeys = {
  update: ["app-update"] as const,
  systemMemory: ["system-memory"] as const,
  minecraftVersions: ["versions"] as const,
  loaderVersions: (loader: ModLoader, minecraftVersion: string) => ["loader-versions", loader, minecraftVersion] as const,
};

/** Modrinth hat eigene Schlüssel, die übrigen Anbieter teilen sich die `catalog-…`-Schlüssel mit der Quelle als Teil. */
export const catalogKeys = {
  search: (source: SourceChoice, type: CatalogType, query: string, mc: string | null, loader: string | null, index: SearchIndex) =>
    source === "modrinth"
      ? (["modrinth-search", type, query, mc, loader, index] as const)
      : (["catalog-search", source, type, query, mc, loader, index] as const),
  /** Modpack-Auswahl im Dialog „Neue Instanz“ (andere Seitenzahl als die Suche in Entdecken). */
  packPicker: (query: string) => ["modrinth-search", "modpack", query, null, null, "pick"] as const,
  project: (source: Source, projectId: string) =>
    source === "modrinth" ? (["modrinth-project", projectId] as const) : (["catalog-project", source, projectId] as const),
  /** Versionen eines Projekts, mit `null` für Minecraft-Version und Loader alle. */
  versions: (source: Source, projectId: string, mc: string | null, loader: string | null) =>
    source === "modrinth"
      ? (["modrinth-versions", projectId, mc, loader] as const)
      : (["catalog-versions", source, projectId, mc, loader] as const),
  /** Titel und Icons der installierten Modrinth-Inhalte einer Liste. */
  projects: (ids: string[]) => ["modrinth-projects", ids] as const,
  /** Update-Check aller Instanzen (Präfix von `updates`). */
  allUpdates: ["modrinth-updates"] as const,
  updates: (instanceId: string) => ["modrinth-updates", instanceId] as const,
};
