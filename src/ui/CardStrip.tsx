import { useLayoutEffect, useRef, useState, type ComponentProps, type RefObject } from "react";
import { cn } from "@/lib/utils";
import { motionOff } from "@/pixel/scene";
import { IconButton } from "./Button";

/** Rundung beim Messen der Scrollposition (px). */
const EDGE_TOLERANCE_PX = 1;

/**
 * Pfeil: mittig im Bildfeld der Karten (nicht über dem Namensschild); die Lage folgt `--strip-media` (Höhe des Bildfelds)
 * und `--strip-pt` (Polster oben). Sichtbar nur, wenn es in die Richtung weitergeht (`data-l`/`data-r` am Wirt).
 */
const ARROW = "absolute z-3 top-[calc(var(--strip-pt)_+_var(--u3)_+_(var(--strip-media)_-_var(--lk-h-m))_/_2)] invisible opacity-0 [transition:opacity_.12s_steps(2,end),visibility_0s_linear_.12s]";
const ARROW_PREV = "left-0 group-data-[l]/strip:visible group-data-[l]/strip:opacity-100 group-data-[l]/strip:[transition:opacity_.12s_steps(2,end),visibility_0s]";
const ARROW_NEXT = "right-0 group-data-[r]/strip:visible group-data-[r]/strip:opacity-100 group-data-[r]/strip:[transition:opacity_.12s_steps(2,end),visibility_0s]";

/** Ob links und rechts der Leiste noch etwas wartet; misst bei jeder Größen- und Scrolländerung (`measure` an `onScroll`). */
function useStripEdges(strip: RefObject<HTMLUListElement | null>, itemCount: number) {
  const [edge, setEdge] = useState({ prev: false, next: false });
  const measure = () => {
    const el = strip.current;
    if (!el) return;
    const prev = el.scrollLeft > EDGE_TOLERANCE_PX;
    const next = el.scrollLeft + el.clientWidth < el.scrollWidth - EDGE_TOLERANCE_PX;
    setEdge((e) => (e.prev === prev && e.next === next ? e : { prev, next }));
  };
  useLayoutEffect(() => {
    measure();
    const el = strip.current;
    if (!el) return;
    const resizes = new ResizeObserver(measure);
    resizes.observe(el);
    return () => resizes.disconnect();
  }, [itemCount]);
  return { edge, measure };
}

/**
 * Waagerecht scrollende Reihe von Karten mit Blätter-Pfeilen darüber (`SceneCard`, `AddCard`; Kinder sind `<li>`).
 * Die Leiste hat keine Scrollleiste und blendet an Rändern, hinter denen noch Karten liegen, aus. Die Pfeile stehen am linken und
 * rechten Rand, mittig im Bildfeld der Karten, und erscheinen nur in Richtungen, in die noch etwas kommt. Sie sind für die Maus
 * (`tabIndex=-1`, `aria-hidden`): per Tastatur scrollt die Leiste mit dem Fokus mit. Ein Klick blättert um ganze Karten (mindestens eine).
 *
 * - `prevLabel`/`nextLabel`: Namen der Pfeile; ohne beide gibt es keine Pfeile (Platzhalter beim Laden).
 * - `itemCount`: Anzahl der Karten, bei Änderung wird neu gemessen.
 * - `listRef`: Zugriff auf die scrollende Liste (etwa um eine Karte ins Bild zu holen).
 * - Bildfeldhöhe der Karten, Maß der Pfeillage: standardmäßig aus `--mini` (Kartenbreite, 256 px); eigene Karten: `className="[--strip-media:120px]"`.
 * - Übrige Eigenschaften (`aria-labelledby` …) gehen an die `<ul>`; `className` an den Wirt.
 */
export function CardStrip({ prevLabel, nextLabel, itemCount = 0, listRef, className, children, onScroll, ...props }: {
  prevLabel?: string;
  nextLabel?: string;
  itemCount?: number;
  listRef?: RefObject<HTMLUListElement | null>;
} & Omit<ComponentProps<"ul">, "className">
  & { className?: string }) {
  const own = useRef<HTMLUListElement>(null);
  const list = listRef ?? own;
  const { edge, measure } = useStripEdges(list, itemCount);

  // Blättert um ganze Karten (Breite plus Lücke der ersten Karte), mindestens eine.
  function page(direction: 1 | -1) {
    const el = list.current;
    const first = el?.firstElementChild;
    if (!el || !(first instanceof HTMLElement)) return;
    const step = first.offsetWidth + (parseFloat(getComputedStyle(el).columnGap) || 0);
    const cards = Math.max(1, Math.floor(el.clientWidth / step) - 1);
    el.scrollBy({ left: direction * cards * step, behavior: motionOff() ? "auto" : "smooth" });
  }

  const arrows = prevLabel !== undefined && nextLabel !== undefined;
  return (
    <div
      className={cn("group/strip relative [--strip-pt:8px] [--strip-media:calc((var(--mini,256px)_-_var(--u3)_*_2)_*_9_/_16)]", className)}
      data-l={edge.prev || undefined}
      data-r={edge.next || undefined}
    >
      <ul
        className="lk-strip -mx-2 flex gap-3.5 overflow-x-auto overflow-y-hidden pt-(--strip-pt) pr-2 pb-2.5 pl-2 [&>li]:flex [&>li]:flex-none"
        ref={list}
        onScroll={(e) => {
          measure();
          onScroll?.(e);
        }}
        {...props}
      >
        {children}
      </ul>
      {arrows && (
        <>
          <IconButton variant="secondary" onScene="strong" icon="chev-left" label={prevLabel} tip={false} className={cn(ARROW, ARROW_PREV)} tabIndex={-1} aria-hidden onClick={() => page(-1)} />
          <IconButton variant="secondary" onScene="strong" icon="chev-right" label={nextLabel} tip={false} className={cn(ARROW, ARROW_NEXT)} tabIndex={-1} aria-hidden onClick={() => page(1)} />
        </>
      )}
    </div>
  );
}
