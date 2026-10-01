import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { t } from "@/i18n";
import { api } from "@/lib/api";
import { fileName } from "@/lib/format";
import type { Datapack, Instance, Server, World, WorldBackup } from "@/lib/types";
import { trackContent, withTarget, type ContentRun } from "./useContent";
import { worldKeys } from "./worldKeys";

/** Welten einer Instanz; auch für die Auswahl der Welt beim Hinzufügen eines Datenpakets aus Entdecken. */
export const worldsQuery = (instanceId: string) => ({ queryKey: worldKeys.list(instanceId), queryFn: () => api.worldList(instanceId) });

export function useWorlds(instanceId: string) {
  return useQuery(worldsQuery(instanceId));
}

/** Sicherungen der Welt `world` (Ordnername) oder, mit null, aller Welten der Instanz. */
export function useWorldBackups(instanceId: string, world: string | null) {
  return useQuery({
    queryKey: worldKeys.backups(instanceId),
    queryFn: () => api.worldBackups(instanceId),
    select: (list) => (world == null ? list : list.filter((b) => b.world === world)),
  });
}

export function useDatapacks(instanceId: string, worldId: string) {
  return useQuery({ queryKey: worldKeys.datapacks(instanceId, worldId), queryFn: () => api.datapackList(instanceId, worldId) });
}

export function useServers(instanceId: string) {
  return useQuery({ queryKey: worldKeys.servers(instanceId), queryFn: () => api.serverList(instanceId) });
}

/** Ob die Minecraft-Version direkt in eine Welt starten kann (ab 1.20); undefined, solange unbekannt. */
export function useWorldQuickPlay(instance: Instance) {
  return useQuery({
    queryKey: ["world-quick-play", instance.id, instance.minecraftVersion],
    queryFn: () => api.worldQuickPlaySupported(instance.id),
    staleTime: Infinity,
    retry: false,
  }).data;
}

/** Änderung an Welten oder Serverliste; danach zeigen alle Listen der Instanz den neuen Stand. */
function useWorldChange<V, R>(instanceId: string, change: (v: V) => Promise<R>, done?: (result: R, v: V) => string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: change,
    onSuccess: (result, v) => void (done && toast.success(done(result, v))),
    onSettled: () => qc.invalidateQueries({ queryKey: worldKeys.all(instanceId) }),
  });
}

export const useDeleteBackup = (instanceId: string) => useWorldChange(instanceId, (backup: WorldBackup) => api.worldBackupDelete(instanceId, backup.id));

export const useAddDatapacks = (instanceId: string, worldId: string) =>
  useWorldChange(
    instanceId,
    (paths: string[]) => api.datapackAdd(instanceId, worldId, paths),
    (_, paths) => (paths.length === 1 ? t("hooks.datapack.added.one", { name: fileName(paths[0]) }) : t("hooks.datapack.added.other", { count: paths.length })),
  );

export const useRemoveDatapack = (instanceId: string, worldId: string) =>
  useWorldChange(instanceId, (pack: Datapack) => api.datapackRemove(instanceId, worldId, pack.id), (_, pack) => t("hooks.datapack.trashed", { name: pack.name }));

export const useSaveServer = (instanceId: string) =>
  useWorldChange(instanceId, ({ index, server }: { index: number | null; server: Server }) => api.serverSave(instanceId, index, server));

export const useRemoveServer = (instanceId: string) =>
  useWorldChange(instanceId, ({ index }: { index: number; server: Server }) => api.serverRemove(instanceId, index), (_, { server }) => t("hooks.world.serverRemoved", { name: server.name }));

/** Ziel eines Welt-Vorgangs im Inhalts-Store: die Zeile der Welt zeigt dann ihren Fortschritt. */
export const worldTarget = (instanceId: string, worldId: string) => `world:${instanceId}:${worldId}`;

/** Sichern, Löschen (sichert vorher) und Wiederherstellen laufen wie Inhalts-Vorgänge: Fortschritt im Aufgaben-Menü, ein Vorgang zur Zeit. */
export function useWorldJobs(instance: Instance) {
  const qc = useQueryClient();
  const track = async <R,>(run: ContentRun<R>) => {
    const result = await trackContent(qc, run, (_, label) => ({ label, sub: instance.name, to: `/instances/${instance.id}?tab=worlds` }));
    if (result == null) throw new Error(t("hooks.world.operationRunning"));
    return result;
  };
  const backupLabel = (world: World) => t("hooks.world.backupTask", { name: world.name });
  const backup = useWorldChange(
    instance.id,
    (world: World) => track(withTarget(worldTarget(instance.id, world.id), (op) => api.worldBackup(instance.id, world.id, op), backupLabel(world), { doneLabel: t("hooks.world.backupTaskDone", { name: world.name }) })),
    (_, world) => t("hooks.world.backupTaskDone", { name: world.name }),
  );
  const remove = useWorldChange(
    instance.id,
    (world: World) => track(withTarget(worldTarget(instance.id, world.id), (op) => api.worldDelete(instance.id, world.id, op), t("hooks.world.deleteTask", { name: world.name }), { doneLabel: t("hooks.world.deleteTaskDone", { name: world.name }) })),
    (_, world) => t("hooks.world.deletedHint", { name: world.name }),
  );
  const restore = useWorldChange(
    instance.id,
    (backup: WorldBackup) => track(withTarget(`restore:${backup.id}`, () => api.worldRestore(instance.id, backup.id), t("hooks.world.restoreTask", { name: backup.world }), { doneLabel: t("hooks.world.restoreTaskDone", { name: backup.world }) })),
    (world, backup) => (world.id === backup.world ? t("hooks.world.restored", { name: world.name }) : t("hooks.world.restoredInFolder", { name: world.name, folder: world.id })),
  );
  return { backup, remove, restore };
}
