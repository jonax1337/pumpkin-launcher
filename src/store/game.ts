import { create } from "zustand";
import type { ExitPayload, InstallProgress, LogPayload } from "@/lib/types";

export interface LogLine {
  id: number;
  stream: LogPayload["stream"];
  line: string;
  /** Beim Anhängen einmal berechnet, damit die Anzeige keine Regex je Render braucht. */
  tone: "error" | "warn" | "normal";
}

/** Schweregrad einer Zeile: Fehlerstrom oder ERROR/FATAL, WARN, sonst normal. */
export const toneOf = ({ stream, line }: Pick<LogPayload, "stream" | "line">): LogLine["tone"] =>
  stream === "stderr" || /\/(ERROR|FATAL)\]/.test(line) ? "error" : /\/WARN\]/.test(line) ? "warn" : "normal";

// Der Puffer hält je Instanz nur die letzten Zeilen; vollständige Logs liest man aus der Datei im Backend.
const MAX_LOG_LINES = 2000;

/** So lange sammelt der Puffer Zeilen, bevor sie gebündelt in den Store gehen. */
const LOG_BATCH_MS = 50;

/**
 * Sammelt Log-Events und gibt sie gebündelt ab: Sie kommen zeilenweise, aber pro Zeile Array kopieren und rendern wäre zu teuer.
 * Timer statt requestAnimationFrame: rAF pausiert bei minimiertem Fenster, dann wüchse der Puffer unbegrenzt.
 */
function createLogBuffer(onFlush: (added: Record<string, LogLine[]>) => void) {
  let pending: LogPayload[] = [];
  let timer: ReturnType<typeof setTimeout> | undefined;
  let nextLogId = 0;

  function flush() {
    const added: Record<string, LogLine[]> = {};
    for (const p of pending) (added[p.instanceId] ??= []).push({ id: nextLogId++, stream: p.stream, line: p.line, tone: toneOf(p) });
    pending = [];
    timer = undefined;
    onFlush(added);
  }

  return {
    push(p: LogPayload) {
      pending.push(p);
      timer ??= setTimeout(flush, LOG_BATCH_MS);
    },
    /** Verwirft die noch nicht abgelieferten Zeilen einer Instanz. */
    discard(instanceId: string) {
      pending = pending.filter((p) => p.instanceId !== instanceId);
    },
  };
}

/** Das Record ohne den Eintrag `id` (neues Objekt, damit der Store ändert). */
function omitKey<V>(record: Record<string, V>, id: string): Record<string, V> {
  const { [id]: _, ...rest } = record;
  return rest;
}

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
  /** Vor einem Start: Protokoll und letzten Absturz der Instanz verwerfen. */
  beginRun: (instanceId: string) => void;
}

/** Startet oder läuft gerade ein Minecraft? */
export const isGameActive = (s: GameState) => Object.keys(s.launching).length > 0 || Object.keys(s.started).length > 0;

export const useGame = create<GameState>()((set, get) => {
  const logBuffer = createLogBuffer((added) =>
    set((s) => {
      const logs = { ...s.logs };
      for (const [id, lines] of Object.entries(added)) logs[id] = [...(logs[id] ?? []), ...lines].slice(-MAX_LOG_LINES);
      return { logs };
    }),
  );

  return {
    installs: {},
    launching: {},
    logs: {},
    crashes: {},
    started: {},
    setStarted: (id, at) =>
      set((s) => {
        const rest = omitKey(s.started, id);
        return { started: at == null ? rest : { ...rest, [id]: at } };
      }),
    setProgress: (p) => set((s) => ({ installs: { ...s.installs, [p.instanceId]: p } })),
    clearProgress: (id) => set((s) => ({ installs: omitKey(s.installs, id) })),
    setLaunching: (id, launching) =>
      set((s) => {
        const rest = omitKey(s.launching, id);
        return { launching: launching ? { ...rest, [id]: true } : rest };
      }),
    appendLog: logBuffer.push,
    clearLog: (id) => {
      logBuffer.discard(id);
      set((s) => ({ logs: { ...s.logs, [id]: [] } }));
    },
    setCrash: (exit) => set((s) => ({ crashes: { ...s.crashes, [exit.instanceId]: exit } })),
    clearCrash: (id) => set((s) => ({ crashes: omitKey(s.crashes, id) })),
    beginRun: (id) => {
      get().clearLog(id);
      get().clearCrash(id);
    },
  };
});
