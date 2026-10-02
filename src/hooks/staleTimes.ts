import { MINUTE } from "@/lib/time";

/** Katalogdaten (Projekte, Versionen, Minecraft- und Loader-Listen, Update-Check) ändern sich selten. */
export const CATALOG_STALE_MS = 10 * MINUTE;

/** Was ein Microsoft-Konto trägt, wechselt nur durch die Skins-Seite, die den Stand dann selbst erneuert. */
export const SKIN_PROFILE_STALE_MS = 5 * MINUTE;

/** Suchergebnisse dürfen kurz alt sein; wer die Suche wiederholt, bekommt sie sofort. */
export const SEARCH_STALE_MS = 5 * MINUTE;
