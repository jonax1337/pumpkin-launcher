import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { create } from "zustand";
import { api } from "@/lib/api";
import type { ContentProgress, ContentProject } from "@/lib/modrinth";
import type { Instance } from "@/lib/types";
import { useTasks } from "@/store/tasks";
import { instanceKeys } from "./useInstances";

// Keeps progress visible across route changes; only the matching active operation may update it.
// `target` says what runs (a project ID or "updates"), so rows can show their own progress.
export const useContentState = create<{
  active: string | null; target: string | null; label: string | null; progress: ContentProgress | null; error: string | null; result: Instance | null;
}>(() => ({ active: null, target: null, label: null, progress: null, error: null, result: null }));

export type ContentRun = ((operationId: string) => Promise<Instance>) & { target?: string; label?: string };

/**
 * Hängt an einen Lauf, was er betrifft (für den Fortschritt in der passenden Zeile)
 * und wie er im Aufgaben-Menü heißt („Sodium installieren“).
 */
export const withTarget = (target: string, run: (operationId: string) => Promise<Instance>, label?: string): ContentRun =>
  Object.assign(run, { target, label });

/** „installieren“ → „installiert“ für den Verlauf. */
const doneLabel = (label: string) =>
  label.replace(/installieren$/, "installiert").replace(/aktualisieren$/, "aktualisiert").replace(/importieren$/, "importiert").replace(/anlegen$/, "angelegt");

export function useContentInstall() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (install: ContentRun) => {
      // A second submit while one runs is ignored: the running operation is already shown, an error would linger next to its success.
      if (useContentState.getState().active) return null;
      const operationId = crypto.randomUUID();
      const label = install.label ?? "Inhalte laden";
      useContentState.setState({ active: operationId, target: install.target ?? null, label, progress: null, error: null, result: null });
      let unlisten: (() => void) | undefined;
      try {
        unlisten = await api.onContentProgress((progress) => {
          if (progress.operationId === operationId && useContentState.getState().active === operationId) useContentState.setState({ progress });
        });
        const result = await install(operationId);
        qc.setQueryData(instanceKeys.detail(result.id), result);
        useContentState.setState({ result });
        useTasks.getState().push({ label: doneLabel(label), sub: result.name, state: "done", to: `/instances/${result.id}` });
        return result;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        useContentState.setState({ error: message });
        useTasks.getState().push({ label, sub: message, state: "fail" });
        throw error;
      } finally {
        unlisten?.();
        useContentState.setState({ active: null, target: null, label: null });
        void qc.invalidateQueries({ queryKey: instanceKeys.all });
        void qc.invalidateQueries({ queryKey: ["instance-status"] });
        void qc.invalidateQueries({ queryKey: ["modrinth-updates"] });
      }
    },
    retry: false,
  });
}

/** Icons und Titel der installierten Modrinth-Inhalte, ein Aufruf pro Liste. Fehler: Liste zeigt Kacheln und Dateinamen. */
export function useProjects(projectIds: string[]) {
  const ids = [...new Set(projectIds)].sort();
  return useQuery({
    queryKey: ["modrinth-projects", ids],
    queryFn: async () => new Map((await api.modrinthProjects(ids)).map((p): [string, ContentProject] => [p.id, p])),
    enabled: ids.length > 0,
    staleTime: 60 * 60_000,
    placeholderData: (prev) => prev,
    retry: false,
  });
}

/** Update-Check einer Instanz; still, wenn Modrinth nicht erreichbar ist. */
export function useModUpdates(instanceId: string, enabled: boolean) {
  return useQuery({
    queryKey: ["modrinth-updates", instanceId],
    queryFn: () => api.modrinthCheckUpdates(instanceId),
    enabled,
    staleTime: 10 * 60_000,
    retry: false,
  });
}
