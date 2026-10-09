import { useEffect } from "react";
import { MutationObserver, useMutation, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { t } from "@/i18n";
import { api } from "@/lib/api";
import { errorMessage } from "@/lib/errors";
import type { ContentProject, ModUpdate } from "@/lib/content-types";
import { queryClient } from "@/lib/queryClient";
import { instanceUrl } from "@/lib/routes";
import { toastError } from "@/lib/toast";
import { HOUR } from "@/lib/time";
import type { Instance } from "@/lib/types";
import { useContentState } from "@/store/contentState";
import { useTasks, type DoneTask } from "@/store/tasks";
import { useOnline } from "./useOnline";
import { catalogKeys, instanceKeys } from "./queryKeys";
import { CATALOG_STALE_MS } from "./staleTimes";

export type ContentRun<R = Instance> = ((operationId: string) => Promise<R>) & {
  target?: string; label?: string; doneLabel?: string; cancellable?: boolean; instanceIds?: string[];
};

/**
 * Hängt an einen Lauf, was er betrifft (für den Fortschritt in der passenden Zeile)
 * und wie er im Aufgaben-Menü heißt („Sodium installieren“, danach „Sodium installiert“).
 * `cancellable`: Backend-Befehl `pack_install_cancel` bricht ihn ab, das Aufgaben-Menü zeigt dann „Abbrechen“.
 * `instanceIds`: die Instanzen, an denen er arbeitet; nur sie sind währenddessen für Start und Änderungen gesperrt.
 * Ohne Angabe legt der Lauf eine neue Instanz an.
 */
export const withTarget = <R = Instance>(
  target: string,
  run: (operationId: string) => Promise<R>,
  label?: string,
  options?: { cancellable?: boolean; doneLabel?: string; instanceIds?: string[] },
): ContentRun<R> =>
  Object.assign(run, { target, label, doneLabel: options?.doneLabel, cancellable: options?.cancellable, instanceIds: options?.instanceIds });

/** Bricht den laufenden Vorgang ab; das Ergebnis meldet der zentrale Fehler-Toast neutral. */
export function cancelContent() {
  const op = useContentState.getState().active;
  if (op) void api.packInstallCancel(op).catch(toastError);
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
  const label = run.label ?? t("ui.tasks.loadingContents");
  useContentState.setState({
    active: operationId, target: run.target ?? null, label, cancellable: !!run.cancellable, progress: null, instanceIds: run.instanceIds ?? [],
  });
  let unlisten: (() => void) | undefined;
  try {
    unlisten = await api.onContentProgress((progress) => {
      if (progress.operationId === operationId && useContentState.getState().active === operationId) useContentState.setState({ progress });
    });
    const result = await run(operationId);
    useTasks.getState().push({ ...finish(result, run.doneLabel ?? label), state: "done" });
    return result;
  } catch (error) {
    useTasks.getState().push({ label, sub: errorMessage(error), state: "fail" });
    throw error;
  } finally {
    unlisten?.();
    useContentState.setState({ active: null, target: null, label: null, cancellable: false, instanceIds: [] });
    void qc.invalidateQueries({ queryKey: instanceKeys.all });
    void qc.invalidateQueries({ queryKey: instanceKeys.statuses });
    void qc.invalidateQueries({ queryKey: catalogKeys.allUpdates });
  }
}

const installMutation = (qc: QueryClient) => ({
  mutationFn: (install: ContentRun) =>
    trackContent(qc, install, (instance, label) => {
      qc.setQueryData(instanceKeys.detail(instance.id), instance);
      return { label, sub: instance.name, to: instanceUrl(instance.id) };
    }),
  retry: false,
});

export function useContentInstall() {
  return useMutation(installMutation(useQueryClient()));
}

/**
 * Wie `useContentInstall`, aber ohne Komponente: `onDone` läuft auch, wenn die Seite inzwischen verlassen wurde.
 * Fehler meldet der zentrale Handler des Clients; das Ergebnis ist da, wenn der Vorgang zu Ende ist.
 */
export const startContentInstall = (run: ContentRun, onDone?: (result: Instance) => void) =>
  new MutationObserver(queryClient, installMutation(queryClient))
    .mutate(run)
    .then((result) => result && onDone?.(result), () => undefined);

/** Titel und Icons eines Projekts ändern sich praktisch nie. */
const PROJECT_INFO_STALE_MS = HOUR;

/** Icons und Titel der installierten Modrinth-Inhalte, ein Aufruf pro Liste. Fehler: Liste zeigt Kacheln und Dateinamen. */
export function useProjects(projectIds: string[]) {
  const ids = [...new Set(projectIds)].sort();
  return useQuery({
    queryKey: catalogKeys.projects(ids),
    queryFn: async () => new Map((await api.modrinthProjects(ids)).map((p): [string, ContentProject] => [p.id, p])),
    enabled: ids.length > 0,
    staleTime: PROJECT_INFO_STALE_MS,
    placeholderData: (prev) => prev,
    retry: false,
  });
}

/** Update-Check einer Instanz: gemeinsamer Schlüssel und Cache (10 min) für Detail und Bibliothek. */
const updatesQuery = (instanceId: string) => ({
  queryKey: catalogKeys.updates(instanceId),
  queryFn: () => api.modrinthCheckUpdates(instanceId),
  staleTime: CATALOG_STALE_MS,
  retry: false,
});

/** Update-Check einer Instanz; still, wenn Modrinth nicht erreichbar ist. */
export function useModUpdates(instanceId: string, enabled: boolean) {
  return useQuery({ ...updatesQuery(instanceId), enabled });
}

/**
 * Update-Hinweise je Mod-ID, deren Stand noch stimmt: direkt nach dem Aktualisieren läuft der Check erst neu.
 * `enabled` false liest nur, was im Cache liegt (Bibliothek, gefüllt von `useBackgroundUpdates`).
 */
export function useCurrentUpdates(instance: Instance, enabled: boolean): Map<string, ModUpdate> {
  const { data } = useModUpdates(instance.id, enabled);
  const current = (data ?? []).filter((u) => instance.mods.some((m) => m.id === u.modId && m.version === u.currentVersion && !m.pinned));
  return new Map(current.map((u) => [u.modId, u]));
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
