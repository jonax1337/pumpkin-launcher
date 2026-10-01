import type { UnlistenFn } from "@tauri-apps/api/event";
import type { OpenDialogOptions } from "@tauri-apps/plugin-dialog";
import type { Update } from "@tauri-apps/plugin-updater";
import type {
  BlockedFile, CatalogType, ContentBlocked, ContentProject, ContentSearch, ContentVersion, ModUpdate, SearchIndex, Source,
} from "./content-types";
import type { ContentProgress } from "./progress";
import type {
  Account, Datapack, ExitPayload, FileCheck, ForeignInstance, Instance, InstallProgress, InstanceStatus, LaunchOptions, LibrarySkin,
  LoaderVersion, LocalFile, LogKind, LogPayload, ModLoader, MsLoginStart, NewInstance, Screenshot, Server, SkinProfile, SkinVariant,
  Template, VersionEntry, World, WorldBackup,
} from "./types";

/** Events des Backends (Tauri-Events bzw. im Browser-Mock der gleiche Name auf einem EventTarget) mit ihrer Nutzlast. */
export interface BackendEvents {
  "content-blocked": ContentBlocked;
  "content-progress": ContentProgress;
  "install-progress": InstallProgress;
  "instance-log": LogPayload;
  "instance-exit": ExitPayload;
  "instances-changed": null;
}

export type Subscribe = <E extends keyof BackendEvents>(event: E, cb: (payload: BackendEvents[E]) => void) => Promise<UnlistenFn>;

export type Emit = <E extends keyof BackendEvents>(event: E, payload: BackendEvents[E]) => void;

/** Minecraft-Version und Loader, auf die ein Katalog-Aufruf einschränkt; `null` = alle. */
export interface VersionFilter {
  mc: string | null;
  loader: string | null;
}

/** Eine Seite der Katalogsuche; `index` ist die Sortierung. */
export interface SearchOptions extends VersionFilter {
  query: string;
  type: CatalogType;
  offset: number;
  index: SearchIndex;
}

/** Ein Modpack-Projekt in einer Version, das als Instanz `name` angelegt wird. */
export interface PackInstall {
  projectId: string;
  versionId: string;
  name: string;
}

/** Eine Mod-Version, die in die Instanz `instanceId` kommt. */
export interface ModInstall {
  instanceId: string;
  projectId: string;
  versionId: string;
}

/**
 * Was nur die App kann. Der Browser-Mock hat es nicht: die Oberfläche blendet es dann aus,
 * statt einen Knopf zu zeigen, der nur einen Fehler meldet.
 */
export interface Capabilities {
  /** Systemdialog für Dateien und Ordner (`pickPaths`); der Browser liefert keine Pfade. */
  pickPaths: boolean;
  /** Instanz als `.mrpack` schreiben (`exportInstance`). */
  exportInstance: boolean;
  /** Dateien aufs Fenster ziehen (`useFileDrop`). */
  fileDrop: boolean;
  /** Fenstertitel und Fensterknöpfe des rahmenlosen Fensters. */
  nativeWindow: boolean;
  /** Version der installierten App (im Browser gilt die aus der `package.json`). */
  appVersion: boolean;
}

export const allCapabilities = (available: boolean): Capabilities => ({
  pickPaths: available,
  exportInstance: available,
  fileDrop: available,
  nativeWindow: available,
  appVersion: available,
});

/**
 * Alles, was die Oberfläche vom Backend braucht: in der App die Tauri-Commands (`backend-tauri.ts`),
 * im Browser ein In-Memory-Mock (`mock-backend.ts`). Das Backend wirft Fehler als string; beide Seiten liefern `Error`.
 */
export interface Backend {
  capabilities: Capabilities;

  modrinthSearch(options: SearchOptions): Promise<ContentSearch>;
  modrinthProject(projectId: string): Promise<ContentProject>;
  modrinthProjects(projectIds: string[]): Promise<ContentProject[]>;
  modrinthVersions(projectId: string, minecraftVersion: string | null, loader: string | null): Promise<ContentVersion[]>;
  modrinthInstallMod(instanceId: string, versionId: string, operationId: string): Promise<Instance>;
  modrinthCheckUpdates(instanceId: string): Promise<ModUpdate[]>;
  modrinthUpdateMods(instanceId: string, modIds: string[], operationId: string): Promise<Instance>;
  /** Lokale Einträge `modIds` per SHA-1 mit Modrinth abgleichen; erkannte bekommen Updates von dort. */
  modrinthIdentify(instanceId: string, modIds: string[]): Promise<Instance>;
  /** Eigene Dateien (absolute Pfade) vorab prüfen: Art und ob die Instanz sie schon hat. */
  checkLocalFiles(instanceId: string, paths: string[]): Promise<FileCheck[]>;
  addLocalFiles(instanceId: string, files: LocalFile[], operationId: string): Promise<Instance>;
  modrinthInstallPack(versionId: string, name: string, operationId: string): Promise<Instance>;
  modrinthImportPack(path: string, name: string, operationId: string): Promise<Instance>;
  /** Anbieter ohne API-Key (FTB, Technic, CurseForge); gleiche Formen wie bei Modrinth. Nur in der App. */
  providerSearch(source: Source, options: SearchOptions): Promise<ContentSearch>;
  providerProject(source: Source, projectId: string): Promise<ContentProject>;
  /** `filter` wirkt nur bei CurseForge mit Schlüssel; die anderen Anbieter liefern alle Versionen. */
  providerVersions(source: Source, projectId: string, filter: VersionFilter): Promise<ContentVersion[]>;
  providerInstallPack(source: Source, pack: PackInstall, operationId: string): Promise<Instance>;
  /** Mod, Shader oder Ressourcenpaket von CurseForge in eine Instanz, samt Abhängigkeiten. */
  providerInstallMod(source: Source, mod: ModInstall, operationId: string): Promise<Instance>;
  /** Holt eine von Hand geladene CurseForge-Datei aus dem Downloads-Ordner; null = noch nicht da. */
  curseforgeAdoptDownload(instanceId: string, file: Pick<BlockedFile, "projectId" | "fileId" | "fileName">): Promise<Instance | null>;
  onContentBlocked(cb: (p: ContentBlocked) => void): Promise<UnlistenFn>;
  onContentProgress(cb: (p: ContentProgress) => void): Promise<UnlistenFn>;
  /** Links aus Beschreibungen im Standardbrowser öffnen, nie im Launcher-Fenster. */
  openExternal(url: string): Promise<void>;

  listInstances(): Promise<Instance[]>;
  getInstance(id: string): Promise<Instance>;
  createInstance(input: NewInstance): Promise<Instance>;
  updateInstance(instance: Instance): Promise<Instance>;
  /** Nur die Gruppe ändern (null oder leer = ohne); überschreibt keinen anderen Stand der Instanz. */
  setInstanceGroup(instanceId: string, group: string | null): Promise<Instance>;
  deleteInstance(id: string): Promise<void>;
  /** Kopie mit Spielordner unter „<Name> (Kopie)“; Fortschritt als `content-progress`. */
  duplicateInstance(instanceId: string, operationId: string): Promise<Instance>;
  /** Einträge des Spielordners, die ein Export mitnehmen kann (Ordner und Dateien). */
  exportEntries(instanceId: string): Promise<string[]>;
  /** Schreibt die Instanz als `.mrpack` nach `path` (absolut); `include` aus `exportEntries`. Abbrechbar wie ein Pack. */
  exportInstance(instanceId: string, include: string[], path: string, operationId: string): Promise<void>;
  /** Auswahldialog des Systems (Dateien oder, mit `directory`, Ordner); abgebrochen = leere Liste. Im Browser gibt es keine Pfade. */
  pickPaths(options: OpenDialogOptions): Promise<string[]>;
  /** Datei im Dateimanager markieren (z. B. ein Export). */
  revealPath(path: string): Promise<void>;

  /** Instanzen anderer Launcher an den Standardorten oder, mit `folder` (absolut), in diesem Ordner. */
  importDetect(folder: string | null): Promise<ForeignInstance[]>;
  /** Neue Instanz aus einer Instanz eines anderen Launchers; Fortschritt als `content-progress`, Abbruch über `packInstallCancel`. */
  importInstance(source: ForeignInstance, operationId: string): Promise<Instance>;

  templateSave(instanceId: string, name: string): Promise<Template>;
  templateList(): Promise<Template[]>;
  templateDelete(id: string): Promise<void>;
  templateCreateInstance(templateId: string, name: string, operationId: string): Promise<Instance>;

  versionsList(): Promise<VersionEntry[]>;
  loaderVersions(loader: ModLoader, mcVersion: string): Promise<LoaderVersion[]>;
  installCancel(instanceId: string): Promise<void>;
  /**
   * Bricht einen abbrechbaren Content-Vorgang ab (Modpack, Import, Vorlage, Duplizieren, Export).
   * Einzige Stelle, die den Command-Namen kennt.
   */
  packInstallCancel(operationId: string): Promise<void>;
  systemMemoryMb(): Promise<number>;
  instanceStatus(instanceId: string): Promise<InstanceStatus>;
  /** Spielordner der Instanz (wird angelegt, falls er fehlt). */
  instanceDir(instanceId: string): Promise<string>;
  installInstance(instanceId: string): Promise<void>;
  /** Startet das Spiel; liefert die Prozess-ID. */
  launchInstance(instanceId: string, options: LaunchOptions): Promise<number>;
  killInstance(instanceId: string): Promise<void>;

  onInstallProgress(cb: (p: InstallProgress) => void): Promise<UnlistenFn>;
  onLog(cb: (p: LogPayload) => void): Promise<UnlistenFn>;
  onExit(cb: (p: ExitPayload) => void): Promise<UnlistenFn>;
  onInstancesChanged(cb: () => void): Promise<UnlistenFn>;

  /** `method: "device"` erzwingt den Gerätecode; sonst Browser-Anmeldung (Rückfall auf Gerätecode im Backend). */
  msLoginStart(method?: "device"): Promise<MsLoginStart>;
  msLoginFinish(): Promise<Account>;
  msLoginCancel(): Promise<void>;
  msAccounts(): Promise<Account[]>;
  /** Spielernamen ohne Konto erlaubt? Im Browser-Mock immer. */
  offlineAllowed(): Promise<boolean>;
  msAccountRemove(id: string): Promise<void>;
  /** Lädt ein Protokoll der Instanz bereinigt zu mclo.gs hoch und liefert den öffentlichen Link. */
  shareLog(instanceId: string, kind: LogKind): Promise<string>;
  /** Launcher, System und Instanzen als Klartext ohne persönliche Daten, für Fehlerberichte. */
  debugInfo(defaultMemoryMb: number): Promise<string>;

  /** Was das Microsoft-Konto gerade trägt. Im Browser ein Beispielprofil. */
  skinProfile(accountId: string): Promise<SkinProfile>;
  skinLibrary(): Promise<LibrarySkin[]>;
  /** PNG eines Bibliotheks-Skins als data:-URL. */
  skinTexture(id: string): Promise<string>;
  /** PNG-Datei (absoluter Pfad aus dem Dateidialog) in die Bibliothek aufnehmen. */
  skinAdd(path: string): Promise<LibrarySkin>;
  skinUpdate(id: string, name: string, variant: SkinVariant): Promise<LibrarySkin>;
  skinDelete(id: string): Promise<void>;
  /** Den gerade getragenen Skin unter `name` in der Bibliothek ablegen. */
  skinSaveActive(accountId: string, name: string): Promise<LibrarySkin>;
  skinUpload(accountId: string, skinId: string): Promise<void>;
  /** Zurück zum Standardskin von Minecraft. */
  skinReset(accountId: string): Promise<void>;
  /** Umhang zeigen; `null` blendet den aktiven aus. */
  skinCape(accountId: string, capeId: string | null): Promise<void>;

  /** Welten der Instanz, zuletzt gespielte zuerst. */
  worldList(instanceId: string): Promise<World[]>;
  /** Sichert eine Welt als ZIP; Fortschritt als `content-progress` (Phase `backup`). */
  worldBackup(instanceId: string, worldId: string, operationId: string): Promise<WorldBackup>;
  /** Sicherungen aller Welten der Instanz (auch gelöschter), neueste zuerst. */
  worldBackups(instanceId: string): Promise<WorldBackup[]>;
  /** Stellt eine Sicherung als neue Welt her; ist der Ordnername belegt, unter „<Name> (2)“. */
  worldRestore(instanceId: string, backupId: string): Promise<World>;
  worldBackupDelete(instanceId: string, backupId: string): Promise<void>;
  /** Löscht eine Welt, nachdem sie gesichert wurde; liefert die Sicherung. */
  worldDelete(instanceId: string, worldId: string, operationId: string): Promise<WorldBackup>;
  /** Kann die Minecraft-Version der Instanz direkt in eine Welt starten (ab 1.20)? */
  worldQuickPlaySupported(instanceId: string): Promise<boolean>;
  /** Datenpakete einer Welt, nach Namen sortiert. */
  datapackList(instanceId: string, worldId: string): Promise<Datapack[]>;
  /** Eigene Datenpaket-Zips (absolute Pfade) in die Welt; passt eins nicht, kommt keins hinein. */
  datapackAdd(instanceId: string, worldId: string, paths: string[]): Promise<void>;
  /** Datenpaket-Version von Modrinth in die Welt; Fortschritt als `content-progress`. */
  datapackInstall(instanceId: string, worldId: string, versionId: string, operationId: string): Promise<void>;
  /** Legt das Datenpaket in den Papierkorb. */
  datapackRemove(instanceId: string, worldId: string, packId: string): Promise<void>;
  serverList(instanceId: string): Promise<Server[]>;
  /** Legt einen Server an (`index` null) oder ändert den an Stelle `index` der Liste. */
  serverSave(instanceId: string, index: number | null, server: Server): Promise<void>;
  serverRemove(instanceId: string, index: number): Promise<void>;
  /** Screenshots der Instanz, neueste zuerst. */
  screenshots(instanceId: string): Promise<Screenshot[]>;
  /** Legt den Screenshot in den Papierkorb. */
  screenshotDelete(instanceId: string, fileName: string): Promise<void>;
  /** Bildquelle über das Asset-Protokoll (Scope: screenshots/ der Instanzen); im Mock ist `path` schon eine data:-URL. */
  screenshotSrc(shot: Screenshot): string;

  /** Datei mit dem Standardprogramm öffnen (z. B. Absturzbericht). */
  openPath(path: string): Promise<void>;

  /** Neuere Launcher-Version aus den GitHub-Releases, sonst null. Im Browser gibt es keine Updates. */
  checkAppUpdate(): Promise<Update | null>;
  /** Launcher neu starten (nach dem Update auf Systemen, deren Installer das nicht selbst tut). */
  restartApp(): Promise<void>;
}

/** Die sechs `on…`-Abonnements, die beide Backends gleich aus ihrem `Subscribe` bauen. */
export const eventSubscriptions = (on: Subscribe) => ({
  onContentBlocked: (cb) => on("content-blocked", cb),
  onContentProgress: (cb) => on("content-progress", cb),
  onInstallProgress: (cb) => on("install-progress", cb),
  onLog: (cb) => on("instance-log", cb),
  onExit: (cb) => on("instance-exit", cb),
  onInstancesChanged: (cb) => on("instances-changed", cb),
} satisfies Partial<Backend>);
