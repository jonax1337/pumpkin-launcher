import { friendKeys } from "@/hooks/queryKeys";
import { api } from "@/lib/api";
import { effectiveOnPlay, resolveFriendsEnabled } from "@/lib/onPlay";
import { queryClient } from "@/lib/queryClient";
import { toastError } from "@/lib/toast";
import { setFriendsEnabled, useFriendsUi } from "@/store/friendsUi";
import { isGameActive, useGame } from "@/store/game";
import { useSettings } from "@/store/settings";

/** So lange wartet der Spielstart auf die Auskunft, ob Freunde an sind; danach gilt die vorsichtige Annahme „an“. */
const FRIENDS_ENABLED_TIMEOUT_MS = 1500;

async function fetchFriendsEnabled() {
  const { enabled } = await queryClient.fetchQuery({ queryKey: friendKeys.state, queryFn: () => api.friendsState() });
  setFriendsEnabled(enabled);
  return enabled;
}

/** Ob Freunde an sind, auch wenn noch keine Seite die Abfrage gezeigt hat; `null`, wenn das Backend nicht rechtzeitig antwortet. */
const ensureFriendsEnabled = () =>
  resolveFriendsEnabled(useFriendsUi.getState().friendsEnabled, fetchFriendsEnabled, FRIENDS_ENABLED_TIMEOUT_MS);

/** Die Einstellung „Beim Spielstart“, wie sie mit dem Stand der Freunde tatsächlich gilt. */
async function effectiveLauncherOnPlay() {
  return effectiveOnPlay(useSettings.getState().launcherOnPlay, await ensureFriendsEnabled());
}

/** Das Spiel läuft: das Launcher-Fenster so behandeln, wie es unter „Beim Spielstart“ eingestellt ist. */
export async function applyLauncherOnPlay() {
  const mode = await effectiveLauncherOnPlay();
  if (mode !== "keep") await api.setLauncherWindow(mode).catch(toastError);
}

/** Das letzte Spiel ist beendet: ein beim Start minimierter Launcher kommt zurück. */
export async function restoreLauncherAfterPlay() {
  const mode = await effectiveLauncherOnPlay();
  if (mode === "minimize" && !isGameActive(useGame.getState())) {
    await api.setLauncherWindow("restore").catch(toastError);
  }
}
