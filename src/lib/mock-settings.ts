// Nur im Browser-Dev-Modus dynamisch geladen (siehe api.ts); im Release-Build nicht enthalten.
import type { Backend } from "./backend";
import { findInstance, wait, type MockContext } from "./mock-util";
import { DAY, HOUR } from "./time";
import type { JavaInstall, LogSession, StorageOverview } from "./types";

const MB = 1024 * 1024;

/** Vorgetäuschte Java-Installationen des Rechners. */
const MOCK_JAVA: JavaInstall[] = [
  { path: "C:\\Program Files\\Eclipse Adoptium\\jdk-21.0.4.7-hotspot\\bin\\javaw.exe", version: "21.0.4", major: 21, vendor: "Eclipse Adoptium" },
  { path: "C:\\Program Files\\Microsoft\\jdk-17.0.12.7-hotspot\\bin\\javaw.exe", version: "17.0.12", major: 17, vendor: "Microsoft" },
  { path: "C:\\Program Files\\Java\\jre-1.8\\bin\\javaw.exe", version: "1.8.0_421", major: 8, vendor: null },
];

/** So viele frühere Sitzungen sichert der Mock je Instanz, im Abstand eines Tages und einer Stunde. */
const MOCK_SESSIONS = 3;

/** Größen der vorgetäuschten Ordner. */
const INSTANCE_BASE_MB = 180;
const MOD_MB = 6;
const SHARED_MB = 1480;
const CACHE_FILE_MB = 6;
const UNUSED_CACHE_FILES = 14;

const sessionText = (instanceId: string, sessionId: string) =>
  Array.from({ length: 6 }, (_, n) =>
    `[${new Date(Number(sessionId) + n * 1000).toLocaleTimeString()}] [Render thread/${n === 4 ? "WARN" : "INFO"}]: ${instanceId} · ${n + 1}`,
  ).join("\n");

/** Speicher, Java-Suche, gesicherte Protokolle und Fenstersteuerung für den Browser. */
export function createSettingsMock({ db }: MockContext) {
  let unusedCacheFiles = UNUSED_CACHE_FILES;
  const now = Date.now();
  const sessions: LogSession[] = Array.from({ length: MOCK_SESSIONS }, (_, n) => {
    const startedAt = now - (n + 1) * DAY - n * HOUR;
    return { id: String(startedAt), startedAt, size: (n + 2) * 1024 };
  });

  return {
    async detectJava() {
      await wait();
      return structuredClone(MOCK_JAVA);
    },
    async storageOverview(): Promise<StorageOverview> {
      await wait();
      const usedCacheFiles = db.instances.reduce((sum, i) => sum + i.mods.length, 0);
      return {
        dataDir: "C:\\Users\\Steve\\AppData\\Roaming\\net.pumpkin.launcher",
        freeMb: 182_400,
        instances: db.instances.map((i) => ({ id: i.id, bytes: (INSTANCE_BASE_MB + i.mods.length * MOD_MB) * MB })),
        modCacheBytes: (usedCacheFiles + unusedCacheFiles) * CACHE_FILE_MB * MB,
        unusedCacheBytes: unusedCacheFiles * CACHE_FILE_MB * MB,
        sharedBytes: SHARED_MB * MB,
      };
    },
    async storageClearCache() {
      await wait();
      const freed = unusedCacheFiles * CACHE_FILE_MB * MB;
      unusedCacheFiles = 0;
      return freed;
    },
    logSessions: async (instanceId) => {
      await wait();
      findInstance(db, instanceId);
      return structuredClone(sessions);
    },
    logSessionRead: async (instanceId, sessionId) => {
      await wait();
      return sessionText(instanceId, sessionId);
    },
    setLauncherWindow: () => Promise.resolve(),
  } satisfies Partial<Backend>;
}
