import { useEffect, useRef, useState, type MouseEvent } from "react";
import { acceptsActivation, changeAttention, isArmed, lockedForMs, openGuard, type Activation, type ConsentGuard } from "./consentGuardModel";

/** Das Fenster wird gerade bedient: es hat den Fokus und ist sichtbar. */
const windowAttended = () => document.hasFocus() && document.visibilityState === "visible";

/**
 * Schutz vor Fehlklicks für die Rückfrage der Mod (INGAME 5.5): `armed` wird erst eine Sekunde nach dem Erscheinen des Dialogs bei
 * Fokus und sichtbarem Fenster wahr und fällt bei jedem Wechsel von Fokus oder Sichtbarkeit wieder zurück. `activate` führt die Aktion
 * nur aus, wenn das Auslösen zählt (`acceptsActivation`); `onPointerDown` gehört an die Schaltfläche, die geschützt wird.
 */
export function useConsentGuard() {
  const [guard, setGuard] = useState<ConsentGuard>(() => openGuard(performance.now(), windowAttended()));
  const [armed, setArmed] = useState(false);
  const pointerDownAt = useRef<number | null>(null);

  useEffect(() => {
    const restart = () => setGuard((current) => changeAttention(current, performance.now(), windowAttended()));
    window.addEventListener("focus", restart);
    window.addEventListener("blur", restart);
    document.addEventListener("visibilitychange", restart);
    return () => {
      window.removeEventListener("focus", restart);
      window.removeEventListener("blur", restart);
      document.removeEventListener("visibilitychange", restart);
    };
  }, []);

  useEffect(() => {
    const now = performance.now();
    const wait = lockedForMs(guard, now);
    setArmed(isArmed(guard, now));
    if (wait === null || wait === 0) return;
    const timer = setTimeout(() => setArmed(isArmed(guard, performance.now())), wait);
    return () => clearTimeout(timer);
  }, [guard]);

  const activationOf = (event: MouseEvent): Activation => {
    const keyboard = event.detail === 0;
    const downAt = pointerDownAt.current;
    pointerDownAt.current = null;
    return keyboard ? { by: "keyboard" } : { by: "pointer", downAt };
  };

  return {
    armed,
    onPointerDown: () => void (pointerDownAt.current = performance.now()),
    activate: (event: MouseEvent, action: () => void) => {
      if (acceptsActivation(guard, performance.now(), activationOf(event))) action();
    },
  };
}
