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
  exportSummary: (id: string, include: string[]) => ["export-summary", id, include] as const,
};

/** Was die Dateien einer Instanz hergeben: Analyse (mit Stand der Inhaltsliste) und gewählte Pakete. */
export const contentKeys = {
  analysis: (instanceId: string, signature: string) => ["content-analysis", instanceId, signature] as const,
  packs: (instanceId: string) => ["pack-selection", instanceId] as const,
};

export const templateKeys = { all: ["templates"] as const };
export const announcementKeys = { all: ["announcements"] as const };

/** Pack-Updates und Wechsel von Minecraft-Version oder Loader einer Instanz. */
export const lifecycleKeys = {
  changelog: (instanceId: string, versionId: string) => ["pack-changelog", instanceId, versionId] as const,
  migrationCheck: (instanceId: string, mc: string, loader: ModLoader, loaderVersion: string | null) =>
    ["migration-check", instanceId, mc, loader, loaderVersion] as const,
};

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

/** Status der Server einer Instanz; außerhalb von `worldKeys`, damit Welt-Änderungen keine neuen Pings auslösen. */
export const serverStatusKeys = {
  all: (instanceId: string) => ["server-status", instanceId] as const,
  one: (instanceId: string, address: string) => ["server-status", instanceId, address] as const,
};

export const logKeys = {
  /** Gesicherte Sitzungen einer Instanz samt ihrer Texte. */
  all: (instanceId: string) => ["log-sessions", instanceId] as const,
  sessions: (instanceId: string) => ["log-sessions", instanceId, "list"] as const,
  session: (instanceId: string, sessionId: string) => ["log-sessions", instanceId, sessionId] as const,
};

/** Befunde des Absturzassistenten zum letzten Absturz einer Instanz. */
export const crashKeys = { diagnosis: (instanceId: string) => ["crash-diagnosis", instanceId] as const };

export const screenshotKeys = { list: (instanceId: string) => ["screenshots", instanceId] as const };

export const skinKeys = {
  library: ["skins"] as const,
  texture: (id: string) => ["skins", "texture", id] as const,
  /** Pixel-Fingerabdruck einer Textur; `key` ist die ID des Bibliotheks-Skins bzw. die Adresse der Online-Textur. */
  signature: (key: string) => ["skins", "signature", key] as const,
  profile: (accountId: string) => ["skin-profile", accountId] as const,
};

export const accountKeys = { microsoft: ["ms-accounts"] as const };

/**
 * Freunde. `all` fasst zusammen, was das Ereignis `friends-changed` auffrischt. Skins, Beitrittspläne und die Zustände je Instanz
 * haben eigene Wurzeln, damit ein Freunde-Ereignis weder Skins neu lädt noch beim Gastgeber das Manifest neu anfordert.
 */
export const friendKeys = {
  all: ["friends"] as const,
  state: ["friends", "state"] as const,
  list: ["friends", "list"] as const,
  requests: ["friends", "requests"] as const,
  codes: ["friends", "codes"] as const,
  blocked: ["friends", "blocked"] as const,
  invites: ["friends", "invites"] as const,
  hostSessions: ["friends", "host-sessions"] as const,
  skin: (friendId: string) => ["friend-skin", friendId] as const,
  plan: (inviteId: string) => ["friend-invite-plan", inviteId] as const,
  lan: (instanceId: string) => ["friend-lan", instanceId] as const,
  modStatus: (instanceId: string) => ["friend-mod-status", instanceId] as const,
  /** Die Vorgänge aus dem Spiel; eine eigene Wurzel, damit `friends-changed` sie nicht neu lädt. */
  modActivity: ["friend-mod-activity"] as const,
};

export const importKeys = { foreign: ["foreign-instances"] as const };

/** Ob `modrinth://` und `curseforge://` dem Launcher gehören (das System weiß es). */
export const deepLinkKeys = { foreign: ["deep-link-foreign"] as const };

export const appKeys = {
  update: ["app-update"] as const,
  systemMemory: ["system-memory"] as const,
  javaInstalls: ["java-installs"] as const,
  storage: ["storage"] as const,
  minecraftVersions: ["versions"] as const,
  loaderVersions: (loader: ModLoader, minecraftVersion: string) => ["loader-versions", loader, minecraftVersion] as const,
};

/** Modrinth hat eigene Schlüssel, die übrigen Anbieter teilen sich die `catalog-…`-Schlüssel mit der Quelle als Teil. */
export const catalogKeys = {
  search: (source: SourceChoice, type: CatalogType, query: string, mc: string | null, loader: string | null, category: string | null, index: SearchIndex) =>
    source === "modrinth"
      ? (["modrinth-search", type, query, mc, loader, category, index] as const)
      : (["catalog-search", source, type, query, mc, loader, category, index] as const),
  /** Trefferzahl einer Suche (erste Seite), z. B. „Auch 12 Treffer unter Mods“. */
  searchTotal: (source: SourceChoice, type: CatalogType, query: string, mc: string | null, loader: string | null) =>
    ["catalog-search-total", source, type, query, mc, loader] as const,
  /** Die kuratierte Einstiegsauswahl eines Typs. */
  starter: (type: CatalogType) => ["modrinth-starter", type] as const,
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
