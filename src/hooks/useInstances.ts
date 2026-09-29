import { useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { api } from "@/lib/api";
import type { Instance, InstanceStatus, NewInstance } from "@/lib/types";
import { useGame } from "@/store/game";
import { useSettings } from "@/store/settings";

export const instanceKeys = {
  all: ["instances"] as const,
  detail: (id: string) => ["instances", id] as const,
  status: (id: string) => ["instance-status", id] as const,
};

export function useInstances() {
  return useQuery({ queryKey: instanceKeys.all, queryFn: api.listInstances });
}

export function useInstance(id: string | undefined) {
  return useQuery({
    queryKey: instanceKeys.detail(id ?? ""),
    queryFn: () => api.getInstance(id!),
    enabled: !!id,
  });
}

export function useCreateInstance() {
  const qc = useQueryClient();
  return useMutation({
    // RAM ist nicht Teil von `NewInstance` und wird direkt danach gesetzt.
    mutationFn: async ({ memoryMb, ...input }: NewInstance & { memoryMb: number | null }) => {
      const inst = await api.createInstance(input);
      return memoryMb == null ? inst : api.updateInstance({ ...inst, memoryMb });
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: instanceKeys.all }),
  });
}

export function useUpdateInstance() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (instance: Instance) => api.updateInstance(instance),
    onSuccess: (inst) => {
      qc.setQueryData(instanceKeys.detail(inst.id), inst);
      return qc.invalidateQueries({ queryKey: instanceKeys.all });
    },
  });
}

export function useDeleteInstance() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.deleteInstance(id),
    onSuccess: (_, id) => {
      qc.removeQueries({ queryKey: instanceKeys.detail(id) });
      return qc.invalidateQueries({ queryKey: instanceKeys.all });
    },
  });
}

/** Zuletzt gespielte Instanz (Fallback: zuletzt erstellte). */
export function pickRecentInstance(instances: Instance[] | undefined): Instance | undefined {
  if (!instances?.length) return undefined;
  return [...instances].sort(
    (a, b) => (b.lastPlayedAt ?? 0) - (a.lastPlayedAt ?? 0) || b.createdAt - a.createdAt,
  )[0];
}

export function useVersions() {
  return useQuery({ queryKey: ["versions"], queryFn: api.versionsList, staleTime: 10 * 60_000 });
}

export function useInstanceStatus(id: string | undefined) {
  return useQuery({
    queryKey: instanceKeys.status(id ?? ""),
    queryFn: () => api.instanceStatus(id!),
    enabled: !!id,
  });
}

export function useInstall() {
  const qc = useQueryClient();
  const { setProgress, clearProgress } = useGame.getState();
  return useMutation({
    mutationFn: (instance: Instance) => {
      setProgress({ instanceId: instance.id, step: "java", done: 0, total: 0 });
      return api.installInstance(instance.id);
    },
    onSuccess: (_, instance) => toast.success(`${instance.name} ist installiert`),
    onSettled: (_, __, instance) => {
      clearProgress(instance.id);
      return qc.invalidateQueries({ queryKey: instanceKeys.status(instance.id) });
    },
  });
}

export function useLaunch() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (instance: Instance) => {
      const { offlineName, javaPath, memoryMb } = useSettings.getState();
      if (!offlineName) throw new Error("Lege zuerst unter Konto einen Offline-Account an");
      useGame.getState().clearLog(instance.id);
      return api.launchInstance(instance.id, offlineName, javaPath, memoryMb);
    },
    onSuccess: (_, instance) => {
      qc.setQueryData<InstanceStatus>(instanceKeys.status(instance.id), (s) => s && { ...s, running: true });
      return qc.invalidateQueries({ queryKey: instanceKeys.all });
    },
  });
}

// Vom Nutzer gestoppte Instanzen: deren Exit-Code (unter Windows 1) ist kein Fehler.
const stopping = new Set<string>();

export function useKill() {
  return useMutation({
    mutationFn: (instance: Instance) => {
      stopping.add(instance.id);
      return api.killInstance(instance.id);
    },
    onError: (_, instance) => stopping.delete(instance.id),
  });
}

/** Verbindet die Backend-Events mit dem Spiel-Store. Einmal im Layout einhängen. */
export function useGameEvents() {
  const qc = useQueryClient();
  useEffect(() => {
    const { setProgress, appendLog } = useGame.getState();
    const subs = [
      api.onInstallProgress(setProgress),
      api.onLog(appendLog),
      api.onExit(({ instanceId, code }) => {
        qc.setQueryData<InstanceStatus>(instanceKeys.status(instanceId), (s) => s && { ...s, running: false });
        if (!stopping.delete(instanceId) && code != null && code !== 0) toast.error(`Spiel mit Code ${code} beendet – Details in der Konsole`);
      }),
    ];
    return () => subs.forEach((p) => p.then((unlisten) => unlisten()));
  }, [qc]);
}
