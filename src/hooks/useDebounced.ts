import { useEffect, useState } from "react";

/** Wartezeit nach dem letzten Tastendruck, bevor eine Suche startet. */
export const SEARCH_DEBOUNCE_MS = 300;

/** `value`, erst `ms` nach der letzten Änderung (z. B. für Suchfelder). */
export function useDebounced<T>(value: T, ms = SEARCH_DEBOUNCE_MS): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(timer);
  }, [value, ms]);
  return debounced;
}
