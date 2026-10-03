import { useEffect, useRef, useState } from "react";
import { useRetryFriendsNow } from "@/hooks/useFriends";

/** So lange bleibt „Jetzt zustellen“ nach einem Druck gesperrt. */
export const RETRY_COOLDOWN_MS = 10_000;

/**
 * Stellt wartende Anfragen sofort zu: einmal beim Öffnen der Seite (das Backend wählt selbst, was fällig ist) und bei jedem
 * Druck auf „Jetzt zustellen“, danach ist der Knopf kurz gesperrt. Was die Zustellung ändert, meldet `friends-changed`.
 */
export function useRetryDeliveries() {
  const { mutate } = useRetryFriendsNow();
  const [cooling, setCooling] = useState(false);
  const opened = useRef(false);
  const cooldown = useRef<number>(undefined);

  useEffect(() => {
    // StrictMode hängt die Seite im Dev-Server zweimal ein; geöffnet wird sie nur einmal.
    if (!opened.current) {
      opened.current = true;
      mutate();
    }
    return () => clearTimeout(cooldown.current);
  }, [mutate]);

  function retryNow() {
    mutate();
    setCooling(true);
    clearTimeout(cooldown.current);
    cooldown.current = window.setTimeout(() => setCooling(false), RETRY_COOLDOWN_MS);
  }
  return { retryNow, cooling };
}
