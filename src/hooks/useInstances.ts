import { useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate, type NavigateFunction } from "react-router";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { autoMemoryMb, maxMemoryMb } from "@/lib/format";
import { INSTALL_CANCELLED, type Instance, type InstanceStatus, type ModLoader, type NewInstance } from "@/lib/types";
import { useGame } from "@/store/game";
import { accountName, useSettings } from "@/store/settings";

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

/**
 * Mod-Liste speichern: Anzeige sofort, bei Fehler zurückgerollt. Gespeichert wird der Reihe nach,
 * weil das Backend eine zweite Änderung ablehnt, solange eine läuft.
 */
export function useUpdateMods(instanceId: string) {
  const qc = useQueryClient();
  const key = instanceKeys.detail(instanceId);
  const mutationKey = ["instance-mods", instanceId];
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

/** Zuletzt gespielte Instanz (Fallback: zuletzt erstellte; `lastPlayedAt` zeigt, welcher Fall vorliegt). */
export function pickRecentInstance(instances: Instance[] | undefined): Instance | undefined {
  if (!instances?.length) return undefined;
  return [...instances].sort(
    (a, b) => (b.lastPlayedAt ?? 0) - (a.lastPlayedAt ?? 0) || b.createdAt - a.createdAt,
  )[0];
}

export function useVersions() {
  return useQuery({ queryKey: ["versions"], queryFn: api.versionsList, staleTime: 10 * 60_000 });
}

export function useLoaderVersions(loader: ModLoader, mcVersion: string) {
  return useQuery({
    queryKey: ["loader-versions", loader, mcVersion],
    queryFn: () => api.loaderVersions(loader, mcVersion),
    enabled: loader !== "vanilla" && !!mcVersion,
    staleTime: 10 * 60_000,
  });
}

const systemMemoryQuery = { queryKey: ["system-memory"], queryFn: api.systemMemoryMb, staleTime: Infinity, retry: false } as const;

/**
 * Arbeitsspeicher: `value` ist der Standard für alle Instanzen (eigene Wahl oder automatisch),
 * `max` die Obergrenze für Regler, `total` der Speicher des PCs (null, solange unbekannt).
 */
export function useMemory() {
  const chosen = useSettings((s) => s.memoryMb);
  const { data: total = null } = useQuery(systemMemoryQuery);
  const auto = total == null ? 4096 : autoMemoryMb(total);
  return { value: chosen ?? auto, auto, total, max: total == null ? 16384 : maxMemoryMb(total), isAuto: chosen == null };
}

async function defaultMemory(qc: ReturnType<typeof useQueryClient>) {
  const chosen = useSettings.getState().memoryMb;
  if (chosen != null) return chosen;
  try {
    return autoMemoryMb(await qc.fetchQuery(systemMemoryQuery));
  } catch {
    return 4096;
  }
}

const isCancelled = (err: unknown) => err instanceof Error && err.message === INSTALL_CANCELLED;

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
    onSuccess: (_, instance) => !useGame.getState().launching[instance.id] && toast.success(`${instance.name} ist bereit`),
    onError: (err, instance) =>
      isCancelled(err)
        ? toast(`Installation von ${instance.name} abgebrochen`)
        : toast.error(`${instance.name} konnte nicht installiert werden`, {
            description: err.message,
            duration: 10_000,
            action: { label: "Erneut versuchen", onClick: () => install.mutate(instance) },
          }),
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

/** Bricht die laufende Vorbereitung ab; das Backend beendet `instance_install` dann mit INSTALL_CANCELLED. */
export function useCancelInstall() {
  return useMutation({ mutationFn: (instanceId: string) => api.installCancel(instanceId) });
}

export function useLaunch() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  return useMutation({
    meta: { ownErrorToast: true },
    mutationFn: async (instance: Instance) => {
      const { active, javaPath } = useSettings.getState();
      if (!active) throw new Error("Leg zuerst einen Spielernamen fest.");
      useGame.getState().clearLog(instance.id);
      useGame.getState().clearCrash(instance.id);
      const accountId = active.kind === "microsoft" ? active.id : null;
      return api.launchInstance(instance.id, accountName(active), accountId, javaPath, await defaultMemory(qc));
    },
    onSuccess: (_, instance) => {
      // Ohne vorherigen Status (Abfrage fehlgeschlagen) gilt die Instanz jetzt als installiert und laufend.
      qc.setQueryData<InstanceStatus>(instanceKeys.status(instance.id), (s) => ({ installed: true, ...s, running: true }));
      // Endet das Spiel sofort, kann instance-exit vor dieser Antwort kommen: echten Status nachladen.
      void qc.invalidateQueries({ queryKey: instanceKeys.status(instance.id) });
      return qc.invalidateQueries({ queryKey: instanceKeys.all });
    },
    onError: (err) => (useSettings.getState().active ? toast.error(err.message) : missingNameToast(err.message, navigate)),
  });
}

function missingNameToast(message: string, navigate: NavigateFunction) {
  toast.error(message, { duration: 10_000, action: { label: "Spielername festlegen", onClick: () => navigate("/settings#konten") } });
}

/**
 * „Spielen“: prüft den Spielernamen, installiert bei Bedarf und startet danach.
 * Fehler melden `useInstall`/`useLaunch` selbst; der Knopf fällt dann in den Ausgangszustand zurück.
 */
export function usePlay() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const install = useInstall();
  const launch = useLaunch();
  return async (instance: Instance, onLaunched?: () => void) => {
    const game = useGame.getState();
    if (game.launching[instance.id] || game.installs[instance.id]) return;
    if (!useSettings.getState().active) return missingNameToast("Leg zuerst einen Spielernamen fest.", navigate);
    game.setLaunching(instance.id, true);
    try {
      // Fehlt der Status (Abfrage fehlgeschlagen), wird wie „nicht installiert“ vorbereitet.
      if (!qc.getQueryData<InstanceStatus>(instanceKeys.status(instance.id))?.installed) await install.mutateAsync(instance);
      await launch.mutateAsync(instance);
      onLaunched?.();
    } catch {
      // Toast kommt aus useInstall/useLaunch.
    } finally {
      game.setLaunching(instance.id, false);
    }
  };
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
  const navigate = useNavigate();
  useEffect(() => {
    const { setProgress, appendLog } = useGame.getState();
    const subs = [
      // Events laufen dem invoke-Ergebnis nach; ohne Guard setzen späte Events eine abgeschlossene Installation wieder auf "läuft".
      api.onInstallProgress((p) => useGame.getState().installs[p.instanceId] && setProgress(p)),
      api.onLog(appendLog),
      api.onExit((exit) => {
        const { instanceId, code, crashed, crashReport } = exit;
        qc.setQueryData<InstanceStatus>(instanceKeys.status(instanceId), (s) => s && { ...s, running: false });
        if (stopping.delete(instanceId)) return;
        const showLog = { label: "Protokoll anzeigen", onClick: () => navigate(`/instances/${instanceId}?tab=console`) };
        if (crashed) {
          useGame.getState().setCrash(exit);
          // Bleibt stehen, bis der Nutzer reagiert: ein Absturz ist keine vorübergehende Meldung.
          toast.error("Minecraft ist abgestürzt", {
            id: `crash-${instanceId}`,
            duration: Infinity,
            description: crashReport ? "Im Absturzbericht steht meist, welche Mod schuld ist." : "Das Protokoll zeigt, was zuletzt passiert ist.",
            action: crashReport
              ? { label: "Absturzbericht öffnen", onClick: () => void api.openPath(crashReport).catch((e: Error) => toast.error(e.message)) }
              : showLog,
            cancel: crashReport ? showLog : undefined,
          });
        } else if (code != null && code !== 0) {
          toast.error(`Minecraft wurde unerwartet beendet (Code ${code})`, { duration: 10_000, action: showLog });
        }
      }),
      // Das Backend hat Instanzen umgebaut (z. B. Migration): Listen und Details neu laden.
      api.onInstancesChanged(() =>
        ["instances", "instance-status", "templates"].forEach((key) => void qc.invalidateQueries({ queryKey: [key] })),
      ),
    ];
    return () => subs.forEach((p) => p.then((unlisten) => unlisten()));
  }, [qc, navigate]);
}
