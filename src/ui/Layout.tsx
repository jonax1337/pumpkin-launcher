/**
 * Seitengerüst des Kits: die Reihenfolge Page → PageHeader → Hinweis → Toolbar → Workspace),
 * aber das Layout steht vollständig als Tailwind-Utilities in diesen Komponenten, nicht in einem Stylesheet.
 * Jede Komponente nimmt `className`; Utilities des Aufrufers ersetzen die gleichartigen Utilities hier (cn merged), z. B.
 * `<Page className="max-w-5xl mx-auto">` oder `<Toolbar className="gap-2">`. Das Aussehen (Linie, Platte, Überschrift) bleibt in look.css.
 */
import { Children, isValidElement, type ComponentProps, type ReactNode } from "react";
import { useMediaQuery } from "@/hooks/useMediaQuery";
import { cn } from "@/lib/utils";
import { flag } from "./util";
import { Count } from "./Chip";
import { Skel } from "./Feedback";
import { Heading, Panel, type HeadingLevel } from "./Panel";
import { Tabs, type TabsProps } from "./Tabs";
import { Surface } from "./Surface";

/**
 * Sprunglink: erstes Bedienelement der App, nur bei Tastaturfokus im Bild (sonst oberhalb des Fensters). `onClick` setzt den Fokus
 * auf den Inhalt. Als erstes Kind des App-Rahmens (`position: relative`) setzen.
 */
export function SkipLink({ className, ...props }: Omit<ComponentProps<"button">, "type">) {
  return (
    <Surface
      kind="stone"
      as="button"
      text
      type="button"
      className={cn("lk-skip absolute top-2 left-gut z-100 h-(--lk-h-s) -translate-y-[200%] px-3.5 focus-visible:translate-y-0", className)}
      {...props}
    />
  );
}

/** Seitenrahmen: Rand links/rechts `--gut`, oben/unten fest, Kinder im Abstand 16. Abstände gibt allein der Rahmen vor. */
export function Page({ className, ...props }: ComponentProps<"section">) {
  return <section className={cn("flex w-full min-w-0 flex-col gap-pg-m px-gut pt-pg-top pb-pg-bottom", className)} {...props} />;
}

/**
 * Seitenkopf: Titel (Display) mit Zähler, Aktionen rechts, darunter die Trennlinie.
 * `tabs` sitzt direkt darunter; ihre Grundlinie ersetzt dann die Trennlinie.
 */
export function PageHeader({ title, count, id, tabs, children, className }: {
  title: ReactNode; count?: number; id?: string; tabs?: ReactNode; children?: ReactNode; className?: string;
}) {
  return (
    <header className={cn("lk-rule flex min-w-0 flex-col gap-pg-s", tabs ? "pb-0 [&>.lk-tabs]:[--t-px:0px]" : "pb-pg-m", className)} data-rule={flag(!tabs)}>
      <div className="flex min-w-0 flex-wrap items-center gap-x-pg-m gap-y-pg-s">
        <div className="flex min-w-0 flex-1 items-baseline gap-pg-s">
          <Heading level="page" id={id}>{title}</Heading>
          {count != null && <Count value={count} size={26} muted className="shrink-0" />}
        </div>
        {Children.count(children) > 0 && <div className="ms-auto flex min-w-0 flex-wrap items-center gap-pg-s">{children}</div>}
      </div>
      {tabs}
    </header>
  );
}

/**
 * Abschnittskopf: 32 px hoch, Titel links (Stufe section / sub / card), Aktionen rechts.
 * `info` steht neben dem Titel, aber außerhalb der Überschrift (sein Text gehört nicht zum Namen der Überschrift).
 */
export function SectionHeader({ title, as, level = "section", id, info, actions, wrap, className }: {
  title: ReactNode; as?: "h1" | "h2" | "h3" | "h4"; level?: Extract<HeadingLevel, "section" | "sub" | "card">; id?: string; info?: ReactNode; actions?: ReactNode;
  /** Aktionen dürfen umbrechen: der Kopf ist dann mindestens 32 px hoch und wächst mit (große Schrift, schmale Fenster). */
  wrap?: boolean; className?: string;
}) {
  return (
    <div className={cn("flex min-w-0 items-center justify-between gap-3 [&_.lk-count]:ml-2", wrap ? "min-h-ctl-s flex-wrap gap-x-pg-m gap-y-pg-s" : "h-ctl-s", className)}>
      <div className="flex min-w-0 items-center gap-1">
        <Heading level={level} as={as} id={id} className="truncate pt-0.5 leading-none">{title}</Heading>
        {info}
      </div>
      {actions && <div className={cn("flex items-center gap-0.5", wrap ? "min-w-0 max-w-full" : "shrink-0")}>{actions}</div>}
    </div>
  );
}

const TOOLBAR_H = { 32: "min-h-ctl-s", 40: "min-h-ctl-m", 56: "min-h-ctl-l" } as const;

/** Suchfeldbreite als Token (s 220 · m 260 · l 320 px, unter 1180 px Fensterbreite 184 · 220 · 280). */
const TOOLBAR_SEARCH = {
  s: "[--tb-search:220px] le-1180:[--tb-search:184px]",
  m: "[--tb-search:260px] le-1180:[--tb-search:220px]",
  l: "[--tb-search:320px] le-1180:[--tb-search:280px]",
} as const;
/** Das Token gilt für Eingabefelder mit Symbol (Suchfelder) in der Leiste; nie breiter als die Leiste. */
const TOOLBAR_SEARCH_FIELD = "[&_.lk-input[data-lead]]:w-(--tb-search) [&_.lk-input[data-lead]]:max-w-full [&_.lk-input[data-lead]]:flex-none";
/** Unter 900 px Fensterbreite nimmt das Suchfeld eine eigene Zeile. */
const TOOLBAR_SEARCH_WRAP = "le-900:[&_.lk-input[data-lead]]:w-auto le-900:[&_.lk-input[data-lead]]:flex-[1_1_100%]";
const TOOLBAR_LAYER = "col-start-1 row-start-1 flex min-w-0 flex-wrap items-center gap-tb [transition:opacity_var(--st),visibility_var(--st)]";
const TOOLBAR_HIDDEN = "invisible opacity-0";

/**
 * Werkzeugleiste unter dem Seitenkopf: Steuerelemente im Abstand 12, Mindesthöhe 32 (dicht), 40 oder 56 (Inhalte mit Auswahl).
 * Bricht um, sobald die Breite nicht reicht; alles hinter einem `Spacer` bildet eine Gruppe, die rechts bleibt und erst innen umbricht.
 * `alt`: zweite Leiste deckungsgleich in derselben Rasterzelle (Auswahl-/Bulk-Leiste), sichtbar bei `altActive`;
 * die inaktive ist `inert` und unsichtbar, die Höhe bleibt, nichts springt.
 * `search`: Breite der Suchfelder darin (zentral, nie breiter als die Leiste): s 220 · m 260 · l 320, unter 1180 px 184 · 220 · 280.
 * `searchWrap`: unter 900 px Fensterbreite füllt das Suchfeld eine eigene Zeile (Breite auto, flex 1 1 100 %); nur mit `search`.
 * `label`: macht die Leiste zur benannten Gruppe (role=group; role=toolbar bräuchte echte Pfeiltasten-Bedienung).
 */
export function Toolbar({ height = 40, alt, altActive, search, searchWrap, label, className, children, ...props }: {
  height?: keyof typeof TOOLBAR_H; alt?: ReactNode; altActive?: boolean; search?: keyof typeof TOOLBAR_SEARCH; searchWrap?: boolean;
  /** Name der Leiste (aria-label); macht sie zur Gruppe. */
  label?: string;
} & ComponentProps<"div">) {
  const hasAlt = alt != null;
  return (
    <div
      className={cn(
        "relative min-w-0",
        hasAlt ? "grid grid-cols-[minmax(0,1fr)]" : "flex flex-wrap items-center gap-tb gap-y-2",
        TOOLBAR_H[height],
        search && [TOOLBAR_SEARCH[search], TOOLBAR_SEARCH_FIELD, searchWrap && TOOLBAR_SEARCH_WRAP],
        className,
      )}
      data-alt={hasAlt ? (altActive ? "on" : "off") : undefined}
      role={label ? "group" : undefined}
      aria-label={label}
      {...props}
    >
      {hasAlt ? (
        <>
          <div className={cn(TOOLBAR_LAYER, TOOLBAR_H[height], altActive && TOOLBAR_HIDDEN)} inert={altActive || undefined}><ToolbarItems>{children}</ToolbarItems></div>
          <div className={cn(TOOLBAR_LAYER, TOOLBAR_H[height], !altActive && TOOLBAR_HIDDEN)} inert={!altActive || undefined}><ToolbarItems>{alt}</ToolbarItems></div>
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
      {end.length > 0 && <div className="ms-auto flex min-w-0 flex-wrap items-center justify-end gap-tb">{end}</div>}
    </>
  );
}

/** Freier Raum in einer Leiste: alles danach steht rechts. */
export function Spacer() {
  return <span className="flex-1" aria-hidden />;
}

const ACTION_GAP = { 4: "gap-1", 8: "gap-2", 12: "gap-3" } as const;
const ACTION_ALIGN = { start: "", end: "justify-end", between: "justify-between" } as const;

/** Reihe von Aktionen (Knöpfe): Abstand 8 (oder 4/12), Ausrichtung start/end/between; `wrap` erlaubt Umbruch. */
export function Actions({ gap = 8, align = "start", wrap, className, ...props }: {
  gap?: keyof typeof ACTION_GAP; align?: keyof typeof ACTION_ALIGN; wrap?: boolean;
} & ComponentProps<"div">) {
  return <div className={cn("flex min-w-0 items-center", ACTION_GAP[gap], ACTION_ALIGN[align], wrap && "flex-wrap gap-y-2", className)} {...props} />;
}

/**
 * Seitenraster mit optionalem Kontextbereich (`rail`, 280 px); ohne `rail` nutzt der Inhalt die volle Breite.
 * Unter 960 px stehen Leiste und Inhalt untereinander.
 */
export function Workspace({ rail, className, children, ...props }: ComponentProps<"div"> & { rail?: ReactNode }) {
  return (
    <div className={cn("grid items-start gap-pg-m", rail ? "grid-cols-[280px_minmax(0,1fr)] le-960:grid-cols-1" : "grid-cols-1", className)} {...props}>
      {rail}
      {children}
    </div>
  );
}

/** Kontext oder Navigation neben dem Inhalt (Platte), auf schmalen Fenstern darüber. `bare` für Navigation ohne Platte. */
export function WorkspaceRail({ bare, className, ...props }: { bare?: boolean } & ComponentProps<"div">) {
  // Enthält die Rail nur die Navigation (`WorkspaceTabs`), steht sie ohne Platte und Innenabstand direkt auf dem Grund.
  return <Panel as="aside" bare={bare} className={cn("lk-rail sticky top-pg-m le-960:static has-[>.lk-tabs]:p-0", bare && "p-0", className)} {...props} />;
}

/** Inhaltsfläche des Arbeitsbereichs: Platte, oder mit `plain` nur der Rahmen eines eingebetteten Bereichs. */
export function WorkspaceContent({ plain, className, ...props }: { plain?: boolean } & ComponentProps<"div">) {
  return <Panel bare={plain} className={cn(plain && "p-0", className)} {...props} />;
}

/** Der große Start-Titel: höchstens zwei Zeilen, ausgeglichen; der Schlagschatten liegt im Polster (der Zeilenschnitt würde ihn sonst kappen), die negativen Ränder halten den Text an seinem Platz. */
const HERO_XL = "line-clamp-2 text-balance p-u1 pb-u2 -m-u1 -mb-u2";
/** Der Kasten des großen Titels reserviert zwei Zeilen (je 0,95 Zeilenhöhe), damit die Seite beim Instanzwechsel nicht springt. */
const HERO_XL_BOX = "flex h-[calc(var(--hd-hero-xl)*1.9)] items-end";

/**
 * Titel einer Szenenseite (Start, Instanz): Display, harter Schatten. `xl` ist der große Start-Titel: höchstens zwei Zeilen,
 * in einem Kasten, der zwei Zeilen Höhe reserviert.
 */
export function HeroTitle({ size, as, className, ...props }: { size?: "xl"; as?: "h1" | "h2" | "h3" | "h4" } & ComponentProps<"h1">) {
  const title = <Heading level="hero" size={size} as={as} className={cn(size === "xl" && HERO_XL, className)} {...props} />;
  return size === "xl" ? <div className={HERO_XL_BOX}>{title}</div> : title;
}

/** Platzhalter des großen Titels (`HeroTitle size="xl"`): derselbe Kasten, damit die Seite nicht springt. */
export function HeroTitleSkel({ className }: { className?: string }) {
  return <div className={HERO_XL_BOX}><Skel className={cn("h-[72px] w-[min(520px,80%)]", className)} /></div>;
}

/**
 * Metazeile unter dem Szenentitel: Text (`Meta`) und kleine Knöpfe in einer Reihe, bei Platzmangel umbrechend.
 * `outline`: Text halbfett mit Kontur (ein Gerätepixel) und Schlagschatten, die Trenner heller; für helle Szenen (Start).
 */
export function HeroMeta({ outline, className, ...props }: { outline?: boolean } & ComponentProps<"div">) {
  return (
    <div
      className={cn("lk-hero-meta flex min-h-ctl-s min-w-0 flex-wrap items-center gap-x-3 gap-y-pg-s [&_.lk-meta]:h-auto [&_.lk-meta]:min-h-ctl-s [&_.lk-meta]:flex-[0_1_auto] [&_.lk-meta]:flex-wrap [&_.lk-meta]:gap-y-0.5", className)}
      data-outline={flag(outline)}
      {...props}
    />
  );
}

/**
 * Abdunklung der Szene in weichen Verläufen; füllt den Szenenkopf (Elternelement `relative`), Text steht unten.
 * `side`: zusätzlich von links dicht, damit Titel und Leiste lesbar bleiben, rechts bleibt die Szene hell (Start).
 */
export function HeroShade({ side, className }: { side?: boolean; className?: string }) {
  return <div className={cn("lk-shade pointer-events-none absolute inset-0 z-1", className)} data-side={flag(side)} aria-hidden />;
}

export type WorkspaceTabsProps<V extends string> = Omit<TabsProps<V>, "variant" | "sticky">;

/** Navigation für das Seitenraster: senkrechte Platten links, unter 960 px kompakte Segmente über dem Inhalt. Beschriftungen brechen um. */
export function WorkspaceTabs<V extends string>({ className, ...props }: WorkspaceTabsProps<V>) {
  const stacked = useMediaQuery("(max-width: 960px)");
  return (
    <Tabs
      {...props}
      variant={stacked ? "segment" : "vertical"}
      className={cn(
        stacked
          ? "h-auto w-full flex-wrap overflow-visible [&>.lk-tab]:min-h-[calc(var(--lk-h-m)_-_var(--u2)_*_2)]"
          : "[&>.lk-tab]:h-auto [&>.lk-tab]:min-h-11 [&>.lk-tab]:py-1.5 [&[data-size=s]>.lk-tab]:min-h-9 [&_.lk-tc]:text-left [&_.lk-tc]:wrap-anywhere [&_.lk-tc]:whitespace-normal",
        className,
      )}
    />
  );
}
