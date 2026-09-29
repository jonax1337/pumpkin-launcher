import { create } from "zustand";
import type { ExitPayload, InstallProgress, LogPayload } from "@/lib/types";

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
  /** Instanzen, für die „Spielen“ gerade läuft (Vorbereiten und Starten). */
  launching: Record<string, true>;
  logs: Record<string, LogLine[]>;
  /** Letzter Absturz je Instanz, bis zum nächsten Start (Hinweis im Protokoll). */
  crashes: Record<string, ExitPayload>;
  setProgress: (p: InstallProgress) => void;
  clearProgress: (instanceId: string) => void;
  setLaunching: (instanceId: string, launching: boolean) => void;
  appendLog: (p: LogPayload) => void;
  clearLog: (instanceId: string) => void;
  setCrash: (exit: ExitPayload) => void;
  clearCrash: (instanceId: string) => void;
}

export const useGame = create<GameState>()((set) => ({
  installs: {},
  launching: {},
  logs: {},
  crashes: {},
  setProgress: (p) => set((s) => ({ installs: { ...s.installs, [p.instanceId]: p } })),
  clearProgress: (id) =>
    set((s) => {
      const { [id]: _, ...installs } = s.installs;
      return { installs };
    }),
  setLaunching: (id, launching) =>
    set((s) => {
      const { [id]: _, ...rest } = s.launching;
      return { launching: launching ? { ...rest, [id]: true } : rest };
    }),
  appendLog: ({ instanceId, stream, line }) =>
    set((s) => ({
      logs: {
        ...s.logs,
        [instanceId]: [...(s.logs[instanceId] ?? []), { id: nextLogId++, stream, line }].slice(-MAX_LOG_LINES),
      },
    })),
  clearLog: (id) => set((s) => ({ logs: { ...s.logs, [id]: [] } })),
  setCrash: (exit) => set((s) => ({ crashes: { ...s.crashes, [exit.instanceId]: exit } })),
  clearCrash: (id) =>
    set((s) => {
      const { [id]: _, ...crashes } = s.crashes;
      return { crashes };
    }),
}));
