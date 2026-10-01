import { useEffect, useRef, type RefObject } from "react";
import { dialogOpen } from "./dialogOpen";

/** So lange wartet der Fokus auf die Überschrift einer Seite, die noch lädt. */
const PAGE_FOCUS_WAIT_MS = 3000;

/** Fokus auf die Überschrift der Seite in `main`, außer die Seite oder ein Dialog hat ihn schon; `false`, solange es keine gibt. */
function focusHeading(main: HTMLElement) {
  const heading = main.querySelector<HTMLElement>("h1");
  if (!heading) return false;
  const focused = document.activeElement;
  const pageOwnsFocus = focused instanceof HTMLElement && focused !== main && main.contains(focused);
  if (!pageOwnsFocus && !dialogOpen()) {
    if (!heading.hasAttribute("tabindex")) heading.tabIndex = -1;
    heading.focus({ preventScroll: true });
  }
  return true;
}

/**
 * Nach einem Seitenwechsel (nicht beim ersten Laden) Fokus auf die Seitenüberschrift, damit Tastatur und
 * Screenreader auf der neuen Seite beginnen. Die Seite kann später rendern (Laden), deshalb kurz auf das h1 warten.
 * Hat die Seite selbst schon fokussiert (Suchfeld, Dialog), bleibt es dabei.
 */
export function usePageFocus(pathname: string, view: RefObject<HTMLElement | null>) {
  // Vorige Adresse statt „erster Lauf“: StrictMode führt Effekte beim Laden doppelt aus.
  const previous = useRef(pathname);
  useEffect(() => {
    if (previous.current === pathname) return;
    previous.current = pathname;
    const main = view.current;
    if (!main) return;
    if (focusHeading(main)) return;
    const waiting = new MutationObserver(() => focusHeading(main) && stopWaiting());
    const giveUp = setTimeout(() => stopWaiting(), PAGE_FOCUS_WAIT_MS);
    const stopWaiting = () => {
      waiting.disconnect();
      clearTimeout(giveUp);
    };
    waiting.observe(main, { childList: true, subtree: true });
    return stopWaiting;
  }, [pathname, view]);
}
