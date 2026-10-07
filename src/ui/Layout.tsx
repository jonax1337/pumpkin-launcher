/**
 * Seitengerüst des Kits: Seitenkopf, Abschnittskopf, Überschriftenstufen, Werkzeugleiste, Aktionsreihe.
 * Maße fest in px (nie von --px abhängig). Aussehen: ui/layout.css (vx-*).
 */
import { Children, isValidElement, type ComponentProps, type ReactNode } from "react";
import { useMediaQuery } from "@/hooks/useMediaQuery";
import { cn } from "@/lib/utils";
import { Count } from "./Chip";
import { Tabs, type TabsProps } from "./Tabs";
import { flag, hasContent } from "./util";

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
 * Seitenkopf mit kompaktem Zähler und Trennlinie; `children` rechts (Aktionen).
 * Das h1 bekommt nach dem Seitenwechsel den Fokus (app/Layout).
 */
export function PageHeader({ title, count, id, children, className }: { title: ReactNode; count?: number; id?: string; children?: ReactNode; className?: string }) {
  return (
    <div className={cn("vx-pageh", className)}>
      <Heading level="page" id={id} className="vx-trunc">{title}</Heading>
      {count != null && <Count value={count} size={18} muted className="vx-pageh-n" />}
      {children && <div className="vx-pageh-a">{children}</div>}
    </div>
  );
}

/** Seitenraster mit optionalem Kontextbereich; ohne `rail` nutzt der Inhalt die volle Breite. */
export function Workspace({ rail, className, children, ...props }: ComponentProps<"div"> & { rail?: ReactNode }) {
  return (
    <div className={cn("vx-workspace", className)} data-rail={flag(hasContent(rail))} {...props}>
      {rail}
      {children}
    </div>
  );
}

/** Kontext oder Navigation neben dem Inhalt, auf schmalen Fenstern darüber. */
export function WorkspaceRail({ className, ...props }: ComponentProps<"aside">) {
  return <aside className={cn("vx-workspace-rail", className)} {...props} />;
}

/** Inhaltsfläche; `plain` übernimmt die bereits vorhandene Oberfläche eines eingebetteten Bereichs. */
export function WorkspaceContent({ variant = "panel", className, ...props }: ComponentProps<"div"> & { variant?: "panel" | "plain" }) {
  return <div className={cn("vx-workspace-content", className)} data-variant={variant} {...props} />;
}

export type WorkspaceTabsProps<V extends string> = Omit<TabsProps<V>, "variant" | "sticky">;

/** Kit-Navigation für das Seitenraster: Pixel-Platten links, kompakte Segmente über dem Inhalt. */
export function WorkspaceTabs<V extends string>({ className, ...props }: WorkspaceTabsProps<V>) {
  const stacked = useMediaQuery("(max-width: 960px)");
  return <Tabs {...props} variant={stacked ? "segment" : "vertical"} className={cn("vx-workspace-tabs", className)} />;
}

/**
 * Abschnittskopf: 32 px, Titel links (Stufe section 22 / sub 20 / card 18), Aktionen rechts (meist Geist s, bündig per bleed="end").
 * `info` steht neben dem Titel, aber außerhalb der Überschrift (z. B. ein Info-Knopf): sein Text gehört nicht zum Namen der Überschrift.
 */
export function SectionHeader({ title, as, size = "section", id, info, actions, className }: {
  title: ReactNode; as?: "h2" | "h3" | "h4"; size?: "section" | "sub" | "card"; id?: string; info?: ReactNode; actions?: ReactNode; className?: string;
}) {
  const heading = <Heading level={size} as={as} id={id} className="vx-trunc">{title}</Heading>;
  return (
    <div className={cn("vx-sech", className)} data-size={size}>
      {info ? <div className="vx-sech-t">{heading}{info}</div> : heading}
      {actions && <div className="vx-sech-a">{actions}</div>}
    </div>
  );
}

/**
 * Werkzeugleiste unter dem Seitenkopf: Höhe 40 (Suche, Sortieren, Ansicht) oder 56 (Inhalte mit Auswahl), Abstand 8.
 * `alt`: zweite Leiste deckungsgleich darüber (Auswahl-/Bulk-Leiste), sichtbar bei `altActive`; die Höhe bleibt, nichts springt.
 * Die Leiste bricht um, wenn die Breite nicht reicht (die Höhe ist Mindesthöhe); alles nach einem `Spacer` bildet eine Gruppe,
 * die rechts bleibt und beim Umbruch zusammenbleibt.
 * `search`: Breite der Suchfelder darin (zentral, nie breiter als die Leiste): s 220 · m 260 · l 320, unter 1180 px Fensterbreite 184 · 240 · 280.
 * `label`: macht die Leiste zur benannten Gruppe (role=toolbar nur mit echter Pfeiltasten-Bedienung, daher group).
 */
export function Toolbar({ height = 40, alt, altActive, search, label, className, children }: {
  height?: 40 | 56; alt?: ReactNode; altActive?: boolean; search?: "s" | "m" | "l"; label?: string; className?: string; children: ReactNode;
}) {
  return (
    <div
      className={cn("vx-toolbar", className)}
      data-h={height}
      data-search={search}
      data-alt={alt != null ? (altActive ? "on" : "off") : undefined}
      role={label ? "group" : undefined}
      aria-label={label}
    >
      {alt != null ? (
        <>
          <div className="vx-tb-main" inert={altActive || undefined}><ToolbarItems>{children}</ToolbarItems></div>
          <div className="vx-tb-alt" inert={!altActive || undefined}><ToolbarItems>{alt}</ToolbarItems></div>
        </>
      ) : (
        <ToolbarItems>{children}</ToolbarItems>
      )}
    </div>
  );
}

/** Teilt die Kinder einer Leiste am `Spacer`: davor steht links, danach die rechte Gruppe. */
function ToolbarItems({ children }: { children: ReactNode }) {
  const items = Children.toArray(children);
  const split = items.findIndex((item) => isValidElement(item) && item.type === Spacer);
  if (split < 0) return <>{items}</>;
  const end = items.slice(split + 1);
  return (
    <>
      {items.slice(0, split)}
      {end.length > 0 && <div className="vx-tb-end">{end}</div>}
    </>
  );
}

/** Freier Raum in der Werkzeugleiste: alles danach steht rechts. */
export function Spacer() {
  return <span className="vx-sp" aria-hidden />;
}

/** Reihe von Aktionen (Knöpfe): Abstand 8 (oder 4/12), Ausrichtung start/end/between; `wrap` erlaubt Umbruch. */
export function Actions({ gap = 8, align = "start", wrap, className, children }: { gap?: 4 | 8 | 12; align?: "start" | "end" | "between"; wrap?: boolean; className?: string; children: ReactNode }) {
  return (
    <div className={cn("vx-acts", className)} data-gap={gap} data-align={align} data-wrap={flag(wrap)}>
      {children}
    </div>
  );
}
