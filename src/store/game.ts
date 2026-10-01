import { create } from "zustand";
import type { ExitPayload, InstallProgress, LogPayload } from "@/lib/types";

export interface LogLine {
  id: number;
  stream: LogPayload["stream"];
  line: string;
  /** Beim Anhängen einmal berechnet, damit die Anzeige keine Regex je Render braucht. */
  tone: "error" | "warn" | "normal";
}

const toneOf = ({ stream, line }: LogPayload): LogLine["tone"] =>
  stream === "stderr" || /\/(ERROR|FATAL)\]/.test(line) ? "error" : /\/WARN\]/.test(line) ? "warn" : "normal";

// Log-Events kommen zeilenweise; gebündelt anhängen statt pro Zeile Array kopieren und rendern.
// Timer statt requestAnimationFrame: rAF pausiert bei minimiertem Fenster, dann wüchse `pending` unbegrenzt.
let pending: LogPayload[] = [];
let timer: ReturnType<typeof setTimeout> | undefined;

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
  /** Startzeit laufender Spiele (Unix-ms) für „Läuft seit“. */
  started: Record<string, number>;
  setStarted: (instanceId: string, at: number | null) => void;
  setProgress: (p: InstallProgress) => void;
  clearProgress: (instanceId: string) => void;
  setLaunching: (instanceId: string, launching: boolean) => void;
  appendLog: (p: LogPayload) => void;
  clearLog: (instanceId: string) => void;
  setCrash: (exit: ExitPayload) => void;
  clearCrash: (instanceId: string) => void;
}

/** Startet oder läuft gerade ein Minecraft? */
export const isGameActive = (s: GameState) => Object.keys(s.launching).length > 0 || Object.keys(s.started).length > 0;

export const useGame = create<GameState>()((set) => ({
  installs: {},
  launching: {},
  logs: {},
  crashes: {},
  started: {},
  setStarted: (id, at) =>
    set((s) => {
      const { [id]: _, ...rest } = s.started;
      return { started: at == null ? rest : { ...rest, [id]: at } };
    }),
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
  appendLog: (p) => {
    pending.push(p);
    timer ??= setTimeout(() => {
      const batch = pending;
      pending = [];
      timer = undefined;
      set((s) => {
        const logs = { ...s.logs };
        const added: Record<string, LogLine[]> = {};
        for (const b of batch) (added[b.instanceId] ??= []).push({ id: nextLogId++, stream: b.stream, line: b.line, tone: toneOf(b) });
        for (const [id, items] of Object.entries(added)) logs[id] = [...(logs[id] ?? []), ...items].slice(-MAX_LOG_LINES);
        return { logs };
      });
    }, 50);
  },
  clearLog: (id) => {
    pending = pending.filter((p) => p.instanceId !== id);
    set((s) => ({ logs: { ...s.logs, [id]: [] } }));
  },
  setCrash: (exit) => set((s) => ({ crashes: { ...s.crashes, [exit.instanceId]: exit } })),
  clearCrash: (id) =>
    set((s) => {
      const { [id]: _, ...crashes } = s.crashes;
      return { crashes };
    }),
}));
