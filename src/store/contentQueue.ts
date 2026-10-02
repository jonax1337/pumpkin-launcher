import { create } from "zustand";

/** Ein vorgemerkter Inhalts-Vorgang. `target` sagt, was er betrifft (Projekt-ID), damit die passende Zeile „Vorgemerkt“ zeigt. */
export interface QueuedContent {
  id: string;
  target: string;
  label: string;
  /** Läuft den Vorgang, meldet Fehler selbst (die Warteschlange fängt keine) und ist fertig, wenn er zu Ende ist. */
  start: () => Promise<unknown>;
}

/** Inhalts-Vorgänge, die auf den laufenden warten; sie laufen der Reihe nach (hooks/contentQueue.ts). */
export const useContentQueue = create<{ jobs: QueuedContent[] }>(() => ({ jobs: [] }));
