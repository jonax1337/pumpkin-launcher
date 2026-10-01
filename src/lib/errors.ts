/** Text für Toasts und Aufgabenverlauf: Fehler des Backends kommen als `Error`, alles andere (Plugins) als beliebiger Wert. */
export const errorMessage = (err: unknown): string => (err instanceof Error ? err.message : String(err));
