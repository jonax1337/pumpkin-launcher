import { useMutation, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { t } from "@/i18n/core";
import { api } from "@/lib/api";
import { isCancelled } from "@/lib/errors";
import { LONG_TOAST_MS } from "@/lib/toast";
import type { Instance, InstanceStatus, LaunchOptions, QuickPlay } from "@/lib/types";
import { askPlayerName, openAddOffline, startMsLogin } from "@/store/accountUi";
import { useGame } from "@/store/game";
import { currentUsableAccount, useOfflineAllowed } from "@/store/offline";
import { accountName, useSettings, type ActiveAccount } from "@/store/settings";
import { markStoppedByUser, unmarkStoppedByUser } from "@/store/stopAsk";
import { useTasks } from "@/store/tasks";
import { instanceKeys } from "./queryKeys";
import { defaultMemory } from "./useMemory";

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
      useTasks.getState().push({
        label: t("hooks.install.doneTask", { name: instance.name }),
        sub: t("hooks.install.readySub"),
        state: "done",
        to: `/instances/${instance.id}`,
      });
      if (!useGame.getState().launching[instance.id]) toast.success(t("hooks.install.readyToast", { name: instance.name }));
    },
    onError: (err, instance) => {
      if (isCancelled(err)) return void toast(t("hooks.install.cancelled", { name: instance.name }));
      const failed = t("hooks.install.failed", { name: instance.name });
      useTasks.getState().push({ label: failed, sub: err.message, state: "fail", to: `/instances/${instance.id}` });
      toast.error(failed, {
        description: err.message,
        duration: LONG_TOAST_MS,
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

/** Das Konto, mit dem gestartet wird; ohne eines sagt der Fehler, was fehlt (Spielername oder Microsoft-Konto). */
function requireUsableAccount(): ActiveAccount {
  const account = currentUsableAccount();
  if (account) return account;
  throw new Error(useOfflineAllowed.getState().allowed ? t("hooks.launch.needPlayerName") : t("hooks.launch.needMicrosoft"));
}

async function launchOptionsFor(account: ActiveAccount, quickPlay: QuickPlay | null, qc: QueryClient): Promise<LaunchOptions> {
  const { javaPath } = useSettings.getState();
  return {
    username: accountName(account),
    accountId: account.kind === "microsoft" ? account.id : null,
    javaPath: javaPath || null,
    defaultMemoryMb: await defaultMemory(qc),
    quickPlay,
  };
}

function useLaunch() {
  const qc = useQueryClient();
  return useMutation({
    meta: { ownErrorToast: true },
    mutationFn: async ({ instance, quickPlay }: { instance: Instance; quickPlay: QuickPlay | null }) => {
      const account = requireUsableAccount();
      useGame.getState().beginRun(instance.id);
      return api.launchInstance(instance.id, await launchOptionsFor(account, quickPlay, qc));
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
      if (currentUsableAccount()) return void toast.error(err.message);
      const action = useOfflineAllowed.getState().allowed
        ? { label: t("hooks.launch.setPlayerName"), onClick: openAddOffline }
        : { label: t("components.account.msLogin"), onClick: () => void startMsLogin(qc) };
      toast.error(err.message, { duration: LONG_TOAST_MS, action });
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
    if (!currentUsableAccount()) {
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

export function useKill() {
  return useMutation({
    mutationFn: (instance: Instance) => {
      markStoppedByUser(instance.id);
      return api.killInstance(instance.id);
    },
    onError: (_, instance) => unmarkStoppedByUser(instance.id),
  });
}
