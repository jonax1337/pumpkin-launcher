import { de } from "./de.ts";
import { en } from "./en.ts";
import type { Dict, Language } from "./types.ts";

const dicts: Record<Language, Dict> = { de, en };

// Aktuelle Sprache auch ohne React (lib/format.ts, Prüf-Skript). Der LanguageProvider setzt sie synchron, bevor neu gerendert wird.
let current: Language = "de";

/** Sprache, in der `t` übersetzt; `lib/format.ts` formatiert Zahlen und Daten nach ihr. */
export const currentLanguage = (): Language => current;

/** Sprache ohne React wechseln (etwa das Prüf-Skript); der Provider ruft das bei jedem Wechsel. */
export function setCurrentLanguage(lang: Language): void {
  current = lang;
}

/** Übersetzt `key` in die aktuelle Sprache; `{platzhalter}` werden ersetzt, fehlende bleiben sichtbar. */
export function t(key: string, params?: Record<string, string | number>): string {
  const template = dicts[current][key] ?? key;
  return template.replace(/\{(\w+)\}/g, (placeholder, name: string) => (params && name in params ? String(params[name]) : placeholder));
}
