import type { ComponentProps, ReactNode } from "react";
import { cn } from "@/lib/utils";
import { Icon } from "./Icon";
import { cssVars, flag, hasContent } from "./util";
import type { IconName, Tone } from "./types";

type ChipBase = {
  tone?: Tone;
  /** Eigene Farbe (CSS-Farbe, z. B. einer Marke) statt der Statusfarbe: färbt wie `acc`. */
  color?: string;
  /** Pixelquadrat vor dem Text (Status). */
  dot?: boolean;
  /** Pixel-Icon vor dem Text (Icon-Slot s). */
  icon?: IconName;
  size?: "m" | "s";
};

/**
 * Status-Etikett: 28 px (m) oder 22 px (s). 1-Einheit-Rahmen, Kerbe. Optional Icon (Slot s) oder `dot` vor dem Text.
 * Zahlen darin als <Count> (Pixelschrift, feste Stellenbreite).
 */
export function Chip({ tone, color, dot, size = "m", icon, className, style, children, ...props }: ChipBase & ComponentProps<"span">) {
  return (
    <span
      className={cn("vx-chip", className)}
      data-size={size}
      data-tone={color ? "acc" : tone && tone !== "neutral" ? tone : undefined}
      data-lead={flag(icon)}
      style={color ? { ...style, ...cssVars({ "--acc": color }) } : style}
      {...props}
    >
      {dot && <i className="vx-dot" aria-hidden />}
      {icon && <Icon name={icon} size="s" />}
      {children}
    </span>
  );
}

/**
 * Zahl in Pixelschrift (Jersey 10) mit fester Stellenbreite: `minDigits` Stellen sind reserviert, damit
 * wechselnde Werte nichts verschieben. Größe 16/18/20/26 px; ohne Angabe bestimmt der Kontext (Chip s: 16, sonst 18).
 */
export function Count({ value, size, minDigits, muted, className }: { value: ReactNode; size?: 16 | 18 | 20 | 26; minDigits?: number; muted?: boolean; className?: string }) {
  return (
    <span
      className={cn("vx-count", className)}
      data-size={size}
      data-muted={flag(muted)}
      style={minDigits ? cssVars({ "--dg": minDigits }) : undefined}
    >
      {value}
    </span>
  );
}

/**
 * Reine Infos als Zeile: Text mit Pixelquadrat als Trenner, ohne Rahmen und Hover (Chips sind Status, Knöpfe Aktionen).
 * `onScene`: harter 1-Einheit-Schatten für Text, Trenner und Icons über Szenen.
 */
export function Meta({ items, size = "m", onScene, className }: { items: ReactNode[]; size?: "m" | "l"; onScene?: boolean; className?: string }) {
  return (
    <div className={cn("vx-meta", className)} data-size={size} data-scene={flag(onScene)}>
      {items.filter(hasContent).map((it, i) => (
        <span key={i} className="vx-meta-i">{it}</span>
      ))}
    </div>
  );
}
