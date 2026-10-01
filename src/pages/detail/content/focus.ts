/** Frames, die Fokus-Versuche auf ein noch unsichtbares Ziel warten (Platzhalter, Menüs). */
const FOCUS_RETRY_FRAMES = 60;

/** Der Tabwechsel zu „Updates“ läuft als Navigation und kann ein paar Frames später sichtbar werden. */
export const UPDATE_FOCUS_RETRY_FRAMES = 30;

/** Ruft `attempt` je Frame auf, bis es gelingt (höchstens `tries` Mal); die Rückgabe bricht die weiteren Versuche ab. */
export function retryPerFrame(attempt: () => boolean, tries: number) {
  let frame = 0, failed = 0;
  const go = () => {
    if (!attempt() && ++failed < tries) frame = requestAnimationFrame(go);
  };
  frame = requestAnimationFrame(go);
  return () => cancelAnimationFrame(frame);
}

/** Knopf in den Blick holen und fokussieren; `false`, solange er noch nicht sichtbar ist (für `retryPerFrame`). */
export function revealAndFocus(button: HTMLElement | null) {
  if (!button?.checkVisibility({ visibilityProperty: true } as CheckVisibilityOptions)) return false;
  button.scrollIntoView({ block: "nearest" });
  button.focus({ preventScroll: true, focusVisible: true } as FocusOptions);
  return true;
}

/**
 * Fokus setzen, sobald das Ziel sichtbar ist (Platzhalter erscheinen erst nach dem optimistischen Update,
 * Menüs geben den Fokus einen Takt später ab).
 */
export function focusSoon(find: () => HTMLElement | null | undefined) {
  const focusIfVisible = () => {
    const el = find();
    if (!el?.isConnected || !el.checkVisibility()) return false;
    el.focus({ focusVisible: true } as FocusOptions);
    return true;
  };
  setTimeout(() => {
    if (!focusIfVisible()) retryPerFrame(focusIfVisible, FOCUS_RETRY_FRAMES - 1);
  }, 0);
}
