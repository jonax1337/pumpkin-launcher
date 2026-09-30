import { useCallback, useRef, type ComponentProps, type CSSProperties, type KeyboardEvent, type ReactNode } from "react";
import { Link, useLocation } from "react-router";
import { cn } from "@/lib/utils";
import { Tip } from "./Overlay";
import { Icon } from "./Icon";
import { Count } from "./Chip";
import type { IconName } from "./types";

// ---------- Roving-Tabindex ----------

/** x = ←/→ (waagerecht), y = ↑/↓ (senkrecht), xy = beide (Radios). */
export type RoveAxis = "x" | "y" | "xy";

const ROVE_ITEMS = "[role=tab]:not(:disabled), [role=radio]:not(:disabled), [data-rove]:not(:disabled)";

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
 * Gibt den onKeyDown-Handler für den Container zurück. Elemente: role=tab/radio oder [data-rove] (Selektor `items`).
 * `follow` (Standard): Auswahl folgt dem Fokus (klickt das neue Element); sonst wandert nur der Tab-Stopp.
 * Ein Autofokus im neuen Inhalt (Suchfeld) zieht den Fokus nicht aus der Leiste.
 */
export function useRoving<E extends HTMLElement = HTMLElement>(axis: RoveAxis, { items = ROVE_ITEMS, follow = true, onMove }: { items?: string; follow?: boolean; onMove?: (el: HTMLElement) => void } = {}) {
  const move = useRef(onMove);
  move.current = onMove;
  return useCallback(
    (e: KeyboardEvent<E>) => {
      if (e.defaultPrevented) return;
      const root = e.currentTarget;
      const list = [...root.querySelectorAll<HTMLElement>(items)].filter((el) => el.getClientRects().length > 0);
      const next = rove(e, list, axis);
      if (!next) return;
      if (follow) next.click();
      else list.forEach((el) => (el.tabIndex = el === next ? 0 : -1));
      move.current?.(next);
      requestAnimationFrame(() => next.isConnected && document.activeElement !== next && next.focus({ preventScroll: true }));
    },
    [axis, items, follow],
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

export type TabsProps<V extends string> = {
  /** underline = Leiste mit Linie (Instanz, Einstellungen) · segment = eingelassene Gruppe (Poster/Liste) · vertical = Spalte (Dialog „Neue Instanz“) */
  variant?: "underline" | "segment" | "vertical";
  items: TabItem<V>[];
  value: V;
  onChange: (v: V) => void;
  /** Zugänglicher Name der Gruppe. */
  label: string;
  /** m: Tab 36 (Leiste 48), Segment 40, senkrecht 44 · s: 32 (40), 32, 36. Icon-Slot m bzw. s. */
  size?: "s" | "m";
  /** tablist (Standard; Inhalt wechselt) oder radiogroup (Wert wählen, z. B. Ansicht, Pixelgröße). */
  role?: "tablist" | "radiogroup";
  /** Nur tablist: ids `${idBase}-${value}` und aria-controls auf `${idBase}-panel` (siehe TabPanel). */
  idBase?: string;
  /** Nur Symbole; die Beschriftung bleibt für Vorleser und steht im Tooltip. */
  iconsOnly?: boolean;
  /** Klebt oben (Grund --bg). Text = Abstand oben als CSS-Wert, z. B. "var(--dc)". */
  sticky?: boolean | string;
  /** Nach jeder Aktivierung (Klick, Pfeiltaste; auch erneut auf den gewählten Tab), mit dem Tab-Element. */
  onActivate?: (v: V, el: HTMLElement) => void;
  className?: string;
  style?: CSSProperties;
};

export const tabId = (idBase: string, v: string) => `${idBase}-${v}`;
export const panelId = (idBase: string) => `${idBase}-panel`;

/**
 * Tab-Leiste / Segment-Umschalter. Ein Tab-Stopp (Roving), Pfeile (senkrecht ↑/↓, Radios beide), Pos1/Ende; Auswahl folgt dem Fokus.
 * Hover = Fläche (--hv-ctl), gewählt = erhabene Platte + Strich (Leiste unten, senkrecht links, Segment Kupferkante).
 */
export function Tabs<V extends string>({ variant = "underline", items, value, onChange, label, size = "m", role = "tablist", idBase, iconsOnly, sticky, onActivate, className, style }: TabsProps<V>) {
  const tabs = role === "tablist";
  const onKeyDown = useRoving<HTMLDivElement>(!tabs ? "xy" : variant === "vertical" ? "y" : "x");
  // Tab-Stopp: der gewählte Eintrag, sonst der erste freie
  const stop = items.some((o) => o.value === value && !o.disabled) ? value : items.find((o) => !o.disabled)?.value;
  const top = typeof sticky === "string" ? ({ "--vx-tabs-top": sticky } as CSSProperties) : undefined;
  return (
    <div
      className={cn("vx-tabs", className)}
      data-variant={variant}
      data-size={size}
      data-icons={iconsOnly ? "" : undefined}
      data-sticky={sticky ? "" : undefined}
      role={role}
      aria-label={label}
      aria-orientation={tabs && variant === "vertical" ? "vertical" : undefined}
      onKeyDown={onKeyDown}
      style={top || style ? { ...top, ...style } : undefined}
    >
      {items.map((o) => {
        const on = o.value === value;
        const btn = (
          <button
            key={o.value}
            type="button"
            className="vx-tab fx"
            data-v={o.value}
            data-lead={o.icon && !iconsOnly ? "" : undefined}
            role={tabs ? "tab" : "radio"}
            id={tabs && idBase ? tabId(idBase, o.value) : undefined}
            aria-controls={tabs && idBase ? panelId(idBase) : undefined}
            aria-selected={tabs ? on : undefined}
            aria-checked={tabs ? undefined : on}
            tabIndex={o.value === stop ? 0 : -1}
            disabled={o.disabled}
            onClick={(e) => {
              if (!on) onChange(o.value);
              onActivate?.(o.value, e.currentTarget);
            }}
          >
            <span className="vx-tc">
              {o.icon && <Icon name={o.icon} size={size} />}
              {iconsOnly ? <span className="sr">{o.label}</span> : o.label}
              {o.count != null && <Count value={o.count} size={size === "s" ? 16 : 18} />}
              {o.badge != null && <span className="vx-tab-badge">{o.badge}</span>}
            </span>
            {variant !== "segment" && <i className="vx-tab-tick" aria-hidden />}
          </button>
        );
        const tip = o.tip ?? (iconsOnly && typeof o.label === "string" ? o.label : undefined);
        return tip ? <Tip key={o.value} label={tip}>{btn}</Tip> : btn;
      })}
    </div>
  );
}

/**
 * Inhalt zu `Tabs` mit gleichem `idBase`: role=tabpanel, beschriftet vom gewählten Tab.
 * `flowRoot` (Standard): display flow-root, damit Außenabstände nicht durchschlagen (kein Springen beim Wechsel).
 */
export function TabPanel({ idBase, value, flowRoot = true, className, children, ...props }: { idBase: string; value: string; flowRoot?: boolean } & Omit<ComponentProps<"div">, "id" | "role">) {
  return (
    <div id={panelId(idBase)} role="tabpanel" aria-labelledby={tabId(idBase, value)} className={cn("vx-tabpanel", className)} data-flow={flowRoot ? "" : undefined} {...props}>
      {children}
    </div>
  );
}

// ---------- Navigation ----------

export type NavTab = {
  to: string;
  label: ReactNode;
  /** Ist dieser Bereich gerade offen? (Pfad → ja/nein) */
  match: (pathname: string) => boolean;
  /** Tastenkürzel für Vorleser, z. B. "Control+1" (die Taste selbst bindet der Aufrufer). */
  shortcut?: string;
};

/**
 * Hauptbereiche als normale Links (Seiten, keine Tabs): gleiche Optik wie Tabs, aktueller Bereich mit aria-current="page".
 */
export function NavTabs({ items, label = "Hauptbereiche", className }: { items: NavTab[]; label?: string; className?: string }) {
  const { pathname } = useLocation();
  return (
    <nav className={cn("vx-navtabs", className)} aria-label={label}>
      {items.map((t) => (
        <Link key={t.to} to={t.to} className="vx-tab fx" data-size="m" aria-current={t.match(pathname) ? "page" : undefined} aria-keyshortcuts={t.shortcut}>
          <span className="vx-tc">{t.label}</span>
          <i className="vx-tab-tick" aria-hidden />
        </Link>
      ))}
    </nav>
  );
}
