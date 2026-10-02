// Sortierung der Inhaltsliste. Reine Funktionen ohne Abhängigkeit zur Oberfläche (Prüf-Skript: contentList.check.mjs).
import type { FileFacts, Mod } from "./types";

/** `default`: Abhängigkeiten eingerückt unter ihrem Nutzer; sonst eine flache Liste nach dem Merkmal. */
export type ContentSort = "default" | "name" | "date" | "size" | "status";

export const CONTENT_SORTS: ContentSort[] = ["default", "name", "date", "size", "status"];

export interface SortContext {
  titleOf: (mod: Mod) => string;
  /** Dateiangaben je Mod-ID; fehlt eine, sortiert der Eintrag ans Ende. */
  facts: Map<string, FileFacts>;
  /** Kleiner = weiter oben: Hinweise vor Updates vor Eingeschaltetem vor Ausgeschaltetem. */
  statusRank: (mod: Mod) => number;
  language: string;
}

/** Wie `titleOf` sortiert: ohne Groß- und Kleinschreibung, Zahlen als Zahlen („Mod 2“ vor „Mod 10“). */
const byName = (language: string) => {
  const collator = new Intl.Collator(language, { numeric: true, sensitivity: "base" });
  return (a: string, b: string) => collator.compare(a, b);
};

/** Vergleich nach dem Merkmal; größere Werte zuerst, fehlende zuletzt. */
const byDescending = (value: (mod: Mod) => number | undefined) => (a: Mod, b: Mod) => {
  const [x, y] = [value(a), value(b)];
  if (x === undefined || y === undefined) return Number(x === undefined) - Number(y === undefined);
  return y - x;
};

/** Zeilen nach `sort`; bei Gleichstand entscheidet der Name. `default` lässt die Reihenfolge der Eingabe. */
export function sortRows<T extends { mod: Mod }>(rows: T[], sort: ContentSort, context: SortContext): T[] {
  if (sort === "default") return rows;
  const name = byName(context.language);
  const compareName = (a: Mod, b: Mod) => name(context.titleOf(a), context.titleOf(b));
  const size = (mod: Mod) => context.facts.get(mod.id)?.sizeBytes;
  const date = (mod: Mod) => context.facts.get(mod.id)?.modifiedMs;
  const primary = {
    name: compareName,
    date: byDescending(date),
    size: byDescending(size),
    status: (a: Mod, b: Mod) => context.statusRank(a) - context.statusRank(b),
  }[sort];
  return [...rows].sort((a, b) => primary(a.mod, b.mod) || compareName(a.mod, b.mod));
}
