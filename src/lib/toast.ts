import { toast } from "sonner";

/** Fehler und Absturz bleiben länger stehen als eine gewöhnliche Meldung, damit man sie lesen und darauf reagieren kann. */
export const LONG_TOAST_MS = 10_000;

/** Für `.catch(toastError)`: zeigt die Fehlermeldung eines Backend-Aufrufs als Toast. */
export const toastError = (e: Error) => void toast.error(e.message);
