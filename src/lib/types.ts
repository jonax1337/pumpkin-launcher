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
  /** Fehlt bei alten Einträgen nie: das Backend liefert dann "mod". */
  kind: ModKind;
  /** Modrinth-Projekt-IDs der direkt installierten Mods, die diese mitgebracht haben. Leer = vom Nutzer. */
  requiredBy: string[];
}

export type ModKind = "mod" | "resourcepack" | "shader";

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
  modpack: ModpackOrigin | null;
  memoryMb: number | null;
  jvmArgs: string[];
  mods: Mod[];
  createdAt: number;
  lastPlayedAt: number | null;
}

/** Vorlage: gespeicherter Schnappschuss einer Instanz (lokales .mrpack, ohne Welten). */
export interface Template {
  id: string;
  name: string;
  minecraftVersion: string;
  loader: ModLoader;
  modCount: number;
  createdAt: number;
}

export interface NewInstance {
  name: string;
  minecraftVersion: string;
  loader: ModLoader;
  loaderVersion: string | null;
}

/** Reihenfolge im Dialog „Neu“. */
export const ALL_LOADERS: ModLoader[] = ["vanilla", "fabric", "quilt", "neoforge", "forge"];

/** Loader, die das Backend installieren und starten kann; die übrigen erscheinen als „bald verfügbar“. */
export const SUPPORTED_LOADERS: ModLoader[] = ["vanilla", "fabric", "quilt", "neoforge", "forge"];

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

// ---------- Installation & Spielstart ----------

/** Eintrag aus Mojangs Versions-Manifest (`versions_list`). */
export interface VersionEntry {
  id: string;
  type: "release" | "snapshot" | "old_beta" | "old_alpha";
  url: string;
  sha1: string;
  releaseTime: string;
}

/** Eintrag aus `loader_versions`, neueste zuerst. */
export interface LoaderVersion {
  version: string;
  stable: boolean;
}

export type InstallStep = "java" | "client" | "libraries" | "natives" | "assets" | "loader" | "mods";

/** Schritte der Vorbereitung in Alltagssprache (Anzeige beim Fortschritt). */
export function installStepLabel(step: InstallStep, loader: ModLoader): string {
  switch (step) {
    case "java":
      return "Java wird eingerichtet";
    case "client":
    case "assets":
      return "Lade Spieldateien";
    case "libraries":
    case "natives":
      return "Lade Bibliotheken";
    case "loader":
      return `${LOADER_LABELS[loader]} wird eingerichtet`;
    case "mods":
      return "Lade Mods";
  }
}

/** Event `install-progress`. */
export interface InstallProgress {
  instanceId: string;
  step: InstallStep;
  done: number;
  total: number;
}

/** Event `instance-log`. */
export interface LogPayload {
  instanceId: string;
  stream: "stdout" | "stderr";
  line: string;
}

/** Event `instance-exit`; `code` fehlt, wenn der Prozess abgeschossen wurde. */
export interface ExitPayload {
  instanceId: string;
  code: number | null;
  crashed: boolean;
  /** Pfad zum Absturzbericht von Minecraft, falls einer geschrieben wurde. */
  crashReport: string | null;
  logFile: string | null;
}

/** Fehlertext des Backends, wenn der Nutzer eine Installation abbricht (kein Fehler, neutral melden). */
export const INSTALL_CANCELLED = "Installation abgebrochen";

// ---------- Konten ----------

/** Microsoft-Konto aus `ms_accounts` / `ms_login_finish`. */
export interface Account {
  id: string;
  username: string;
  kind: "microsoft";
  active: boolean;
}

/** Ergebnis von `ms_login_start` (Geräte-Code-Anmeldung). */
export interface MsLoginStart {
  userCode: string;
  verificationUri: string;
  /** Sekunden, bis der Code verfällt. */
  expiresIn: number;
  interval: number;
  message: string;
}

export interface InstanceStatus {
  installed: boolean;
  running: boolean;
}
