import { useEffect, useRef, useState } from "react";
import { useView } from "@/app/Layout";

/** Höhe des kompakten Kopfs (`--dc` in styles/pixelkino.css). */
const COMPACT_HEAD_PX = 64;
/** So weit vor dem kompakten Kopf wechselt der große, damit der Wechsel nicht erst am Rand geschieht. */
const COMPACT_SWITCH_MARGIN_PX = 28;

/** Kopf wird beim Scrollen kompakt (nur Klasse wechseln; der Platz bleibt reserviert). */
export function useCompactHead(ready: boolean) {
  const view = useView();
  const head = useRef<HTMLElement>(null);
  const [compact, setCompact] = useState(false);
  useEffect(() => {
    const el = view.current;
    if (!el || !ready) return;
    let frame = 0;
    const check = () => {
      frame = 0;
      const h = head.current;
      if (h) setCompact(el.scrollTop > h.offsetHeight - COMPACT_HEAD_PX - COMPACT_SWITCH_MARGIN_PX);
    };
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(check);
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    check();
    return () => {
      el.removeEventListener("scroll", onScroll);
      cancelAnimationFrame(frame);
    };
  }, [view, ready]);
  return { head, compact };
}
