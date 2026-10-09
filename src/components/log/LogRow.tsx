import { memo, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import type { LogLine } from "@/store/game";

/** Zeitstempel am Zeilenanfang („[12:34:56]“, auch „[6:22:12 PM]“): wird gedimmt, der Rest der Zeile trägt die Farbe des Schweregrads. */
const TIMESTAMP = /^(\[\d{1,2}:\d{2}:\d{2}(?: [AP]M)?\])(.*)$/s;

/** Text mit Treffern der Suche: `split` mit Gruppe liefert Text und Treffer im Wechsel, ungerade Stellen sind Treffer. */
function marked(text: string, highlight: RegExp | null): ReactNode {
  if (!highlight) return text;
  return text.split(highlight).map((part, i) => (i % 2 ? <mark key={i}>{part}</mark> : part));
}

/** Thread und Stufe nach dem Zeitstempel („ [Render thread/WARN]:“): wird in der Info-Zeile gedimmt, in Warnung/Fehler trägt es die Farbe der Zeile. */
const LEVEL = /^(\s*\[[^\]\n]+\/[A-Z]+\]:?)(.*)$/s;

/** Rest einer Zeile ohne Zeitstempel: Stufe gedimmt (`lv`), dann der Text. */
function body(text: string, highlight: RegExp | null): ReactNode {
  const level = LEVEL.exec(text);
  if (!level) return marked(text, highlight);
  return (
    <>
      <span className="lv">{marked(level[1], highlight)}</span>
      {marked(level[2], highlight)}
    </>
  );
}

/** Eine Zeile der Ausgabe; `highlight` (mit einer Gruppe) markiert die Treffer der Suche. */
export const LogRow = memo(function LogRow({ line, highlight }: { line: LogLine; highlight: RegExp | null }) {
  const className = cn("ln", line.tone === "warn" && "w", line.tone === "error" && "e");
  const stamp = TIMESTAMP.exec(line.line);
  if (!stamp) return <span className={className}>{body(line.line, highlight)}</span>;
  return (
    <span className={className}>
      <span className="ts">{marked(stamp[1], highlight)}</span>
      {body(stamp[2], highlight)}
    </span>
  );
});
