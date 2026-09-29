import { create } from "zustand";
import type { InstallProgress, LogPayload } from "@/lib/types";

export interface LogLine {
  id: number;
  stream: LogPayload["stream"];
  line: string;
}

// ponytail: Log-Puffer auf die letzten MAX_LOG_LINES Zeilen je Instanz begrenzt; für vollständige Logs Datei im Backend lesen.
export const MAX_LOG_LINES = 2000;
let nextLogId = 0;

/** Flüchtiger Laufzeitzustand aus den Backend-Events (nicht persistiert). */
interface GameState {
  /** Laufende Installationen je Instanz. */
  installs: Record<string, InstallProgress>;
  logs: Record<string, LogLine[]>;
  setProgress: (p: InstallProgress) => void;
  clearProgress: (instanceId: string) => void;
  appendLog: (p: LogPayload) => void;
  clearLog: (instanceId: string) => void;
}

export const useGame = create<GameState>()((set) => ({
  installs: {},
  logs: {},
  setProgress: (p) => set((s) => ({ installs: { ...s.installs, [p.instanceId]: p } })),
  clearProgress: (id) =>
    set((s) => {
      const { [id]: _, ...installs } = s.installs;
      return { installs };
    }),
  appendLog: ({ instanceId, stream, line }) =>
    set((s) => ({
      logs: {
        ...s.logs,
        [instanceId]: [...(s.logs[instanceId] ?? []), { id: nextLogId++, stream, line }].slice(-MAX_LOG_LINES),
      },
    })),
  clearLog: (id) => set((s) => ({ logs: { ...s.logs, [id]: [] } })),
}));
