import { useEffect, type RefObject } from "react";
import { useLatest } from "@/hooks/useLatest";

/** Beobachtet nur, wenn Kinder kommen oder gehen (Seitenwechsel). */
const CHILD_LIST: MutationObserverInit = { childList: true };

/**
 * Ruft `measure(view)` je Animationsframe, sobald sich Größe oder Inhalt der scrollenden Ansicht ändern: Größe der Ansicht
 * und ihrer Kinder (ein Seitenwechsel meldet das neue Kind neu an), dazu die Änderungen nach `mutations`;
 * mit `scroll` auch beim Scrollen. `active = false` beobachtet nichts.
 */
export function useViewObserver(
  view: RefObject<HTMLElement | null>,
  measure: (view: HTMLElement) => void,
  { active = true, mutations = CHILD_LIST, scroll = false }: { active?: boolean; mutations?: MutationObserverInit; scroll?: boolean } = {},
) {
  const latestMeasure = useLatest(measure);
  useEffect(() => {
    const el = view.current;
    if (!active || !el) return;
    let frame = 0;
    const run = () => {
      frame = 0;
      latestMeasure.current(el);
    };
    const schedule = () => void (frame ||= requestAnimationFrame(run));
    const resizes = new ResizeObserver(schedule);
    const watch = () => {
      resizes.disconnect();
      resizes.observe(el);
      for (const child of el.children) resizes.observe(child);
      schedule();
    };
    const changes = new MutationObserver(watch);
    changes.observe(el, mutations);
    if (scroll) el.addEventListener("scroll", schedule, { passive: true });
    watch();
    return () => {
      cancelAnimationFrame(frame);
      resizes.disconnect();
      changes.disconnect();
      el.removeEventListener("scroll", schedule);
    };
  }, [view, active, mutations, scroll, latestMeasure]);
}
