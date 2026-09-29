import { useMutation, useQueryClient } from "@tanstack/react-query";
import { create } from "zustand";
import { api } from "@/lib/api";
import type { ContentProgress } from "@/lib/modrinth";
import type { Instance } from "@/lib/types";
import { instanceKeys } from "./useInstances";

// Keeps progress visible across route changes; only the matching active operation may update it.
export const useContentState = create<{
  active: string | null; progress: ContentProgress | null; error: string | null; result: Instance | null;
}>(() => ({ active: null, progress: null, error: null, result: null }));

export function useContentInstall() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (install: (operationId: string) => Promise<Instance>) => {
      // A second submit while one runs is ignored: the running operation is already shown, an error would linger next to its success.
      if (useContentState.getState().active) return null;
      const operationId = crypto.randomUUID();
      useContentState.setState({ active: operationId, progress: null, error: null, result: null });
      let unlisten: (() => void) | undefined;
      try {
        unlisten = await api.onContentProgress((progress) => {
          if (progress.operationId === operationId && useContentState.getState().active === operationId) useContentState.setState({ progress });
        });
        const result = await install(operationId);
        qc.setQueryData(instanceKeys.detail(result.id), result);
        useContentState.setState({ result });
        return result;
      } catch (error) {
        useContentState.setState({ error: error instanceof Error ? error.message : String(error) });
        throw error;
      } finally {
        unlisten?.();
        useContentState.setState({ active: null });
        void qc.invalidateQueries({ queryKey: instanceKeys.all });
        void qc.invalidateQueries({ queryKey: ["instance-status"] });
      }
    },
    retry: false,
  });
}
