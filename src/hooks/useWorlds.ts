import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { create } from "zustand";
import { api } from "@/lib/api";
import type { Instance, Server, World, WorldBackup } from "@/lib/types";
import { useTasks } from "@/store/tasks";

export const worldKeys = {
  /** Welten, Sicherungen und Serverliste einer Instanz (z. B. nach dem Spielen neu laden). */
  all: (instanceId: string) => ["worlds", instanceId] as const,
  list: (instanceId: string) => ["worlds", instanceId, "list"] as const,
  backups: (instanceId: string) => ["worlds", instanceId, "backups"] as const,
  servers: (instanceId: string) => ["worlds", instanceId, "servers"] as const,
};

export function useWorlds(instanceId: string) {
  return useQuery({ queryKey: worldKeys.list(instanceId), queryFn: () => api.worldList(instanceId) });
}

/** Sicherungen der Welt `world` (Ordnername) oder, mit null, aller Welten der Instanz. */
export function useWorldBackups(instanceId: string, world: string | null) {
  return useQuery({
    queryKey: worldKeys.backups(instanceId),
    queryFn: () => api.worldBackups(instanceId),
    select: (list) => (world == null ? list : list.filter((b) => b.world === world)),
  });
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

export const useRestoreBackup = (instanceId: string) =>
  useWorldChange(
    instanceId,
    (backup: WorldBackup) => api.worldRestore(instanceId, backup.id),
    (world, backup) => (world.id === backup.world ? `„${world.name}“ ist wieder da` : `„${world.name}“ ist wieder da, im Ordner „${world.id}“`),
  );

export const useDeleteBackup = (instanceId: string) => useWorldChange(instanceId, (backup: WorldBackup) => api.worldBackupDelete(instanceId, backup.id));

export const useSaveServer = (instanceId: string) =>
  useWorldChange(instanceId, ({ index, server }: { index: number | null; server: Server }) => api.serverSave(instanceId, index, server));

export const useRemoveServer = (instanceId: string) =>
  useWorldChange(instanceId, ({ index }: { index: number; server: Server }) => api.serverRemove(instanceId, index), (_, { server }) => `„${server.name}“ entfernt`);

/**
 * Laufendes Sichern oder Löschen einer Welt (Löschen sichert vorher): wer, was und wie weit (`p` 0–1, null = noch unbekannt).
 * Ein Store, damit der Fortschritt Tab- und Seitenwechsel übersteht; das Backend erlaubt ohnehin nur einen Vorgang.
 */
export const useWorldJob = create<{ job: { instanceId: string; worldId: string; label: string; p: number | null } | null }>(() => ({ job: null }));

export function useWorldJobs(instance: Instance) {
  const track = async (world: World, verb: { running: string; done: string }, run: (operationId: string) => Promise<WorldBackup>) => {
    const operationId = crypto.randomUUID();
    const label = `„${world.name}“ ${verb.running}`;
    const show = (p: number | null) => useWorldJob.setState({ job: { instanceId: instance.id, worldId: world.id, label, p } });
    show(null);
    const unlisten = await api.onContentProgress((e) => {
      if (e.operationId === operationId && e.total) show(e.done / e.total);
    });
    try {
      const backup = await run(operationId);
      useTasks.getState().push({ label: `„${world.name}“ ${verb.done}`, sub: instance.name, state: "done", to: `/instances/${instance.id}?tab=worlds` });
      return backup;
    } catch (error) {
      useTasks.getState().push({ label, sub: error instanceof Error ? error.message : String(error), state: "fail" });
      throw error;
    } finally {
      unlisten();
      useWorldJob.setState({ job: null });
    }
  };
  const backup = useWorldChange(
    instance.id,
    (world: World) => track(world, { running: "sichern", done: "gesichert" }, (op) => api.worldBackup(instance.id, world.id, op)),
    (_, world) => `„${world.name}“ gesichert`,
  );
  const remove = useWorldChange(
    instance.id,
    (world: World) => track(world, { running: "löschen", done: "gelöscht" }, (op) => api.worldDelete(instance.id, world.id, op)),
    (_, world) => `„${world.name}“ gelöscht. Die Sicherung davon findest du unter „Sicherungen“.`,
  );
  return { backup, remove };
}
