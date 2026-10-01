import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { PumpkinChoice } from "@/branding/calendar";
import type { LanguageChoice } from "@/i18n/types";

export type PxSize = "s" | "m" | "l";

/** Aktives Konto: Offline-Spielername oder Microsoft-Konto (der Name wird für die Anzeige mitgemerkt). */
export type ActiveAccount = { kind: "offline"; name: string } | { kind: "microsoft"; id: string; username: string };

// Einstellungen und Offline-Namen leben lokal (localStorage); das Backend bekommt sie beim Start übergeben.
interface SettingsState {
  /** Leer = mitgelieferte Java-Runtime. */
  javaPath: string;
  /** RAM für Instanzen ohne eigenen Wert; null = automatisch nach Arbeitsspeicher des PCs. */
  memoryMb: number | null;
  active: ActiveAccount | null;
  offlineAccounts: string[];
  /** Pixelgröße: 2/3/4 CSS-Pixel bei 100 % Skalierung. */
  pxSize: PxSize;
  /** Bewegte Szenen (Sterne, Wolken, Glut); pausieren ohnehin, solange Minecraft läuft. */
  motion: boolean;
  /** Automatisch nach Jahreszeit oder eine dauerhaft gewählte Pumpkin-Variante. */
  pumpkin: PumpkinChoice;
  /**
   * Sprachwahl der Oberfläche. „system“ folgt der Browsersprache (beginnt `navigator.language`
   * mit „de“, gilt Deutsch, sonst Englisch) – der Start soll ohne Rückfrage passen.
   */
  language: LanguageChoice;
  set: (patch: Partial<Pick<SettingsState, "javaPath" | "memoryMb" | "pxSize" | "motion" | "pumpkin" | "language">>) => void;
  reset: () => void;
  addAccount: (name: string) => void;
  selectAccount: (account: ActiveAccount) => void;
  removeAccount: (name: string) => void;
  /** Microsoft-Konto wurde entfernt: war es aktiv, übernimmt der erste Offline-Name. */
  forgetMicrosoft: (id: string) => void;
  /** Nach dem Laden der Microsoft-Konten: fehlt das aktive, übernimmt der erste Offline-Name. */
  syncMicrosoft: (ids: string[]) => void;
}

const defaults = { javaPath: "", memoryMb: null };

/** Bis Version 2 der feste Standard für den Arbeitsspeicher; seitdem bedeutet `null` „automatisch“. */
const LEGACY_DEFAULT_MEMORY_MB = 4096;

function withoutClientId(old: unknown) {
  const { msClientId: _dropped, ...rest } = old as Record<string, unknown>;
  return rest;
}

/** Wie im Spiel und im Backend (`auth::offline_account`). */
export const isValidPlayerName = (name: string) => /^[A-Za-z0-9_]{3,16}$/.test(name);

/** Anzeigename des aktiven Kontos ("" = keins). */
export const accountName = (a: ActiveAccount | null) => (a ? (a.kind === "offline" ? a.name : a.username) : "");

const offline = (name: string | undefined): ActiveAccount | null => (name ? { kind: "offline", name } : null);

export const useSettings = create<SettingsState>()(
  persist(
    (set) => ({
      ...defaults,
      active: null,
      offlineAccounts: [],
      pxSize: "m",
      motion: true,
      pumpkin: "auto",
      language: "system",
      set: (patch) => set(patch),
      reset: () => set(defaults),
      addAccount: (name) =>
        set((s) => ({
          offlineAccounts: s.offlineAccounts.includes(name) ? s.offlineAccounts : [...s.offlineAccounts, name],
          active: { kind: "offline", name },
        })),
      selectAccount: (active) => set({ active }),
      removeAccount: (name) =>
        set((s) => {
          const offlineAccounts = s.offlineAccounts.filter((n) => n !== name);
          const wasActive = s.active?.kind === "offline" && s.active.name === name;
          return { offlineAccounts, active: wasActive ? offline(offlineAccounts[0]) : s.active };
        }),
      forgetMicrosoft: (id) =>
        set((s) => (s.active?.kind === "microsoft" && s.active.id === id ? { active: offline(s.offlineAccounts[0]) } : {})),
      syncMicrosoft: (ids) =>
        set((s) => (s.active?.kind === "microsoft" && !ids.includes(s.active.id) ? { active: offline(s.offlineAccounts[0]) } : {})),
    }),
    {
      name: "launcher-settings",
      version: 6,
      migrate: (old, version) => {
        // v5 kannte noch keine Sprachwahl; „system“ (Browsersprache folgen) ist der neue Standard.
        if (version === 5) return { ...(old as Record<string, unknown>), language: "system" } as unknown as SettingsState;
        // v4 hatte noch eine eigene Microsoft-Kennung (`msClientId`); der Launcher bringt seine mit.
        if (version === 4) return withoutClientId(old) as unknown as SettingsState;
        // v3 hatte noch die Seitenleiste; Pixelgröße und Bewegung kamen mit Pixelkino.
        if (version === 3) return { ...withoutClientId(old), pxSize: "m", motion: true } as unknown as SettingsState;
        // v1 kannte nur einen Offline-Namen, v2 eine Liste mit `offlineName` als aktivem Namen.
        const prev = old as { javaPath?: string; memoryMb?: number; offlineName?: string; offlineAccounts?: string[] };
        const name = prev.offlineName && isValidPlayerName(prev.offlineName) ? prev.offlineName : "";
        const accounts = version >= 2 ? (prev.offlineAccounts ?? []) : name ? [name] : [];
        return {
          javaPath: prev.javaPath ?? "",
          memoryMb: prev.memoryMb == null || prev.memoryMb === LEGACY_DEFAULT_MEMORY_MB ? null : prev.memoryMb,
          active: offline(name),
          offlineAccounts: accounts,
          pxSize: "m",
          motion: true,
        } as unknown as SettingsState;
      },
    },
  ),
);
