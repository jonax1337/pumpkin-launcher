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

/**
 * Übersetzten Satz um den `{marker}`-Platzhalter teilen. Die Mitte (`Count`, `<b>`) rendert die
 * Aufrufstelle selbst als React-Knoten, weil `t` nur Zeichenketten einsetzen kann – so bleibt die
 * Satzstellung dennoch vollständig im Wörterbuch.
 */
export function tAround(key: string, marker: string): [string, string] {
  const template = dicts[current][key] ?? key;
  const token = `{${marker}}`;
  const at = template.indexOf(token);
  return at < 0 ? ["", template] : [template.slice(0, at), template.slice(at + token.length)];
}
