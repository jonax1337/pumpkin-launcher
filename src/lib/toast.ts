import { toast } from "sonner";

/** Für `.catch(toastError)`: zeigt die Fehlermeldung eines Backend-Aufrufs als Toast. */
export const toastError = (e: Error) => void toast.error(e.message);
