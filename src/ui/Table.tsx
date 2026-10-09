import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";
import { flag } from "./util";

/**
 * Datentabelle (echtes <table>, wenn die Daten Spalten mit gleichem Rhythmus haben und keine Zeilen-Bausteine brauchen):
 * 13 px, Schrift gedämpft. Bausteine: `Th` (Spaltenkopf), `Tr`, `Td`. Spalten, die in schmalen Containern entfallen sollen,
 * bekommen an Kopf- und Datenzelle `className="@max-[600px]:hidden"` (Container-Abfrage, wie bei `FormRow`).
 */
export function Table({ className, ...props }: ComponentProps<"table">) {
  return <table className={cn("lk-table w-full border-collapse text-ctl-s", className)} {...props} />;
}

/** Spaltenkopf (`scope="col"`): Pixelschrift 16 px, Versalien, Linie unten. */
export function Th({ className, scope = "col", ...props }: ComponentProps<"th">) {
  return (
    <th
      className={cn("lk-th pr-3 pb-2 text-left text-[length:calc(16px*var(--tz))] leading-none tracking-[.06em] whitespace-nowrap uppercase", className)}
      scope={scope}
      {...props}
    />
  );
}

/**
 * Zeile der Tabelle; beim Überfahren hebt sich die Fläche ab. `sub`: Folgezeile, die zur vorigen gehört (aufgeklappte Details):
 * ohne Hover, die vorige Zeile verliert ihre Linie unten.
 */
export function Tr({ sub, className, ...props }: { sub?: boolean } & ComponentProps<"tr">) {
  return <tr className={cn("lk-tr", className)} data-sub={flag(sub)} {...props} />;
}

/** Zelle mit Linie unten, mittig; `className` setzt Ausrichtung und Umbruch (z. B. `text-right whitespace-nowrap pr-0`). */
export function Td({ className, ...props }: ComponentProps<"td">) {
  return <td className={cn("lk-td py-2 pr-3 align-middle", className)} {...props} />;
}
