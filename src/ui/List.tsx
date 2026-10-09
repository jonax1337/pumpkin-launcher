/**
 * Listen des Kits. Die Spalten gibt der Aufrufer einmal an der `List` an (`cols`), Kopf und Zeilen teilen sie:
 *
 *   <List head={…} cols={{ base: "44px minmax(0,1fr) 150px", 1180: "44px minmax(0,1fr)" }} density="compact">
 *
 * Die Maße der Liste sind getypte Eigenschaften (`ListLayout`), keine Variablen an der Seite:
 *   - `cols`: `grid-template-columns` (Leerzeichen statt Unterstrich); Zeilen und Kopf teilen sie. `{ base, 720 | 900 | 1040 | 1180 }`:
 *     ab dieser Fensterbreite abwärts gilt der andere Wert (der kleinste passende gewinnt).
 *   - `gap` (Spaltenabstand in px, Vorgabe 12), `pad` (Zeilen-Innenabstand, Vorgabe `0 8px`), `rowHeight` (Mindesthöhe der Zeile in px,
 *     Vorgabe 56), `headHeight` (Mindesthöhe des Kopfs in px, Vorgabe 32); jeweils ebenfalls `{ base, … }`.
 *   - `density="compact"`: Zeilen, die mit einem Symbolknopf (Menü) enden: Innenabstand `0 6px 0 8px`.
 * Intern sind das die Variablen --l-cols, --l-gap, --l-pad, --l-h und --l-hh; Seiten schreiben sie nicht selbst. Eine Zeile, die im
 * schmalen Container anders liegt, setzt ihr eigenes Raster mit Tailwind (`@max-[640px]/name:grid-cols-[…] @max-[640px]/name:gap-x-2`).
 * `ListHeader` nimmt dieselben Eigenschaften; ein gemeinsames `ListLayout`-Objekt lässt sich auf Kopf und Listen spreizen.
 *
 * Fertige Ausprägungen statt Handarbeit an der Seite:
 *   - `List flat`: flache Einträge (Versionen, Sicherungen, Speicher): 44 px, Linie unten, kein Hover, Text 13, zwei Spalten.
 *   - `List framed`: eingelassene Tabellenfläche mit dunklem Kopf (Inhalt, Welten, Server).
 *   - `List spaced` + `ListRow plate="row"`: Plattenzeilen mit Abstand (Konten, Anfragen, Codes).
 *   - `List tiles` + `TileRow` (ListExtras): Kacheln im Raster.
 *   - `ListRow tone` / `bar` / `still`: getönte Hinweiszeile ohne Hover; `selected="bar"`: Kerbe links.
 */
import { createContext, useContext, type ComponentProps, type CSSProperties, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import { HitEl, type Hit } from "./Hit";
import { ContextMenu, type MenuEntry } from "./Menu";
import { Trunc } from "./Tooltip";
import type { Breakpoint } from "./types";
import { cssVars, flag } from "./util";

/** Raster aus den Variablen der Liste; ohne --l-cols eine einzige Spalte. */
export const GRID = "grid grid-cols-(--l-cols,minmax(0,1fr)) items-center gap-x-(--l-gap,12px) p-(--l-pad,0_8px)";

/** Fensterbreiten (px), ab denen abwärts eine Liste andere Maße haben darf. */
export type ListBreakpoint = 720 | 900 | 1040 | 1180;
/** Ein Wert oder `{ base, 1180: …, 720: … }`: ab der Breite abwärts gilt der jeweilige Wert. */
export type Responsive<T> = T | ({ base: T } & Partial<Record<ListBreakpoint, T>>);

/** Maße einer Liste; `List` und `ListHeader` nehmen sie als Eigenschaften. */
export type ListLayout = {
  /** Spalten (`grid-template-columns`, z. B. `"44px minmax(0,1fr) 150px"`). */
  cols?: Responsive<string>;
  /** Spaltenabstand in px (Vorgabe 12). */
  gap?: Responsive<number>;
  /** Innenabstand der Zeile (Vorgabe `0 8px`). */
  pad?: Responsive<string>;
  /** Mindesthöhe der Zeile in px (Vorgabe 56); bei `lazy` auch die reservierte Höhe. */
  rowHeight?: Responsive<number>;
  /** Mindesthöhe des Kopfs in px (Vorgabe 32). */
  headHeight?: Responsive<number>;
  /** `compact`: Zeilen mit Symbolknopf am Ende, Innenabstand `0 6px 0 8px` (`pad` überstimmt). */
  density?: "compact";
};

const LAYOUT_VAR = { cols: "--l-cols", gap: "--l-gap", pad: "--l-pad", rowHeight: "--l-h", headHeight: "--l-hh" } as const;
type LayoutKey = keyof typeof LAYOUT_VAR;
const LAYOUT_KEYS = Object.keys(LAYOUT_VAR) as LayoutKey[];
const LAYOUT_PX: Record<LayoutKey, boolean> = { cols: false, gap: true, pad: false, rowHeight: true, headHeight: true };
const COMPACT_PAD = "0 6px 0 8px";

/**
 * Antwortfähige Werte laufen über Zwischenvariablen (`--l-x-0` = base, `--l-x-<Breite>`), die diese vollständigen Klassen
 * (Tailwind muss sie finden) je Fensterbreite in die eigentliche Variable heben. Einfache Werte stehen direkt am Element.
 */
const BASE_CLASS: Record<LayoutKey, string> = {
  cols: "[--l-cols:var(--l-cols-0)]",
  gap: "[--l-gap:var(--l-gap-0)]",
  pad: "[--l-pad:var(--l-pad-0)]",
  rowHeight: "[--l-h:var(--l-h-0)]",
  headHeight: "[--l-hh:var(--l-hh-0)]",
};
const BREAKPOINT_CLASS: Record<ListBreakpoint, Record<LayoutKey, string>> = {
  1180: {
    cols: "le-1180:[--l-cols:var(--l-cols-1180)]", gap: "le-1180:[--l-gap:var(--l-gap-1180)]", pad: "le-1180:[--l-pad:var(--l-pad-1180)]",
    rowHeight: "le-1180:[--l-h:var(--l-h-1180)]", headHeight: "le-1180:[--l-hh:var(--l-hh-1180)]",
  },
  1040: {
    cols: "le-1040:[--l-cols:var(--l-cols-1040)]", gap: "le-1040:[--l-gap:var(--l-gap-1040)]", pad: "le-1040:[--l-pad:var(--l-pad-1040)]",
    rowHeight: "le-1040:[--l-h:var(--l-h-1040)]", headHeight: "le-1040:[--l-hh:var(--l-hh-1040)]",
  },
  900: {
    cols: "le-900:[--l-cols:var(--l-cols-900)]", gap: "le-900:[--l-gap:var(--l-gap-900)]", pad: "le-900:[--l-pad:var(--l-pad-900)]",
    rowHeight: "le-900:[--l-h:var(--l-h-900)]", headHeight: "le-900:[--l-hh:var(--l-hh-900)]",
  },
  720: {
    cols: "le-720:[--l-cols:var(--l-cols-720)]", gap: "le-720:[--l-gap:var(--l-gap-720)]", pad: "le-720:[--l-pad:var(--l-pad-720)]",
    rowHeight: "le-720:[--l-h:var(--l-h-720)]", headHeight: "le-720:[--l-hh:var(--l-hh-720)]",
  },
};
const BREAKPOINTS: ListBreakpoint[] = [1180, 1040, 900, 720];

/** Die Maße als Klassen (Fensterbreiten) und Variablen (Werte) für `List` und `ListHeader`. */
function listLayout({ cols, gap, pad, rowHeight, headHeight, density }: ListLayout, style?: CSSProperties) {
  const given = { cols, gap, pad: pad ?? (density === "compact" ? COMPACT_PAD : undefined), rowHeight, headHeight };
  const vars: Record<`--${string}`, string> = {};
  const classes: string[] = [];
  const css = (key: LayoutKey, value: string | number) => (LAYOUT_PX[key] ? `${value}px` : String(value));
  for (const key of LAYOUT_KEYS) {
    const value = given[key as keyof typeof given];
    if (value == null) continue;
    const name = LAYOUT_VAR[key];
    if (typeof value !== "object") {
      vars[name] = css(key, value);
      continue;
    }
    vars[`${name}-0`] = css(key, value.base);
    classes.push(BASE_CLASS[key]);
    for (const bp of BREAKPOINTS) {
      const at = value[bp];
      if (at == null) continue;
      vars[`${name}-${bp}`] = css(key, at);
      classes.push(BREAKPOINT_CLASS[bp][key]);
    }
  }
  return { className: classes.join(" "), style: Object.keys(vars).length ? { ...cssVars(vars), ...style } : style };
}

/** Vorgaben einer flachen Liste (überschreibbar per `className`): Name | Aktion, Abstand 8, ohne Innenabstand, 44 px. */
const FLAT_LIST = "[--l-cols:minmax(0,1fr)_auto] [--l-gap:8px] [--l-pad:0] [--l-h:44px]";
/** Plattenzeile: Reihe mit Platz links für die Auswahlmarke (Pfeil), mindestens 60 px; der Titel nimmt den Rest. */
const PLATE_ROW = "flex min-h-15 items-center gap-3 py-1.5 pr-2 pl-[30px]";
/** Zeile einer Beitragsliste (`feed`): Inhalt untereinander, Abstand 6, Innenabstand 12 × --pg-pad, Höhe nach Inhalt. */
const FEED_ROW = "flex min-h-0 flex-col items-stretch gap-1.5 px-(--pg-pad) py-3";
/** Zeile außerhalb des Fensters rendert nicht; ihre Höhe (--l-h) bleibt reserviert. */
export const LAZY = "[content-visibility:auto] [contain-intrinsic-block-size:auto_var(--l-h,56px)]";

/** Was die Liste ihren Zeilen verrät: flach, Beitragsliste. */
const ListCtx = createContext({ flat: false, feed: false });

/** Was die Zeile ihrem Inhalt verrät: ob sie als Ganzes trifft (Tooltip-Wirt), Karte, flach oder Plattenzeile ist. */
const RowCtx = createContext({ hit: false, feature: false, flat: false, plateRow: false });

/**
 * Liste mit festen Spalten. `head`: Kopfzellen (gleiches Raster wie die Zeilen). Spalten, Abstand, Innenabstand und Höhen:
 * `cols`, `gap`, `pad`, `rowHeight`, `headHeight`, `density` (siehe `ListLayout`).
 * `divided`: dezente Trenner zwischen Zeilen (`"strong"`: volle Linienfarbe). `flat`: flache Einträge ohne Hover, 44 px, Linie unten.
 * `framed`: eingelassene Fläche, Kopf als dunkle Leiste. `spaced`: Abstand 8 zwischen den Zeilen (Plattenzeilen).
 * `tiles`: Zeilen als Kacheln im Raster aus Spalten von mindestens `--tile-min` (300 px).
 * `feed`: Beitragsliste auf einer Platte (Mitteilungen): Zeilen mit Innenabstand 12 × --pg-pad, Inhalt untereinander
 * (`RowTitle size="display" eyebrow`), volle Linie unter jeder Zeile, Hover `--panel-2`, gewählt = Tönung der Zone (`--acc`) mit Kerbe links.
 */
export function List({ head, divided, flat, framed, spaced, tiles, feed, cols, gap, pad, rowHeight, headHeight, density, className, style, children, "aria-label": label, ...props }: {
  head?: ReactNode;
  divided?: boolean | "strong";
  flat?: boolean;
  framed?: boolean;
  spaced?: boolean;
  tiles?: boolean;
  feed?: boolean;
} & ListLayout & ComponentProps<"div">) {
  const layout = listLayout({ cols, gap, pad, rowHeight, headHeight, density }, style);
  return (
    <ListCtx.Provider value={{ flat: !!flat, feed: !!feed }}>
      <div
        className={cn("lk-list flex min-w-0 flex-col", framed && "lk-pit", flat && FLAT_LIST, layout.className, className)}
        style={layout.style}
        data-divided={divided === "strong" ? "strong" : flag(divided)}
        data-framed={flag(framed)}
        data-feed={flag(feed)}
        {...props}
      >
        {head != null && <ListHeader>{head}</ListHeader>}
        <div
          className={cn(
            "min-w-0",
            tiles ? "grid grid-cols-[repeat(auto-fill,minmax(var(--tile-min,300px),1fr))] gap-2.5 pt-1" : "flex flex-col",
            spaced && !tiles && "gap-2",
          )}
          role="list"
          aria-label={label}
        >
          {children}
        </div>
      </div>
    </ListCtx.Provider>
  );
}

/**
 * Kopfzeile (Pixelschrift, Versalien) im Raster der umgebenden `List`; allein verwendbar, wenn mehrere Listen die Spalten teilen
 * (dann dieselben `cols`, `gap`, `pad`, `headHeight`, `density` wie die Listen).
 * `bar`: abgesetzte Leiste (dunkel, Kante oben und unten), wenn der Kopf über mehreren Listen steht.
 */
export function ListHeader({ bar, cols, gap, pad, rowHeight, headHeight, density, className, style, ...props }: { bar?: boolean } & ListLayout & ComponentProps<"div">) {
  const layout = listLayout({ cols, gap, pad, rowHeight, headHeight, density }, style);
  return (
    <div
      className={cn("lk-lhead min-h-(--l-hh,32px) text-[calc(var(--fs-px-m)*var(--tz))] leading-none tracking-[.06em] whitespace-nowrap [&_.lk-cell]:text-[length:inherit]", GRID, layout.className, className)}
      style={layout.style}
      data-kit-item="head"
      data-bar={flag(bar)}
      {...props}
    />
  );
}

export type ListRowProps = {
  /** Ganze Zeile öffnet (Stretched-Link/-Knopf mit Klasse `hit`); Bedienelemente in den Zellen liegen darüber. */
  hit?: Hit;
  /** Name der Trefferfläche, falls `hit.label` fehlt. */
  hitLabel?: string;
  /** Die Zeile ist das aktuelle Element ihrer Liste (`aria-current` an der Trefferfläche, z. B. der geöffnete Beitrag). */
  current?: boolean;
  /** gewählt: globale Auswahl (--sel-bg, --sel-ring). `"bar"`: Kerbe links statt Rahmen (Bibliothek). */
  selected?: boolean | "bar";
  /** ausgeschaltet: Bild gedämpft, Name --fg-2 */
  off?: boolean;
  /** Plattenzeile: erhabene Steinplatte mit Fase statt flacher Zeile. `"row"`: Reihe mit Auswahlpfeil links (Konten, Codes, Anfragen), Titel nimmt den Rest. */
  plate?: boolean | "row";
  /** Karte für den ersten Treffer (Katalog): Platte, mindestens 132 px hoch, Spalten 104 · 1fr · 190; `RowTitle` zeigt Display 28. */
  feature?: boolean;
  /** Kein Hover (Zeile ist nicht anklickbar, z. B. Aufgaben, Hinweise). */
  still?: boolean;
  /** Getönte Hinweiszeile (8 % Tonfarbe auf der Platte, ohne Hover); die Unterzeile von `RowTitle` rückt auf --fg-2. */
  tone?: "run" | "warn" | "bad";
  /** Balken links in der Tonfarbe (nur mit `tone`). */
  bar?: boolean;
  /** Außerhalb des Fensters nicht rendern; die Höhe (--l-h) bleibt reserviert (lange Listen). */
  lazy?: boolean;
  /** Position für die Einblend-Staffel (40 ms je Zeile). */
  index?: number;
  /** Kontextmenü (Rechtsklick). */
  menu?: MenuEntry[];
} & ComponentProps<"div">;

/**
 * Zeile einer List. Hover = Platte --hv-row (kein Unterstrich); Druck auf die Trefferfläche dunkler.
 * Die Zeile ist Gruppe `group/row` (Seiten färben Teile per `group-hover/row:` oder `group-data-[off]/row:`), trägt die Zustände
 * `data-selected` und `data-off` und `data-kit-item="row"` für `useRovingItems`.
 */
export function ListRow({ hit, hitLabel, current, selected, off, plate, feature, still, tone, bar, lazy, index, menu, className, style, children, ...props }: ListRowProps) {
  const { flat, feed } = useContext(ListCtx);
  const plateRow = plate === "row" && !feature;
  const row = (
    <div
      role="listitem"
      className={cn(
        "lk-row group/row min-h-(--l-h,56px) min-w-0 [&>.hit]:absolute [&>.hit]:inset-0 [&>.hit]:z-0 [&>.hit]:block [&[data-hit]>:not(.hit)]:relative [&[data-hit]>:not(.hit)]:z-1",
        GRID,
        flat && "text-[calc(13px*var(--tz))]",
        plateRow ? PLATE_ROW : plate && !feature && "px-3 py-2",
        feature && "mb-2 min-h-33 grid-cols-[104px_minmax(0,1fr)_190px] gap-x-[18px]",
        feed && FEED_ROW,
        lazy && LAZY,
        className,
      )}
      data-kit-item="row"
      data-hit={flag(hit)}
      data-selected={selected === "bar" ? "bar" : flag(selected)}
      data-off={flag(off)}
      data-plate={plateRow ? "row" : flag(plate || feature)}
      data-feature={flag(feature)}
      data-still={flag(still || flat)}
      data-flat={flag(flat)}
      data-tone={tone}
      data-bar={flag(bar)}
      data-rise={flag(index != null)}
      style={index != null ? { ...style, ...cssVars({ "--i": index }) } : style}
      {...props}
    >
      {hit && <HitEl hit={hit} fallbackLabel={hitLabel ?? ""} current={current} />}
      <RowCtx.Provider value={{ hit: !!hit, feature: !!feature, flat, plateRow }}>{children}</RowCtx.Provider>
    </div>
  );
  return menu ? <ContextMenu items={menu}>{row}</ContextMenu> : row;
}

const NAME_SIZE = {
  xs: "text-[calc(13px*var(--tz))]",
  s: "text-[calc(14px*var(--tz))]",
  m: "text-[calc(15px*var(--tz))]",
  l: "text-[calc(16px*var(--tz))]",
  display: "text-hd-card leading-[1.15]",
} as const;
const CLAMP = { 2: "line-clamp-2", 3: "line-clamp-3" } as const;
const WRAP = "whitespace-normal [overflow-wrap:anywhere]";

/**
 * Name (+ Unterzeile) einer Zeile. Abgeschnittener Name zeigt den vollen Text als Tooltip (Wirt: Trefferfläche der Zeile).
 * `size`: xs 13 · s 14 · m 15/700 + 13 (Vorgabe, in einer flachen Liste xs) · l 16/700 · `display` Anzeigeschrift 800 in Kartengröße (Beiträge in
 * einer `List feed`: bricht immer um, Unterzeile --fg-2), `aside` daneben, Beschreibung, `meta`-Zeile; `eyebrow`: Zeile über dem Namen
 * (Datum und Zustand, Mindesthöhe 22, Inhalte an den Rändern). In einer `feature`-Zeile Display 28, Beschreibung zweizeilig.
 * `wrap`: Name, Zusatz, Unterzeile und Meta brechen um statt abzuschneiden (schmale Karten, Fehlermeldungen); `clamp`: Unterzeile
 * höchstens so viele Zeilen (mit `wrap`). In einer Plattenzeile füllt der Titel die Breite. `children`: z. B. Text nur für Vorleser.
 */
export function RowTitle({ title, sub, aside, meta, eyebrow, size, wrap, clamp, trunc = true, id, className, asideClassName, children }: {
  title: string;
  sub?: ReactNode;
  aside?: ReactNode;
  meta?: ReactNode;
  eyebrow?: ReactNode;
  size?: keyof typeof NAME_SIZE;
  wrap?: boolean;
  clamp?: keyof typeof CLAMP;
  /** false: kein eigener Tooltip (die Zeile zeigt schon einen). */
  trunc?: boolean;
  id?: string;
  className?: string;
  /** Klassen für den Zusatz neben dem Namen (z. B. `le-720:hidden`, wenn er schmal entfällt). */
  asideClassName?: string;
  children?: ReactNode;
}) {
  const { hit, feature, flat, plateRow } = useContext(RowCtx);
  const scale = size ?? (flat ? "xs" : "m");
  const large = scale === "l";
  const display = scale === "display" && !feature;
  const look = feature ? "feature" : display ? "display" : large ? "l" : "m";
  const breaks = wrap || display;
  const name = feature
    ? "text-hd-dialog leading-[1.1] font-extrabold tracking-[.01em] uppercase [font-family:var(--f-display)]"
    : NAME_SIZE[scale];
  return (
    <div className={cn("lk-rt flex min-w-0 flex-col", plateRow && "flex-1", feature ? "gap-1.5 leading-[normal]" : display ? "gap-1.5 leading-[1.45]" : large ? "gap-[3px] leading-[normal]" : "leading-tight", className)} data-size={look}>
      {eyebrow != null && <div className="lk-rt-e flex min-h-[22px] flex-wrap items-center justify-between gap-2 text-ctl-s [overflow-wrap:anywhere]">{eyebrow}</div>}
      <div className={cn("flex min-w-0 items-baseline gap-2", breaks && "flex-wrap")}>
        {breaks
          ? <b className={cn("lk-rt-n min-w-0", WRAP, name)} id={id}>{title}</b>
          : trunc
            ? <Trunc as="b" text={title} host={hit ? ".hit" : undefined} className={cn("lk-rt-n", name)} />
            : <b className={cn("lk-rt-n truncate", name)} id={id}>{title}</b>}
        {aside != null && <span className={cn("lk-rt-a flex-none text-ctl-s", breaks ? WRAP : "whitespace-nowrap", asideClassName)}>{aside}</span>}
      </div>
      {sub != null && (look === "m"
        ? <span className={cn("lk-rt-s text-ctl-s", breaks ? [WRAP, clamp && CLAMP[clamp]] : "truncate")}>{sub}</span>
        : <p className={cn("lk-rt-s m-0 text-ctl-s", feature ? "line-clamp-2 max-w-[90ch] text-ctl-m leading-[1.45]" : breaks ? [WRAP, clamp && CLAMP[clamp]] : "truncate")}>{sub}</p>)}
      {meta != null && (
        <div className={cn("lk-rt-m flex min-h-[22px] items-center gap-1.5 overflow-hidden text-ctl-s [&_.lk-chip]:flex-none [&_.lk-count]:text-[calc(var(--fs-px-m)*var(--tz))]", (breaks || plateRow) && "overflow-visible", breaks && ["flex-wrap", WRAP])}>{meta}</div>
      )}
      {children}
    </div>
  );
}

const HIDE: Record<Extract<Breakpoint, 900 | 1040 | 1180>, string> = { 900: "le-900:hidden", 1040: "le-1040:hidden", 1180: "le-1180:hidden" };

/** `align="switch"`: Breite des Schalterkastens, nach rechts gerückt um das reservierte Zustandswort hinter dem Schalter. */
const SWITCH_ALIGN = "ml-auto mr-[calc(var(--sw-gap)+var(--sw-st-w))] w-[calc(var(--lk-box)*2)]";

/**
 * Zelle einer Zeile oder des Kopfs: Text 13 px --fg-2 mit Auslassung. `flex`: Inhalt als Reihe (Chips, Knöpfe, Mindesthöhe 32).
 * `align="end"`: rechtsbündig. `align="switch"`: mittig über dem rechtsbündigen `Switch` der Spalte (Kopf „An“; der Schalter steht
 * vor dem reservierten Zustandswort, das die Zelle ausspart). `hide`: unter dieser Fensterbreite ausgeblendet; die Spalte muss die Liste dann ebenfalls streichen.
 */
export function Cell({ hide, align, flex, className, children, ...props }: { hide?: keyof typeof HIDE; align?: "start" | "end" | "switch"; flex?: boolean } & ComponentProps<"span">) {
  return (
    <span
      className={cn(
        "lk-cell min-w-0 text-ctl-s",
        flex ? "flex min-h-ctl-s items-center gap-1.5" : "block truncate whitespace-nowrap",
        align === "end" && (flex ? "justify-end" : "text-right"),
        align === "switch" && cn(SWITCH_ALIGN, flex ? "justify-center" : "text-center"),
        hide && HIDE[hide],
        className,
      )}
      {...props}
    >
      {children}
    </span>
  );
}
