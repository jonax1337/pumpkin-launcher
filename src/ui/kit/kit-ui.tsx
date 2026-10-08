/**
 * Gemeinsame Bausteine der Kit-Vorschau (/_kit): Abschnitt, Beschriftungen und Prüfraster-Box. Stile: kit.css.
 */
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/** Kleine Beschriftung neben oder über einer Demo. */
export function Cap({ children, className, ...props }: { children: ReactNode; className?: string } & { [name: `data-${string}`]: string | undefined }) {
  return <span className={cn("kit-cap", className)} {...props}>{children}</span>;
}

/** Zeilenbeschriftung in fester Breite. */
export function Lab({ children }: { children: ReactNode }) {
  return <Cap className="kit-lab">{children}</Cap>;
}

/** Gestrichelte Box um die feste Fläche eines Icons oder Bilds. */
export function Frame({ children, title }: { children: ReactNode; title?: string }) {
  return <span className="kit-cell" title={title}>{children}</span>;
}

/** Abschnitt der Vorschau; `id` setzt data-kit="sec-…" als Marke zum Wiederfinden. */
export function Sec({ title, id, children }: { title: string; id?: string; children: ReactNode }) {
  return (
    <section className="kit-sec" data-kit={id && `sec-${id}`}>
      <h2 className="vx-h">{title}</h2>
      {children}
    </section>
  );
}
