import { create } from "zustand";
import { persist } from "zustand/middleware";

// Einstellungen und Offline-Accounts leben lokal (localStorage); das Backend bekommt sie beim Start übergeben.
interface SettingsState {
  /** Leer = mitgelieferte Java-Runtime. */
  javaPath: string;
  /** RAM für Instanzen ohne eigenen Wert. */
  memoryMb: number;
  /** Aktiver Offline-Account ("" = keiner). */
  offlineName: string;
  offlineAccounts: string[];
  /** Seitenleiste eingeklappt; null = automatisch nach Fensterbreite. */
  sidebarCollapsed: boolean | null;
  set: (patch: Partial<Pick<SettingsState, "javaPath" | "memoryMb" | "sidebarCollapsed">>) => void;
  reset: () => void;
  addAccount: (name: string) => void;
  selectAccount: (name: string) => void;
  removeAccount: (name: string) => void;
}

const defaults = { javaPath: "", memoryMb: 4096 };

/** Wie im Spiel und im Backend (`auth::offline_account`). */
export const isValidPlayerName = (name: string) => /^[A-Za-z0-9_]{3,16}$/.test(name);

export const useSettings = create<SettingsState>()(
  persist(
    (set) => ({
      ...defaults,
      offlineName: "",
      offlineAccounts: [],
      sidebarCollapsed: null,
      set: (patch) => set(patch),
      reset: () => set(defaults),
      addAccount: (name) =>
        set((s) => ({
          offlineAccounts: s.offlineAccounts.includes(name) ? s.offlineAccounts : [...s.offlineAccounts, name],
          offlineName: name,
        })),
      selectAccount: (name) => set({ offlineName: name }),
      removeAccount: (name) =>
        set((s) => {
          const offlineAccounts = s.offlineAccounts.filter((n) => n !== name);
          return { offlineAccounts, offlineName: s.offlineName === name ? (offlineAccounts[0] ?? "") : s.offlineName };
        }),
    }),
    {
      name: "launcher-settings",
      version: 2,
      // v1 kannte nur einen einzelnen Offline-Namen
      migrate: (old) => {
        const v1 = old as { javaPath?: string; memoryMb?: number; offlineName?: string };
        const name = v1.offlineName && isValidPlayerName(v1.offlineName) ? v1.offlineName : "";
        return { ...defaults, ...v1, offlineName: name, offlineAccounts: name ? [name] : [] } as SettingsState;
      },
    },
  ),
);
