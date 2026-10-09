import type { ComponentProps, ReactNode } from "react";
import { cn } from "@/lib/utils";

/** Eine Zeile: Bezeichnung links, Wert rechts daneben; `valueClassName` geht an das Wertelement (`truncate`, `min-h-[19px]` …). */
export type DescriptionItem = { label: ReactNode; value: ReactNode; valueClassName?: string };

const SIZE = { s: "gap-x-3 gap-y-1.5 text-ctl-s", m: "gap-x-5 gap-y-2 text-ctl-m" } as const;

/**
 * Bezeichnung-Wert-Liste (`dl`): zwei Spalten, die Bezeichnung gedämpft, der Wert nimmt den Rest und bricht um.
 * `items` (falsche Einträge werden übersprungen, so lassen sich Zeilen bedingt zeigen). `size`: `s` = 13 px, eng · `m` = 14 px (Standard).
 * `end`: Werte rechtsbündig. `framed`: eingelassene Fläche mit Innenabstand (Diagnose); ohne sie steht die Liste frei im Inhalt.
 * Außenabstände und Breite setzt der Aufrufer per `className`.
 */
export function DescriptionList({ items, size = "m", end, framed, className, ...props }: {
  items: readonly (DescriptionItem | false | null | undefined)[]; size?: keyof typeof SIZE; end?: boolean; framed?: boolean;
} & Omit<ComponentProps<"dl">, "children">) {
  return (
    <dl
      className={cn("lk-dl m-0 grid grid-cols-[minmax(0,auto)_minmax(0,1fr)]", SIZE[size], framed && "lk-slot px-3.5 py-3", className)}
      {...props}
    >
      {items.map((item, i) => item && (
        <div key={i} className="contents">
          <dt>{item.label}</dt>
          <dd className={cn("m-0 min-w-0 wrap-anywhere", end && "text-right", item.valueClassName)}>{item.value}</dd>
        </div>
      ))}
    </dl>
  );
}
