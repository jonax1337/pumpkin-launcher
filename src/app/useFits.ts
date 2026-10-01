import { useState, type RefObject } from "react";
import { useViewObserver } from "./useViewObserver";

/** So viel (px) darf der Inhalt überstehen, ohne dass die Ansicht als zu klein gilt (Rundung bei Zoom). */
const FIT_TOLERANCE_PX = 1;

/**
 * Start scrollt nicht, solange die Seite in die Ansicht passt (Szene bis an den Rand). Passt sie nicht
 * (Zoom, kleines Fenster), wird sie normal scrollbar statt abgeschnitten. Beobachtet Ansicht und Inhalt.
 */
export function useFits(view: RefObject<HTMLElement | null>, active: boolean) {
  const [fits, setFits] = useState(true);
  useViewObserver(view, (el) => setFits(el.scrollHeight <= el.clientHeight + FIT_TOLERANCE_PX), { active });
  return active && fits;
}
