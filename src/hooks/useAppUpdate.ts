import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { Update } from "@tauri-apps/plugin-updater";
import { useNavigate } from "react-router";
import { toast } from "sonner";
import { create } from "zustand";
import { t } from "@/i18n/core";
import { api } from "@/lib/api";
import { isGameActive, useGame } from "@/store/game";
import { appKeys } from "./queryKeys";
import { anyTaskRunning, subscribeRunningTasks } from "./useRunningTasks";

/**
 * Ein Fund bleibt gültig, bis jemand erneut sucht; `gcTime` hält ihn auch, wenn gerade niemand die Über-Seite zeigt
 * (Fund beim Start, wartendes Update).
 */
const updateQuery = { queryKey: appKeys.update, queryFn: api.checkAppUpdate, staleTime: Infinity, gcTime: Infinity, retry: false };

/** Erst suchen, wenn der Start durch ist: die Suche soll nicht mit Laden und Szene um das Netz konkurrieren. */
const START_CHECK_DELAY_MS = 8_000;

/** Ergebnis der letzten Suche nach einer neuen Launcher-Version (null = aktuell); sucht selbst nur per `refetch`. */
export function useAppUpdate() {
  return useQuery({ ...updateQuery, enabled: false });
}

/** Release-Build: kurz nach dem Start still nach einer neuen Version suchen und sie per Toast anbieten. Einmal im Layout einhängen. */
export function useUpdateCheckOnStart() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  useEffect(() => {
    if (!import.meta.env.PROD) return;
    const timer = setTimeout(() => {
      qc.fetchQuery(updateQuery)
        .then((update) => update && announceUpdate(update.version, () => navigate("/settings?tab=ueber")))
        .catch((err: unknown) => console.warn("Update-Suche fehlgeschlagen", err));
    }, START_CHECK_DELAY_MS);
    return () => clearTimeout(timer);
  }, [qc, navigate]);
}

/** Nur ein Hinweis: installiert wird erst nach „Installieren und neu starten“ in den Einstellungen (`show`). */
function announceUpdate(version: string, show: () => void) {
  toast.info(t("hooks.update.availableToast", { version }), {
    id: "app-update",
    duration: 15_000,
    description: t("hooks.update.availableHint"),
    action: { label: t("components.content.viewAction"), onClick: show },
  });
}

/**
 * Ablauf „Installieren und neu starten“; liegt außerhalb der Seite, damit er Seitenwechsel übersteht.
 * `wait`: geladen, aber Minecraft oder eine Aufgabe läuft noch. `ready`: frei, Neustart wartet auf einen Klick.
 * `p`: Anteil des Downloads, null = unbekannt.
 */
export const useUpdateRun = create<{ phase: "idle" | "download" | "wait" | "ready" | "install"; p: number | null }>(() => ({ phase: "idle", p: null }));

/** Hinweis, während der Neustart auf Spiel und Aufgaben wartet; live berechnet, kein fester Text. */
export const waitForIdle = () => t("hooks.update.waitForIdle");

/**
 * Lädt das Update und installiert es, wenn der Launcher frei ist: unter Windows beendet der Installer den Launcher,
 * mitten im Spiel gingen Protokoll, Spielzeit und Absturzerkennung verloren, mitten in einer Aufgabe bliebe Halbes liegen.
 * Musste gewartet werden, startet erst der nächste Aufruf (Phase `ready`) neu.
 */
export async function installAppUpdate(update: Update) {
  const { phase } = useUpdateRun.getState();
  if (phase !== "idle" && phase !== "ready") return;
  try {
    if (phase === "idle") await download(update);
    if (launcherBusy()) return await deferRestart(update);
    useUpdateRun.setState({ phase: "install", p: null });
    await update.install();
    // Unter Windows startet der Installer den Launcher neu; der Neustart hier gilt für die übrigen Systeme.
    await api.restartApp();
  } catch (err) {
    useUpdateRun.setState({ phase: "idle", p: null });
    toast.error(t("hooks.update.installFailed"), { description: err instanceof Error ? err.message : String(err) });
  }
}

async function download(update: Update) {
  let total = 0;
  let done = 0;
  useUpdateRun.setState({ phase: "download", p: null });
  await update.download((event) => {
    if (event.event === "Started") total = event.data.contentLength ?? 0;
    if (event.event !== "Progress" || total === 0) return;
    done += event.data.chunkLength;
    useUpdateRun.setState({ p: done / total });
  });
}

/**
 * Wartet, bis der Launcher frei ist, und fragt dann noch einmal: wer zugestimmt hat, als das Spiel noch lief,
 * liest danach womöglich Absturzbericht oder Protokoll, die ein sofortiger Neustart verwerfen würde.
 */
async function deferRestart(update: Update) {
  useUpdateRun.setState({ phase: "wait", p: null });
  toast.info(t("hooks.update.loaded"), { description: waitForIdle() });
  await launcherIdle();
  useUpdateRun.setState({ phase: "ready" });
  toast.info(t("hooks.update.ready"), {
    id: "app-update",
    duration: Infinity,
    description: t("hooks.update.readyHint"),
    action: { label: t("components.update.restartNow"), onClick: () => void installAppUpdate(update) },
  });
}

/** Startet oder läuft ein Minecraft, oder läuft eine Aufgabe aus dem Aufgaben-Menü? */
const launcherBusy = () => isGameActive(useGame.getState()) || anyTaskRunning();

/** Erfüllt sich, sobald `launcherBusy` nicht mehr gilt. */
function launcherIdle() {
  return new Promise<void>((resolve) => {
    // `subscribeRunningTasks` meldet auch den Game-Store: ein Abonnement genügt für Spiel und Aufgaben.
    const unsubscribe = subscribeRunningTasks(() => {
      if (launcherBusy()) return;
      unsubscribe();
      resolve();
    });
  });
}
