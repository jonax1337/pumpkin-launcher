import { useInstanceStatus } from "@/hooks/useInstances";
import { useGame } from "@/store/game";

export type Phase = "loading" | "preparing" | "starting" | "running" | "crashed" | "installed" | "missing";

/** Minecraft startet oder läuft: das Backend lehnt dann jede Änderung an der Instanz ab. */
export const isGameLive = (phase: Phase) => phase === "starting" || phase === "running";

/** Es ist etwas im Gang (Installation, Start oder laufendes Spiel): Löschen, Reparieren und Kopieren sind gesperrt. */
export const isBusy = (phase: Phase) => phase === "preparing" || isGameLive(phase);

/** Zustände, die auffallen sollen; „Bereit“ und „Nicht installiert“ sind der ruhige Normalfall. */
export const LOUD_PHASES: Phase[] = ["preparing", "starting", "running", "crashed"];

export function usePhase(instanceId: string): Phase {
  const status = useInstanceStatus(instanceId);
  const preparing = useGame((s) => !!s.installs[instanceId]);
  const launching = useGame((s) => !!s.launching[instanceId]);
  const crashed = useGame((s) => !!s.crashes[instanceId]);
  if (preparing) return "preparing";
  if (status.data?.running) return "running";
  if (launching) return "starting";
  if (crashed) return "crashed";
  // Schlägt die Statusabfrage fehl, gilt die Instanz als nicht installiert; „Spielen“ installiert sie dann.
  if (status.isPending) return "loading";
  return status.data?.installed ? "installed" : "missing";
}
