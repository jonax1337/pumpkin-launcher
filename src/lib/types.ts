// Backend-Vertrag (serde camelCase). Zeiten = Unix-Millisekunden.
import { t } from "../i18n/core.ts";
import type { GlyphName, GlyphPalette } from "../pixel/icons.tsx";
import type { Biome } from "../pixel/sceneConfig.ts";

export type ModLoader = "vanilla" | "fabric" | "quilt" | "forge" | "neoforge";
export type ModSource =
  | { type: "local" }
  | { type: "url"; url: string }
  | { type: "modrinth"; projectId: string; versionId: string }
  | { type: "curseforge"; projectId: number; fileId: number };

export interface Mod {
  id: string;
  name: string;
  version: string;
  source: ModSource;
  fileName: string;
  /** SHA-1 der JAR, Schlüssel im globalen Mod-Cache. */
  sha1: string | null;
  enabled: boolean;
  /** Art des Eintrags (bestimmt den Zielordner); in alten Dateien ohne Angabe liefert das Backend "mod". */
  kind: ModKind;
  /** Modrinth-Projekt-IDs der direkt installierten Mods, die diese mitgebracht haben. Leer = vom Nutzer. */
  requiredBy: string[];
  /** Festgehalten: die Update-Prüfung überspringt den Inhalt, er bleibt auf seiner Version. */
  pinned: boolean;
  /** Kam mit einem Modpack oder einer Vorlage in die Instanz; für ihn sind Pack-Updates der vorgesehene Weg. */
  packManaged: boolean;
}

export type ModKind = "mod" | "resourcepack" | "shader";

/** Größe und Änderungsdatum (Unix-ms) der Datei eines Inhalts. */
export interface FileFacts {
  modId: string;
  sizeBytes: number;
  modifiedMs: number;
}

/**
 * Hinweis aus den Metadaten einer Mod-Datei; `subject` je Art: `missingDependency` die ID der fehlenden Mod,
 * `duplicate` die anderen Dateien derselben Mod, `wrongLoader` die Loader der Datei, `wrongMinecraft` ihre Bedingung.
 */
export type IssueKind = "missingDependency" | "duplicate" | "wrongLoader" | "wrongMinecraft";
export interface ContentIssue {
  modId: string;
  kind: IssueKind;
  subject: string;
}

/** Dateien und Hinweise einer Instanz, gelesen aus den Mod-JARs. */
export interface ContentAnalysis {
  files: FileFacts[];
  issues: ContentIssue[];
}

/**
 * Gewählte Pakete laut `options.txt` und Iris. `resourcePacks` in Dateireihenfolge: das letzte gewinnt;
 * eigene Pakete stehen als `file/<Dateiname>`, eingebaute (`vanilla`, `fabric`) ohne Präfix.
 */
export interface PackSelection {
  resourcePacks: string[];
  incompatible: string[];
  shaderPack: string | null;
}

/** Eigene Datei mit ihrer Art, zum Hinzufügen in eine Instanz. */
export interface LocalFile {
  path: string;
  kind: ModKind;
}

/**
 * Vorab-Prüfung einer eigenen Datei: `kind` null = Zip ohne eindeutiges Merkmal (nachfragen), `duplicateOf` = Name des
 * vorhandenen Eintrags, `error` = warum die Datei nicht passt.
 */
export interface FileCheck {
  path: string;
  kind: ModKind | null;
  duplicateOf: string | null;
  error: string | null;
}

/** Herkunft einer aus einem Modpack installierten Instanz; `file` = selbst gewählte `.mrpack` (Name und Version aus ihr). */
export type ModpackOrigin =
  | { type: "modrinth"; projectId: string; versionId: string }
  | { type: "curseforge"; projectId: number; fileId: number }
  | { type: "provider"; source: string; projectId: string; versionId: string }
  | { type: "file"; name: string; version: string };

/** Wohin ein Pack-Update führt: eine Version der Quelle oder eine neuere `.mrpack`-Datei (absoluter Pfad). */
export type PackTarget = { type: "version"; versionId: string } | { type: "file"; path: string };

/** Was ein Pack-Update geändert hat, als Pfade im Spielordner; `kept` = vom Spieler geändert, blieb stehen. */
export interface PackChanges {
  added: string[];
  updated: string[];
  removed: string[];
  kept: string[];
}

export interface PackUpdateOutcome {
  instance: Instance;
  changes: PackChanges;
  /** Welten, die vorher gesichert wurden. */
  worldBackups: number;
}

/** Ziel eines Wechsels von Minecraft-Version oder Loader; ohne Loader-Version gilt die neueste stabile. */
export interface MigrationTarget {
  minecraftVersion: string;
  loader: ModLoader;
  loaderVersion: string | null;
}

/** Was ein Wechsel mit einem Inhalt tut; `modId` ist bei neuen Abhängigkeiten ihr Modrinth-Projekt. */
export interface ModChange {
  modId: string;
  name: string;
  outcome: "update" | "add" | "disable";
  /** Neue Version bei `update` und `add`. */
  version: string | null;
}

/** Warum ein Wechsel nur als Kopie geht; die Oberfläche übersetzt den Grund über `errors.game.migrate.<Grund>`. */
export type MigrationBlock = "packInstance" | "downgradeWithWorlds";

/** Vorschau eines Wechsels; `blocked` nennt den Grund, warum er nur als Kopie geht. */
export interface MigrationCheck {
  changes: ModChange[];
  downgrade: boolean;
  worlds: number;
  blocked: MigrationBlock | null;
}

export interface MigrationOutcome {
  instance: Instance;
  changes: ModChange[];
  worldBackups: number;
}

/** Quick Play: direkt in eine Welt (`id` = Ordnername) oder auf einen Server (`host[:port]`). */
export type QuickPlay = { type: "world"; id: string } | { type: "server"; address: string };

/** Wohin ein Schnellstart führt: Ordnername der Welt oder Adresse des Servers. */
export const quickPlayTarget = (q: QuickPlay) => (q.type === "world" ? q.id : q.address);

/** Was der Start vom Launcher mitbekommt; die Startoptionen der Instanz liest das Backend aus ihr. */
export interface LaunchOptions {
  /** Offline-Spielername; mit `accountId` (Microsoft-Konto) ohne Bedeutung. */
  username: string;
  accountId: string | null;
  /** Java-Einstellung des Launchers (null = mitgelieferte Runtime); der Pfad der Instanz geht vor. */
  javaPath: string | null;
  /** RAM-Standard für Instanzen ohne eigenen Wert. */
  defaultMemoryMb: number;
  /** Launcher-Einstellung „Welten vor dem Start sichern“; die Wahl der Instanz (`backupWorlds`) geht vor. */
  backupWorlds: boolean;
  /** So viele automatische Sicherungen je Welt bleiben erhalten. */
  backupKeep: number;
  /** Minimaler RAM (-Xms) für Instanzen ohne eigenen Wert; null = die JVM entscheidet. */
  defaultMinMemoryMb: number | null;
  /** JVM-Argumente für Instanzen ohne eigene. */
  defaultJvmArgs: string[];
  /** Fenster für Instanzen, die keines festgelegt haben; null = wie Minecraft. */
  defaultWindow: GameWindow | null;
  /** Direkt in eine Welt oder auf einen Server. */
  quickPlay: QuickPlay | null;
}

/** Spielfenster beim Start; `default` = wie Minecraft es selbst öffnet. */
export type GameWindow = { type: "default" } | { type: "size"; width: number; height: number } | { type: "fullscreen" };

/** Vom Nutzer gewähltes Icon einer Instanz: ein Pixel-Icon oder ein eigenes Bild (quadratisch, als Datenadresse). */
export type IconChoice = { type: "glyph"; glyph: GlyphName; palette: GlyphPalette } | { type: "image"; src: string };

/** Gewählte Szene einer Instanz: Biom und Variante des Aufbaus. */
export interface InstanceScene {
  biome: Biome;
  seed: number;
}

export interface Instance {
  id: string;
  name: string;
  minecraftVersion: string;
  loader: ModLoader;
  loaderVersion: string | null;
  modpack: ModpackOrigin | null;
  memoryMb: number | null;
  /** Minimaler RAM (-Xms) in MB; null = Einstellung des Launchers. */
  minMemoryMb: number | null;
  jvmArgs: string[];
  /** Eigene Java-Programmdatei; null = Einstellung des Launchers bzw. mitgelieferte Runtime. */
  javaPath: string | null;
  window: GameWindow;
  /** Eigene Spielargumente nach denen der Version. */
  gameArgs: string[];
  /** Gesamte Spielzeit in Sekunden; zählt nur das Backend (beim Beenden des Spiels). */
  playtimeSecs: number;
  /** Gruppe in der Bibliothek; null = ohne Gruppe. */
  group: string | null;
  /** Eigene Notizen zur Instanz, höchstens `NOTES_MAX_LENGTH` Zeichen. */
  notes: string;
  /** Instanzordner im anderen Launcher, aus dem die Instanz importiert wurde. */
  importedFrom: string | null;
  /** Eigenes Icon; null = automatisch (Icon des Modpacks, sonst Pixel-Icon aus der ID). */
  icon: IconChoice | null;
  /** Gewählte Szene; null = aus der ID abgeleitet. */
  scene: InstanceScene | null;
  /** Welten vor dem Start sichern: die Wahl dieser Instanz; null = Einstellung des Launchers. */
  backupWorlds: boolean | null;
  mods: Mod[];
  createdAt: number;
  lastPlayedAt: number | null;
  /** Ziel des letzten Starts per Quick Play. */
  lastQuickPlay: QuickPlay | null;
  /** Konto, mit dem diese Instanz startet (Schlüssel aus `keyOf`); null = aktives Konto. */
  defaultAccount: string | null;
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

/** Wie ein Export die Inhalte einer Auswahl verteilt (Mods, Ressourcen- und Shaderpakete). */
export interface ExportSummary {
  /** Als Download von Modrinth im Pack. */
  linked: number;
  /** Als Datei im Pack. */
  embedded: number;
  /** Ausgeschaltet, deshalb nicht im Pack. */
  skippedDisabled: number;
}

export interface NewInstance {
  name: string;
  minecraftVersion: string;
  loader: ModLoader;
  loaderVersion: string | null;
}

/** Längste Notiz einer Instanz in Zeichen; das Backend lehnt längere ab. */
export const NOTES_MAX_LENGTH = 10_000;

/** Feste Reihenfolge überall (Dialog „Neue Instanz“, Filter). */
export const ALL_LOADERS: ModLoader[] = ["vanilla", "fabric", "quilt", "forge", "neoforge"];

/** Loader-Namen sind Marken und bleiben unübersetzt. */
export const LOADER_LABELS: Record<ModLoader, string> = {
  vanilla: "Vanilla",
  fabric: "Fabric",
  quilt: "Quilt",
  forge: "Forge",
  neoforge: "NeoForge",
};

// ---------- Import aus anderen Launchern ----------

export type ForeignLauncher = "prism" | "modrinth" | "curseforge" | "atlauncher";

/** Feste Reihenfolge der Gruppen im Import. */
export const FOREIGN_LAUNCHERS: ForeignLauncher[] = ["prism", "modrinth", "curseforge", "atlauncher"];

export const FOREIGN_LAUNCHER_LABELS: Record<ForeignLauncher, string> = {
  prism: "Prism Launcher / MultiMC",
  modrinth: "Modrinth App",
  curseforge: "CurseForge App",
  atlauncher: "ATLauncher",
};

/** Einstellung einer fremden Instanz, die Pumpkin Launcher nicht übernimmt. */
export type NotAdopted = "preLaunchCommand" | "postExitCommand" | "wrapperCommand" | "javaPath" | "jvmArgs";

/** Was der Import aus dem Spielordner mitnimmt. */
export interface ForeignContents {
  sizeBytes: number;
  mods: number;
  worlds: number;
}

/** Instanz eines anderen Launchers aus `import_detect`; `instance_import` bekommt davon nur `root`, `path` und den Namen. */
export interface ForeignInstance {
  launcher: ForeignLauncher;
  /** Ordner, unter dem die Suche die Instanz fand. */
  root: string;
  /** Instanzordner im anderen Launcher, eindeutig je Instanz. */
  path: string;
  gameDir: string;
  /** Aus diesem Ordner wurde schon einmal importiert. */
  imported: boolean;
  /** Warum Pumpkin Launcher die Instanz nicht starten kann (z. B. Forge vor 1.17); dann gibt es keinen Import. */
  unsupported: string | null;
  contents: ForeignContents;
  name: string;
  minecraftVersion: string;
  loader: ModLoader;
  loaderVersion: string | null;
  memoryMb: number | null;
  jvmArgs: string[];
  javaPath: string | null;
  window: GameWindow;
  group: string | null;
  notes: string;
  /** Eigenes Icon als `data:`-URL. */
  icon: string | null;
  notAdopted: NotAdopted[];
}

/** Die Wahl für `instance_import`: die erkannte Instanz und ihr Name; alles Weitere liest das Backend selbst. */
export interface ImportRequest {
  root: string;
  path: string;
  name: string;
}

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

/** Schritte der Vorbereitung in Alltagssprache (Anzeige beim Fortschritt); Loader-Name ist Marke und bleibt unübersetzt. */
export function installStepLabel(step: InstallStep, loader: ModLoader): string {
  switch (step) {
    case "java":
      return t("components.install.java");
    case "client":
    case "assets":
      return t("components.install.gameFiles");
    case "libraries":
    case "natives":
      return t("components.install.libraries");
    case "loader":
      return t("components.install.loader", { loader: LOADER_LABELS[loader] });
    case "mods":
      return t("components.install.mods");
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
  /** Mods, die laut Absturzbericht als Ursache in Frage kommen, wahrscheinlichster zuerst. */
  suspectedMods: string[];
}

/** Auf dem Rechner gefundene Java-Installation; `path` ist die Programmdatei. */
export interface JavaInstall {
  path: string;
  version: string;
  major: number;
  vendor: string | null;
}

/** Platz im Datenordner in Bytes. Mods zählen im Cache und in der Instanz (Hardlinks, belegen nur einmal Platz). */
export interface StorageOverview {
  dataDir: string;
  /** Freier Platz auf dem Laufwerk in MB. */
  freeMb: number | null;
  instances: { id: string; bytes: number }[];
  modCacheBytes: number;
  /** Teil des Mod-Caches, den keine Instanz braucht und „Cache leeren“ löscht. */
  unusedCacheBytes: number;
  sharedBytes: number;
}

/** Gesichertes Protokoll einer früheren Spielsitzung; `id` ist ihre Startzeit. */
export interface LogSession {
  id: string;
  startedAt: number;
  size: number;
}

/** Welches Protokoll `log_share` hochlädt: `logs/latest.log` oder den neuesten Absturzbericht. */
export type LogKind = "latest" | "crashReport";

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

// ---------- Screenshots ----------

/** PNG aus `screenshots/` der Instanz (`screenshot_list`, neueste zuerst). */
export interface Screenshot {
  fileName: string;
  /** Absoluter Pfad; die Vorschau kommt über `api.screenshotSrc`. */
  path: string;
  takenAt: number;
  /** Bytes. */
  size: number;
}

// ---------- Skins ----------

/** Spielermodell: breite (Steve) oder schmale Arme (Alex); Benennung in `pages.skins.variant.*`. */
export type SkinVariant = "classic" | "slim";

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

/** Datenpaket unter `saves/<Welt>/datapacks/`; `id` ist der Datei- oder Ordnername. */
export interface Datapack {
  id: string;
  /** Name ohne `.zip`. */
  name: string;
  /** Beschreibung aus `pack.mcmeta`. */
  description: string | null;
  /** Laut `level.dat` aktiv bzw. abgeschaltet; null = das Spiel hat es noch nicht geladen. */
  enabled: boolean | null;
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

/** Antwort eines Servers auf die Statusabfrage der Serverliste. */
export interface ServerStatus {
  /** MOTD als einzeiliger Text ohne Formatierung. */
  motd: string;
  playersOnline: number;
  playersMax: number;
  /** Versionsname, wie der Server ihn nennt; leer, wenn er keinen nennt. */
  version: string;
  /** Antwortzeit in Millisekunden. */
  latencyMs: number;
}
