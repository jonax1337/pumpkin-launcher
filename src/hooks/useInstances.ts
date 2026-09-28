import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type { Instance, NewInstance } from "@/lib/types";

export const instanceKeys = {
  all: ["instances"] as const,
  detail: (id: string) => ["instances", id] as const,
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
    mutationFn: (input: NewInstance) => api.createInstance(input),
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
