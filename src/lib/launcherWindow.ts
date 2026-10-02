import { api } from "@/lib/api";
import { toastError } from "@/lib/toast";
import { isGameActive, useGame } from "@/store/game";
import { useSettings } from "@/store/settings";

/** Das Spiel läuft: das Launcher-Fenster so behandeln, wie es unter „Beim Spielstart“ eingestellt ist. */
export function applyLauncherOnPlay() {
  const mode = useSettings.getState().launcherOnPlay;
  if (mode !== "keep") void api.setLauncherWindow(mode).catch(toastError);
}

/** Das letzte Spiel ist beendet: ein beim Start minimierter Launcher kommt zurück. */
export function restoreLauncherAfterPlay() {
  if (useSettings.getState().launcherOnPlay === "minimize" && !isGameActive(useGame.getState())) {
    void api.setLauncherWindow("restore").catch(toastError);
  }
}
