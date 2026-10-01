import type { ReactNode } from "react";
import type { useBackgroundTask } from "@/hooks/useBackgroundTask";
import type { useImportInstances } from "@/hooks/useImport";
import type { Instance } from "@/lib/types";

export type Tab = "blank" | "pack" | "file" | "tpl" | "import";

/** Was alle Reiter des Dialogs „Neue Instanz“ teilen: es läuft immer nur ein Vorgang. */
export interface TabContext {
  /** Der gewählte Reiter, damit ein Reiter erst lädt, wenn er gezeigt wird. */
  tab: Tab;
  close: () => void;
  /** Eine Instanz ist fertig: der Dialog geht zu ihr, falls er noch offen ist. */
  onCreated: (instance: Instance) => void;
  /** Ein Inhalts-Vorgang läuft (aus diesem Dialog oder woanders). */
  active: boolean;
  background: ReturnType<typeof useBackgroundTask>;
  importer: ReturnType<typeof useImportInstances>;
  /** Fortschritt des laufenden Vorgangs, solange er aus diesem Dialog kommt; sonst `null`. */
  runningLabel: string | null;
}

/** Was der Dialog je Reiter braucht: Zustand der Fußzeile, Absenden und den Inhalt. */
export interface TabModel {
  /** Kann abgesendet werden. */
  valid: boolean;
  /** Beschriftung des Knopfes. */
  label: string;
  /** Hilfe in der Fußzeile. */
  hint: string;
  /** Ein zweiter Vorgang würde still verworfen: Läuft schon einer, ist der Knopf gesperrt und die Fußzeile nennt den Grund. */
  queues: boolean;
  /** Dieser Reiter hat einen Vorgang laufen. */
  busy: boolean;
  /** Zusätzlicher Knopf „Abbrechen“ für den laufenden Vorgang. */
  cancel?: { aria: string; onClick: () => void };
  submit: () => void;
  /** Der Inhalt; `busy` sagt, ob irgendein Reiter etwas laufen hat. */
  renderPane: (busy: boolean) => ReactNode;
}
