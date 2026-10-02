import { useEffect, useRef, useState } from "react";
import { t } from "@/i18n";
import type { LogLine } from "@/store/game";
import { useLatest } from "./useLatest";

/** Höchstens so oft (ms) wird eine Kurzmeldung angesagt. */
const LOG_DIGEST_INTERVAL_MS = 5000;

/** Warnungen und Fehler unter den Zeilen, die nach `seenId` kamen (Zeilen-IDs steigen mit jeder neuen Zeile). */
function countNewProblems(lines: LogLine[], seenId: number) {
  let warnings = 0, errors = 0;
  for (let i = lines.length - 1; i >= 0 && lines[i].id > seenId; i--) {
    if (lines[i].tone === "warn") warnings++;
    else if (lines[i].tone === "error") errors++;
  }
  return { warnings, errors };
}

/** „Protokoll: 2 neue Warnungen, 1 neuer Fehler“. Reine Funktion, deshalb Modul-`t`. */
function digestText(warnings: number, errors: number) {
  const parts = [
    warnings && t(warnings === 1 ? "components.log.newWarnings.one" : "components.log.newWarnings.other", { n: warnings }),
    errors && t(errors === 1 ? "components.log.newErrors.one" : "components.log.newErrors.other", { n: errors }),
  ].filter(Boolean);
  return t("components.log.digestPrefix") + parts.join(", ");
}

/**
 * Kurzmeldung für Screenreader: neue Warnungen und Fehler seit der letzten Meldung, höchstens alle 5 s.
 * Die Konsole selbst liest nicht mit (aria-live="off"), sonst käme jede Zeile.
 */
export function useLogDigest(lines: LogLine[] | undefined) {
  const [message, setMessage] = useState("");
  const latest = useLatest(lines);
  // Bestand beim Öffnen wird nicht angesagt, nur was danach kommt.
  const seenId = useRef(lines?.at(-1)?.id ?? -1);
  const lastSaidAt = useRef(0);
  const timer = useRef<number | undefined>(undefined);

  function announceNew() {
    timer.current = undefined;
    const all = latest.current ?? [];
    const { warnings, errors } = countNewProblems(all, seenId.current);
    seenId.current = all.at(-1)?.id ?? seenId.current;
    if (!warnings && !errors) return;
    lastSaidAt.current = Date.now();
    const text = digestText(warnings, errors);
    // Gleicher Wortlaut wie zuletzt: unsichtbar ändern, damit er erneut angesagt wird.
    setMessage((previous) => (previous === text ? `${text} ` : text));
  }

  useEffect(() => {
    if (timer.current !== undefined) return;
    timer.current = window.setTimeout(announceNew, Math.max(0, lastSaidAt.current + LOG_DIGEST_INTERVAL_MS - Date.now()));
  }, [lines]);

  useEffect(() => () => {
    window.clearTimeout(timer.current);
    timer.current = undefined;
  }, []);

  return message;
}
