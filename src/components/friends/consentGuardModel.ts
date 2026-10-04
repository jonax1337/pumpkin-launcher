// Reine Zeitlogik des Schutzes vor Fehlklicks in der Rückfrage der Mod (INGAME 5.5, kein React), damit consentGuardModel.check.mjs sie
// ohne Bundler prüft. Alle Zeiten sind Millisekunden auf derselben Uhr (`performance.now()`).

/** So lange bleibt jede Schaltfläche außer „Ablehnen“ gesperrt, gerechnet ab dem Moment, in dem der Dialog sichtbar ist und das Fenster den Fokus hat. */
export const CONSENT_GUARD_MS = 1000;

export interface ConsentGuard {
  /** Seit wann der Dialog offen ist: ein Druck, der früher begann, galt nicht ihm. */
  shownAt: number;
  /** Beginn der laufenden Zeit mit Fokus und sichtbarem Fenster; `null`, solange eines von beiden fehlt. */
  attendedSince: number | null;
}

/** Wodurch eine Schaltfläche ausgelöst wurde: per Tastatur, oder per Zeiger, dessen Druck `downAt` auf dieser Schaltfläche begann (`null` = anderswo). */
export type Activation = { by: "keyboard" } | { by: "pointer"; downAt: number | null };

export const openGuard = (now: number, attended: boolean): ConsentGuard => ({ shownAt: now, attendedSince: attended ? now : null });

/** Jeder Wechsel von Fokus oder Sichtbarkeit beginnt die Wartezeit neu, auch einer, der den Zustand gar nicht ändert. */
export const changeAttention = (guard: ConsentGuard, now: number, attended: boolean): ConsentGuard =>
  ({ ...guard, attendedSince: attended ? now : null });

/** Wie lange die Schaltflächen noch gesperrt bleiben; `null`, solange die Wartezeit gar nicht läuft. */
export const lockedForMs = (guard: ConsentGuard, now: number): number | null =>
  guard.attendedSince === null ? null : Math.max(0, CONSENT_GUARD_MS - (now - guard.attendedSince));

export const isArmed = (guard: ConsentGuard, now: number): boolean => lockedForMs(guard, now) === 0;

/**
 * Ob ein Auslösen zählt: nur nach der Wartezeit, und ein Zeiger nur, wenn sein Druck nach dem Erscheinen des Dialogs
 * auf der Schaltfläche begann. Ein Druck, der vorher anderswo begann (ein Klick, der den Dialog auslöste), zählt nicht.
 */
export function acceptsActivation(guard: ConsentGuard, now: number, activation: Activation): boolean {
  if (!isArmed(guard, now)) return false;
  return activation.by === "keyboard" || (activation.downAt !== null && activation.downAt >= guard.shownAt);
}
