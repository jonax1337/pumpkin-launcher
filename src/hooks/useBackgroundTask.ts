import type { Instance } from "@/lib/types";
import { useContentInstall, withTarget } from "./useContent";

type BackgroundTask = {
  /** Was der Vorgang betrifft (Projekt-ID o. ä.), damit die passende Zeile ihren Fortschritt zeigt. */
  key: string;
  /** Name im Aufgaben-Menü während des Laufs, `doneLabel` danach. */
  label: string;
  doneLabel: string;
  /** Das Aufgaben-Menü zeigt „Abbrechen“. */
  cancellable?: boolean;
  task: (operationId: string) => Promise<Instance>;
  /** Läuft nur bei Erfolg und nur, wenn der Vorgang wirklich gestartet wurde (nicht, wenn schon einer läuft). */
  onDone?: (result: Instance) => void;
};

/**
 * Startet einen Vorgang im Hintergrund: Fortschritt und Verlauf im Aufgaben-Menü, ein Vorgang zur Zeit.
 * `isPending` ist wahr, solange er läuft.
 */
export function useBackgroundTask() {
  const install = useContentInstall();
  const run = ({ key, label, doneLabel, cancellable, task, onDone }: BackgroundTask) =>
    install.mutate(withTarget(key, task, label, { cancellable, doneLabel }), { onSuccess: (result) => result && onDone?.(result) });
  return { run, isPending: install.isPending };
}
