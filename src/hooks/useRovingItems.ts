import { useCallback, useEffect, useRef, type FocusEvent, type KeyboardEvent } from "react";

/** Alles, was per Tab erreichbar sein kann (auch mit bereits gesetztem tabindex). */
const TAB_STOPS = "a[href], button, input, select, textarea, [tabindex]";
/** Merkt das ursprüngliche tabindex eines Elements, solange es aus der Tab-Reihenfolge genommen ist ("" = keines). */
const SAVED_TABINDEX = "roveTabindex";

const ARROWS = ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"];

type Direction = "up" | "down" | "left" | "right";
const DIRECTION: Record<string, Direction> = { ArrowUp: "up", ArrowDown: "down", ArrowLeft: "left", ArrowRight: "right" };

const center = (rect: DOMRect) => ({ x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 });

function setTabStop(el: HTMLElement, reachable: boolean) {
  const saved = el.dataset[SAVED_TABINDEX];
  if (reachable && saved !== undefined) {
    if (saved === "") el.removeAttribute("tabindex");
    else el.setAttribute("tabindex", saved);
    delete el.dataset[SAVED_TABINDEX];
  } else if (!reachable && saved === undefined) {
    el.dataset[SAVED_TABINDEX] = el.getAttribute("tabindex") ?? "";
    el.tabIndex = -1;
  }
}

/** Nächstes Element in Pfeilrichtung nach Lage auf dem Bildschirm (Raster und Liste; Zeile bzw. Spalte zuerst, dann der Abstand). */
function neighbour(from: HTMLElement, items: HTMLElement[], direction: Direction) {
  const origin = center(from.getBoundingClientRect());
  const horizontal = direction === "left" || direction === "right";
  const sign = direction === "right" || direction === "down" ? 1 : -1;
  let best: { item: HTMLElement; rank: number } | null = null;
  for (const item of items) {
    if (item === from) continue;
    const rect = item.getBoundingClientRect();
    const c = center(rect);
    const along = (horizontal ? c.x - origin.x : c.y - origin.y) * sign;
    const across = Math.abs(horizontal ? c.y - origin.y : c.x - origin.x);
    const sameLine = across < (horizontal ? rect.height : rect.width) / 2;
    if (along <= 0 || (horizontal && !sameLine)) continue;
    const rank = along * 1000 + across;
    if (!best || rank < best.rank) best = { item, rank };
  }
  return best?.item ?? null;
}

type Options = {
  /** CSS-Selektor der Elemente (Karte, Zeile) innerhalb des Containers. */
  item: string;
  /** CSS-Selektor des Elements, das im Element den Fokus der Pfeiltasten trägt (Trefferfläche); Standard `.hit`. */
  primary?: string;
};

/**
 * Roving-Tabindex für Raster und Listen: ein Tab-Stopp für die ganze Sammlung statt zwei bis fünf je Karte oder Zeile.
 * Pfeiltasten springen nach Lage zum Nachbarn (Raster: auch hoch und runter, Liste: hoch und runter), Pos1/Ende zum ersten
 * und letzten Element. Das Element mit dem Fokus (zunächst das erste) behält alle seine Bedienelemente in der Tab-Reihenfolge;
 * die Bedienelemente der übrigen Elemente sind nur noch per Pfeiltaste erreichbar (tabindex -1).
 *
 * Verwendung: `const roving = useRovingItems<HTMLDivElement>({ item: "[data-kit-item=card]" })`, dann `<div {...roving}>` um das Raster
 * bzw. die Liste. Die Kit-Bausteine kennzeichnen sich dafür selbst: `data-kit-item="row"` (ListRow), `"card"` (SceneCard, ThumbCard),
 * `"pick"` (PickCard); eigene Selektoren auf `lk-*`-Klassen gibt es nicht. Keine Änderung an den Elementen selbst nötig; Pfeiltasten
 * in Feldern und Menüs bleiben unberührt, weil nur die Taste auf dem Element `primary` zählt.
 */
export function useRovingItems<E extends HTMLElement>({ item, primary = ".hit" }: Options) {
  const ref = useRef<E>(null);
  const active = useRef<HTMLElement | null>(null);

  const itemsOf = useCallback(
    () => [...(ref.current?.querySelectorAll<HTMLElement>(item) ?? [])].filter((el) => el.getClientRects().length > 0),
    [item],
  );
  const primaryOf = useCallback((el: HTMLElement) => (el.matches(primary) ? el : el.querySelector<HTMLElement>(primary)), [primary]);

  const syncTabStops = useCallback(() => {
    const items = itemsOf();
    if (!active.current?.isConnected || !items.includes(active.current)) active.current = items[0] ?? null;
    for (const el of items) {
      const reachable = el === active.current;
      el.querySelectorAll<HTMLElement>(TAB_STOPS).forEach((stop) => setTabStop(stop, reachable));
      if (el.matches(TAB_STOPS)) setTabStop(el, reachable);
    }
  }, [itemsOf]);

  // Die Sammlung ändert sich (Filter, Nachladen, Sortierung): Tab-Stopps neu verteilen.
  useEffect(() => {
    const container = ref.current;
    if (!container) return;
    let frame = 0;
    const schedule = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(syncTabStops);
    };
    schedule();
    const observer = new MutationObserver(schedule);
    observer.observe(container, { childList: true, subtree: true });
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, [syncTabStops]);

  const onFocus = useCallback(
    (e: FocusEvent<E>) => {
      const focused = (e.target as HTMLElement).closest<HTMLElement>(item);
      if (!focused || focused === active.current) return;
      active.current = focused;
      syncTabStops();
    },
    [item, syncTabStops],
  );

  const onKeyDown = useCallback(
    (e: KeyboardEvent<E>) => {
      const isArrow = ARROWS.includes(e.key);
      if (e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey || e.shiftKey || !(isArrow || e.key === "Home" || e.key === "End")) return;
      const from = (e.target as HTMLElement).closest<HTMLElement>(item);
      if (!from || primaryOf(from) !== e.target) return;
      const items = itemsOf();
      const next = isArrow ? neighbour(from, items, DIRECTION[e.key]) : items[e.key === "Home" ? 0 : items.length - 1];
      if (!next) return;
      e.preventDefault();
      primaryOf(next)?.focus();
    },
    [item, itemsOf, primaryOf],
  );

  return { ref, onKeyDown, onFocus };
}
