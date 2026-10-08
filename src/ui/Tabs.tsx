import { useCallback, useLayoutEffect, useRef, type ComponentProps, type CSSProperties, type KeyboardEvent, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import { Tip } from "./Tip";
import { Icon } from "./Icon";
import { Count } from "./Chip";
import { cssVars, flag } from "./util";
import type { IconName } from "./types";

// ---------- Roving-Tabindex ----------

/** x = ←/→ (waagerecht), y = ↑/↓ (senkrecht), xy = beide (Radios). */
type RoveAxis = "x" | "y" | "xy";

const ROVE_ITEMS = "[role=tab]:not(:disabled), [role=radio]:not(:disabled)";

/** Fokus in `items` weitersetzen; gibt das neue Element zurück (null: Taste nicht verbraucht oder Fokus blieb). */
function rove(e: KeyboardEvent<HTMLElement>, items: HTMLElement[], axis: RoveAxis) {
  const keys = ["Home", "End", ...(axis !== "y" ? ["ArrowLeft", "ArrowRight"] : []), ...(axis !== "x" ? ["ArrowUp", "ArrowDown"] : [])];
  if (!keys.includes(e.key) || e.altKey || e.ctrlKey || e.metaKey || !items.length) return null;
  const i = items.indexOf(document.activeElement as HTMLElement);
  if (i < 0) return null;
  e.preventDefault();
  const n = items.length;
  const j = e.key === "Home" ? 0 : e.key === "End" ? n - 1 : (i + (e.key === "ArrowRight" || e.key === "ArrowDown" ? 1 : -1) + n) % n;
  items[j].focus();
  return items[j] !== items[i] ? items[j] : null;
}

/**
 * Pfeiltasten, Pos1 und Ende in einer Gruppe (Tabs, Segmente, Radios als Knöpfe): ein Tab-Stopp, Fokus wandert.
 * Gibt den onKeyDown-Handler für den Container zurück. Elemente: role=tab oder role=radio.
 * Die Auswahl folgt dem Fokus (das neue Element wird geklickt). Ein Autofokus im neuen Inhalt (Suchfeld) zieht den Fokus nicht aus der Leiste.
 */
export function useRoving<E extends HTMLElement = HTMLElement>(axis: RoveAxis) {
  return useCallback(
    (e: KeyboardEvent<E>) => {
      if (e.defaultPrevented) return;
      const list = [...e.currentTarget.querySelectorAll<HTMLElement>(ROVE_ITEMS)].filter((el) => el.getClientRects().length > 0);
      const next = rove(e, list, axis);
      if (!next) return;
      next.click();
      requestAnimationFrame(() => next.isConnected && document.activeElement !== next && next.focus({ preventScroll: true }));
    },
    [axis],
  );
}

// ---------- Tabs ----------

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
  /** m: Tab 36 (Leiste 48), Segment 40, senkrecht 44 · s: 32 (40), 32, 36. Icon-Slot m bzw. s. */
  size?: "s" | "m";
  /** Nur Symbole; die Beschriftung bleibt für Vorleser und steht im Tooltip. */
  iconsOnly?: boolean;
  /** Nach jeder Aktivierung (Klick, Pfeiltaste; auch erneut auf den gewählten Tab), mit dem Tab-Element. */
  onActivate?: (v: V, el: HTMLElement) => void;
  className?: string;
  style?: CSSProperties;
};

export type TabsProps<V extends string> = StripProps<V> & {
  /** underline = Leiste mit Linie (Instanz, Einstellungen) · segment = eingelassene Gruppe (Poster/Liste) · vertical = Spalte (Dialog „Neue Instanz“) */
  variant?: "underline" | "segment" | "vertical";
  /** Ids `${idBase}-${value}` und aria-controls auf `${idBase}-panel` (siehe TabPanel). */
  idBase?: string;
  /** Klebt oben (Grund --bg). Text = Abstand oben als CSS-Wert, z. B. "var(--dc)". */
  sticky?: boolean | string;
};

const tabId = (idBase: string, v: string) => `${idBase}-${v}`;
const panelId = (idBase: string) => `${idBase}-panel`;

type DataAttrs = { [name: `data-${string}`]: string | undefined };

type Strip<V extends string> = StripProps<V> & {
  variant: "underline" | "segment" | "vertical";
  axis: RoveAxis;
  /** role, aria-orientation u. ä. des Containers. */
  group: ComponentProps<"div"> & DataAttrs;
  /** role und Auswahlzustand (aria-selected bzw. aria-checked) eines Eintrags. */
  itemProps: (value: V, selected: boolean) => ComponentProps<"button">;
};

/** Gemeinsame Leiste von Tabs (tablist) und Segmented (radiogroup): ein Tab-Stopp, Pfeiltasten, Auswahl folgt dem Fokus. */
function TabStrip<V extends string>({ variant, axis, group, itemProps, items, value, onChange, label, size = "m", iconsOnly, onActivate, className, style }: Strip<V>) {
  const onKeyDown = useRoving<HTMLDivElement>(axis);
  const stripRef = useRef<HTMLDivElement>(null);
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
      className={cn("vx-tabs", variant === "segment" && "vx-pit", className)}
      data-variant={variant}
      data-size={size}
      data-icons={flag(iconsOnly)}
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
            className="vx-tab fx"
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
            <span className="vx-tc">
              {o.icon && <Icon name={o.icon} size="s" />}
              {iconsOnly ? <span className="sr">{o.label}</span> : <span className="vx-tab-l">{o.label}</span>}
              {o.count != null && <Count value={o.count} size={size === "s" ? 16 : 18} />}
              {o.badge != null && <span className="vx-tab-badge">{o.badge}</span>}
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
 * Hover = hellere Fläche, gewählt = höherer Reiter mit Akzentkante (waagerecht), Platte an der rechten Kante (senkrecht) bzw. erhabener Stein (Segment).
 */
export function Tabs<V extends string>({ variant = "underline", idBase, sticky, style, ...strip }: TabsProps<V>) {
  const vertical = variant === "vertical";
  return (
    <TabStrip
      {...strip}
      variant={variant}
      axis={vertical ? "y" : "x"}
      group={{ role: "tablist", "aria-orientation": vertical ? "vertical" : undefined, "data-sticky": flag(sticky) }}
      itemProps={(v, selected) => ({
        role: "tab",
        "aria-selected": selected,
        id: idBase ? tabId(idBase, v) : undefined,
        "aria-controls": idBase ? panelId(idBase) : undefined,
      })}
      style={typeof sticky === "string" ? { ...cssVars({ "--vx-tabs-top": sticky }), ...style } : style}
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

/**
 * Inhalt zu `Tabs` mit gleichem `idBase`: role=tabpanel, beschriftet vom gewählten Tab.
 * display flow-root, damit Außenabstände nicht durchschlagen (kein Springen beim Wechsel).
 */
export function TabPanel({ idBase, value, className, children, ...props }: { idBase: string; value: string } & Omit<ComponentProps<"div">, "id" | "role">) {
  return (
    <div id={panelId(idBase)} role="tabpanel" aria-labelledby={tabId(idBase, value)} className={cn("vx-tabpanel", className)} {...props}>
      {children}
    </div>
  );
}
