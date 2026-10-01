import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { create } from "zustand";
import { api } from "@/lib/api";
import type { ContentProgress, ContentProject } from "@/lib/modrinth";
import type { Instance } from "@/lib/types";
import { useTasks } from "@/store/tasks";
import { instanceKeys } from "./useInstances";

// Keeps progress visible across route changes; only the matching active operation may update it.
// `target` says what runs (a project ID or "updates"), so rows can show their own progress.
export const useContentState = create<{
  active: string | null; target: string | null; label: string | null; cancellable: boolean; progress: ContentProgress | null; error: string | null; result: Instance | null;
}>(() => ({ active: null, target: null, label: null, cancellable: false, progress: null, error: null, result: null }));

export type ContentRun = ((operationId: string) => Promise<Instance>) & { target?: string; label?: string; cancellable?: boolean };

/**
 * Hängt an einen Lauf, was er betrifft (für den Fortschritt in der passenden Zeile)
 * und wie er im Aufgaben-Menü heißt („Sodium installieren“).
 */
export const withTarget = (target: string, run: (operationId: string) => Promise<Instance>, label?: string): ContentRun =>
  Object.assign(run, { target, label });

/** Der Lauf lässt sich abbrechen (Backend: `pack_install_cancel`); das Aufgaben-Menü zeigt dann „Abbrechen“. */
export const cancellable = (run: ContentRun): ContentRun => Object.assign(run, { cancellable: true });

/** Bricht den laufenden Vorgang ab; das Ergebnis meldet der zentrale Fehler-Toast neutral. */
export function cancelContent() {
  const op = useContentState.getState().active;
  if (op) void api.packInstallCancel(op).catch((e: Error) => toast.error(e.message));
}

/** „installieren“ → „installiert“ für den Verlauf. */
const doneLabel = (label: string) =>
  label.replace(/installieren$/, "installiert").replace(/aktualisieren$/, "aktualisiert").replace(/importieren$/, "importiert").replace(/anlegen$/, "angelegt").replace(/duplizieren$/, "dupliziert")
    .replace(/hinzufügen$/, "hinzugefügt").replace(/abgleichen$/, "abgeglichen").replace(/exportieren$/, "exportiert");

export function useContentInstall() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (install: ContentRun) => {
      // A second submit while one runs is ignored: the running operation is already shown, an error would linger next to its success.
      if (useContentState.getState().active) return null;
      const operationId = crypto.randomUUID();
      const label = install.label ?? "Inhalte laden";
      useContentState.setState({ active: operationId, target: install.target ?? null, label, cancellable: !!install.cancellable, progress: null, error: null, result: null });
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
        useContentState.setState({ active: null, target: null, label: null, cancellable: false });
        void qc.invalidateQueries({ queryKey: instanceKeys.all });
        void qc.invalidateQueries({ queryKey: ["instance-status"] });
        void qc.invalidateQueries({ queryKey: ["modrinth-updates"] });
      }
    },
    retry: false,
  });
}

/** Laufenden abbrechbaren Vorgang (Modpack, Import) abbrechen; das Ergebnis meldet der zentrale Fehler-Toast neutral. */
export function cancelActive() {
  const op = useContentState.getState().active;
  if (op) void api.packInstallCancel(op).catch((e: Error) => toast.error(e.message));
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

/** Online-Zustand des Browsers/WebViews (für Abfragen im Hintergrund). */
function useOnline() {
  const [online, setOnline] = useState(() => navigator.onLine);
  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    return () => {
      window.removeEventListener("online", on);
      window.removeEventListener("offline", off);
    };
  }, []);
  return online;
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
