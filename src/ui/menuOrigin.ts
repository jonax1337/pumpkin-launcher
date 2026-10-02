/**
 * Auslöser des zuletzt geöffneten Menüs. Öffnet ein Eintrag einen Dialog, ist der Eintrag beim Öffnen schon
 * aus dem DOM; der Dialog gibt den Fokus dann hierhin zurück (siehe useReturnFocus in Dialog.tsx).
 */

/** So lange nach dem Schließen des Menüs (durch die Auswahl) zählt sein Auslöser noch als Herkunft eines Dialogs. */
const ORIGIN_GRACE_MS = 1000;

const origin = { el: null as HTMLElement | null, open: false, closedAt: 0 };

export function rememberMenuOrigin(el: HTMLElement | null) {
  origin.el = el;
  origin.open = true;
}

export function markMenuClosed() {
  origin.open = false;
  origin.closedAt = performance.now();
}

/** Auslöser, solange das Menü offen ist oder gerade erst geschlossen wurde. */
export function recentMenuOrigin() {
  const { el, open, closedAt } = origin;
  return el?.isConnected && (open || performance.now() - closedAt < ORIGIN_GRACE_MS) ? el : null;
}
