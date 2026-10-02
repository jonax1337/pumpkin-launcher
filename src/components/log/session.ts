import { useMemo } from "react";
import { useLogSession } from "@/hooks/useLogSessions";
import { toneOf, type LogLine } from "@/store/game";

/** Zeilen eines gesicherten Protokolls; die Datei kennt keinen Strom, den Schweregrad zeigt die Zeile selbst. */
const linesOfText = (text: string): LogLine[] =>
  text
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line, id) => ({ id, stream: "stdout", line, tone: toneOf({ stream: "stdout", line }) }));

/** Zeilen der gesicherten Sitzung `sessionId`; `undefined`, solange sie lädt oder keine gewählt ist. */
export function useSessionLines(instanceId: string, sessionId: string | null) {
  const { data } = useLogSession(instanceId, sessionId);
  return useMemo(() => (data == null ? undefined : linesOfText(data)), [data]);
}
