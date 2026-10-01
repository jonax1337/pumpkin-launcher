/** Ein Wörterbuch je Sprache: Übersetzungsschlüssel → Text (mit `{platzhaltern}`). */
export type Dict = Record<string, string>;

/** Sprachen der Oberfläche. Deutsch ist die Quelle, Englisch muss dieselben Schlüssel definieren. */
export type Language = "de" | "en";

/** Sprachwahl in den Einstellungen: dem System folgen oder eine Sprache fest wählen. */
export type LanguageChoice = "system" | Language;

/**
 * „system“ folgt der Browsersprache: Beginnt `navigator.language` mit „de“, gilt Deutsch,
 * sonst Englisch – auch für jede andere Systemsprache, mehr gibt die Oberfläche nicht her.
 */
export function resolveChoice(choice: LanguageChoice): Language {
  if (choice !== "system") return choice;
  return navigator.language.toLowerCase().startsWith("de") ? "de" : "en";
}
