import type { CSSProperties, ReactNode } from "react";

export const clamp = (x: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, x));

/** Hat der Knoten etwas zu zeigen? (`null`, `false` und `""` rendern nichts.) */
export const hasContent = (node: ReactNode) => node != null && node !== false && node !== "";

/** Boolesches data-*-Attribut: leer gesetzt oder ganz weg (CSS prüft nur die Anwesenheit). */
export const flag = (on: unknown) => (on ? "" : undefined);

/** Eigene CSS-Variablen als style; React kennt `--x`-Schlüssel nicht im Typ. */
export const cssVars = (vars: Record<`--${string}`, string | number | undefined>) => vars as CSSProperties;

/** Läuft der Inhalt über (Auslassung, Zeilenklammer)? 1 px Toleranz gegen Rundung. */
export const isOverflowing = (el: HTMLElement | null) => !!el && (el.scrollWidth > el.clientWidth + 1 || el.scrollHeight > el.clientHeight + 1);

/** Per Tastatur erreichbare Elemente. */
export const FOCUSABLE = "a[href], button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex='-1'])";
