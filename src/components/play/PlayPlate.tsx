import { SHORTCUT } from "@/app/shortcuts";
import { Button, cssVars, Icon, type IconSize } from "@/ui";
import { cn } from "@/lib/utils";
import { PlayBar } from "./PlayBar";
import type { PlayState } from "./playState";

/** Größen des Knopfes: `l` 272×56, `m` 176×40, `i` 32×32; Symbol 32 / 24 / 16 px. */
export type PlaySize = "l" | "m" | "i";

/**
 * Je Größe: Knopfgröße des Kits, Symbolgröße, Maße und Innenabstand (Rand → Symbol), Lücke Symbol → Beschriftung,
 * Schrift der großen Zeile (`name`) und Lage des Balkens (links ab Ende des Symbols, rechts bis zum Innenabstand, unten über der Fase).
 */
const LOOK: Record<PlaySize, { button: "l" | "m" | "s"; icon: IconSize; box: string; gap: string; name: string; bar: string }> = {
  l: {
    button: "l", icon: "l",
    box: "w-[calc(272px+(var(--tz)-1)*192px)] px-[calc(16px-var(--px))]",
    gap: "mr-3", name: "text-[22px]",
    bar: "left-[calc(32px+12px)] right-0 bottom-[calc(var(--bvw)+var(--px))] h-(--u2)",
  },
  m: {
    button: "m", icon: "m",
    box: "w-44 px-[calc(10px-var(--px))]",
    gap: "mr-2", name: "text-[18px]",
    bar: "left-[calc(24px+8px)] right-0 bottom-(--bvw) h-(--px)",
  },
  i: {
    button: "s", icon: "s",
    box: "w-8 px-0",
    gap: "mx-auto", name: "",
    bar: "inset-x-(--px) bottom-0 h-(--px)",
  },
};

export type PlayForce = "hover" | "press" | "focus";

/**
 * Die Steinplatte des Spielen-Knopfes, ohne Store und Instanz: ein Kit-`Button` (`fill`), darin Symbol, Beschriftung,
 * darunter die Unterzeile und im Vorgang der Fortschritt. Idle = Primär in der Instanzfarbe, Läuft/Fehler = Sekundär mit Ton
 * (`tinted`), Installieren/Starten = `busy`. Der Baustein hinter `PlayButton` und der /_kit-Vorschau.
 * `acc`: Akzentfarbe der Instanz (`--acc`); im Fehlerzustand bleibt sie unberücksichtigt (Ton `bad`).
 */
export function PlayPlate({ state, size = "l", acc, force, main, tabIndex, className, onClick }: {
  state: PlayState;
  size?: PlaySize;
  acc?: string;
  force?: PlayForce;
  /** Der Spielen-Knopf der Seite (Strg+Enter klickt ihn). */
  main?: boolean;
  tabIndex?: number;
  /** Platzierung des Knopfes in der Umgebung (Tailwind, z. B. Spalte und Zeile im Raster). */
  className?: string;
  onClick?: () => void;
}) {
  const look = LOOK[size];
  const st = state.state;
  const busy = st === "prep" || st === "start";
  const status = st === "run" || st === "error";
  // Aus mit Grund in der Unterzeile: die Platte ist flach, die Unterzeile bleibt lesbar.
  const flat = !!state.disabled && !busy;
  return (
    <Button
      fill
      size={look.button}
      variant={status ? "secondary" : "primary"}
      tone={st === "run" ? "acc" : st === "error" ? "bad" : undefined}
      tinted={status}
      busy={busy}
      className={cn("play group/play", look.box, className)}
      data-st={st}
      data-force={force}
      aria-label={state.ariaLabel}
      aria-disabled={flat || undefined}
      aria-keyshortcuts={main ? SHORTCUT.play : undefined}
      data-main-play={main ? "" : undefined}
      tabIndex={tabIndex}
      style={st === "error" ? undefined : cssVars({ "--acc": acc })}
      onClick={onClick}
    >
      <Icon
        name={state.icon}
        size={look.icon}
        className={cn(look.gap, size !== "i" && "[&_svg]:[filter:drop-shadow(var(--tsh))] group-aria-disabled/play:[&_svg]:[filter:none]")}
      />
      {size !== "i" && (
        <span className="grid min-w-0 flex-1 grid-cols-[minmax(0,1fr)_auto] content-center text-left font-semibold tracking-normal">
          <span className={cn("col-start-1 truncate font-(family-name:--f-display) font-extrabold tracking-[.02em] uppercase", look.name, "leading-none")}>
            {size === "m" ? state.compactLabel : state.label}
          </span>
          {st === "prep" && (
            <span className={cn("col-start-2 row-start-1 ml-2 w-[4ch] text-right font-(family-name:--f-px) font-normal", look.name, "leading-none")}>
              {state.percentText}
            </span>
          )}
          {size === "l" && (
            <span
              className={cn(
                "col-[1/-1] row-start-2 mt-0.5 min-h-[calc(13px*var(--tz)*1.2)] truncate text-[length:calc(13px*var(--tz))] leading-[1.2] [text-shadow:none]",
                flat || status ? "text-(color:--fg-2)" : "text-(color:--ink)",
              )}
            >
              {state.detail}
            </span>
          )}
        </span>
      )}
      <PlayBar p={state.progress} className={cn("absolute [--prog-on:var(--ink)] [--prog-off:rgba(18,12,7,.38)]", look.bar, !busy && "invisible")} />
    </Button>
  );
}
