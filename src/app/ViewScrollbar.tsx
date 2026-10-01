import { useRef, type PointerEvent as RPointerEvent, type RefObject } from "react";
import { useViewObserver } from "./useViewObserver";

/** Die Leiste zeigt sich erst, wenn der Inhalt so viel (px) höher ist als die Ansicht. */
const OVERFLOW_TOLERANCE_PX = 1;
const MIN_THUMB_PX = 40;
/** Ein Klick in die Bahn blättert um diesen Anteil der Ansichtshöhe. */
const PAGE_SCROLL_SHARE = 0.9;
const LEFT_BUTTON = 0;

/** Außer neuen Seiten zählt der Klassenwechsel der Ansicht (`noscroll` nimmt ihr das Scrollen). */
const CLASS_AND_CHILDREN: MutationObserverInit = { childList: true, attributes: true, attributeFilter: ["class"] };

type Drag = { startY: number; startScrollTop: number; scrollPerPixel: number };

/** Daumen in Höhe und Lage an den Stand der Ansicht anpassen; die Bahn erscheint nur, wenn es etwas zu scrollen gibt. */
function placeThumb(view: HTMLElement, track: HTMLElement, thumb: HTMLElement) {
  const { scrollHeight, clientHeight, scrollTop } = view;
  const scrollable = scrollHeight > clientHeight + OVERFLOW_TOLERANCE_PX && getComputedStyle(view).overflowY !== "hidden";
  track.toggleAttribute("data-on", scrollable);
  if (!scrollable) return;
  const height = Math.max(MIN_THUMB_PX, Math.round((clientHeight * clientHeight) / scrollHeight));
  thumb.style.height = `${height}px`;
  thumb.style.transform = `translateY(${Math.round((scrollTop / (scrollHeight - clientHeight)) * (clientHeight - height))}px)`;
}

/**
 * Schmale Pixel-Scrollbar über der Ansicht statt der nativen Spur: nichts wird reserviert,
 * Szenen (Start, Instanzkopf) reichen bis an den Fensterrand. Ziehen und Klick in die Bahn wie gewohnt.
 */
export function ViewScrollbar({ view }: { view: RefObject<HTMLElement | null> }) {
  const track = useRef<HTMLDivElement>(null);
  const thumb = useRef<HTMLDivElement>(null);
  const drag = useRef<Drag | null>(null);

  useViewObserver(
    view,
    (el) => track.current && thumb.current && placeThumb(el, track.current, thumb.current),
    { mutations: CLASS_AND_CHILDREN, scroll: true },
  );

  function onThumbDown(e: RPointerEvent<HTMLDivElement>) {
    const el = view.current;
    if (!el || e.button !== LEFT_BUTTON) return;
    e.preventDefault();
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    const thumbHeight = e.currentTarget.offsetHeight;
    drag.current = {
      startY: e.clientY,
      startScrollTop: el.scrollTop,
      scrollPerPixel: (el.scrollHeight - el.clientHeight) / Math.max(1, el.clientHeight - thumbHeight),
    };
    track.current?.setAttribute("data-drag", "");
  }
  function onThumbMove(e: RPointerEvent<HTMLDivElement>) {
    const d = drag.current;
    if (d && view.current) view.current.scrollTop = d.startScrollTop + (e.clientY - d.startY) * d.scrollPerPixel;
  }
  function onThumbUp() {
    drag.current = null;
    track.current?.removeAttribute("data-drag");
  }
  // Klick in die Bahn blättert eine Seite in Richtung des Klicks.
  function onTrackDown(e: RPointerEvent<HTMLDivElement>) {
    const el = view.current;
    const thumbEl = thumb.current;
    if (!el || !thumbEl || e.button !== LEFT_BUTTON) return;
    const above = e.clientY < thumbEl.getBoundingClientRect().top;
    el.scrollBy({ top: (above ? -1 : 1) * el.clientHeight * PAGE_SCROLL_SHARE });
  }

  return (
    <div ref={track} className="vbar" aria-hidden onPointerDown={onTrackDown}>
      <div
        ref={thumb}
        className="vthumb"
        onPointerDown={onThumbDown}
        onPointerMove={onThumbMove}
        onPointerUp={onThumbUp}
        onPointerCancel={onThumbUp}
      />
    </div>
  );
}
