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
  | { type: "curseforge"; projectId: number; fileId: number }
  | { type: "provider"; source: string; projectId: string; versionId: string };

/** Quick Play: direkt in eine Welt (`id` = Ordnername) oder auf einen Server (`host[:port]`). */
export type QuickPlay = { type: "world"; id: string } | { type: "server"; address: string };

/** Spielfenster beim Start; `default` = wie Minecraft es selbst öffnet. */
export type GameWindow = { type: "default" } | { type: "size"; width: number; height: number } | { type: "fullscreen" };

export interface Instance {
  id: string;
  name: string;
  minecraftVersion: string;
  loader: ModLoader;
  loaderVersion: string | null;
  modpack: ModpackOrigin | null;
  memoryMb: number | null;
  jvmArgs: string[];
  /** Eigene java(w).exe; null = Einstellung des Launchers bzw. mitgelieferte Runtime. */
  javaPath: string | null;
  window: GameWindow;
  /** Eigene Spielargumente nach denen der Version. */
  gameArgs: string[];
  /** Gesamte Spielzeit in Sekunden; zählt nur das Backend (beim Beenden des Spiels). */
  playtimeSecs: number;
  /** Gruppe in der Bibliothek; null = ohne Gruppe. */
  group: string | null;
  mods: Mod[];
  createdAt: number;
  lastPlayedAt: number | null;
  /** Ziel des letzten Starts per Quick Play. */
  lastQuickPlay: QuickPlay | null;
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

/** Feste Reihenfolge überall (Dialog „Neue Instanz“, Filter). */
export const ALL_LOADERS: ModLoader[] = ["vanilla", "fabric", "quilt", "forge", "neoforge"];

/** Loader, die das Backend installieren und starten kann; die übrigen erscheinen als „bald verfügbar“. */
export const SUPPORTED_LOADERS: ModLoader[] = ["vanilla", "fabric", "quilt", "forge", "neoforge"];

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

/** Welches Protokoll `log_share` hochlädt: `logs/latest.log` oder den neuesten Absturzbericht. */
export type LogKind = "latest" | "crashReport";

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

/** Ergebnis von `ms_login_start`: Browser mit Rücksprung auf localhost (Standard) oder Gerätecode. */
export interface MsLoginStart {
  /** `browser`: `verificationUri` ist die Anmeldeseite, `userCode` ist leer. `device`: Code dort eingeben. */
  mode: "browser" | "device";
  userCode: string;
  verificationUri: string;
  /** Sekunden, bis die Anmeldung verfällt. */
  expiresIn: number;
  interval: number;
  message: string;
}

export interface InstanceStatus {
  installed: boolean;
  running: boolean;
}

// ---------- Skins ----------

/** Spielermodell: breite (Steve) oder schmale Arme (Alex). */
export type SkinVariant = "classic" | "slim";

export const SKIN_VARIANT_LABELS: Record<SkinVariant, string> = { classic: "Klassisch", slim: "Schlank" };

/** Skin in der lokalen Bibliothek; `id` ist der SHA-1 der PNG, die Textur kommt über `skin_texture`. */
export interface LibrarySkin {
  id: string;
  name: string;
  variant: SkinVariant;
  addedAt: number;
}

/** Umhang eines Microsoft-Kontos; höchstens einer ist `active`. */
export interface Cape {
  id: string;
  alias: string;
  url: string;
  active: boolean;
}

/** Was ein Microsoft-Konto gerade trägt (`skin_profile`); Texturen von textures.minecraft.net. */
export interface SkinProfile {
  skin: { url: string; variant: SkinVariant } | null;
  capes: Cape[];
}

// ---------- Welten und Server ----------

export type GameMode = "survival" | "creative" | "adventure" | "spectator";

export const GAME_MODE_LABELS: Record<GameMode, string> = { survival: "Überleben", creative: "Kreativ", adventure: "Abenteuer", spectator: "Zuschauer" };

/** Welt unter `saves/`; `id` ist ihr Ordnername. */
export interface World {
  id: string;
  name: string;
  lastPlayed: number | null;
  gameMode: GameMode | null;
  hardcore: boolean;
  /** Minecraft-Version, mit der die Welt zuletzt gespielt wurde. */
  version: string | null;
  sizeBytes: number;
  /** `icon.png` als data:-URL. */
  icon: string | null;
  /** Absoluter Ordnerpfad (für `openPath`). */
  path: string;
}

/** Sicherung einer Welt; `world` ist der Ordnername, auch von inzwischen gelöschten Welten. */
export interface WorldBackup {
  id: string;
  world: string;
  createdAt: number;
  sizeBytes: number;
}

/** Eintrag der Serverliste des Spiels. */
export interface Server {
  name: string;
  /** `host[:port]` */
  address: string;
  /** Icon als data:-URL; setzt nur das Spiel, beim Speichern bleibt das alte. */
  icon: string | null;
  /** Ressourcenpakete des Servers annehmen bzw. ablehnen; null = im Spiel nachfragen. */
  acceptTextures: boolean | null;
}
