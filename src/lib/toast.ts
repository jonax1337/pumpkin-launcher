import { toast } from "sonner";

/** Fehler und Absturz bleiben länger stehen als eine gewöhnliche Meldung, damit man sie lesen und darauf reagieren kann. */
export const LONG_TOAST_MS = 10_000;

/** Meldungen mit einem Knopf oder Link bleiben länger, damit man ihn noch erreicht (Link öffnen, Update ansehen). */
export const ACTION_TOAST_MS = 15_000;

/** Für `.catch(toastError)`: zeigt die Fehlermeldung eines Backend-Aufrufs als Toast. */
export const toastError = (e: Error) => void toast.error(e.message);
