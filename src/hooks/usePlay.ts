import { useMutation, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { launchAccountFor } from "@/components/accounts/useAccounts";
import { t } from "@/i18n/core";
import { api } from "@/lib/api";
import { isCancelled } from "@/lib/errors";
import { presetArgs } from "@/lib/jvm";
import { applyLauncherOnPlay } from "@/lib/launcherWindow";
import { instanceUrl } from "@/lib/routes";
import { LONG_TOAST_MS } from "@/lib/toast";
import type { FriendJoin, Instance, InstanceStatus, LaunchOptions, QuickPlay } from "@/lib/types";
import { askPlayerName, openAddOffline, startMsLogin } from "@/store/accountUi";
import { useGame } from "@/store/game";
import { useOfflineAllowed } from "@/store/offline";
import { accountName, useSettings, type ActiveAccount } from "@/store/settings";
import { markStoppedByUser, unmarkStoppedByUser } from "@/store/stopAsk";
import { useTasks } from "@/store/tasks";
import { useWorldBackup } from "@/store/worldBackup";
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
        to: instanceUrl(instance.id),
      });
      if (!useGame.getState().launching[instance.id]) toast.success(t("hooks.install.readyToast", { name: instance.name }));
    },
    onError: (err, instance) => {
      if (isCancelled(err)) return void toast(t("hooks.install.cancelled", { name: instance.name }));
      const failed = t("hooks.install.failed", { name: instance.name });
      useTasks.getState().push({ label: failed, sub: err.message, state: "fail", to: instanceUrl(instance.id) });
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

/** Bricht die laufende Installation ab; das Backend beendet `instance_install` dann mit dem Fehlercode „cancelled“. */
export function useCancelInstall() {
  return useMutation({ mutationFn: (instanceId: string) => api.installCancel(instanceId) });
}

/** Das Konto, mit dem die Instanz startet; ohne eines sagt der Fehler, was fehlt (Spielername oder Microsoft-Konto). */
async function requireUsableAccount(instance: Instance): Promise<ActiveAccount> {
  const account = await launchAccountFor(instance);
  if (account) return account;
  throw new Error(useOfflineAllowed.getState().allowed ? t("hooks.launch.needPlayerName") : t("hooks.launch.needMicrosoft"));
}

async function launchOptionsFor(account: ActiveAccount, quickPlay: QuickPlay | null, friendJoin: FriendJoin | undefined, qc: QueryClient): Promise<LaunchOptions> {
  const { javaPath, minMemoryMb, jvmPreset, jvmArgs, window, discordPresence } = useSettings.getState();
  const { enabled: backupWorlds, keep: backupKeep } = useWorldBackup.getState();
  return {
    username: accountName(account),
    accountId: account.kind === "microsoft" ? account.id : null,
    javaPath: javaPath || null,
    defaultMemoryMb: await defaultMemory(qc),
    backupWorlds,
    backupKeep,
    defaultMinMemoryMb: minMemoryMb,
    defaultJvmArgs: presetArgs(jvmPreset, jvmArgs),
    defaultWindow: window.type === "default" ? null : window,
    discordPresence,
    quickPlay,
    friendJoin,
  };
}

function useLaunch() {
  const qc = useQueryClient();
  return useMutation({
    meta: { ownErrorToast: true },
    mutationFn: async ({ instance, quickPlay, friendJoin }: { instance: Instance; quickPlay: QuickPlay | null; friendJoin?: FriendJoin }) => {
      const account = await requireUsableAccount(instance);
      useGame.getState().beginRun(instance.id);
      return api.launchInstance(instance.id, await launchOptionsFor(account, quickPlay, friendJoin, qc));
    },
    onSuccess: (_, { instance }) => {
      useGame.getState().setStarted(instance.id, Date.now());
      applyLauncherOnPlay();
      // Ohne vorherigen Status (Abfrage fehlgeschlagen) gilt die Instanz jetzt als installiert und laufend.
      qc.setQueryData<InstanceStatus>(instanceKeys.status(instance.id), (s) => ({ installed: true, ...s, running: true }));
      // Endet das Spiel sofort, kann instance-exit vor dieser Antwort kommen: echten Status nachladen.
      void qc.invalidateQueries({ queryKey: instanceKeys.status(instance.id) });
      return qc.invalidateQueries({ queryKey: instanceKeys.all });
    },
    // Name erst während der Installation entfernt: selten, deshalb nur Meldung mit direktem Weg zum Dialog.
    onError: async (err, { instance }) => {
      if (await launchAccountFor(instance)) return void toast.error(err.message);
      const action = useOfflineAllowed.getState().allowed
        ? { label: t("hooks.launch.setPlayerName"), onClick: openAddOffline }
        : { label: t("components.account.msLogin"), onClick: () => void startMsLogin() };
      toast.error(err.message, { duration: LONG_TOAST_MS, action });
    },
  });
}

/** Öffnet den Tunnel zur Welt eines Freundes und liefert, wohin das Spiel verbinden soll. */
export type OpenFriendJoin = () => Promise<FriendJoin>;

/**
 * „Spielen“: prüft den Spielernamen, installiert bei Bedarf und startet danach, mit `quickPlay` direkt in eine Welt oder auf einen Server.
 * `openFriendJoin` (Beitritt zu einer Freundeswelt) läuft erst nach der Installation: Der Tunnel wartet sonst auf ein Spiel,
 * das noch lädt (Spezifikation 6.2). Der Start geht dann ohne `quickPlay` an die Adresse des Tunnels.
 * Ohne Namen öffnet sich der Dialog „Spielername hinzufügen“; nach dem Speichern geht es hier weiter.
 * Fehler melden `useInstall`/`useLaunch` selbst; der Knopf fällt dann in den Ausgangszustand zurück.
 */
export function usePlay() {
  const qc = useQueryClient();
  const install = useInstall();
  const launch = useLaunch();
  const play = async (instance: Instance, onLaunched?: () => void, quickPlay: QuickPlay | null = null, openFriendJoin?: OpenFriendJoin): Promise<void> => {
    const game = useGame.getState();
    if (game.launching[instance.id] || game.installs[instance.id]) return;
    game.setLaunching(instance.id, true);
    try {
      if (!(await launchAccountFor(instance))) {
        return askPlayerName({ label: instance.name, run: () => void play(instance, onLaunched, quickPlay, openFriendJoin) });
      }
      // Fehlt der Status (Abfrage fehlgeschlagen), wird wie bei „nicht installiert“ zuerst installiert.
      if (!qc.getQueryData<InstanceStatus>(instanceKeys.status(instance.id))?.installed) await install.mutateAsync(instance);
      const friendJoin = await openFriendJoin?.();
      await launch.mutateAsync({ instance, quickPlay: friendJoin ? null : quickPlay, friendJoin });
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
