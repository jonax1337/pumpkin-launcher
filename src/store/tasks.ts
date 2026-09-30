import { create } from "zustand";

/**
 * Abgeschlossene Aufgaben (Downloads, Installationen) für das Aufgaben-Menü in der Fensterleiste.
 * Laufende Aufgaben kommen live aus `useGame.installs` und `useContentState`, nur das Ergebnis landet hier.
 */
export interface DoneTask {
  id: string;
  label: string;
  sub: string;
  state: "done" | "fail";
  at: number;
  /** Route, die „Öffnen“ ansteuert. */
  to?: string;
}

interface TasksState {
  history: DoneTask[];
  push: (task: Omit<DoneTask, "id" | "at">) => void;
  clear: () => void;
}

let next = 0;

export const useTasks = create<TasksState>()((set) => ({
  history: [],
  push: (task) => set((s) => ({ history: [{ ...task, id: `t${next++}`, at: Date.now() }, ...s.history].slice(0, 12) })),
  clear: () => set({ history: [] }),
}));
