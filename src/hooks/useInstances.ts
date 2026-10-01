import { useEffect } from "react";
import { useMutation, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router";
import { toast } from "sonner";
import { create } from "zustand";
import { askPlayerName, openAddOffline, startMsLogin } from "@/components/PlayerNames";
import { currentLanguage, t } from "@/i18n/core";
import { usableAccount, useOfflineAllowed } from "@/store/offline";
import { api } from "@/lib/api";
import { autoMemoryMb, formatClock, MEMORY_FALLBACK_MAX_MB, MEMORY_FALLBACK_MB, maxMemoryMb } from "@/lib/format";
import { instanceUrl } from "@/lib/routes";
import { toastError } from "@/lib/toast";
import { CANCELLED, type Instance, type InstanceStatus, type ModLoader, type NewInstance, type QuickPlay } from "@/lib/types";
import { useGame } from "@/store/game";
import { accountName, useSettings } from "@/store/settings";
import { useTasks } from "@/store/tasks";
import { CATALOG_STALE_MS } from "./staleTimes";
import { appKeys, instanceKeys, instanceRelatedKeys, screenshotKeys, worldKeys } from "./queryKeys";

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

/** Gespeicherte Instanz in den Cache übernehmen und die Liste neu laden. */
function instanceSaved(qc: QueryClient, inst: Instance) {
  qc.setQueryData(instanceKeys.detail(inst.id), inst);
  return qc.invalidateQueries({ queryKey: instanceKeys.all });
}

export function useUpdateInstance() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (instance: Instance) => api.updateInstance(instance),
    onSuccess: (inst) => instanceSaved(qc, inst),
  });
}

/** Gruppe einer Instanz setzen (null = ohne); das Backend ändert nur dieses Feld. */
export function useSetGroup(instanceId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (group: string | null) => api.setInstanceGroup(instanceId, group),
    onSuccess: (inst) => instanceSaved(qc, inst),
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
    onSuccess: (inst) => {
      // Nur die letzte Änderung übernimmt den Serverstand, sonst springen noch wartende Schalter zurück.
      if (qc.isMutating({ mutationKey }) === 1) qc.setQueryData(key, inst);
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

/** Zuletzt gespielte Instanz (Fallback: zuletzt erstellte; `lastPlayedAt` zeigt, welcher Fall vorliegt). */
export function pickRecentInstance(instances: Instance[] | undefined): Instance | undefined {
  if (!instances?.length) return undefined;
  return [...instances].sort(
    (a, b) => (b.lastPlayedAt ?? 0) - (a.lastPlayedAt ?? 0) || b.createdAt - a.createdAt,
  )[0];
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

const systemMemoryQuery = { queryKey: appKeys.systemMemory, queryFn: api.systemMemoryMb, staleTime: Infinity, retry: false } as const;

/**
 * Arbeitsspeicher: `value` ist der Standard für alle Instanzen (eigene Wahl oder automatisch),
 * `max` die Obergrenze für Regler, `total` der Speicher des PCs (null, solange unbekannt).
 */
export function useMemory() {
  const chosen = useSettings((s) => s.memoryMb);
  const { data: total = null } = useQuery(systemMemoryQuery);
  const auto = total == null ? MEMORY_FALLBACK_MB : autoMemoryMb(total);
  return { value: chosen ?? auto, auto, total, max: total == null ? MEMORY_FALLBACK_MAX_MB : maxMemoryMb(total), isAuto: chosen == null };
}

/** RAM für Instanzen ohne eigene Einstellung, wie ihn der Start übergibt. */
export async function defaultMemory(qc: ReturnType<typeof useQueryClient>) {
  const chosen = useSettings.getState().memoryMb;
  if (chosen != null) return chosen;
  try {
    return autoMemoryMb(await qc.fetchQuery(systemMemoryQuery));
  } catch {
    return MEMORY_FALLBACK_MB;
  }
}

export const isCancelled = (err: unknown) => err instanceof Error && err.message === CANCELLED;

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
  const install = useMutation({
    meta: { ownErrorToast: true },
    mutationFn: (instance: Instance) => {
      setProgress({ instanceId: instance.id, step: instance.loader !== "vanilla" ? "loader" : "java", done: 0, total: 0 });
      return api.installInstance(instance.id);
    },
    // Beim Spielen folgt gleich der Start; eine Erfolgsmeldung gibt es nur für Reparieren und „Erneut versuchen“.
    onSuccess: (_, instance) => {
      useTasks.getState().push({ label: t("hooks.install.doneTask", { name: instance.name }), sub: t("hooks.install.readySub"), state: "done", to: `/instances/${instance.id}` });
      if (!useGame.getState().launching[instance.id]) toast.success(t("hooks.install.readyToast", { name: instance.name }));
    },
    onError: (err, instance) => {
      if (isCancelled(err)) return void toast(t("hooks.install.cancelled", { name: instance.name }));
      useTasks.getState().push({ label: t("hooks.install.failed", { name: instance.name }), sub: err.message, state: "fail", to: `/instances/${instance.id}` });
      toast.error(t("hooks.install.failed", { name: instance.name }), {
        description: err.message,
        duration: 10_000,
        action: { label: t("common.retry"), onClick: () => install.mutate(instance) },
      });
    },
    onSettled: (_, __, instance) => {
      clearProgress(instance.id);
      // Bei Fabric ohne loaderVersion schreibt das Backend die gewählte Version in die Instanz.
      return Promise.all([
        qc.invalidateQueries({ queryKey: instanceKeys.status(instance.id) }),
        qc.invalidateQueries({ queryKey: instanceKeys.all }),
      ]);
    },
  });
  return install;
}

/** Bricht die laufende Installation ab; das Backend beendet `instance_install` dann mit CANCELLED. */
export function useCancelInstall() {
  return useMutation({ mutationFn: (instanceId: string) => api.installCancel(instanceId) });
}

function useLaunch() {
  const qc = useQueryClient();
  return useMutation({
    meta: { ownErrorToast: true },
    mutationFn: async ({ instance, quickPlay }: { instance: Instance; quickPlay: QuickPlay | null }) => {
      const { javaPath } = useSettings.getState();
      const offlineOk = useOfflineAllowed.getState().allowed;
      const active = usableAccount(useSettings.getState().active, offlineOk);
      if (!active) throw new Error(offlineOk ? t("hooks.launch.needPlayerName") : t("hooks.launch.needMicrosoft"));
      useGame.getState().clearLog(instance.id);
      useGame.getState().clearCrash(instance.id);
      return api.launchInstance(instance.id, {
        username: accountName(active),
        accountId: active.kind === "microsoft" ? active.id : null,
        javaPath: javaPath || null,
        defaultMemoryMb: await defaultMemory(qc),
        quickPlay,
      });
    },
    onSuccess: (_, { instance }) => {
      useGame.getState().setStarted(instance.id, Date.now());
      // Ohne vorherigen Status (Abfrage fehlgeschlagen) gilt die Instanz jetzt als installiert und laufend.
      qc.setQueryData<InstanceStatus>(instanceKeys.status(instance.id), (s) => ({ installed: true, ...s, running: true }));
      // Endet das Spiel sofort, kann instance-exit vor dieser Antwort kommen: echten Status nachladen.
      void qc.invalidateQueries({ queryKey: instanceKeys.status(instance.id) });
      return qc.invalidateQueries({ queryKey: instanceKeys.all });
    },
    // Name erst während der Installation entfernt: selten, deshalb nur Meldung mit direktem Weg zum Dialog.
    onError: (err) => {
      const offlineOk = useOfflineAllowed.getState().allowed;
      if (usableAccount(useSettings.getState().active, offlineOk)) return void toast.error(err.message);
      const action = offlineOk
        ? { label: t("hooks.launch.setPlayerName"), onClick: openAddOffline }
        : { label: t("components.account.msLogin"), onClick: () => void startMsLogin(qc) };
      toast.error(err.message, { duration: 10_000, action });
    },
  });
}

/**
 * „Spielen“: prüft den Spielernamen, installiert bei Bedarf und startet danach, mit `quickPlay` direkt in eine Welt oder auf einen Server.
 * Ohne Namen öffnet sich der Dialog „Spielername hinzufügen“; nach dem Speichern geht es hier weiter.
 * Fehler melden `useInstall`/`useLaunch` selbst; der Knopf fällt dann in den Ausgangszustand zurück.
 */
export function usePlay() {
  const qc = useQueryClient();
  const install = useInstall();
  const launch = useLaunch();
  const play = async (instance: Instance, onLaunched?: () => void, quickPlay: QuickPlay | null = null): Promise<void> => {
    const game = useGame.getState();
    if (game.launching[instance.id] || game.installs[instance.id]) return;
    if (!usableAccount(useSettings.getState().active, useOfflineAllowed.getState().allowed)) {
      return askPlayerName({ label: instance.name, run: () => void play(instance, onLaunched, quickPlay) }, qc);
    }
    game.setLaunching(instance.id, true);
    try {
      // Fehlt der Status (Abfrage fehlgeschlagen), wird wie bei „nicht installiert“ zuerst installiert.
      if (!qc.getQueryData<InstanceStatus>(instanceKeys.status(instance.id))?.installed) await install.mutateAsync(instance);
      await launch.mutateAsync({ instance, quickPlay });
      onLaunched?.();
    } catch {
      // Toast kommt aus useInstall/useLaunch.
    } finally {
      game.setLaunching(instance.id, false);
    }
  };
  return play;
}

// Vom Nutzer gestoppte Instanzen: deren Exit-Code (unter Windows 1) ist kein Fehler.
const stopping = new Set<string>();

/** Offene Rückfrage „Minecraft beenden?“ (StopDialog in game.tsx, einmal global eingehängt). */
export const useStopAsk = create<{ instance: Instance | null }>(() => ({ instance: null }));

/**
 * Beenden mit Rückfrage: öffnet „Minecraft beenden?“; erst „Beenden“ dort beendet hart (useKill).
 * Für alle Auslöser (Spielen-Knopf, Instanz-Menü, Protokoll), damit nie ohne Rückfrage gestoppt wird.
 */
export const askStop = (instance: Instance) => useStopAsk.setState({ instance });

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
  const navigate = useNavigate();
  useEffect(() => {
    const { setProgress, appendLog } = useGame.getState();
    const subs = [
      // Events laufen dem invoke-Ergebnis nach; ohne Guard setzen späte Events eine abgeschlossene Installation wieder auf "läuft".
      api.onInstallProgress((p) => useGame.getState().installs[p.instanceId] && setProgress(p)),
      api.onLog(appendLog),
      api.onExit((exit) => {
        const { instanceId, code, crashed, crashReport } = exit;
        const since = useGame.getState().started[instanceId];
        useGame.getState().setStarted(instanceId, null);
        qc.setQueryData<InstanceStatus>(instanceKeys.status(instanceId), (s) => s && { ...s, running: false });
        // Das Backend hat die Spielzeit der Sitzung angerechnet, das Spiel Welten, Serverliste und Screenshots geändert.
        void qc.invalidateQueries({ queryKey: instanceKeys.all });
        void qc.invalidateQueries({ queryKey: worldKeys.all(instanceId) });
        void qc.invalidateQueries({ queryKey: screenshotKeys.list(instanceId) });
        const showLog = { label: t("components.log.ariaLabel"), onClick: () => navigate(instanceUrl(instanceId, "console")) };
        if (stopping.delete(instanceId)) {
          toast(since ? t("hooks.game.exitedPlayed", { duration: formatClock(Date.now() - since) }) : t("hooks.game.exited"), { action: showLog });
          return;
        }
        const name = qc.getQueryData<Instance[]>(instanceKeys.all)?.find((i) => i.id === instanceId)?.name ?? "Minecraft";
        if (crashed) {
          useGame.getState().setCrash(exit);
          // Bleibt stehen, bis der Nutzer reagiert: ein Absturz ist keine vorübergehende Meldung.
          toast.error(t("hooks.game.crashed", { name }), {
            id: `crash-${instanceId}`,
            duration: Infinity,
            description: crashReport ? t("hooks.game.crashReportHint") : t("hooks.game.logHint"),
            action: crashReport
              ? { label: t("components.game.openCrashReport"), onClick: () => void api.openPath(crashReport).catch(toastError) }
              : showLog,
            cancel: crashReport ? showLog : undefined,
          });
        } else if (code != null && code !== 0) {
          toast.error(t("hooks.game.exitedWithCode", { name, code }), { duration: 10_000, action: showLog });
        }
      }),
      // Das Backend hat Instanzen umgebaut (z. B. Migration): Listen und Details neu laden.
      api.onInstancesChanged(() => instanceRelatedKeys.forEach((queryKey) => void qc.invalidateQueries({ queryKey }))),
    ];
    return () => subs.forEach((p) => p.then((unlisten) => unlisten()));
  }, [qc, navigate]);
}
