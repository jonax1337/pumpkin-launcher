import { useImperativeHandle, useRef, type PointerEvent as RPointerEvent, type Ref, type RefObject } from "react";
import { cn } from "@/lib/utils";

/** Die Leiste zeigt sich erst, wenn der Inhalt so viel (px) höher ist als das Ziel. */
const OVERFLOW_TOLERANCE_PX = 1;
const MIN_THUMB_PX = 40;
/** Ein Klick in die Bahn blättert um diesen Anteil der Zielhöhe. */
const PAGE_SCROLL_SHARE = 0.9;
const LEFT_BUTTON = 0;

type Drag = { startY: number; startScrollTop: number; scrollPerPixel: number };

/** Handle der `Scrollbar`: `update()` misst Daumen und Sichtbarkeit neu. */
export type ScrollbarHandle = { update: () => void };

export type ScrollbarProps = {
  /** Das scrollende Element, dessen Stand die Leiste zeigt und das sie bedient. */
  target: RefObject<HTMLElement | null>;
  /** `update()` ruft der Aufrufer, wenn sich Größe, Inhalt oder Scrollstand des Ziels ändern (die Leiste beobachtet nichts selbst). */
  ref?: Ref<ScrollbarHandle>;
  /** Setzt die Bahn: Standard ist die volle Höhe des nächsten positionierten Elternelements am rechten Rand (z. B. `top-(--bar)`). */
  className?: string;
};

/** Daumen in Höhe und Lage an den Stand des Ziels anpassen; die Bahn erscheint nur, wenn es etwas zu scrollen gibt. */
function placeThumb(target: HTMLElement, track: HTMLElement, thumb: HTMLElement) {
  const { scrollHeight, clientHeight, scrollTop } = target;
  const scrollable = scrollHeight > clientHeight + OVERFLOW_TOLERANCE_PX && getComputedStyle(target).overflowY !== "hidden";
  track.toggleAttribute("data-on", scrollable);
  if (!scrollable) return;
  const height = Math.max(MIN_THUMB_PX, Math.round((clientHeight * clientHeight) / scrollHeight));
  thumb.style.height = `${height}px`;
  thumb.style.transform = `translateY(${Math.round((scrollTop / (scrollHeight - clientHeight)) * (clientHeight - height))}px)`;
}

/**
 * Schmale Pixel-Scrollbar (12 px) über einem Element, das ohne eigene Spur scrollt (`scrollbar-width: none`): nichts wird
 * reserviert, Inhalte reichen bis an den Rand. Daumen als Steinplatte mit Fase im Rahmen, Hover und Ziehen heben ihn an, im
 * Windows-Kontrastmodus trägt er `ButtonText`. Ziehen am Daumen und Klick in die Bahn (blättert eine Seite) wie gewohnt.
 * Die Bahn ist `absolute`: als Geschwister des Ziels in einen `relative` Rahmen setzen, Lage über `className`.
 */
export function Scrollbar({ target, ref, className }: ScrollbarProps) {
  const track = useRef<HTMLDivElement>(null);
  const thumb = useRef<HTMLDivElement>(null);
  const drag = useRef<Drag | null>(null);

  useImperativeHandle(ref, () => ({
    update() {
      const el = target.current;
      if (el && track.current && thumb.current) placeThumb(el, track.current, thumb.current);
    },
  }), [target]);

  function onThumbDown(e: RPointerEvent<HTMLDivElement>) {
    const el = target.current;
    if (!el || e.button !== LEFT_BUTTON) return;
    e.preventDefault();
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = {
      startY: e.clientY,
      startScrollTop: el.scrollTop,
      scrollPerPixel: (el.scrollHeight - el.clientHeight) / Math.max(1, el.clientHeight - e.currentTarget.offsetHeight),
    };
    track.current?.setAttribute("data-drag", "");
  }
  function onThumbMove(e: RPointerEvent<HTMLDivElement>) {
    const d = drag.current;
    if (d && target.current) target.current.scrollTop = d.startScrollTop + (e.clientY - d.startY) * d.scrollPerPixel;
  }
  function onThumbUp() {
    drag.current = null;
    track.current?.removeAttribute("data-drag");
  }
  // Klick in die Bahn blättert eine Seite in Richtung des Klicks.
  function onTrackDown(e: RPointerEvent<HTMLDivElement>) {
    const el = target.current;
    const thumbEl = thumb.current;
    if (!el || !thumbEl || e.button !== LEFT_BUTTON) return;
    const above = e.clientY < thumbEl.getBoundingClientRect().top;
    el.scrollBy({ top: (above ? -1 : 1) * el.clientHeight * PAGE_SCROLL_SHARE });
  }

  return (
    <div ref={track} className={cn("lk-scroll invisible absolute top-0 right-0 bottom-0 z-30 w-[12px] data-[on]:visible", className)} aria-hidden onPointerDown={onTrackDown}>
      <div
        ref={thumb}
        className="lk-scrollthumb absolute top-0 right-0 w-[12px] will-change-transform"
        onPointerDown={onThumbDown}
        onPointerMove={onThumbMove}
        onPointerUp={onThumbUp}
        onPointerCancel={onThumbUp}
      />
    </div>
  );
}
