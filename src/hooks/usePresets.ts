import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type { NewPreset, Preset } from "@/lib/types";
import { instanceKeys } from "@/hooks/useInstances";

export const presetKeys = {
  all: ["presets"] as const,
};

export function usePresets() {
  return useQuery({ queryKey: presetKeys.all, queryFn: api.listPresets });
}

export function useCreatePreset() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: NewPreset) => api.createPreset(input),
    onSuccess: () => qc.invalidateQueries({ queryKey: presetKeys.all }),
  });
}

export function useUpdatePreset() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (preset: Preset) => api.updatePreset(preset),
    onSuccess: () => qc.invalidateQueries({ queryKey: presetKeys.all }),
  });
}

export function useDeletePreset() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.deletePreset(id),
    // Instanzen können auf das Preset verweisen
    onSuccess: () =>
      Promise.all([
        qc.invalidateQueries({ queryKey: presetKeys.all }),
        qc.invalidateQueries({ queryKey: instanceKeys.all }),
      ]),
  });
}

export function useApplyPreset() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ instanceId, presetId }: { instanceId: string; presetId: string }) =>
      api.applyPreset(instanceId, presetId),
    onSuccess: (inst) => {
      qc.setQueryData(instanceKeys.detail(inst.id), inst);
      return qc.invalidateQueries({ queryKey: instanceKeys.all });
    },
  });
}
