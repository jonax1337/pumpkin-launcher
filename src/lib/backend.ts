import type { UnlistenFn } from "@tauri-apps/api/event";
import type { OpenDialogOptions, SaveDialogOptions } from "@tauri-apps/plugin-dialog";
import type { Update } from "@tauri-apps/plugin-updater";
import type {
  BlockedFile, CatalogType, ContentBlocked, ContentProject, ContentSearch, ContentVersion, ModUpdate, SearchIndex, Source,
} from "./content-types";
import type { ContentProgress } from "./progress";
import type {
  Account, BlockedPeer, ContentAnalysis, Datapack, IngameEvent, IngameFailedEvent, IngameStatus, ExitPayload, ExportSummary, FileCheck, ForeignInstance, Friend, FriendCode,
  FriendPresenceEvent, FriendRequest, FriendRequestEvent, FriendRequestRefusedEvent, FriendsEnableInput, FriendsSettings, FriendsState, HostSession,
  HostSessionEndedEvent, HostSessionEvent, IconChoice, ImportRequest, Instance, InstallProgress, InstanceScene, InstanceStatus, Invite,
  InviteEvent, InviteRevokedEvent, JavaInstall, JoinPlan, JoinSessionEvent, JoinTicket, LanEvent, LanStatus, LaunchOptions, LibrarySkin,
  LoaderVersion, LocalFile, LogKind, LogPayload, LogSession, MigrationCheck, MigrationOutcome, MigrationTarget, ModConfirmEvent,
  ModConnectionEvent, ModLoader, MsLoginStart, NetworkStatus, NewInstance, PackSelection, PackTarget, PackUpdateOutcome,
  Screenshot, Server, ServerStatus, SkinProfile, SkinVariant, StorageOverview, Template, VersionEntry, World, WorldBackup,
} from "./types";

/** Events des Backends (Tauri-Events bzw. im Browser-Mock der gleiche Name auf einem EventTarget) mit ihrer Nutzlast. */
export interface BackendEvents {
  "content-blocked": ContentBlocked;
  "content-progress": ContentProgress;
  "install-progress": InstallProgress;
  "instance-log": LogPayload;
  "instance-exit": ExitPayload;
  "instances-changed": null;
  /** Der Launcher wurde mit einer Pack-Datei geöffnet; `takeOpenedPack` liefert sie. */
  "pack-opened": null;
  /** Freunde, Anfragen, Codes, Sperren, Einstellungen oder Hinweise haben sich geändert; die Oberfläche lädt neu. */
  "friends-changed": null;
  "friends-network": NetworkStatus;
  "friend-presence": FriendPresenceEvent;
  "friend-request": FriendRequestEvent;
  "friend-request-refused": FriendRequestRefusedEvent;
  "friend-invite": InviteEvent;
  "friend-invite-revoked": InviteRevokedEvent;
  "host-session": HostSessionEvent;
  "host-session-ended": HostSessionEndedEvent;
  "join-session": JoinSessionEvent;
  "lan-changed": LanEvent;
  "friends-mod": ModConnectionEvent;
  "friends-mod-confirm": ModConfirmEvent;
  /** Der Status der Mod im Spiel einer Instanz hat sich geändert (Schalter, Startfehler, Spielstart oder -ende). */
  "friends-ingame": IngameEvent;
  /** Der Start ist wahrscheinlich an der Mod gescheitert; ihre Einspeisung in die Instanz ist ausgeschaltet. */
  "friends-ingame-failed": IngameFailedEvent;
}

export type Subscribe = <E extends keyof BackendEvents>(event: E, cb: (payload: BackendEvents[E]) => void) => Promise<UnlistenFn>;

export type Emit = <E extends keyof BackendEvents>(event: E, payload: BackendEvents[E]) => void;

/** Minecraft-Version und Loader, auf die ein Katalog-Aufruf einschränkt; `null` = alle. */
export interface VersionFilter {
  mc: string | null;
  loader: string | null;
}

/** Eine Seite der Katalogsuche; `index` ist die Sortierung, `category` die Kategorie des Anbieters (nur Modrinth). */
export interface SearchOptions extends VersionFilter {
  query: string;
  type: CatalogType;
  category: string | null;
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

/** Was ein Export mitnimmt (`include`, Einträge aus `exportEntries`) und was im Index des Packs steht. */
export interface ExportRequest {
  include: string[];
  name: string;
  versionId: string;
  /** Beschreibung des Packs; `null` = keine. */
  summary: string | null;
}

/** Was in den Bericht der Debug-Info kommt: Einstellungen des Launchers, die nur das Frontend kennt, und die Instanz im Fokus. */
export interface DebugInfoOptions {
  defaultMemoryMb: number;
  javaPath: string | null;
  instanceId: string | null;
}

export type LauncherWindowAction = "minimize" | "restore" | "close";

/**
 * Was nur die App kann. Der Browser-Mock hat es nicht: die Oberfläche blendet es dann aus,
 * statt einen Knopf zu zeigen, der nur einen Fehler meldet.
 */
export interface Capabilities {
  /** Systemdialog für Dateien und Ordner (`pickPaths`); der Browser liefert keine Pfade. */
  pickPaths: boolean;
  /** Instanz oder Vorlage als `.mrpack` schreiben (`exportInstance`, `templateExport`). */
  exportInstance: boolean;
  /** Dateien aufs Fenster ziehen (`useFileDrop`). */
  fileDrop: boolean;
  /** Datei im Dateimanager markieren (`revealPath`). */
  revealPath: boolean;
  /** Fenstertitel und Fensterknöpfe des rahmenlosen Fensters. */
  nativeWindow: boolean;
  /** Version der installierten App (im Browser gilt die aus der `package.json`). */
  appVersion: boolean;
}

export const allCapabilities = (available: boolean): Capabilities => ({
  pickPaths: available,
  exportInstance: available,
  fileDrop: available,
  revealPath: available,
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
  /** Setzt einen Modrinth-Inhalt auf eine gewählte Version, neuer oder älter. */
  modrinthSwitchVersion(instanceId: string, modId: string, versionId: string, operationId: string): Promise<Instance>;
  /** Größe und Datum der Dateien samt Hinweisen aus den Mod-Metadaten (fehlende Abhängigkeiten, Doppelte, Loader, Version). */
  contentAnalysis(instanceId: string): Promise<ContentAnalysis>;
  /** Gewählte Ressourcenpakete und Shader (`options.txt`, Iris). */
  packSelection(instanceId: string): Promise<PackSelection>;
  /** Setzt die Ressourcenpakete in `options.txt`; läuft das Spiel, schreibt das Backend nichts. */
  setResourcePacks(instanceId: string, packs: string[]): Promise<PackSelection>;
  /** Wählt den Iris-Shader (Dateiname) oder, mit null, keinen; läuft das Spiel, schreibt das Backend nichts. */
  setShaderPack(instanceId: string, pack: string | null): Promise<PackSelection>;
  /** Lokale Einträge `modIds` per SHA-1 mit Modrinth abgleichen; erkannte bekommen Updates von dort. */
  modrinthIdentify(instanceId: string, modIds: string[]): Promise<Instance>;
  /** Eigene Dateien (absolute Pfade) vorab prüfen: Art und ob die Instanz sie schon hat. */
  checkLocalFiles(instanceId: string, paths: string[]): Promise<FileCheck[]>;
  addLocalFiles(instanceId: string, files: LocalFile[], operationId: string): Promise<Instance>;
  modrinthInstallPack(versionId: string, name: string, operationId: string): Promise<Instance>;
  modrinthImportPack(path: string, name: string, operationId: string): Promise<Instance>;
  /** CurseForge-Modpack als `.zip` von der Platte; Dateien nur von der Webseite meldet das Ereignis `content-blocked`. */
  curseforgeImportPack(path: string, name: string, operationId: string): Promise<Instance>;
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
  /** Eigenes Icon setzen; null = automatisch. Ändert nichts anderes an der Instanz. */
  setInstanceIcon(instanceId: string, icon: IconChoice | null): Promise<Instance>;
  /** Szene setzen; null = aus der ID abgeleitet. Ändert nichts anderes an der Instanz. */
  setInstanceScene(instanceId: string, scene: InstanceScene | null): Promise<Instance>;
  deleteInstance(id: string): Promise<void>;
  /** Kopie mit Spielordner unter „<Name> (Kopie)“; Fortschritt als `content-progress`. */
  duplicateInstance(instanceId: string, operationId: string): Promise<Instance>;
  /** Einträge des Spielordners, die ein Export mitnehmen kann (Ordner und Dateien). */
  exportEntries(instanceId: string): Promise<string[]>;
  /** Wie ein Export die Inhalte der Auswahl `include` verteilen würde (fragt Modrinth, was es kennt). */
  exportSummary(instanceId: string, include: string[]): Promise<ExportSummary>;
  /** Zielpfade für mehrere `.mrpack` in `folder`: ein Dateiname, der dort schon liegt oder doppelt vorkommt, bekommt eine Nummer. */
  exportTargets(folder: string, fileNames: string[]): Promise<string[]>;
  /** Schreibt die Instanz als `.mrpack` nach `path` (absolut). Abbrechbar wie ein Pack. */
  exportInstance(instanceId: string, request: ExportRequest, path: string, operationId: string): Promise<void>;
  /** Änderungsprotokoll einer Version des Packs, aus dem die Instanz stammt (Markdown); null, wo die Quelle keins führt. */
  packChangelog(instanceId: string, versionId: string): Promise<string | null>;
  /** Pack-Instanz auf eine andere Pack-Version bringen; vorher werden alle Welten gesichert. Abbrechbar wie ein Pack. */
  packUpdate(instanceId: string, target: PackTarget, operationId: string): Promise<PackUpdateOutcome>;
  /** Vorschau eines Wechsels von Minecraft-Version oder Loader, ohne etwas zu ändern. */
  migrateCheck(instanceId: string, target: MigrationTarget): Promise<MigrationCheck>;
  /** Wechselt Minecraft-Version oder Loader der Instanz selbst (Welten vorher gesichert). Abbrechbar wie ein Pack. */
  migrateInstance(instanceId: string, target: MigrationTarget, operationId: string): Promise<MigrationOutcome>;
  /** Legt eine Kopie an und wechselt nur sie; das Original bleibt. Abbrechbar wie ein Pack. */
  duplicateMigrate(instanceId: string, target: MigrationTarget, operationId: string): Promise<MigrationOutcome>;
  /** Auswahldialog des Systems (Dateien oder, mit `directory`, Ordner); abgebrochen = leere Liste. Im Browser gibt es keine Pfade. */
  pickPaths(options: OpenDialogOptions): Promise<string[]>;
  /** Speichern-Dialog des Systems (bestätigt das Überschreiben); abgebrochen = null. */
  pickSavePath(options: SaveDialogOptions): Promise<string | null>;
  /** Datei im Dateimanager markieren (z. B. ein Export). */
  revealPath(path: string): Promise<void>;

  /** Instanzen anderer Launcher an den Standardorten oder, mit `folder` (absolut), in diesem Ordner. */
  importDetect(folder: string | null): Promise<ForeignInstance[]>;
  /** Neue Instanz aus einer erkannten Instanz eines anderen Launchers; Fortschritt als `content-progress`, Abbruch über `packInstallCancel`. */
  importInstance(request: ImportRequest, operationId: string): Promise<Instance>;

  templateSave(instanceId: string, name: string): Promise<Template>;
  templateList(): Promise<Template[]>;
  templateDelete(id: string): Promise<void>;
  templateCreateInstance(templateId: string, name: string, operationId: string): Promise<Instance>;
  /** Schreibt die Vorlage als `.mrpack` nach `path` (absolut), zum Weitergeben. */
  templateExport(templateId: string, path: string): Promise<void>;
  /** Nimmt eine `.mrpack`-Datei (absoluter Pfad) als Vorlage auf. */
  templateImport(path: string): Promise<Template>;

  /** Die `.mrpack`-Datei, mit der der Launcher geöffnet wurde, einmalig; danach `null` bis zur nächsten. */
  takeOpenedPack(): Promise<string | null>;

  versionsList(): Promise<VersionEntry[]>;
  loaderVersions(loader: ModLoader, mcVersion: string): Promise<LoaderVersion[]>;
  installCancel(instanceId: string): Promise<void>;
  /**
   * Bricht einen abbrechbaren Content-Vorgang ab (Modpack, Import, Vorlage, Duplizieren, Export, Pack-Update, Wechsel).
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
  onPackOpened(cb: () => void): Promise<UnlistenFn>;
  onFriendsChanged(cb: () => void): Promise<UnlistenFn>;
  onFriendsNetwork(cb: (p: NetworkStatus) => void): Promise<UnlistenFn>;
  onFriendPresence(cb: (p: FriendPresenceEvent) => void): Promise<UnlistenFn>;
  onFriendRequest(cb: (p: FriendRequestEvent) => void): Promise<UnlistenFn>;
  onFriendRequestRefused(cb: (p: FriendRequestRefusedEvent) => void): Promise<UnlistenFn>;
  onFriendInvite(cb: (p: InviteEvent) => void): Promise<UnlistenFn>;
  onFriendInviteRevoked(cb: (p: InviteRevokedEvent) => void): Promise<UnlistenFn>;
  onHostSession(cb: (p: HostSessionEvent) => void): Promise<UnlistenFn>;
  onHostSessionEnded(cb: (p: HostSessionEndedEvent) => void): Promise<UnlistenFn>;
  onJoinSession(cb: (p: JoinSessionEvent) => void): Promise<UnlistenFn>;
  onLanChanged(cb: (p: LanEvent) => void): Promise<UnlistenFn>;
  onFriendsMod(cb: (p: ModConnectionEvent) => void): Promise<UnlistenFn>;
  onFriendsModConfirm(cb: (p: ModConfirmEvent) => void): Promise<UnlistenFn>;
  onFriendsIngame(cb: (p: IngameEvent) => void): Promise<UnlistenFn>;
  onFriendsIngameFailed(cb: (p: IngameFailedEvent) => void): Promise<UnlistenFn>;

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
  /** Launcher, System und Instanzen als Klartext ohne persönliche Daten, für Fehlerberichte; mit `instanceId` samt deren Mod-Liste. */
  debugInfo(options: DebugInfoOptions): Promise<string>;
  /** Gesicherte Protokolle früherer Sitzungen der Instanz, neueste zuerst. */
  logSessions(instanceId: string): Promise<LogSession[]>;
  logSessionRead(instanceId: string, sessionId: string): Promise<string>;

  /** Platz je Instanz, im Mod-Cache und in den geteilten Ordnern. */
  storageOverview(): Promise<StorageOverview>;
  /** Löscht, was im Mod-Cache keine Instanz braucht; liefert die freigegebenen Bytes. */
  storageClearCache(): Promise<number>;
  /** Datenordner im Dateimanager öffnen. */
  storageOpenDir(): Promise<void>;
  /** Auf dem Rechner installierte Java-Versionen, neueste zuerst. */
  detectJava(): Promise<JavaInstall[]>;
  /** Launcher-Fenster minimieren, wiederherstellen oder schließen (Einstellung „Beim Spielstart“). */
  setLauncherWindow(action: LauncherWindowAction): Promise<void>;

  /** Was das Microsoft-Konto gerade trägt. Im Browser ein Beispielprofil. */
  skinProfile(accountId: string): Promise<SkinProfile>;
  skinLibrary(): Promise<LibrarySkin[]>;
  /** PNG eines Bibliotheks-Skins als data:-URL. */
  skinTexture(id: string): Promise<string>;
  /** PNG-Datei (absoluter Pfad aus dem Dateidialog) in die Bibliothek aufnehmen. */
  skinAdd(path: string): Promise<LibrarySkin>;
  /** Lädt den Skin, den der Spieler `name` gerade trägt, in die Bibliothek (öffentliche Mojang-Endpunkte, ohne Konto). */
  skinAddPlayer(name: string): Promise<LibrarySkin>;
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
  /** Alle Sicherungen der Instanz in einen neuen Ordner in `directory` (absolut, bestehend) kopieren; liefert den neuen Ordner. */
  worldBackupsExport(instanceId: string, directory: string): Promise<string>;
  /** Holt eine Welt aus einem Zip (absoluter Pfad) als neue Welt, unter „<Name> (2)“, wenn der Ordner belegt ist; Fortschritt als `content-progress` (Phase `extract`). */
  worldImport(instanceId: string, path: string, operationId: string): Promise<World>;
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
  /** Status (Ping, Spieler, MOTD, Version) eines Servers aus der Liste der Instanz; Fehler = nicht erreichbar. */
  serverPing(instanceId: string, address: string): Promise<ServerStatus>;
  /** Screenshots der Instanz, neueste zuerst. */
  screenshots(instanceId: string): Promise<Screenshot[]>;
  /** Legt den Screenshot in den Papierkorb. */
  screenshotDelete(instanceId: string, fileName: string): Promise<void>;
  /** Der Inhalt eines Screenshots (PNG), etwa für die Zwischenablage. */
  screenshotRead(instanceId: string, fileName: string): Promise<ArrayBuffer>;
  /** Bildquelle über das Asset-Protokoll (Scope: screenshots/ der Instanzen); im Mock ist `path` schon eine data:-URL. */
  screenshotSrc(shot: Screenshot): string;

  /** Datei mit dem Standardprogramm öffnen (z. B. Absturzbericht). */
  openPath(path: string): Promise<void>;

  /** Neuere Launcher-Version aus den GitHub-Releases, sonst null. Im Browser gibt es keine Updates. */
  checkAppUpdate(): Promise<Update | null>;
  /** Launcher neu starten (nach dem Update auf Systemen, deren Installer das nicht selbst tut). */
  restartApp(): Promise<void>;

  /** Stand der Freunde-Funktion; geht immer, auch wenn sie aus ist oder die Identität fehlt. */
  friendsState(): Promise<FriendsState>;
  /** Schaltet Freunde ein (Microsoft-Konto nötig); legt beim ersten Mal die Identität an. */
  friendsEnable(input: FriendsEnableInput): Promise<FriendsState>;
  /** Schaltet Freunde aus; die Daten bleiben. */
  friendsDisable(): Promise<FriendsState>;
  /** Ändert Anzeigename und „Immer über Relay“; bei geänderter Relay-Wahl enden laufende Sitzungen. */
  friendsUpdateSettings(settings: FriendsSettings): Promise<FriendsState>;
  /** Neue Identität; Freunde bekommen sie automatisch, offene Codes und wartende Anfragen verfallen. */
  friendsRotateIdentity(): Promise<FriendsState>;
  /** Alle Freunde, Anfragen, Codes und Sperren löschen und eine neue Identität anlegen; geht auch bei verlorener Identität. */
  friendsReset(): Promise<FriendsState>;
  friendsList(): Promise<Friend[]>;
  friendRequests(): Promise<FriendRequest[]>;
  /** Erzeugt einen Freundescode; nur diese Antwort trägt den Code im Klartext. */
  friendCodeCreate(): Promise<FriendCode>;
  /** Die offenen Codes ohne Klartext. */
  friendCodes(): Promise<FriendCode[]>;
  friendCodeRevoke(codeId: string): Promise<void>;
  /** Löst einen Code ein; kehrt sofort zurück, die Zustellung läuft im Hintergrund. */
  friendAdd(code: string): Promise<FriendRequest>;
  /** Schickt über das Verzeichnis eine Anfrage an den genauen Minecraft-Namen; die Antwort ist die wartende eigene Anfrage. */
  friendAddByName(name: string): Promise<FriendRequest>;
  friendRequestAnswer(requestId: string, accept: boolean): Promise<void>;
  /** Zieht eine eigene Anfrage zurück. */
  friendRequestCancel(requestId: string): Promise<void>;
  /** Eigener Name für den Freund; null = der angegebene Name. */
  friendRename(friendId: string, alias: string | null): Promise<void>;
  /** Blendet den Hinweis (neuer Name, neue Identität) eines Freundes aus. */
  friendAcknowledge(friendId: string): Promise<void>;
  friendRemove(friendId: string): Promise<void>;
  /** Entfernt den Freund bzw. verwirft die Anfrage und sperrt die Gegenseite. */
  friendBlock(peerId: string): Promise<void>;
  friendUnblock(peerId: string): Promise<void>;
  friendsBlocked(): Promise<BlockedPeer[]>;
  /** Stellt offene Anfragen sofort zu und versucht Freunde zu erreichen, die offline wirken; kehrt sofort zurück. */
  friendsRetryNow(): Promise<void>;
  /** Skin des Freundes als PNG-data:-URL (das Backend lädt und merkt ihn sich); null = keiner bekannt. */
  friendSkin(friendId: string): Promise<string | null>;

  /** Der geprüfte LAN-Port der laufenden Instanz; null = keiner offen. */
  lanStatus(instanceId: string): Promise<LanStatus | null>;
  hostSessions(): Promise<HostSession[]>;
  /** Teilt die geöffnete LAN-Welt; `port` nur, wenn der Nutzer ihn selbst nennt. */
  hostStart(instanceId: string, port: number | null, showWorldName: boolean): Promise<HostSession>;
  hostInvite(sessionId: string, friendIds: string[]): Promise<HostSession>;
  hostKick(sessionId: string, friendId: string): Promise<HostSession>;
  hostStop(sessionId: string): Promise<void>;
  invitesList(): Promise<Invite[]>;
  inviteDecline(inviteId: string): Promise<void>;
  /** Holt die Angaben des Gastgebers und gleicht sie mit den eigenen Instanzen ab. */
  invitePlan(inviteId: string): Promise<JoinPlan>;
  /** Öffnet den lokalen Tunnel; das Spiel startet die Oberfläche danach mit `LaunchOptions.friendJoin`. */
  inviteJoin(inviteId: string, instanceId: string): Promise<JoinTicket>;
  joinLeave(joinId: string): Promise<void>;
  /** Was der nächste Start der Instanz mit der Mod im Spiel tut und warum, berechnet ohne Start (INGAME 3.9). */
  friendsIngameStatus(instanceId: string): Promise<IngameStatus>;
  /** Der Schalter „Freunde-Menü im Spiel“ der Instanz; hebt auch ein automatisches Ausschalten auf. */
  friendsIngameSetEnabled(instanceId: string, enabled: boolean): Promise<IngameStatus>;
  /** „Erneut versuchen“ nach einem Startfehler; ein vom Nutzer ausgeschalteter Schalter bleibt aus. */
  friendsIngameRetry(instanceId: string): Promise<IngameStatus>;
  /** Antwort auf `friends-mod-confirm`: darf die Mod die Welt teilen? */
  friendsModConfirm(requestId: string, allow: boolean): Promise<void>;
}

/** Die `on…`-Abonnements, die beide Backends gleich aus ihrem `Subscribe` bauen. */
export const eventSubscriptions = (on: Subscribe) => ({
  onContentBlocked: (cb) => on("content-blocked", cb),
  onContentProgress: (cb) => on("content-progress", cb),
  onInstallProgress: (cb) => on("install-progress", cb),
  onLog: (cb) => on("instance-log", cb),
  onExit: (cb) => on("instance-exit", cb),
  onInstancesChanged: (cb) => on("instances-changed", cb),
  onPackOpened: (cb) => on("pack-opened", cb),
  onFriendsChanged: (cb) => on("friends-changed", cb),
  onFriendsNetwork: (cb) => on("friends-network", cb),
  onFriendPresence: (cb) => on("friend-presence", cb),
  onFriendRequest: (cb) => on("friend-request", cb),
  onFriendRequestRefused: (cb) => on("friend-request-refused", cb),
  onFriendInvite: (cb) => on("friend-invite", cb),
  onFriendInviteRevoked: (cb) => on("friend-invite-revoked", cb),
  onHostSession: (cb) => on("host-session", cb),
  onHostSessionEnded: (cb) => on("host-session-ended", cb),
  onJoinSession: (cb) => on("join-session", cb),
  onLanChanged: (cb) => on("lan-changed", cb),
  onFriendsMod: (cb) => on("friends-mod", cb),
  onFriendsModConfirm: (cb) => on("friends-mod-confirm", cb),
  onFriendsIngame: (cb) => on("friends-ingame", cb),
  onFriendsIngameFailed: (cb) => on("friends-ingame-failed", cb),
} satisfies Partial<Backend>);
