import { useEffect } from "react";
import { useQueryClient, type QueryClient } from "@tanstack/react-query";
import { useNavigate, type NavigateFunction } from "react-router";
import { toast } from "sonner";
import { t } from "@/i18n/core";
import { api } from "@/lib/api";
import { formatClock } from "@/lib/format";
import { openLocalPath } from "@/lib/links";
import { instanceUrl } from "@/lib/routes";
import { LONG_TOAST_MS } from "@/lib/toast";
import type { ExitPayload, Instance, InstanceStatus } from "@/lib/types";
import { useGame } from "@/store/game";
import { consumeStoppedByUser } from "@/store/stopAsk";
import { instanceKeys, instanceRelatedKeys, screenshotKeys, worldKeys } from "./queryKeys";

type ToastAction = { label: string; onClick: () => void };

/**
 * Nach dem Ende des Spiels: Das Backend hat die Spielzeit der Sitzung angerechnet,
 * das Spiel Welten, Serverliste und Screenshots geändert.
 */
function refreshAfterExit(qc: QueryClient, instanceId: string) {
  qc.setQueryData<InstanceStatus>(instanceKeys.status(instanceId), (s) => s && { ...s, running: false });
  void qc.invalidateQueries({ queryKey: instanceKeys.all });
  void qc.invalidateQueries({ queryKey: worldKeys.all(instanceId) });
  void qc.invalidateQueries({ queryKey: screenshotKeys.list(instanceId) });
}

/** Bleibt stehen, bis der Nutzer reagiert: ein Absturz ist keine vorübergehende Meldung. */
function notifyCrash({ instanceId, crashReport }: ExitPayload, name: string, showLog: ToastAction) {
  toast.error(t("hooks.game.crashed", { name }), {
    id: `crash-${instanceId}`,
    duration: Infinity,
    description: crashReport ? t("hooks.game.crashReportHint") : t("hooks.game.logHint"),
    action: crashReport ? { label: t("components.game.openCrashReport"), onClick: () => openLocalPath(crashReport) } : showLog,
    cancel: crashReport ? showLog : undefined,
  });
}

/**
 * Sagt dem Nutzer, wie das Spiel endete: ruhig, wenn er es selbst beendet hat (`since` = Startzeit für die Spieldauer),
 * sonst als Fehler bei Absturz oder Exit-Code ungleich 0.
 */
function notifyExit(exit: ExitPayload, name: string, since: number | undefined, showLog: ToastAction) {
  const { instanceId, code, crashed } = exit;
  if (consumeStoppedByUser(instanceId)) {
    const message = since ? t("hooks.game.exitedPlayed", { duration: formatClock(Date.now() - since) }) : t("hooks.game.exited");
    toast(message, { action: showLog });
  } else if (crashed) {
    useGame.getState().setCrash(exit);
    notifyCrash(exit, name, showLog);
  } else if (code != null && code !== 0) {
    toast.error(t("hooks.game.exitedWithCode", { name, code }), { duration: LONG_TOAST_MS, action: showLog });
  }
}

function handleExit(exit: ExitPayload, qc: QueryClient, navigate: NavigateFunction) {
  const { instanceId } = exit;
  const since = useGame.getState().started[instanceId];
  useGame.getState().setStarted(instanceId, null);
  refreshAfterExit(qc, instanceId);
  const name = qc.getQueryData<Instance[]>(instanceKeys.all)?.find((i) => i.id === instanceId)?.name ?? "Minecraft";
  const showLog = { label: t("components.log.ariaLabel"), onClick: () => navigate(instanceUrl(instanceId, "console")) };
  notifyExit(exit, name, since, showLog);
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
      api.onExit((exit) => handleExit(exit, qc, navigate)),
      // Das Backend hat Instanzen umgebaut (z. B. Migration): Listen und Details neu laden.
      api.onInstancesChanged(() => instanceRelatedKeys.forEach((queryKey) => void qc.invalidateQueries({ queryKey }))),
    ];
    return () => subs.forEach((p) => p.then((unlisten) => unlisten()));
  }, [qc, navigate]);
}
