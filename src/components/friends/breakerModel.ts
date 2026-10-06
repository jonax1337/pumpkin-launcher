// Reine Abfolge des Dialogs nach einem Startfehler durch das Pumpkin Bridge (docs/bridge/README.md, "Startup recovery", kein React), damit breakerModel.check.mjs sie
// ohne Bundler prüft.

/** Die zwei Wege aus dem Dialog: ohne Pumpkin Bridge starten (Schalter der Instanz aus) oder es noch einmal versuchen (Sperre aufheben). */
export type BreakerChoice = "startWithout" | "retryAnyway";

/** Was der Dialog tun kann; jeder Schritt meldet seinen Fehler, indem er ablehnt. */
export interface BreakerSteps {
  switchOff: () => Promise<unknown>;
  retry: () => Promise<unknown>;
  start: () => Promise<void>;
}

/**
 * Erst der Zustand der Einspeisung, dann der Start: der Start liest den Zustand beim Zusammenbauen der Argumente, also muss er
 * schon stehen. Scheitert der erste Schritt, startet nichts und der Fehler geht an den Aufrufer.
 */
export async function runBreakerChoice(choice: BreakerChoice, steps: BreakerSteps): Promise<void> {
  await (choice === "startWithout" ? steps.switchOff() : steps.retry());
  await steps.start();
}
