import type { ComponentProps, ReactNode } from "react";
import { Link, type LinkProps } from "react-router";
import { cn } from "@/lib/utils";
import { Icon } from "./Icon";
import type { IconName, Tone } from "./types";
import { cssVars, flag, hasContent } from "./util";

type ChipBase = {
  tone?: Tone;
  /** Eigene Farbe (CSS-Farbe, z. B. einer Marke) statt der Statusfarbe: färbt wie `acc`. */
  color?: string;
  /** Pixel-Icon vor dem Text (Icon-Slot s); ersetzt das Pixelquadrat. */
  icon?: IconName;
  size?: "m" | "s";
  /** Über einer Szene (Instanzkopf): volle Textfarbe, fett, harter Schatten statt der Tonfarbe. */
  onScene?: boolean;
};

/* Layout (Tailwind). Pixelschrift 20 sitzt etwa 1 px über der Mitte: bei s gleichen 2 Einheiten Innenabstand oben das aus,
   Pip und Symbol gehen dafür 1 px nach oben (`-translate-y-px`). */
const BOX = {
  m: "h-7 gap-1.5 px-[9px] text-chip-m [--cnt-fs:20px] data-[lead]:gap-1 data-[lead]:pl-[7px]",
  s: "h-[22px] gap-[5px] px-[7px] pt-0.5 text-chip-s [--cnt-fs:18px] data-[lead]:gap-0.5 data-[lead]:pl-[3px]",
};
const BASE = "lk-chip lk-slot relative inline-flex shrink-0 items-center whitespace-nowrap leading-none";

function Lead({ icon, size }: Pick<ChipBase, "icon" | "size">) {
  const lift = size === "s" && "-translate-y-px";
  return icon
    ? <Icon name={icon} size="s" className={cn(lift)} />
    : <i className={cn("lk-pip size-u2 shrink-0", lift)} aria-hidden />;
}

/**
 * Status-Etikett: kleiner Slot, 28 px (m) oder 22 px (s), Pixelschrift, Pip in der Tonfarbe oder Icon (Slot s).
 * Zahlen darin als <Count> (Pixelschrift, feste Stellenbreite).
 */
export function Chip({ tone, color, size = "m", icon, onScene, className, style, children, ...props }: ChipBase & ComponentProps<"span">) {
  return (
    <span
      className={cn(BASE, BOX[size], className)}
      data-tone={color ? "acc" : tone && tone !== "neutral" ? tone : undefined}
      data-lead={flag(icon)}
      data-scene={flag(onScene)}
      style={color ? { ...style, ...cssVars({ "--acc": color }) } : style}
      {...props}
    >
      <Lead icon={icon} size={size} />
      {children}
    </span>
  );
}

/**
 * Chip als Knopf für Filter: gleiche Optik, mit Hover und Fokusring. `pressed` = gewählt (Akzentfarbe, `aria-pressed`).
 * `tone`: Tonfarbe eines Hinweises (z. B. `warn`); gewählt gewinnt der Akzent.
 * Ohne `icon` steht das Pixelquadrat davor.
 */
export function ChipButton({ pressed, tone, size = "m", icon, className, type = "button", children, ...props }: Pick<ChipBase, "icon" | "size" | "tone"> & { pressed?: boolean } & ComponentProps<"button">) {
  return (
    <button
      type={type}
      className={cn(BASE, BOX[size], className)}
      data-press
      data-tone={pressed ? "acc" : tone && tone !== "neutral" ? tone : undefined}
      data-lead={flag(icon)}
      aria-pressed={pressed}
      {...props}
    >
      <Lead icon={icon} size={size} />
      {children}
    </button>
  );
}

/** Chip als Link (react-router): Optik und Hover wie `ChipButton`, für Hinweise, die zu einer Seite führen (z. B. „Updates“). */
export function ChipLink({ tone, size = "m", icon, className, children, ...props }: Pick<ChipBase, "tone" | "icon" | "size"> & LinkProps) {
  return (
    <Link
      className={cn(BASE, BOX[size], className)}
      data-press
      data-tone={tone && tone !== "neutral" ? tone : undefined}
      data-lead={flag(icon)}
      {...props}
    >
      <Lead icon={icon} size={size} />
      {children}
    </Link>
  );
}

const COUNT_SIZE = { 16: "text-[16px]", 18: "text-[18px]", 20: "text-[20px]", 24: "text-[24px]", 26: "text-[26px]", 32: "text-[32px]" } as const;

/**
 * Zahl in Pixelschrift mit fester Stellenbreite: `minDigits` Stellen sind reserviert, damit wechselnde Werte nichts verschieben.
 * Ohne `size` bestimmt der Kontext (Chip s: 18, Chip m: 20, sonst 18). `strong`: volle Textfarbe mit hartem Schatten (große Anzeige eines Werts).
 */
export function Count({ value, size, minDigits, muted, strong, className }: { value: ReactNode; size?: keyof typeof COUNT_SIZE; minDigits?: number; muted?: boolean; strong?: boolean; className?: string }) {
  return (
    <span
      // `leading-none` steht nach der Größe: `text-[20px]` löscht sonst die Zeilenhöhe (cn-Zusammenführung)
      className={cn("lk-count inline-block text-right text-(length:--cnt-fs,18px)", size && COUNT_SIZE[size], "leading-none", minDigits && "min-w-[calc(var(--dg)*(1ch+.02em))]", className)}
      data-muted={flag(muted)}
      data-strong={flag(strong)}
      style={minDigits ? cssVars({ "--dg": minDigits }) : undefined}
    >
      {value}
    </span>
  );
}

/**
 * Reine Infos als Zeile: Text mit Pixelquadrat als Trenner, ohne Rahmen und Hover (Chips sind Status, Knöpfe Aktionen).
 * `onScene`: harter 1-Einheit-Schatten für Text, Trenner und Icons über Szenen.
 * `wrap`: für viele oder lange Einträge; sie brechen in weitere Zeilen um, statt sich zu überlappen.
 */
export function Meta({ items, size = "m", onScene, wrap, className }: { items: ReactNode[]; size?: "m" | "l"; onScene?: boolean; wrap?: boolean; className?: string }) {
  const h = size === "l" ? "text-ctl-m" : "text-ctl-s";
  const rows = wrap ? (size === "l" ? "flex-wrap gap-y-0.5 min-h-ctl-s" : "flex-wrap gap-y-0.5 min-h-7") : size === "l" ? "h-ctl-s" : "h-7";
  return (
    <div className={cn("lk-meta flex min-w-0 items-center whitespace-nowrap", h, rows, className)} data-scene={flag(onScene)}>
      {items.filter(hasContent).map((it, i) => (
        <span key={i} className="lk-meta-i inline-flex min-w-0 items-center gap-[5px] not-first:before:mx-2.5 not-first:before:size-u2 not-first:before:shrink-0">{it}</span>
      ))}
    </div>
  );
}
