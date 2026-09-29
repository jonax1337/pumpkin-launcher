import type { Instance } from "./types";

// Modrinth-Katalog bleibt snake_case; Instanzen und Events sind camelCase.
export interface ContentHit {
  project_id: string; slug: string; title: string; description: string;
  icon_url: string | null; project_type: string; downloads: number; author: string;
}
export interface ContentSearch { hits: ContentHit[]; total_hits: number; offset: number; limit: number }
export interface ContentProject {
  id: string; slug: string; title: string; description: string; body: string;
  icon_url: string | null; project_type: string; client_side: string; server_side: string;
}
export interface ContentVersion {
  id: string; project_id: string; name: string; version_number: string;
  game_versions: string[]; loaders: string[];
  files: { filename: string; primary: boolean; url: string; size: number; hashes: Record<string, string> }[];
  dependencies: { project_id: string | null; version_id: string | null; dependency_type: string }[];
}
export interface ContentProgress { operationId: string; phase: string; done: number; total: number }
export function modCompatibility(instance: Instance | undefined, version: ContentVersion | undefined): string | null {
  if (!instance) return "Wähle eine Fabric-Instanz.";
  if (instance.loader !== "fabric") return "Mods können nur in Fabric-Instanzen installiert werden – nicht in Vanilla, Quilt, Forge oder NeoForge.";
  if (!version) return "Wähle eine Version.";
  if (!version.loaders.includes("fabric") || !version.game_versions.includes(instance.minecraftVersion)) return "Diese Version passt nicht zur Minecraft-Version und zum Fabric-Loader der Instanz.";
  return null;
}
export function isAbsoluteMrpack(path: string): boolean {
  return /^(?:[A-Za-z]:[\\/]|\\\\[^\\]+\\[^\\]+\\|\/)/.test(path) && /\.mrpack$/i.test(path);
}
