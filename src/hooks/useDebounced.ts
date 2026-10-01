import { useEffect, useState } from "react";

/** `value`, erst `ms` nach der letzten Änderung (z. B. für Suchfelder). */
export function useDebounced<T>(value: T, ms: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return debounced;
}
