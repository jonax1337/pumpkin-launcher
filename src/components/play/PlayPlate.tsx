import { SHORTCUT } from "@/app/shortcuts";
import { Icon, type IconSize } from "@/ui";
import { cssVars } from "@/ui/util";
import { cn } from "@/lib/utils";
import { PlayBar } from "./PlayBar";
import type { PlayState } from "./playState";

/** Größen des Knopfes: `l` 272×56, `m` 176×40, `i` 32×32; Symbol 32 / 24 / 16 px. */
export type PlaySize = "l" | "m" | "i";
const ICON_OF_SIZE: Record<PlaySize, IconSize> = { l: "l", m: "m", i: "s" };

export type PlayForce = "hover" | "press" | "focus";

/**
 * Die Steinplatte des Spielen-Knopfes (Maße und Zustände: components/play.css), ohne Store und Instanz:
 * Symbol, Beschriftung, darunter die Unterzeile und im Vorgang der Fortschritt. Der Baustein hinter `PlayButton` und der /_kit-Vorschau.
 * `acc`: Akzentfarbe der Instanz; im Fehlerzustand setzt play.css `--bad` (ein Inline-Wert würde es überstimmen).
 */
export function PlayPlate({ state, size = "l", acc, force, main, tabIndex, onClick }: {
  state: PlayState;
  size?: PlaySize;
  acc?: string;
  force?: PlayForce;
  /** Der Spielen-Knopf der Seite (Strg+Enter klickt ihn). */
  main?: boolean;
  tabIndex?: number;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      className={cn("fx play vx-stone vx-text", size !== "l" && size)}
      data-st={state.state}
      data-force={force}
      aria-label={state.ariaLabel}
      aria-disabled={state.disabled || undefined}
      aria-keyshortcuts={main ? SHORTCUT.play : undefined}
      data-main-play={main ? "" : undefined}
      tabIndex={tabIndex}
      style={state.state === "error" ? undefined : cssVars({ "--acc": acc })}
      onClick={onClick}
    >
      <span className="bc">
        <Icon name={state.icon} size={ICON_OF_SIZE[size]} />
        {size !== "i" && (
          <span className="lab">
            <span className="l1">{size === "m" ? state.compactLabel : state.label}</span>
            <span className="pct">{state.percentText ?? ""}</span>
            {size === "l" && <span className="l2">{state.detail}</span>}
          </span>
        )}
        <PlayBar p={state.progress} className="pbar" />
      </span>
    </button>
  );
}
