import { create } from "zustand";

/**
 * Abgeschlossene Aufgaben (Downloads, Installationen) für das Aufgaben-Menü in der Fensterleiste.
 * Laufende Aufgaben kommen live aus `useRunningTasks`, nur das Ergebnis landet hier.
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

/** So viele abgeschlossene Aufgaben merkt sich das Menü; die ältesten fallen heraus. */
const MAX_HISTORY = 12;

interface TasksState {
  history: DoneTask[];
  push: (task: Omit<DoneTask, "id" | "at">) => void;
  clear: () => void;
}

let next = 0;

export const useTasks = create<TasksState>()((set) => ({
  history: [],
  push: (task) => set((s) => ({ history: [{ ...task, id: `t${next++}`, at: Date.now() }, ...s.history].slice(0, MAX_HISTORY) })),
  clear: () => set({ history: [] }),
}));
