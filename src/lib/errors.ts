// Import mit Endung: Dieses Modul lädt auch das plain-node-Prüf-Skript (kein Bundler, der Auflösung macht).
import { t } from "../i18n/core.ts";
import { errors } from "../i18n/de/errors.ts";

/** Stabiler Schlüssel, mit dem das Backend den Abbruch durch den Nutzer meldet (`AppError::code`). */
const CANCELLED_CODE = "cancelled";

/** Fehlercode des Backends (`coded!`); jeder hat eine deutsche und eine englische Übersetzung. */
export type ErrorKey = keyof typeof errors;

type BackendErrorOptions = ErrorOptions & { key?: ErrorKey };

/**
 * Fehler eines Backend-Aufrufs: `message` ist der Text für den Nutzer, `code` die Fehlerart des Backends
 * (`AppError::code`), `key` der Fehlercode der Meldung (`coded!`), an dem die Oberfläche einen einzelnen Fall erkennt.
 * Fehler von Plugins und Browser-Mock haben keinen Code oder ihren eigenen.
 */
export class BackendError extends Error {
  readonly code: string | null;
  readonly key: ErrorKey | null;

  constructor(message: string, code: string | null = null, { key, ...options }: BackendErrorOptions = {}) {
    super(message, options);
    this.name = "BackendError";
    this.code = code;
    this.key = key ?? null;
  }
}

/** Meldung als Fehlercode, wie das Backend sie neben `message` schickt (`ErrorText`); Details roh oder selbst codiert. */
interface CodedText {
  key: ErrorKey;
  params?: Record<string, string>;
  details?: string | CodedText;
}

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null;

const isCodedText = (value: unknown): value is CodedText =>
  isObject(value) &&
  typeof value.key === "string" &&
  Object.hasOwn(errors, value.key) &&
  (value.params === undefined || isObject(value.params)) &&
  (value.details === undefined || typeof value.details === "string" || isCodedText(value.details));

/** Codierte Meldung in der Sprache der Oberfläche, mit denselben Platzhaltern wie im Backend. */
function translate({ key, params, details }: CodedText): string {
  const message = t(key, params);
  if (details === undefined) return message;
  return t("errors.withDetails", { message, details: typeof details === "string" ? details : translate(details) });
}

/**
 * Text für Toasts und Aufgabenverlauf: Fehler des Backends kommen als `Error` oder als `{ code, message }`, mit
 * Fehlercode übersetzt; unbekannte Codes, Plugins (string oder Objekt) und rohe Texte bleiben, wie sie sind.
 * Ohne `message` erscheint das Objekt als JSON, damit nie „[object Object]“ erscheint.
 */
export function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (!isObject(err)) return String(err);
  if (isCodedText(err)) return translate(err);
  return typeof err.message === "string" ? err.message : JSON.stringify(err);
}

const codeOf = (err: unknown) => (isObject(err) && typeof err.code === "string" ? err.code : null);

/** Macht aus dem, was ein Tauri-Aufruf zurückweist (`{ code, message }` des Backends, string oder Plugin-Objekt), einen `BackendError`; die Ursache bleibt in `cause`. */
export const toBackendError = (err: unknown) =>
  new BackendError(errorMessage(err), codeOf(err), { cause: err, key: isCodedText(err) ? err.key : undefined });

/** Die Meldung des Abbruchs durch den Nutzer, wie das Backend sie liefert (für den Browser-Mock). */
export const cancelledError = () => new BackendError(t("errors.cancelled"), CANCELLED_CODE);

/** Hat der Nutzer den Vorgang abgebrochen? Das ist kein Fehler und wird neutral gemeldet. */
export const isCancelled = (err: unknown) => err instanceof BackendError && err.code === CANCELLED_CODE;
