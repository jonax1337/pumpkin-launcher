import { useEffect, useRef, useState } from "react";
import { ANNOUNCE_DEBOUNCE_MS } from "./useDebounced";

/**
 * Text für eine Statusregion nur für Screenreader. Ändert sich `key` (z. B. Suche und Filter), wird `message` erst nach
 * einer Pause angesagt, damit nicht jeder Tastendruck vorgelesen wird. `say` setzt einen Text sofort.
 */
export function useAnnouncement(key: string, message: string) {
  const [said, say] = useState("");
  const lastKey = useRef(key);
  useEffect(() => {
    if (key === lastKey.current) return;
    const timer = setTimeout(() => {
      lastKey.current = key;
      say(message);
    }, ANNOUNCE_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [key, message]);
  return [said, say] as const;
}
