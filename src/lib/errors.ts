import { CANCELLED } from "./types";

/**
 * Text für Toasts und Aufgabenverlauf: Fehler des Backends kommen als `Error`, Plugins auch als string
 * oder als Objekt (mit `message`, sonst als JSON, damit nie „[object Object]“ erscheint).
 */
export function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err !== "object" || err === null) return String(err);
  return "message" in err && typeof err.message === "string" ? err.message : JSON.stringify(err);
}

/** Hat der Nutzer den Vorgang abgebrochen? Das ist kein Fehler und wird neutral gemeldet. */
export const isCancelled = (err: unknown) => err instanceof Error && err.message === CANCELLED;
