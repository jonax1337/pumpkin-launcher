import { memo } from "react";
import { cn } from "@/lib/utils";
import type { LogLine } from "@/store/game";

/** Eine Zeile der Ausgabe; `highlight` (mit einer Gruppe) markiert die Treffer der Suche. */
export const LogRow = memo(function LogRow({ line, highlight }: { line: LogLine; highlight: RegExp | null }) {
  const className = cn("ln", line.tone === "warn" && "w", line.tone === "error" && "e");
  if (!highlight) return <span className={className}>{line.line}</span>;
  // split mit Gruppe liefert Text und Treffer im Wechsel: ungerade Stellen sind Treffer.
  const parts = line.line.split(highlight);
  return <span className={className}>{parts.map((part, i) => (i % 2 ? <mark key={i}>{part}</mark> : part))}</span>;
});
