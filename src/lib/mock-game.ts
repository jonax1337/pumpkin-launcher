// Nur im Browser-Dev-Modus dynamisch geladen (siehe api.ts); im Release-Build nicht enthalten.
import { currentLanguage, t } from "@/i18n";
import type { Backend } from "./backend";
import { MOCK_VERSIONS } from "./mock-data";
import { clone, findInstance, wait, type MockContext } from "./mock-util";
import { cancelledError } from "./errors";
import { quickPlayTarget, type InstallStep, type ModLoader } from "./types";

/** Arbeitsspeicher des vorgetäuschten PCs. */
export const MOCK_SYSTEM_MEMORY_MB = 16384;

const MOCK_LOADER_VERSIONS: Record<ModLoader, string[]> = {
  vanilla: [],
  fabric: ["0.17.3", "0.17.2", "0.16.14"],
  quilt: ["0.29.1", "0.29.0-beta.4"],
  neoforge: ["21.1.172", "21.1.170"],
  forge: ["52.1.1", "52.0.40"],
};

/** Schritte der vorgetäuschten Installation mit ihrer Menge; mit Loader kommen zwei dazu. */
const installSteps = (loader: ModLoader): [InstallStep, number][] => {
  const steps: [InstallStep, number][] = [["java", 60], ["client", 2], ["libraries", 40], ["natives", 4], ["assets", 120]];
  return loader === "vanilla" ? steps : [["loader", 1], ...steps, ["mods", 1]];
};

/** Fortschritt eines Schritts in so vielen Teilen, mit dieser Pause dazwischen. */
const INSTALL_PARTS = 12;
const INSTALL_STEP_MS = 90;

/** Abstand der Demo-Logzeilen, jede siebte geht auf stderr. */
const DEMO_LOG_INTERVAL_MS = 400;
const DEMO_STDERR_EVERY = 7;
const MOCK_PID = 4242;

/** Lasttest: Zeilen je Pause und Pause. */
const BURST_CHUNK = 100;
const BURST_PAUSE_MS = 20;
const BURST_WARN_EVERY = 50;
const DEFAULT_BURST_LINES = 5000;

/** Installation, Start und Beenden des vorgetäuschten Spiels samt Protokoll. */
export function createGameMock({ db, emit }: MockContext) {
  /** Beendet das simulierte Spiel und rechnet wie das Backend die Spielzeit seit dem Start an. */
  function stop(instanceId: string) {
    clearInterval(db.running.get(instanceId));
    db.running.delete(instanceId);
    const inst = findInstance(db, instanceId);
    inst.playtimeSecs += Math.round((Date.now() - (inst.lastPlayedAt ?? Date.now())) / 1000);
  }

  /** Nur zum Vorführen: `pumpkinMock.crash("inst-survival")` in der Browser-Konsole. */
  function crash(instanceId: string) {
    stop(instanceId);
    emit("instance-exit", {
      instanceId,
      code: -1,
      crashed: true,
      crashReport: "C:\Pumpkin Launcher\instances\survival\crash-reports\crash-2026-09-29.txt",
      logFile: "C:\Pumpkin Launcher\instances\survival\logs\latest.log",
      suspectedMods: ["Sodium", "Iris Shaders"],
    });
  }

  /** Lasttest fürs Protokoll: `pumpkinMock.logBurst("inst-vanilla")` schickt 5000 Zeilen in etwa 1–2 s. */
  async function logBurst(instanceId: string, count = DEFAULT_BURST_LINES) {
    for (let i = 0; i < count; i++) {
      const level = i % BURST_WARN_EVERY ? "INFO" : "WARN";
      const line = `[Render thread/${level}]: ${t("hooks.api.loadTestLine", { n: i + 1 })}`;
      emit("instance-log", { instanceId, stream: "stdout", line });
      if (i % BURST_CHUNK === BURST_CHUNK - 1) await wait(BURST_PAUSE_MS);
    }
  }

  Object.assign(globalThis, { pumpkinMock: { crash, logBurst } });

  return {
    async versionsList() {
      await wait(400);
      return clone(MOCK_VERSIONS);
    },
    async loaderVersions(loader) {
      await wait(300);
      return MOCK_LOADER_VERSIONS[loader].map((version) => ({ version, stable: !version.includes("beta") }));
    },
    async installInstance(instanceId) {
      const inst = findInstance(db, instanceId);
      db.cancelled.delete(instanceId);
      for (const [step, total] of installSteps(inst.loader)) {
        for (let done = 0; done <= total; done += Math.ceil(total / INSTALL_PARTS)) {
          if (db.cancelled.delete(instanceId)) throw cancelledError();
          emit("install-progress", { instanceId, step, done: Math.min(done, total), total });
          await wait(INSTALL_STEP_MS);
        }
      }
      db.installed.add(instanceId);
    },
    installCancel: (instanceId) => Promise.resolve(void db.cancelled.add(instanceId)),
    async launchInstance(instanceId, { username, quickPlay }) {
      await wait(300);
      const inst = findInstance(db, instanceId);
      if (!db.installed.has(instanceId)) throw new Error(t("hooks.api.versionNotInstalled", { version: inst.minecraftVersion }));
      if (db.running.has(instanceId)) throw new Error(t("hooks.api.alreadyRunning"));
      const log = (line: string, stream: "stdout" | "stderr" = "stdout") =>
        emit("instance-log", { instanceId, stream, line: `[${new Date().toLocaleTimeString(currentLanguage())}] ${line}` });
      log(`[main/INFO]: Setting user: ${username}`);
      if (quickPlay) {
        log(`[main/INFO]: Quick Play: ${quickPlayTarget(quickPlay)}`);
        inst.lastQuickPlay = quickPlay;
      }
      let lines = 0;
      const demoLine = () => {
        lines++;
        log(`[Render thread/INFO]: ${t("hooks.api.demoLogLine", { n: lines })}`, lines % DEMO_STDERR_EVERY ? "stdout" : "stderr");
      };
      db.running.set(instanceId, window.setInterval(demoLine, DEMO_LOG_INTERVAL_MS));
      inst.lastPlayedAt = Date.now();
      return MOCK_PID;
    },
    async killInstance(instanceId) {
      if (!db.running.has(instanceId)) throw new Error(t("hooks.api.runningGameNotFound", { id: instanceId }));
      stop(instanceId);
      emit("instance-exit", { instanceId, code: null, crashed: false, crashReport: null, logFile: null, suspectedMods: [] });
    },
    systemMemoryMb: () => Promise.resolve(MOCK_SYSTEM_MEMORY_MB),
    async instanceStatus(instanceId) {
      await wait();
      return { installed: db.installed.has(instanceId), running: db.running.has(instanceId) };
    },
    async debugInfo() {
      await wait();
      return `Pumpkin Launcher (browser preview, no backend)\nInstances: ${db.instances.length}`;
    },
  } satisfies Partial<Backend>;
}
