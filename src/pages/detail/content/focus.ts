/** Frames, die Fokus-Versuche auf ein noch unsichtbares Ziel warten (Platzhalter, Menüs). */
const FOCUS_RETRY_FRAMES = 60;

/** Ruft `attempt` je Frame auf, bis es gelingt (höchstens `tries` Mal); die Rückgabe bricht die weiteren Versuche ab. */
export function retryPerFrame(attempt: () => boolean, tries: number) {
  let frame = 0, failed = 0;
  const go = () => {
    if (!attempt() && ++failed < tries) frame = requestAnimationFrame(go);
  };
  frame = requestAnimationFrame(go);
  return () => cancelAnimationFrame(frame);
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
