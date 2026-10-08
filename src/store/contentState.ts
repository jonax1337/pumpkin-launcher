import { create } from "zustand";
import type { ContentProgress } from "@/lib/progress";

/**
 * Der gerade laufende Inhalts-Vorgang (Installieren, Aktualisieren, Importieren, Welt sichern).
 * Hält den Fortschritt über Seitenwechsel; nur der passende aktive Vorgang darf ihn ändern.
 * `target` sagt, was läuft (eine Projekt-ID oder „updates“), damit Zeilen ihren eigenen Fortschritt zeigen.
 * `instanceIds` sind die Instanzen, an denen er arbeitet; nur sie sind währenddessen gesperrt. Leer, wenn er eine neue
 * Instanz anlegt.
 */
export const useContentState = create<{
  active: string | null; target: string | null; label: string | null; cancellable: boolean; progress: ContentProgress | null;
  instanceIds: string[];
}>(() => ({ active: null, target: null, label: null, cancellable: false, progress: null, instanceIds: [] }));
