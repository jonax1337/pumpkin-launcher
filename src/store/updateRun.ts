import { create } from "zustand";

type UpdatePhase = "idle" | "download" | "wait" | "ready" | "install";

/**
 * Ablauf „Installieren und neu starten“; liegt außerhalb der Seite, damit er Seitenwechsel übersteht.
 * `wait`: geladen, aber Minecraft oder eine Aufgabe läuft noch. `ready`: frei, Neustart wartet auf einen Klick.
 * `p`: Anteil des Downloads, null = unbekannt.
 */
export const useUpdateRun = create<{ phase: UpdatePhase; p: number | null }>(() => ({ phase: "idle", p: null }));
