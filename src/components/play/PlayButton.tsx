import { useEffect, useRef, type CSSProperties } from "react";
import { SHORTCUT } from "@/app/shortcuts";
import { Icon, Tip } from "@/ui";
import { useUsableAccount } from "@/store/offline";
import { useGame } from "@/store/game";
import { useLook } from "@/store/look";
import { askStop } from "@/store/stopAsk";
import { usePlay } from "@/hooks/usePlay";
import type { Instance } from "@/lib/types";
import { cn } from "@/lib/utils";
import { useInstallPercent } from "./installPercent";
import { usePhase } from "./phase";
import { PlayBar } from "./PlayBar";
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
  instance: Instance; size?: "l" | "m" | "i"; onLaunched?: () => void; tabIndex?: number; main?: boolean;
}) {
  const phase = usePhase(instance.id);
  const percent = useInstallPercent(instance);
  const exitCode = useGame((s) => s.crashes[instance.id]?.code ?? null);
  const since = useGame((s) => s.started[instance.id]);
  const hasAccount = !!useUsableAccount();
  const { acc } = useLook(instance.id);
  const play = usePlay();
  const mounted = useMounted();
  const now = useNow(phase === "running" && !!since);
  const runMs = phase === "running" && since ? now - since : null;
  const state = playState(phase, { instanceName: instance.name, percent, exitCode, hasAccount, runMs });

  function click() {
    if (state.disabled) return;
    if (phase === "running") return askStop(instance);
    void play(instance, () => mounted.current && onLaunched?.());
  }

  const button = (
    <button
      type="button"
      className={cn("fx play", size !== "l" && size)}
      data-st={state.state}
      aria-label={state.ariaLabel}
      aria-disabled={state.disabled || undefined}
      aria-keyshortcuts={main ? SHORTCUT.play : undefined}
      data-main-play={main ? "" : undefined}
      tabIndex={tabIndex}
      // Akzent der Instanz (Biom); im Fehlerzustand setzt play.css --bad (Inline würde es überstimmen)
      style={state.state === "error" ? undefined : ({ "--acc": acc } as CSSProperties)}
      onClick={click}
    >
      <span className="bf" />
      <span className="bc">
        <span className="pic"><Icon name={state.icon} size={size === "i" ? "s" : size} /></span>
        <span className="lab">
          <span className="l1">{size === "m" ? state.compactLabel : state.label}</span>
          <span className="l2">{state.detail}</span>
        </span>
        {/* Symbolknopf (i): Prozent nur im Namen, sonst ragt die Zahl aus den 32 px */}
        {size !== "i" && <span className="pct">{state.percentText ?? ""}</span>}
      </span>
      <PlayBar p={state.progress} className="pbar" />
    </button>
  );
  return size === "i" ? <Tip label={state.label}>{button}</Tip> : button;
}
