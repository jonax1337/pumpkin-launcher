/**
 * Seitengerüst des Kits: Seitenkopf, Abschnittskopf, Überschriftenstufen, Werkzeugleiste, Aktionsreihe.
 * Maße fest in px (nie von --px abhängig). Aussehen: ui/layout.css (vx-*).
 */
import type { ComponentProps, ReactNode } from "react";
import { cn } from "@/lib/utils";
import { Count } from "./Chip";

/** Überschriftenstufen (Display, Versalien): Seite 40 · Dialog 26 · Abschnitt 22 · Unterabschnitt 20 · Karte 18. */
export type HeadingLevel = "page" | "dialog" | "section" | "sub" | "card";
type HTag = "h1" | "h2" | "h3" | "h4";

const TAG: Record<HeadingLevel, HTag> = { page: "h1", dialog: "h2", section: "h2", sub: "h3", card: "h3" };

/** Überschrift einer Stufe; das Element (`as`) folgt der Dokumentstruktur, die Größe der Stufe. */
export function Heading({ level, as, className, children, ...props }: { level: HeadingLevel; as?: HTag } & ComponentProps<"h2">) {
  const H = as ?? TAG[level];
  return <H className={cn("vx-h", className)} data-level={level} {...props}>{children}</H>;
}

/**
 * Seitenkopf: 44 px hoch, h1 40 px unten bündig; `count` als Pixelzahl daneben (grau), `children` rechts (Aktionen).
 * Das h1 bekommt nach dem Seitenwechsel den Fokus (app/Layout).
 */
export function PageHeader({ title, count, id, children, className }: { title: ReactNode; count?: number; id?: string; children?: ReactNode; className?: string }) {
  return (
    <div className={cn("vx-pageh", className)}>
      <Heading level="page" id={id} className="vx-trunc">{title}</Heading>
      {count != null && <Count value={count} size={26} muted className="vx-pageh-n" />}
      {children && <div className="vx-pageh-a">{children}</div>}
    </div>
  );
}

/**
 * Abschnittskopf: 32 px, Titel links (Stufe section 22 / sub 20 / card 18), Aktionen rechts (meist Geist s, bündig per bleed="end").
 */
export function SectionHeader({ title, as, size = "section", id, actions, className }: { title: ReactNode; as?: "h2" | "h3" | "h4"; size?: "section" | "sub" | "card"; id?: string; actions?: ReactNode; className?: string }) {
  return (
    <div className={cn("vx-sech", className)} data-size={size}>
      <Heading level={size} as={as} id={id} className="vx-trunc">{title}</Heading>
      {actions && <div className="vx-sech-a">{actions}</div>}
    </div>
  );
}

/**
 * Werkzeugleiste unter dem Seitenkopf: Höhe 40 (Suche, Sortieren, Ansicht) oder 56 (Inhalte mit Auswahl), Abstand 8.
 * `alt`: zweite Leiste deckungsgleich darüber (Auswahl-/Bulk-Leiste), sichtbar bei `altActive`; die Höhe bleibt, nichts springt.
 * `wrapBelow`: unter dieser Fensterbreite bricht die Leiste um (Höhe wird Mindesthöhe).
 * `search`: Breite der Suchfelder darin (zentral, schrumpft mit dem Fenster): s 220→128 · m 260→180 · l 320.
 * `label`: macht die Leiste zur benannten Gruppe (role=toolbar nur mit echter Pfeiltasten-Bedienung, daher group).
 */
export function Toolbar({ height = 40, wrapBelow, alt, altActive, search, label, className, children }: {
  height?: 40 | 56; wrapBelow?: 1096 | 800; alt?: ReactNode; altActive?: boolean; search?: "s" | "m" | "l"; label?: string; className?: string; children: ReactNode;
}) {
  return (
    <div
      className={cn("vx-toolbar", className)}
      data-h={height}
      data-wrap={wrapBelow}
      data-search={search}
      data-alt={alt != null ? (altActive ? "on" : "off") : undefined}
      role={label ? "group" : undefined}
      aria-label={label}
    >
      {alt != null ? (
        <>
          <div className="vx-tb-main" inert={altActive || undefined}>{children}</div>
          <div className="vx-tb-alt" inert={!altActive || undefined}>{alt}</div>
        </>
      ) : (
        children
      )}
    </div>
  );
}

/** Freier Raum in Toolbar/Actions: schiebt alles Folgende nach rechts. */
export function Spacer() {
  return <span className="vx-sp" aria-hidden />;
}

/** Reihe von Aktionen (Knöpfe): Abstand 8 (oder 4/12), Ausrichtung start/end/between; `wrap` erlaubt Umbruch. */
export function Actions({ gap = 8, align = "start", wrap, className, children }: { gap?: 4 | 8 | 12; align?: "start" | "end" | "between"; wrap?: boolean; className?: string; children: ReactNode }) {
  return (
    <div className={cn("vx-acts", className)} data-gap={gap} data-align={align} data-wrap={wrap ? "" : undefined}>
      {children}
    </div>
  );
}
