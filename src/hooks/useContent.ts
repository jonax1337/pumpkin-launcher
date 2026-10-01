import { useEffect } from "react";
import { useMutation, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { create } from "zustand";
import { api } from "@/lib/api";
import { doneLabel, type ContentProgress, type ContentProject } from "@/lib/modrinth";
import type { Instance } from "@/lib/types";
import { useTasks, type DoneTask } from "@/store/tasks";
import { instanceKeys } from "./useInstances";
import { useOnline } from "./useOnline";

// Keeps progress visible across route changes; only the matching active operation may update it.
// `target` says what runs (a project ID or "updates"), so rows can show their own progress.
export const useContentState = create<{
  active: string | null; target: string | null; label: string | null; cancellable: boolean; progress: ContentProgress | null;
}>(() => ({ active: null, target: null, label: null, cancellable: false, progress: null }));

export type ContentRun<R = Instance> = ((operationId: string) => Promise<R>) & { target?: string; label?: string; cancellable?: boolean };

/**
 * Hängt an einen Lauf, was er betrifft (für den Fortschritt in der passenden Zeile)
 * und wie er im Aufgaben-Menü heißt („Sodium installieren“). `cancellable`: Backend-Befehl
 * `pack_install_cancel` bricht ihn ab, das Aufgaben-Menü zeigt dann „Abbrechen“.
 */
export const withTarget = <R = Instance>(
  target: string,
  run: (operationId: string) => Promise<R>,
  label?: string,
  options?: { cancellable?: boolean },
): ContentRun<R> => Object.assign(run, { target, label, cancellable: options?.cancellable });

/** Bricht den laufenden Vorgang ab; das Ergebnis meldet der zentrale Fehler-Toast neutral. */
export function cancelContent() {
  const op = useContentState.getState().active;
  if (op) void api.packInstallCancel(op).catch((e: Error) => toast.error(e.message));
}

/**
 * Führt einen Lauf als sichtbaren Vorgang aus (Fortschritt im Store, Eintrag im Verlauf) und gibt sein Ergebnis zurück;
 * null, wenn schon einer läuft. `finish` macht aus dem Ergebnis den Verlaufseintrag.
 */
export async function trackContent<R>(
  qc: QueryClient,
  run: ContentRun<R>,
  finish: (result: R, label: string) => Pick<DoneTask, "label" | "sub" | "to">,
): Promise<R | null> {
  // A second submit while one runs is ignored: the running operation is already shown.
  if (useContentState.getState().active) return null;
  const operationId = crypto.randomUUID();
  const label = run.label ?? "Inhalte laden";
  useContentState.setState({ active: operationId, target: run.target ?? null, label, cancellable: !!run.cancellable, progress: null });
  let unlisten: (() => void) | undefined;
  try {
    unlisten = await api.onContentProgress((progress) => {
      if (progress.operationId === operationId && useContentState.getState().active === operationId) useContentState.setState({ progress });
    });
    const result = await run(operationId);
    useTasks.getState().push({ ...finish(result, label), state: "done" });
    return result;
  } catch (error) {
    useTasks.getState().push({ label, sub: error instanceof Error ? error.message : String(error), state: "fail" });
    throw error;
  } finally {
    unlisten?.();
    useContentState.setState({ active: null, target: null, label: null, cancellable: false });
    void qc.invalidateQueries({ queryKey: instanceKeys.all });
    void qc.invalidateQueries({ queryKey: ["instance-status"] });
    void qc.invalidateQueries({ queryKey: ["modrinth-updates"] });
  }
}

export function useContentInstall() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (install: ContentRun) =>
      trackContent(qc, install, (instance, label) => {
        qc.setQueryData(instanceKeys.detail(instance.id), instance);
        return { label: doneLabel(label), sub: instance.name, to: `/instances/${instance.id}` };
      }),
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

/** Update-Check einer Instanz: gemeinsamer Schlüssel und Cache (10 min) für Detail und Bibliothek. */
const updatesQuery = (instanceId: string) => ({
  queryKey: ["modrinth-updates", instanceId],
  queryFn: () => api.modrinthCheckUpdates(instanceId),
  staleTime: 10 * 60_000,
  retry: false,
});

/** Update-Check einer Instanz; still, wenn Modrinth nicht erreichbar ist. */
export function useModUpdates(instanceId: string, enabled: boolean) {
  return useQuery({ ...updatesQuery(instanceId), enabled });
}

/**
 * Sparsamer Update-Check im Hintergrund für mehrere Instanzen (Bibliothek): nur online, höchstens zwei gleichzeitig,
 * frische Einträge (< 10 min) werden nicht neu abgefragt. Ergebnisse landen im selben Cache wie `useModUpdates`.
 */
export function useBackgroundUpdates(instanceIds: string[]) {
  const qc = useQueryClient();
  const online = useOnline();
  const key = instanceIds.join("|");
  useEffect(() => {
    if (!key || !online) return;
    const queue = key.split("|");
    let stopped = false;
    const worker = async () => {
      for (let id = queue.shift(); id && !stopped; id = queue.shift()) await qc.prefetchQuery(updatesQuery(id));
    };
    void Promise.all([worker(), worker()]);
    return () => void (stopped = true);
  }, [qc, key, online]);
}
