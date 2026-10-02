import { useCallback } from "react";
import { useLatest } from "./useLatest";

/**
 * Eine Funktion mit fester Identität, die beim Aufruf immer die aktuelle Fassung ausführt. Für Zeilen langer Listen, die
 * nur neu rendern, wenn sich ihre Daten ändern: ihre Handler dürfen trotzdem nie einen alten Stand der Seite sehen.
 */
export function useStableFn<A extends unknown[], R>(fn: (...args: A) => R): (...args: A) => R {
  const latest = useLatest(fn);
  return useCallback((...args: A) => latest.current(...args), [latest]);
}
