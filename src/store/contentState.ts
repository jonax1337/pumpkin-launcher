import { create } from "zustand";
import type { ContentProgress } from "@/lib/progress";

/**
 * Der gerade laufende Inhalts-Vorgang (Installieren, Aktualisieren, Importieren, Welt sichern).
 * Hält den Fortschritt über Seitenwechsel; nur der passende aktive Vorgang darf ihn ändern.
 * `target` sagt, was läuft (eine Projekt-ID oder „updates“), damit Zeilen ihren eigenen Fortschritt zeigen.
 */
export const useContentState = create<{
  active: string | null; target: string | null; label: string | null; cancellable: boolean; progress: ContentProgress | null;
}>(() => ({ active: null, target: null, label: null, cancellable: false, progress: null }));
