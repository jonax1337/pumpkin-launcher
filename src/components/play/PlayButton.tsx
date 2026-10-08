import { useEffect, useRef } from "react";
import { Tip } from "@/ui";
import { useUsableAccount } from "@/store/offline";
import { useGame } from "@/store/game";
import { accountName } from "@/store/settings";
import { useLook } from "@/store/look";
import { askStop } from "@/store/stopAsk";
import { usePlay } from "@/hooks/usePlay";
import type { Instance } from "@/lib/types";
import { useInstallPercent } from "./installPercent";
import { usePhase } from "./phase";
import { PlayPlate, type PlaySize } from "./PlayPlate";
import { playState } from "./playState";
import { useNow } from "./useNow";

/** Ist die Komponente noch eingehängt? Der Start endet erst nach dem Rendern, die Seite kann dann schon weg sein. */
function useMounted() {
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => void (mounted.current = false);
  }, []);
  return mounted;
}

/**
 * Ein Knopf für alles, feste Größe in allen Zuständen: Spielen (installiert bei Bedarf), Wird installiert x %,
 * Startet (beide nicht klickbar), Beenden (Klick fragt „Minecraft beenden?“), Erneut starten nach Absturz.
 * `l` 272×56, `m` 176×40, `i` 32×32.
 * `main`: der Spielen-Knopf der Seite (Start, Instanzkopf); Strg+Enter klickt ihn.
 */
export function PlayButton({ instance, size = "l", onLaunched, tabIndex, main }: {
  instance: Instance; size?: PlaySize; onLaunched?: () => void; tabIndex?: number; main?: boolean;
}) {
  const phase = usePhase(instance.id);
  const percent = useInstallPercent(instance);
  const exitCode = useGame((s) => s.crashes[instance.id]?.code ?? null);
  const since = useGame((s) => s.started[instance.id]);
  const playerName = accountName(useUsableAccount()) || null;
  const { acc } = useLook(instance.id);
  const play = usePlay();
  const mounted = useMounted();
  const now = useNow(phase === "running" && !!since);
  const runMs = phase === "running" && since ? now - since : null;
  const state = playState(phase, { instanceName: instance.name, percent, exitCode, playerName, runMs });

  function click() {
    if (state.disabled) return;
    if (phase === "running") return askStop(instance);
    void play(instance, () => mounted.current && onLaunched?.());
  }

  const button = <PlayPlate state={state} size={size} acc={acc} main={main} tabIndex={tabIndex} onClick={click} />;
  return size === "i" ? <Tip label={state.label}>{button}</Tip> : button;
}
