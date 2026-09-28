// Backend-Vertrag (serde camelCase). Zeiten = Unix-Millisekunden.

export type ModLoader = "vanilla" | "fabric" | "quilt" | "forge" | "neoforge";
export type ModSource =
  | { type: "local" }
  | { type: "url"; url: string }
  | { type: "modrinth"; projectId: string; versionId: string }
  | { type: "curseforge"; projectId: number; fileId: number };

export type ModSourceType = ModSource["type"];

export interface Mod {
  id: string;
  name: string;
  version: string;
  source: ModSource;
  fileName: string;
  /** SHA-1 der JAR, Schlüssel im globalen Mod-Cache. */
  sha1: string | null;
  enabled: boolean;
}

/** Herkunft einer aus einem Modpack installierten Instanz. */
export type ModpackOrigin =
  | { type: "modrinth"; projectId: string; versionId: string }
  | { type: "curseforge"; projectId: number; fileId: number };

export interface Instance {
  id: string;
  name: string;
  minecraftVersion: string;
  loader: ModLoader;
  loaderVersion: string | null;
  presetId: string | null;
  modpack: ModpackOrigin | null;
  memoryMb: number | null;
  jvmArgs: string[];
  mods: Mod[];
  createdAt: number;
  lastPlayedAt: number | null;
}

export interface NewInstance {
  name: string;
  minecraftVersion: string;
  loader: ModLoader;
  loaderVersion: string | null;
}

export interface Preset {
  id: string;
  name: string;
  description: string;
  inheritsFrom: string | null;
  excludeMods: string[];
  mods: Mod[];
  jvmArgs: string[];
  memoryMb: number | null;
  gameSettings: Record<string, string>;
  createdAt: number;
}

export interface NewPreset {
  name: string;
  description: string;
  inheritsFrom: string | null;
  excludeMods: string[];
  mods: Mod[];
  jvmArgs: string[];
  memoryMb: number | null;
  gameSettings: Record<string, string>;
}

// Nur Frontend: Katalogeintrag, bis die Modrinth-Suche angebunden ist.
export interface Modpack {
  id: string;
  name: string;
  description: string;
  minecraftVersion: string;
  loader: ModLoader;
  mods: Mod[];
}

export type AccountKind = "microsoft" | "offline";

export interface Account {
  id: string;
  username: string;
  kind: AccountKind;
  active: boolean;
}

// Nur Frontend (kein Backend-Vertrag)
export interface NewsItem {
  id: string;
  title: string;
  excerpt: string;
  tag: string;
  date: number;
}

export const LOADERS: ModLoader[] = ["vanilla", "fabric", "quilt", "forge", "neoforge"];

export const LOADER_LABELS: Record<ModLoader, string> = {
  vanilla: "Vanilla",
  fabric: "Fabric",
  quilt: "Quilt",
  forge: "Forge",
  neoforge: "NeoForge",
};

export const SOURCE_LABELS: Record<ModSourceType, string> = {
  modrinth: "Modrinth",
  curseforge: "CurseForge",
  url: "URL",
  local: "Lokal",
};
