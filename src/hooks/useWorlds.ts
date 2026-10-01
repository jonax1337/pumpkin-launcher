import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { api } from "@/lib/api";
import type { Instance, Server, World, WorldBackup } from "@/lib/types";

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
 * Sichern und Löschen einer Welt (Löschen sichert vorher). `job`: welche Welt gerade dran ist und wie weit (0–1, null = noch unbekannt).
 */
export function useWorldJobs(instanceId: string) {
  const [job, setJob] = useState<{ worldId: string; p: number | null } | null>(null);
  const track = async (world: World, run: (operationId: string) => Promise<WorldBackup>) => {
    const operationId = crypto.randomUUID();
    setJob({ worldId: world.id, p: null });
    const unlisten = await api.onContentProgress((e) => {
      if (e.operationId === operationId && e.total) setJob({ worldId: world.id, p: e.done / e.total });
    });
    try {
      return await run(operationId);
    } finally {
      unlisten();
      setJob(null);
    }
  };
  const backup = useWorldChange(
    instanceId,
    (world: World) => track(world, (op) => api.worldBackup(instanceId, world.id, op)),
    (_, world) => `„${world.name}“ gesichert`,
  );
  const remove = useWorldChange(
    instanceId,
    (world: World) => track(world, (op) => api.worldDelete(instanceId, world.id, op)),
    (_, world) => `„${world.name}“ gelöscht. Die Sicherung davon findest du unter „Sicherungen“.`,
  );
  return { job, backup, remove };
}
