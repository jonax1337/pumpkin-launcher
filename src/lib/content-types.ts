// Modrinth-Katalog bleibt snake_case; Instanzen und Events sind camelCase.
export interface ContentHit {
  project_id: string; slug: string; title: string; description: string;
  icon_url: string | null; project_type: string; downloads: number; author: string; categories: string[];
}
export type CatalogType = "mod" | "modpack" | "resourcepack" | "shader" | "datapack";
/** Sortierung der Modrinth-Suche. */
export type SearchIndex = "relevance" | "downloads" | "follows" | "newest" | "updated";
export interface ContentSearch { hits: ContentHit[]; total_hits: number; offset: number; limit: number }
export interface ContentProject {
  id: string; slug: string; title: string; description: string; body: string;
  icon_url: string | null; project_type: string; client_side: string; server_side: string;
  /** Projektseite bei Anbietern ohne Installation (Technic, CurseForge). */
  web_url?: string | null;
}

/** Katalog-Quellen: Modrinth plus die Anbieter ohne API-Key (Backend: `services::providers`). */
export type Source = "modrinth" | "ftb" | "technic" | "curseforge";
export interface SourceInfo {
  label: string;
  types: CatalogType[];
  /** Pumpkin Launcher kann Packs dieser Quelle selbst installieren. */
  install: boolean;
  /** Sortierung und Loader-Filter stehen zur Verfügung. */
  filters: boolean;
  /** Minecraft-Version lässt sich filtern. */
  versions: boolean;
}
export const SOURCES: Record<Source, SourceInfo> = {
  modrinth: { label: "Modrinth", types: ["modpack", "mod", "shader", "resourcepack", "datapack"], install: true, filters: true, versions: true },
  ftb: { label: "FTB", types: ["modpack"], install: true, filters: true, versions: true },
  technic: { label: "Technic", types: ["modpack"], install: true, filters: false, versions: true },
  curseforge: { label: "CurseForge", types: ["modpack", "mod", "shader", "resourcepack"], install: true, filters: true, versions: true },
};
/** Eine Datei, die CurseForge nur über die Webseite ausliefert (Event `content-blocked`). */
export interface BlockedFile { projectId: number; fileId: number; name: string; fileName: string; url: string }
export interface ContentBlocked { operationId: string; instanceId: string; items: BlockedFile[] }
/** Schlüssel eines Projekts in `Mod.requiredBy` und „Schon drin“: Modrinth-ID oder `cf-<Nummer>`. */
export const projectKey = (source: Source, id: string) => (source === "curseforge" ? `cf-${id}` : id);
/** Schlüssel für „Schon in Instanz“: Modrinth-IDs bleiben, Anbieter bekommen ein Präfix. */
export const installedKey = (source: Source, id: string) => (source === "modrinth" ? id : `${source}:${id}`);
export interface ContentVersion {
  id: string; project_id: string; name: string; version_number: string;
  game_versions: string[]; loaders: string[]; version_type: "release" | "beta" | "alpha";
  files: { filename: string; primary: boolean; url: string; size: number; hashes: Record<string, string> }[];
  dependencies: { project_id: string | null; version_id: string | null; dependency_type: string }[];
}
export interface ModUpdate { modId: string; currentVersion: string; versionId: string; versionNumber: string }
