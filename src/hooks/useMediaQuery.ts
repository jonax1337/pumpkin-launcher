import { useCallback, useSyncExternalStore } from "react";

const REDUCED_MOTION = "(prefers-reduced-motion: reduce)";

/** Trifft die Media Query gerade zu? Folgt Änderungen (Fenstergröße, Systemeinstellung) sofort. */
export function useMediaQuery(query: string): boolean {
  const subscribe = useCallback(
    (onChange: () => void) => {
      const list = matchMedia(query);
      list.addEventListener("change", onChange);
      return () => list.removeEventListener("change", onChange);
    },
    [query],
  );
  return useSyncExternalStore(subscribe, () => matchMedia(query).matches);
}

/** Wünscht das System weniger Bewegung? Einmalige Abfrage für Code außerhalb von React; in Komponenten `useReducedMotion`. */
export const prefersReducedMotion = () => matchMedia(REDUCED_MOTION).matches;

/** Wünscht das System weniger Bewegung? Folgt der Systemeinstellung live. */
export const useReducedMotion = () => useMediaQuery(REDUCED_MOTION);
