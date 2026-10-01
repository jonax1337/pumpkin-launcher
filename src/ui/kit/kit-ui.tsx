/**
 * Gemeinsame Bausteine der Kit-Vorschau (/_kit): Abschnitt, Beschriftungen und Raster-Boxen.
 */
import type { CSSProperties, ReactNode } from "react";

/** Kleine Beschriftung neben oder über einer Demo. */
export const cap: CSSProperties = { fontSize: 12, color: "var(--fg-3)", fontWeight: 600 };

/** Eine Zeile aus Demos, die umbricht. */
export const row: CSSProperties = { display: "flex", gap: 16, alignItems: "center", flexWrap: "wrap" };

/** Gestrichelter Rahmen um die feste Box eines Icons oder Bilds. */
const GRID_OUTLINE = "1px dashed #33415C";
export const cell: CSSProperties = { outline: GRID_OUTLINE, display: "inline-grid" };

const section: CSSProperties = { display: "flex", flexDirection: "column", gap: 14, padding: "22px 0", boxShadow: "inset 0 calc(var(--px) * -1) 0 var(--line)" };

/** Abschnitt der Vorschau; `id` setzt data-kit="sec-…" als Marke zum Wiederfinden. */
export function Sec({ title, id, children }: { title: string; id?: string; children: ReactNode }) {
  return (
    <section style={section} data-kit={id && `sec-${id}`}>
      <h2 className="vx-h">{title}</h2>
      {children}
    </section>
  );
}

/** Zeilenbeschriftung in fester Breite. */
export function Lab({ children }: { children: ReactNode }) {
  return <span style={{ ...cap, width: 110, flex: "none" }}>{children}</span>;
}
