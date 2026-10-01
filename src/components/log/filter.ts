import { useMemo } from "react";
import type { TKey } from "@/i18n";
import type { LogLine } from "@/store/game";

export type LogFilter = "all" | "warn" | "err";

export const LOG_FILTERS: { value: LogFilter; label: TKey }[] = [
  { value: "all", label: "common.all" },
  { value: "warn", label: "components.log.filterWarn" },
  { value: "err", label: "common.error" },
];

const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** „Warnungen“ zeigt auch Fehler, „Fehler“ nur Fehler. */
const matchesLevel = (line: LogLine, filter: LogFilter) =>
  filter === "all" || (filter === "warn" ? line.tone !== "normal" : line.tone === "error");

/** Zeilen, die Stufe und Suchtext erfüllen, und die Regex, mit der der Treffer in der Zeile markiert wird (`null` = ohne Suche). */
export function useFilteredLines(lines: LogLine[] | undefined, filter: LogFilter, query: string) {
  const needle = query.trim().toLowerCase();
  const highlight = useMemo(() => (needle ? new RegExp(`(${escapeRegExp(needle)})`, "gi") : null), [needle]);
  const shown = useMemo(
    () => (lines ?? []).filter((line) => matchesLevel(line, filter) && (!needle || line.line.toLowerCase().includes(needle))),
    [lines, filter, needle],
  );
  return { shown, highlight };
}
