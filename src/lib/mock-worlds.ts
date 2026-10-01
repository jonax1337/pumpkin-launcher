// Nur im Browser-Dev-Modus dynamisch geladen (siehe api.ts); im Release-Build nicht enthalten.
import { t } from "@/i18n";
import type { Backend } from "./backend";
import type { ContentVersion } from "./content-types";
import { clone, findInstance, modrinthFetch, wait, type MockContext } from "./mock-util";
import { DAY } from "./time";
import type { Datapack, GameMode, Server, World, WorldBackup } from "./types";

const MB = 1024 * 1024;

/** Eine gesicherte Welt ist gepackt kleiner als der Ordner. */
const BACKUP_SIZE_SHARE = 0.6;

/** Ordner einer Welt im vorgetäuschten Launcher. */
const savePath = (id: string) => `C:\\Pumpkin Launcher\\saves\\${id}`;

const WORLDS: [id: string, name: string, mode: GameMode, hardcore: boolean, days: number, mb: number][] = [
  ["Neue Welt", "Kürbisinsel", "survival", false, 0.1, 182],
  ["Bauplatz", "Kreativ-Bauplatz", "creative", false, 6, 64],
  ["Hardcore 3", "Hardcore, dritter Versuch", "survival", true, 40, 12],
];

const SERVERS: Server[] = [
  { name: "Pumpkin Lobby", address: "play.example.net", icon: null, acceptTextures: null },
  { name: "Freunde-SMP", address: "smp.example.net:25570", icon: null, acceptTextures: true },
];

const DATAPACKS: Datapack[] = [
  { id: "Mehr Biome.zip", name: "Mehr Biome", description: "Neue Biome und Höhlen für die Oberwelt", enabled: true },
  { id: "Köpfe", name: "Köpfe", description: "Kreaturen lassen manchmal ihren Kopf fallen", enabled: false },
  { id: "Schnellere Nächte.zip", name: "Schnellere Nächte", description: null, enabled: null },
];

/** Gleiche Formen wie die Welt-, Datenpaket- und Server-Commands, alles nur im Speicher; je Instanz dieselben Beispiele. */
export function createWorldMock({ db, emit }: MockContext) {
  const worlds = new Map<string, World[]>();
  const servers = new Map<string, Server[]>();
  const backups = new Map<string, WorldBackup[]>();
  const datapacks = new Map<string, Datapack[]>();
  const now = Date.now();

  const worldsOf = (instanceId: string) => {
    if (!worlds.has(instanceId)) {
      worlds.set(instanceId, WORLDS.map(([id, name, gameMode, hardcore, days, mb]) => ({
        id,
        name,
        gameMode,
        hardcore,
        lastPlayed: now - days * DAY,
        version: findInstance(db, instanceId).minecraftVersion,
        sizeBytes: mb * MB,
        icon: null,
        path: savePath(id),
      })));
    }
    return worlds.get(instanceId)!;
  };
  const serversOf = (instanceId: string) => {
    if (!servers.has(instanceId)) servers.set(instanceId, clone(SERVERS));
    return servers.get(instanceId)!;
  };
  const backupsOf = (instanceId: string) => {
    if (!backups.has(instanceId)) backups.set(instanceId, []);
    return backups.get(instanceId)!;
  };
  /** Wie `AppState::operation` im Backend: Spieldateien bleiben unangetastet, solange das Spiel läuft. */
  const notRunning = (instanceId: string) => {
    if (db.running.has(instanceId)) throw new Error(t("mock.instance.stillRunning"));
  };
  const world = (instanceId: string, id: string) => {
    const found = worldsOf(instanceId).find((w) => w.id === id);
    if (!found) throw new Error(t("mock.world.notFound", { id }));
    return found;
  };
  const packsOf = (instanceId: string, worldId: string) => {
    const key = `${instanceId}/${world(instanceId, worldId).id}`;
    if (!datapacks.has(key)) datapacks.set(key, clone(DATAPACKS));
    return datapacks.get(key)!;
  };

  async function backup(instanceId: string, worldId: string, operationId: string) {
    notRunning(instanceId);
    const saved = world(instanceId, worldId);
    const total = 24;
    for (let done = 0; done <= total; done += 4) {
      emit("content-progress", { operationId, phase: "backup", done, total });
      await wait(120);
    }
    const created: WorldBackup = {
      id: `${worldId}-${Date.now()}.zip`,
      world: worldId,
      createdAt: Date.now(),
      sizeBytes: Math.round(saved.sizeBytes * BACKUP_SIZE_SHARE),
    };
    backupsOf(instanceId).unshift(created);
    return clone(created);
  }

  return {
    async worldList(instanceId: string) {
      await wait();
      return clone(worldsOf(instanceId));
    },
    worldBackup: backup,
    async worldBackups(instanceId: string) {
      await wait();
      return clone(backupsOf(instanceId));
    },
    async worldRestore(instanceId: string, backupId: string) {
      notRunning(instanceId);
      await wait(600);
      const source = backupsOf(instanceId).find((b) => b.id === backupId);
      if (!source) throw new Error(t("mock.backup.notFound", { id: backupId }));
      const list = worldsOf(instanceId);
      let id = source.world;
      for (let n = 2; list.some((w) => w.id === id); n++) id = `${source.world} (${n})`;
      const restored: World = {
        id,
        name: id,
        lastPlayed: source.createdAt,
        gameMode: "survival",
        hardcore: false,
        version: null,
        sizeBytes: source.sizeBytes,
        icon: null,
        path: savePath(id),
      };
      list.unshift(restored);
      return clone(restored);
    },
    async worldBackupDelete(instanceId: string, backupId: string) {
      await wait();
      backups.set(instanceId, backupsOf(instanceId).filter((b) => b.id !== backupId));
    },
    async worldDelete(instanceId: string, worldId: string, operationId: string) {
      const safety = await backup(instanceId, worldId, operationId);
      worlds.set(instanceId, worldsOf(instanceId).filter((w) => w.id !== worldId));
      // Wie `world_delete`: eine gelöschte Welt ist kein Quick-Play-Ziel mehr.
      const owner = findInstance(db, instanceId);
      if (owner.lastQuickPlay?.type === "world" && owner.lastQuickPlay.id === worldId) owner.lastQuickPlay = null;
      return safety;
    },
    /** Wie die Versions-JSON ab 1.20 (Feature `is_quick_play_singleplayer`). */
    async worldQuickPlaySupported(instanceId: string) {
      await wait();
      const [, minor] = findInstance(db, instanceId).minecraftVersion.split(".").map(Number);
      return minor >= 20;
    },
    async datapackList(instanceId: string, worldId: string) {
      await wait();
      return clone(packsOf(instanceId, worldId));
    },
    /** Wie `datapack_install`: Version echt von Modrinth, der Download nur vorgetäuscht. */
    async datapackInstall(instanceId: string, worldId: string, versionId: string, operationId: string) {
      notRunning(instanceId);
      emit("content-progress", { operationId, phase: "resolve", done: 0, total: 1 });
      const version = await modrinthFetch<ContentVersion>(`/version/${versionId}`);
      emit("content-progress", { operationId, phase: "download", done: 0, total: 1 });
      await wait(600);
      const file = version.files.find((f) => f.primary) ?? version.files[0];
      const name = file.filename.replace(/\.zip$/i, "");
      packsOf(instanceId, worldId).push({ id: file.filename, name, description: version.name, enabled: null });
    },
    async datapackRemove(instanceId: string, worldId: string, packId: string) {
      notRunning(instanceId);
      await wait();
      const list = packsOf(instanceId, worldId);
      const at = list.findIndex((p) => p.id === packId);
      if (at < 0) throw new Error(t("mock.datapack.notFound", { id: packId }));
      list.splice(at, 1);
    },
    async serverList(instanceId: string) {
      await wait();
      return clone(serversOf(instanceId));
    },
    async serverSave(instanceId: string, index: number | null, server: Server) {
      notRunning(instanceId);
      await wait();
      const list = serversOf(instanceId);
      const saved = { ...server, name: server.name.trim(), address: server.address.trim() };
      if (index == null) list.push({ ...saved, icon: null });
      else list[index] = { ...saved, icon: list[index].icon };
    },
    async serverRemove(instanceId: string, index: number) {
      notRunning(instanceId);
      await wait();
      serversOf(instanceId).splice(index, 1);
    },
  } satisfies Partial<Backend>;
}
