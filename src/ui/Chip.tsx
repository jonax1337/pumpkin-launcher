import { type ComponentProps, type CSSProperties, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import { Icon } from "./Icon";
import type { IconName, Tone } from "./types";

type ChipBase = {
  tone?: Tone;
  /** Feste Breite in px (Status-Chip, dessen Text wechselt); Text läuft mit Auslassung aus. */
  fixed?: number;
  /** Pixelquadrat vor dem Text (Status). */
  dot?: boolean;
};
type ChipSize = { size?: "m"; icon?: IconName } | { size: "s"; icon?: never };

/**
 * Status-Etikett: 28 px (m, optional Icon s) oder 22 px (s, nur Text + dot). 1-Einheit-Rahmen, Kerbe.
 * Zahlen darin als <Count> (Pixelschrift, feste Stellenbreite).
 */
export function Chip({ tone, fixed, dot, size = "m", icon, className, style, children, ...props }: ChipBase & ChipSize & ComponentProps<"span">) {
  return (
    <span
      className={cn("vx-chip", className)}
      data-size={size}
      data-tone={tone && tone !== "neutral" ? tone : undefined}
      data-lead={icon ? "" : undefined}
      data-fixed={fixed != null ? "" : undefined}
      style={fixed != null ? { ...style, width: fixed } : style}
      {...props}
    >
      {dot && <i className="vx-dot" aria-hidden />}
      {icon && size === "m" && <Icon name={icon} size="s" />}
      {fixed != null ? <span className="vx-chip-t">{children}</span> : children}
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
      data-muted={muted ? "" : undefined}
      style={minDigits ? ({ "--dg": minDigits } as CSSProperties) : undefined}
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
  const list = items.filter((i) => i != null && i !== false && i !== "");
  return (
    <div className={cn("vx-meta", className)} data-size={size} data-scene={onScene ? "" : undefined}>
      {list.map((it, i) => (
        <span key={i} className="vx-meta-i">{it}</span>
      ))}
    </div>
  );
}
