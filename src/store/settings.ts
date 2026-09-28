import { create } from "zustand";
import { persist } from "zustand/middleware";

// Noch kein Backend – Einstellungen werden lokal (localStorage) persistiert.
interface SettingsState {
  javaPath: string;
  memoryMb: number;
  gameDir: string;
  instancesDir: string;
  closeOnLaunch: boolean;
  offlineName: string;
  set: (patch: Partial<Omit<SettingsState, "set" | "reset">>) => void;
  reset: () => void;
}

const defaults = {
  javaPath: "",
  memoryMb: 4096,
  gameDir: "%APPDATA%\\.launcher",
  instancesDir: "%APPDATA%\\.launcher\\instances",
  closeOnLaunch: false,
  offlineName: "Steve",
};

export const useSettings = create<SettingsState>()(
  persist(
    (set) => ({
      ...defaults,
      set: (patch) => set(patch),
      reset: () => set(defaults),
    }),
    { name: "launcher-settings", version: 1 },
  ),
);
