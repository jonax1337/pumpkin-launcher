import { create } from "zustand";

/** Ein vorgemerkter Inhalts-Vorgang. `target` sagt, was er betrifft (Projekt-ID), damit die passende Zeile „Vorgemerkt“ zeigt. */
export interface QueuedContent {
  id: string;
  target: string;
  label: string;
  /** Meldet Fehler selbst und ist fertig, wenn der Vorgang zu Ende ist; die Warteschlange setzt danach den nächsten fort. */
  start: () => Promise<unknown>;
}

/** Inhalts-Vorgänge, die auf den laufenden warten; sie laufen der Reihe nach (hooks/contentQueue.ts). */
export const useContentQueue = create<{ jobs: QueuedContent[] }>(() => ({ jobs: [] }));
