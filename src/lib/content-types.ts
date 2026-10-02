// Modrinth-Katalog bleibt snake_case; Instanzen und Events sind camelCase.
export interface ContentHit {
  project_id: string; slug: string; title: string; description: string;
  icon_url: string | null; project_type: string; downloads: number; author: string; categories: string[];
}
export type CatalogType = "mod" | "modpack" | "resourcepack" | "shader" | "datapack";
/** Sortierung der Modrinth-Suche. */
export type SearchIndex = "relevance" | "downloads" | "follows" | "newest" | "updated";
/** Ohne Wahl: Downloads ohne Suchbegriff, sonst Relevanz. */
export const defaultSort = (query: string): SearchIndex => (query ? "relevance" : "downloads");
/** Ein Projekt mit Titel, wie es Aktionen und Dialoge brauchen; jedes `ContentProject` erfüllt das. */
export interface ProjectRef { id: string; title: string }
export interface ContentSearch { hits: ContentHit[]; total_hits: number; offset: number; limit: number }
/** Ein Bild der Projektseite (Modrinth-Galerie). */
export interface GalleryImage { url: string; featured: boolean; title: string | null; description: string | null }
export interface ContentProject {
  id: string; slug: string; title: string; description: string; body: string;
  icon_url: string | null; project_type: string; client_side: string; server_side: string;
  downloads: number; categories: string[]; gallery: GalleryImage[];
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
  /** Treffer lassen sich auf eine Kategorie des Anbieters eingrenzen. */
  categories: boolean;
  /** Minecraft-Version lässt sich filtern. */
  versions: boolean;
}
export const SOURCES: Record<Source, SourceInfo> = {
  modrinth: {
    label: "Modrinth", types: ["modpack", "mod", "shader", "resourcepack", "datapack"], install: true, filters: true, categories: true, versions: true,
  },
  ftb: { label: "FTB", types: ["modpack"], install: true, filters: true, categories: false, versions: true },
  technic: { label: "Technic", types: ["modpack"], install: true, filters: false, categories: false, versions: true },
  curseforge: { label: "CurseForge", types: ["modpack", "mod", "shader", "resourcepack"], install: true, filters: true, categories: false, versions: true },
};
export const SOURCE_KEYS = Object.keys(SOURCES) as Source[];
/** Alle Quellen, die den Katalogtyp führen, in einer Liste („Alle Quellen“ in Entdecken). */
export const ALL_SOURCES = "all";
export type SourceChoice = Source | typeof ALL_SOURCES;
/** Was eine Auswahl kann: bei „Alle“ alles, was mindestens eine Quelle kann. */
export function choiceInfo(choice: SourceChoice): Pick<SourceInfo, "types" | "filters" | "categories" | "versions"> {
  if (choice !== ALL_SOURCES) return SOURCES[choice];
  const all = Object.values(SOURCES);
  return {
    types: [...new Set(all.flatMap((s) => s.types))],
    filters: all.some((s) => s.filters),
    categories: all.some((s) => s.categories),
    versions: all.some((s) => s.versions),
  };
}
/** Die Quellen, die Projekte dieses Typs führen. */
export const sourcesFor = (type: CatalogType) => SOURCE_KEYS.filter((s) => SOURCES[s].types.includes(type));
/** Ein Treffer samt der Quelle, aus der er kommt. */
export interface CatalogHit extends ContentHit { source: Source }
/** Ab welchem Versatz jede Quelle weitersucht; fehlt eine Quelle, hat sie nichts mehr. */
export type SearchOffsets = Partial<Record<Source, number>>;
/** Eine Seite der Suche über eine oder mehrere Quellen. `failed`: Quellen, die nicht antworteten. */
export interface SearchPage { hits: CatalogHit[]; total: number; next: SearchOffsets | null; failed: Source[] }
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
  /** ISO-8601; leer, wo der Anbieter kein Datum nennt. */
  date_published: string;
  /** Änderungsprotokoll (Markdown); null, wo der Anbieter keins führt. */
  changelog: string | null;
  files: { filename: string; primary: boolean; url: string; size: number; hashes: Record<string, string> }[];
  dependencies: { project_id: string | null; version_id: string | null; dependency_type: string }[];
}
export interface ModUpdate { modId: string; currentVersion: string; versionId: string; versionNumber: string }
