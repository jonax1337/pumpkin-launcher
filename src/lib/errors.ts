/** Stabiler Schlüssel, mit dem das Backend den Abbruch durch den Nutzer meldet (`AppError::code`). */
const CANCELLED_CODE = "cancelled";

/**
 * Fehler eines Backend-Aufrufs: `message` ist der Text für den Nutzer, `code` die Fehlerart des Backends
 * (`AppError::code`). Fehler von Plugins und Browser-Mock haben keinen Code oder ihren eigenen.
 */
export class BackendError extends Error {
  readonly code: string | null;

  constructor(message: string, code: string | null = null, options?: ErrorOptions) {
    super(message, options);
    this.name = "BackendError";
    this.code = code;
  }
}

/**
 * Text für Toasts und Aufgabenverlauf: Fehler des Backends kommen als `Error`, Plugins auch als string
 * oder als Objekt (mit `message`, sonst als JSON, damit nie „[object Object]“ erscheint).
 */
export function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err !== "object" || err === null) return String(err);
  return "message" in err && typeof err.message === "string" ? err.message : JSON.stringify(err);
}

const codeOf = (err: unknown) =>
  typeof err === "object" && err !== null && "code" in err && typeof err.code === "string" ? err.code : null;

/** Macht aus dem, was ein Tauri-Aufruf zurückweist (`{ code, message }` des Backends, string oder Plugin-Objekt), einen `BackendError`; die Ursache bleibt in `cause`. */
export const toBackendError = (err: unknown) => new BackendError(errorMessage(err), codeOf(err), { cause: err });

/** Die Meldung des Abbruchs durch den Nutzer, wie das Backend sie liefert (für den Browser-Mock). */
export const cancelledError = () => new BackendError("Vorgang abgebrochen", CANCELLED_CODE);

/** Hat der Nutzer den Vorgang abgebrochen? Das ist kein Fehler und wird neutral gemeldet. */
export const isCancelled = (err: unknown) => err instanceof BackendError && err.code === CANCELLED_CODE;
