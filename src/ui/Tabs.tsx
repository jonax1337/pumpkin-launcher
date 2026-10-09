import { useLayoutEffect, useRef, type ComponentProps, type CSSProperties, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import { Icon } from "./Icon";
import { Tip } from "./Tooltip";
import { useRoving } from "./roving";
import type { IconName } from "./types";
import { cssVars, flag } from "./util";
import { Count } from "./Chip";

export type TabItem<V extends string> = {
  value: V;
  label: ReactNode;
  icon?: IconName;
  /** Zahl nach der Beschriftung (Pixelschrift, gedämpft). */
  count?: number;
  /** Zusatz nach der Zahl (z. B. Warnsymbol mit Tooltip); Platz selbst reservieren, wenn er wechselt. */
  badge?: ReactNode;
  /** Tooltip; bei `iconsOnly` Standard = label (wenn Text). */
  tip?: string;
  disabled?: boolean;
};

type StripProps<V extends string> = {
  items: TabItem<V>[];
  value: V;
  onChange: (v: V) => void;
  /** Zugänglicher Name der Gruppe. */
  label: string;
  /** m: Reiter 36 (Leiste 42), Segment 40, senkrecht 44 · s: 32 (38), 32, 36. */
  size?: "s" | "m";
  /** Nur Symbole; die Beschriftung bleibt für Vorleser und steht im Tooltip. */
  iconsOnly?: boolean;
  /** Nach jeder Aktivierung (Klick, Pfeiltaste; auch erneut auf den gewählten Tab), mit dem Tab-Element. */
  onActivate?: (v: V, el: HTMLElement) => void;
  className?: string;
  style?: CSSProperties;
};

export type TabsProps<V extends string> = StripProps<V> & {
  /** underline = Leiste mit Linie · segment = eingelassene Gruppe · vertical = Spalte */
  variant?: "underline" | "segment" | "vertical";
  /** Ids `${idBase}-${value}` und aria-controls auf `${idBase}-panel` (siehe TabPanel). */
  idBase?: string;
  /** Klebt oben (Grund --bg). Text = Abstand oben als CSS-Wert, z. B. "var(--dc)". */
  sticky?: boolean | string;
  /** Nur `underline`: Seitenränder der Leiste wie der Seitenkopf (`--gut`); die Grundlinie läuft nur zwischen ihnen (Instanzseite). */
  gutter?: boolean;
};

type Variant = NonNullable<TabsProps<string>["variant"]>;
type Size = NonNullable<StripProps<string>["size"]>;

/* ---------- Layout (Tailwind) ----------
   Das Maß steckt in drei Variablen der Leiste: --t-pad (Innenabstand), --t-gap (Abstand im Reiter), --t-fs (Schrift). */
/** `gutter`: Seitenrand `--t-px` = `--gut`; die Grundlinie (Hintergrund) läuft nur im Inhaltsbereich zwischen den Rändern. */
const GUTTER = "[--t-px:var(--gut)] [background-clip:content-box] [background-origin:content-box]";
const STRIP: Record<Variant, Record<Size, string>> = {
  // Seitenrand der Leiste per `--t-px` (Standard 2 Einheiten): Seitenkopf und Instanzseite setzen ihn, ein `px-*` am Aufrufer würde mit dem Kit-Utility um die Reihenfolge streiten.
  underline: {
    m: "flex min-h-(--t-full) flex-wrap items-end gap-u1 px-(--t-px,var(--u2)) [--t-full:42px]",
    s: "flex min-h-(--t-full) flex-wrap items-end gap-u1 px-(--t-px,var(--u2)) [--t-full:38px]",
  },
  vertical: { m: "flex flex-col gap-u1", s: "flex flex-col gap-u1" },
  segment: {
    m: "lk-pit inline-flex h-[var(--lk-h-m)] w-fit max-w-full flex-none gap-u1 overflow-x-auto p-u1 [scrollbar-width:none]",
    s: "lk-pit inline-flex h-[var(--lk-h-s)] w-fit max-w-full flex-none gap-u1 overflow-x-auto p-0 [scrollbar-width:none]",
  },
};
const TEXT: Record<Size, string> = { m: "[--t-gap:10px] [--t-fs:14px]", s: "[--t-gap:6px] [--t-fs:13px]" };
const PAD = {
  tab: { m: "[--t-pad:18px]", s: "[--t-pad:14px]" },
  segment: { m: "[--t-pad:14px]", s: "[--t-pad:10px]" },
  icon: "[--t-pad:8px]",
  segmentIcon: "[--t-pad:0px]",
};
const padClass = (variant: Variant, size: Size, iconsOnly?: boolean) =>
  iconsOnly ? (variant === "segment" ? PAD.segmentIcon : PAD.icon) : variant === "segment" ? PAD.segment[size] : PAD.tab[size];

const TAB = "lk-tab relative inline-flex shrink-0 items-center justify-center whitespace-nowrap px-(--t-pad) data-[lead]:pl-[calc(var(--t-pad)_-_2px)] [font-size:calc(var(--t-fs)*var(--tz))]";
/** Der gewählte Reiter der Leiste ist 2 Einheiten höher und sitzt auf der Linie; die anderen 1 Einheit darüber. */
const TAB_BY_VARIANT: Record<Variant, Record<Size, string>> = {
  underline: {
    m: "mb-u1 h-[calc(var(--t-full)_-_var(--u2))] aria-selected:mb-0 aria-selected:h-(--t-full)",
    s: "mb-u1 h-[calc(var(--t-full)_-_var(--u2))] aria-selected:mb-0 aria-selected:h-(--t-full)",
  },
  vertical: {
    m: "mr-u1 h-11 justify-start text-left aria-selected:mr-0",
    s: "mr-u1 h-9 justify-start text-left aria-selected:mr-0",
  },
  segment: { m: "h-full pb-u2", s: "h-full pb-u2" },
};
const ICON_WIDTH: Record<Size, string> = { m: "w-9", s: "w-7" };

const tabId = (idBase: string, v: string) => `${idBase}-${v}`;
const panelId = (idBase: string) => `${idBase}-panel`;

type DataAttrs = { [name: `data-${string}`]: string | undefined };
type Strip<V extends string> = StripProps<V> & {
  variant: Variant;
  axis: "x" | "y" | "xy";
  /** role, aria-orientation u. ä. des Containers. */
  group: ComponentProps<"div"> & DataAttrs;
  /** role und Auswahlzustand (aria-selected bzw. aria-checked) eines Eintrags. */
  itemProps: (value: V, selected: boolean) => ComponentProps<"button">;
};

/** Gemeinsame Leiste von Tabs (tablist) und Segmented (radiogroup): ein Tab-Stopp, Pfeiltasten, Auswahl folgt dem Fokus. */
function TabStrip<V extends string>({ variant, axis, group, itemProps, items, value, onChange, label, size = "m", iconsOnly, onActivate, className, style }: Strip<V>) {
  const onKeyDown = useRoving<HTMLDivElement>(axis);
  const stripRef = useRef<HTMLDivElement>(null);
  // Segment: der gewählte Eintrag bleibt sichtbar, wenn die Gruppe schmaler als ihr Inhalt wird
  useLayoutEffect(() => {
    const strip = stripRef.current;
    if (!strip || variant !== "segment") return;
    const revealSelection = () => {
      const selected = strip.querySelector<HTMLElement>('[aria-selected="true"], [aria-checked="true"]');
      if (!selected || !strip.clientWidth) return;
      const viewport = strip.getBoundingClientRect();
      const item = selected.getBoundingClientRect();
      const inset = parseFloat(getComputedStyle(strip).paddingLeft);
      const left = item.left - viewport.left - inset;
      const right = item.right - viewport.right + inset;
      if (left < 0) strip.scrollLeft += left;
      else if (right > 0) strip.scrollLeft += right;
    };
    revealSelection();
    const observer = new ResizeObserver(revealSelection);
    observer.observe(strip);
    return () => observer.disconnect();
  }, [value, variant]);
  // Tab-Stopp: der gewählte Eintrag, sonst der erste freie
  const stop = items.some((o) => o.value === value && !o.disabled) ? value : items.find((o) => !o.disabled)?.value;
  return (
    <div
      ref={stripRef}
      className={cn("lk-tabs", STRIP[variant][size], TEXT[size], padClass(variant, size, iconsOnly), group["data-sticky"] != null && "sticky top-(--lk-tabs-top,0) z-6", className)}
      data-variant={variant}
      data-size={size}
      aria-label={label}
      onKeyDown={onKeyDown}
      style={style}
      {...group}
    >
      {items.map((o) => {
        const on = o.value === value;
        const btn = (
          <button
            key={o.value}
            type="button"
            className={cn(TAB, TAB_BY_VARIANT[variant][size], iconsOnly && variant === "segment" && ICON_WIDTH[size])}
            data-v={o.value}
            data-lead={flag(o.icon && !iconsOnly)}
            tabIndex={o.value === stop ? 0 : -1}
            disabled={o.disabled}
            onClick={(e) => {
              if (!on) onChange(o.value);
              onActivate?.(o.value, e.currentTarget);
            }}
            {...itemProps(o.value, on)}
          >
            <span className="lk-tc relative inline-flex min-w-0 items-center gap-(--t-gap)">
              {o.icon && <Icon name={o.icon} size="s" />}
              {iconsOnly ? <span className="sr-only">{o.label}</span> : <span className="lk-tab-l">{o.label}</span>}
              {o.count != null && <Count value={o.count} size={size === "s" ? 16 : 18} className={variant === "segment" ? "min-w-0" : "min-w-[1.4em] text-center"} />}
              {o.badge != null && <span className="inline-flex items-center">{o.badge}</span>}
            </span>
          </button>
        );
        const tip = o.tip ?? (iconsOnly && typeof o.label === "string" ? o.label : undefined);
        return tip ? <Tip key={o.value} label={tip}>{btn}</Tip> : btn;
      })}
    </div>
  );
}

/**
 * Tab-Leiste (role=tablist; der Inhalt wechselt). Ein Tab-Stopp (Roving), Pfeile (senkrecht ↑/↓), Pos1/Ende; Auswahl folgt dem Fokus.
 * Layout per Tailwind: `className` an der Leiste, z. B. `max-w-md` oder `flex-nowrap`.
 */
export function Tabs<V extends string>({ variant = "underline", idBase, sticky, gutter, className, style, ...strip }: TabsProps<V>) {
  const vertical = variant === "vertical";
  return (
    <TabStrip
      {...strip}
      variant={variant}
      className={cn(gutter && GUTTER, className)}
      axis={vertical ? "y" : "x"}
      group={{ role: "tablist", "aria-orientation": vertical ? "vertical" : undefined, "data-sticky": flag(sticky) }}
      itemProps={(v, selected) => ({
        role: "tab",
        "aria-selected": selected,
        id: idBase ? tabId(idBase, v) : undefined,
        "aria-controls": idBase ? panelId(idBase) : undefined,
      })}
      style={typeof sticky === "string" ? { ...cssVars({ "--lk-tabs-top": sticky }), ...style } : style}
    />
  );
}

/** Segment-Umschalter für einen Wert (Poster/Liste, Pixelgröße …): Tabs-Optik als role=radiogroup, Pfeile in beide Achsen. */
export function Segmented<V extends string>(props: StripProps<V>) {
  return (
    <TabStrip
      {...props}
      variant="segment"
      axis="xy"
      group={{ role: "radiogroup" }}
      itemProps={(_, selected) => ({ role: "radio", "aria-checked": selected })}
    />
  );
}

/** Platzhalter der Tab-Leiste (Unterstrich) beim Laden: nur die Grundlinie in der Höhe der echten Leiste (42), damit die Seite nicht springt. */
export function TabsSkel({ className }: { className?: string }) {
  return <div className={cn("lk-tabs min-h-[42px]", className)} data-variant="underline" aria-hidden />;
}

/** Inhalt zu `Tabs` mit gleichem `idBase`: role=tabpanel, beschriftet vom gewählten Tab. */
export function TabPanel({ idBase, value, className, children, ...props }: { idBase: string; value: string } & Omit<ComponentProps<"div">, "id" | "role">) {
  return (
    <div id={panelId(idBase)} role="tabpanel" aria-labelledby={tabId(idBase, value)} className={cn("lk-tabpanel flow-root", className)} {...props}>
      {children}
    </div>
  );
}
