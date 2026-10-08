import { keepPreviousData, useMutation, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { currentLanguage, t } from "@/i18n/core";
import { api } from "@/lib/api";
import type { IconChoice, Instance, InstanceScene, ModLoader, NewInstance } from "@/lib/types";
import { CATALOG_STALE_MS } from "./staleTimes";
import { appKeys, instanceKeys } from "./queryKeys";

const instanceListQuery = { queryKey: instanceKeys.all, queryFn: api.listInstances };

export function useInstances() {
  return useQuery(instanceListQuery);
}

/** Gruppennamen aller Instanzen, alphabetisch; Gruppen gibt es nur über die Instanzen, die sie tragen. */
export const groupsOf = (instances: Instance[]) =>
  [...new Set(instances.flatMap((i) => (i.group ? [i.group] : [])))].sort((a, b) => a.localeCompare(b, currentLanguage()));

/** Anzeige für Instanzen ohne Gruppe (Bibliothek und Einstellungen); live berechnet, kein fester Text. */
export const ungrouped = () => t("detail.settings.noGroup");

export function useGroups() {
  return useQuery({ ...instanceListQuery, select: groupsOf }).data ?? [];
}

/** Gewählte Szene der Instanz (null = aus der ID abgeleitet); aus der Instanzliste, die ohnehin geladen ist. */
export function useInstanceScene(id: string | undefined) {
  return useQuery({ ...instanceListQuery, select: (list) => list.find((i) => i.id === id)?.scene ?? null }).data;
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
    // RAM und Icon sind nicht Teil von `NewInstance` und werden direkt danach gesetzt.
    mutationFn: async ({ memoryMb, icon, ...input }: NewInstance & { memoryMb: number | null; icon?: IconChoice | null }) => {
      let instance = await api.createInstance(input);
      if (memoryMb != null) instance = await api.updateInstance({ ...instance, memoryMb });
      return icon ? api.setInstanceIcon(instance.id, icon) : instance;
    },
    // Auch nach einem Teilfehler: die Instanz gibt es dann schon.
    onSettled: () => qc.invalidateQueries({ queryKey: instanceKeys.all }),
  });
}

/** Gespeicherte Instanz in den Cache übernehmen und die Liste neu laden. */
export function instanceSaved(qc: QueryClient, instance: Instance) {
  qc.setQueryData(instanceKeys.detail(instance.id), instance);
  return qc.invalidateQueries({ queryKey: instanceKeys.all });
}

export function useUpdateInstance() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (instance: Instance) => api.updateInstance(instance),
    onSuccess: (instance) => instanceSaved(qc, instance),
  });
}

/** Gruppe einer Instanz setzen (null = ohne); das Backend ändert nur dieses Feld. */
export function useSetGroup(instanceId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (group: string | null) => api.setInstanceGroup(instanceId, group),
    onSuccess: (instance) => instanceSaved(qc, instance),
  });
}

/** Eigenes Icon einer Instanz setzen (null = automatisch); das Backend ändert nur dieses Feld. */
export function useSetIcon(instanceId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (icon: IconChoice | null) => api.setInstanceIcon(instanceId, icon),
    onSuccess: (instance) => instanceSaved(qc, instance),
  });
}

/** Szene einer Instanz setzen (null = aus der ID abgeleitet); das Backend ändert nur dieses Feld. */
export function useSetScene(instanceId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (scene: InstanceScene | null) => api.setInstanceScene(instanceId, scene),
    onSuccess: (instance) => instanceSaved(qc, instance),
  });
}

/** Instanz umbenennen, auf dem frisch gelesenen Stand: so überschreibt der Name nichts, was sich seit der Liste geändert hat. */
export function useRenameInstance(instanceId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (name: string) => api.updateInstance({ ...(await api.getInstance(instanceId)), name }),
    onSuccess: (instance) => instanceSaved(qc, instance),
  });
}

/**
 * Mod-Liste speichern: Anzeige sofort, bei Fehler zurückgerollt. Gespeichert wird der Reihe nach,
 * weil das Backend eine zweite Änderung ablehnt, solange eine läuft.
 */
export function useUpdateMods(instanceId: string) {
  const qc = useQueryClient();
  const key = instanceKeys.detail(instanceId);
  const mutationKey = instanceKeys.mods(instanceId);
  return useMutation({
    mutationKey,
    scope: { id: mutationKey.join(":") },
    mutationFn: (instance: Instance) => api.updateInstance(instance),
    onMutate: async (instance) => {
      await qc.cancelQueries({ queryKey: key });
      const previous = qc.getQueryData<Instance>(key);
      qc.setQueryData(key, instance);
      return { previous };
    },
    onError: (_, __, ctx) => ctx?.previous && qc.setQueryData(key, ctx.previous),
    onSuccess: (instance) => {
      // Nur die letzte Änderung übernimmt den Serverstand, sonst springen noch wartende Schalter zurück.
      if (qc.isMutating({ mutationKey }) === 1) qc.setQueryData(key, instance);
    },
    onSettled: () => qc.invalidateQueries({ queryKey: instanceKeys.all, exact: true }),
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

/** Einträge des Spielordners, aus denen der Export-Dialog wählen lässt. */
export function useExportEntries(instanceId: string) {
  return useQuery({ queryKey: instanceKeys.exportEntries(instanceId), queryFn: () => api.exportEntries(instanceId), staleTime: 0 });
}

/** Wie ein Export die Inhalte der Auswahl verteilen würde; die letzte Zahl bleibt stehen, bis die neue da ist. */
export function useExportSummary(instanceId: string, include: string[], enabled: boolean) {
  return useQuery({
    enabled,
    queryKey: instanceKeys.exportSummary(instanceId, include),
    queryFn: () => api.exportSummary(instanceId, include),
    staleTime: 0,
    placeholderData: keepPreviousData,
  });
}

/** Zuletzt gespielte zuerst, nie gespielte dahinter (neueste zuerst). */
export const byRecent = (a: Instance, b: Instance) => (b.lastPlayedAt ?? 0) - (a.lastPlayedAt ?? 0) || b.createdAt - a.createdAt;

/** Zuletzt gespielte Instanz (Fallback: zuletzt erstellte; `lastPlayedAt` zeigt, welcher Fall vorliegt). */
export function pickRecentInstance(instances: Instance[] | undefined): Instance | undefined {
  if (!instances?.length) return undefined;
  return [...instances].sort(byRecent)[0];
}

export function useVersions() {
  return useQuery({ queryKey: appKeys.minecraftVersions, queryFn: api.versionsList, staleTime: CATALOG_STALE_MS });
}

export function useLoaderVersions(loader: ModLoader, mcVersion: string) {
  return useQuery({
    queryKey: appKeys.loaderVersions(loader, mcVersion),
    queryFn: () => api.loaderVersions(loader, mcVersion),
    enabled: loader !== "vanilla" && !!mcVersion,
    staleTime: CATALOG_STALE_MS,
  });
}

/** Abfrage des Status einer Instanz; auch für mehrere Instanzen auf einmal (`useQueries`). */
export const instanceStatusQuery = (id: string | undefined) => ({
  queryKey: instanceKeys.status(id ?? ""),
  queryFn: () => api.instanceStatus(id!),
  enabled: !!id,
});

export function useInstanceStatus(id: string | undefined) {
  return useQuery(instanceStatusQuery(id));
}
