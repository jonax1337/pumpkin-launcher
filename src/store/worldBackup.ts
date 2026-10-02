import { create } from "zustand";
import { persist } from "zustand/middleware";

/** So viele automatische Sicherungen je Welt sind einstellbar; die Obergrenze gilt auch im Backend (`worlds::auto`). */
export const BACKUP_KEEP_MIN = 1;
export const BACKUP_KEEP_MAX = 50;
const BACKUP_KEEP_DEFAULT = 5;

/**
 * Welten vor dem Spielstart sichern: Einstellung des Launchers für alle Instanzen, die keine eigene Wahl haben
 * (`Instance.backupWorlds`). Lebt lokal; das Backend bekommt sie beim Start übergeben.
 */
interface WorldBackupState {
  enabled: boolean;
  /** So viele automatische Sicherungen bleiben je Welt erhalten. */
  keep: number;
  set: (patch: Partial<Pick<WorldBackupState, "enabled" | "keep">>) => void;
}

export const useWorldBackup = create<WorldBackupState>()(
  persist((set) => ({ enabled: false, keep: BACKUP_KEEP_DEFAULT, set: (patch) => set(patch) }), { name: "launcher-world-backup", version: 1 }),
);
