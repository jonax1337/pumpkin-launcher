/** Roving-Tabindex für Tabs, Segmente und Radios als Knöpfe (Tabs.tsx, Toggle.tsx). */
import { useCallback, type KeyboardEvent } from "react";

/** x = ←/→ (waagerecht), y = ↑/↓ (senkrecht), xy = beide (Radios). */
type RoveAxis = "x" | "y" | "xy";

const ROVE_ITEMS = "[role=tab]:not(:disabled), [role=radio]:not(:disabled)";

/** Fokus in `items` weitersetzen; gibt das neue Element zurück (null: Taste nicht verbraucht oder Fokus blieb). */
function rove(e: KeyboardEvent<HTMLElement>, items: HTMLElement[], axis: RoveAxis) {
  const keys = ["Home", "End", ...(axis !== "y" ? ["ArrowLeft", "ArrowRight"] : []), ...(axis !== "x" ? ["ArrowUp", "ArrowDown"] : [])];
  if (!keys.includes(e.key) || e.altKey || e.ctrlKey || e.metaKey || !items.length) return null;
  const i = items.indexOf(document.activeElement as HTMLElement);
  if (i < 0) return null;
  e.preventDefault();
  const n = items.length;
  const j = e.key === "Home" ? 0 : e.key === "End" ? n - 1 : (i + (e.key === "ArrowRight" || e.key === "ArrowDown" ? 1 : -1) + n) % n;
  items[j].focus();
  return items[j] !== items[i] ? items[j] : null;
}

/**
 * Pfeiltasten, Pos1 und Ende in einer Gruppe (Tabs, Segmente, Radios als Knöpfe): ein Tab-Stopp, Fokus wandert.
 * Gibt den onKeyDown-Handler für den Container zurück. Elemente: role=tab oder role=radio.
 * Die Auswahl folgt dem Fokus (das neue Element wird geklickt). Ein Autofokus im neuen Inhalt (Suchfeld) zieht den Fokus nicht aus der Leiste.
 */
export function useRoving<E extends HTMLElement = HTMLElement>(axis: RoveAxis) {
  return useCallback(
    (e: KeyboardEvent<E>) => {
      if (e.defaultPrevented) return;
      const list = [...e.currentTarget.querySelectorAll<HTMLElement>(ROVE_ITEMS)].filter((el) => el.getClientRects().length > 0);
      const next = rove(e, list, axis);
      if (!next) return;
      next.click();
      requestAnimationFrame(() => next.isConnected && document.activeElement !== next && next.focus({ preventScroll: true }));
    },
    [axis],
  );
}
