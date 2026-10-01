import { de } from "./de.ts";
import { en } from "./en.ts";
import type { mockWords } from "./mockWords.ts";
import type { Dict, Language } from "./types.ts";

/** Alle Übersetzungsschlüssel: die der App und die des Browser-Mocks (nur im Dev-Server geladen). */
export type TKey = keyof typeof de | keyof (typeof mockWords)["de"];
type Params = Record<string, string | number>;

const dicts: Record<Language, Dict> = { de: { ...de }, en: { ...en } };

/** Ergänzt die Wörterbücher um Schlüssel, die nicht in jedem Build vorkommen (Texte des Browser-Mocks). */
export function addWords(words: Record<Language, Dict>): void {
  for (const lang of Object.keys(words) as Language[]) Object.assign(dicts[lang], words[lang]);
}

// Aktuelle Sprache auch ohne React (lib/format.ts, Prüf-Skript). Der LanguageProvider setzt sie synchron, bevor neu gerendert wird.
let current: Language = "de";

/** Sprache, in der `t` übersetzt; `lib/format.ts` formatiert Zahlen und Daten nach ihr. */
export const currentLanguage = (): Language => current;

/** Sprache ohne React wechseln (etwa das Prüf-Skript); der Provider ruft das bei jedem Wechsel. */
export function setCurrentLanguage(lang: Language): void {
  current = lang;
}

/** Übersetzt `key` in die aktuelle Sprache; `{platzhalter}` werden ersetzt, fehlende bleiben sichtbar. */
export function t(key: TKey, params?: Params): string {
  const template = dicts[current][key] ?? key;
  return template.replace(/\{(\w+)\}/g, (placeholder, name: string) => (params && name in params ? String(params[name]) : placeholder));
}

/**
 * Übersetzten Satz um den `{marker}`-Platzhalter teilen. Die Mitte (`Count`, `<b>`) rendert die
 * Aufrufstelle selbst als React-Knoten, weil `t` nur Zeichenketten einsetzen kann – so bleibt die
 * Satzstellung dennoch vollständig im Wörterbuch.
 */
export function tAround(key: TKey, marker: string): [string, string] {
  const template = dicts[current][key] ?? key;
  const token = `{${marker}}`;
  const at = template.indexOf(token);
  return at < 0 ? ["", template] : [template.slice(0, at), template.slice(at + token.length)];
}
