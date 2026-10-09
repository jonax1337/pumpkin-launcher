import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { PumpkinChoice } from "@/branding/calendar";
import type { LanguageChoice } from "@/i18n/types";
import { EMPTY_LAUNCH } from "@/lib/launchSettings";
import type { JvmPreset } from "@/lib/jvm";
import type { GameWindow, LaunchSettings } from "@/lib/types";

export type PxSize = "s" | "m" | "l";
export type TextSize = "m" | "l" | "xl";

/** Was der Launcher beim Spielstart mit seinem Fenster tut. */
export type LauncherOnPlay = "keep" | "minimize" | "close";

/** Aktives Konto: Offline-Spielername oder Microsoft-Konto (der Name wird für die Anzeige mitgemerkt). */
export type ActiveAccount = { kind: "offline"; name: string } | { kind: "microsoft"; id: string; username: string };

// Einstellungen und Offline-Namen leben lokal (localStorage); das Backend bekommt sie beim Start übergeben.
interface SettingsState {
  /** Leer = mitgelieferte Java-Runtime. */
  javaPath: string;
  /** RAM für Instanzen ohne eigenen Wert; null = automatisch nach Arbeitsspeicher des PCs. */
  memoryMb: number | null;
  /** Minimaler RAM (-Xms) für Instanzen ohne eigenen Wert; null = die JVM entscheidet. */
  minMemoryMb: number | null;
  /** JVM-Argumente für Instanzen ohne eigene: eine Vorgabe oder der Text unter `jvmArgs`. */
  jvmPreset: JvmPreset;
  /** Eigener Text der JVM-Argumente, gilt bei der Vorgabe „Eigene“. */
  jvmArgs: string;
  /** Fenster für Instanzen, die keines festlegen. */
  window: GameWindow;
  /** Umgebungsvariablen, Wrapper und Hooks für Instanzen, die zu einem Feld nichts eingestellt haben. */
  launch: LaunchSettings;
  launcherOnPlay: LauncherOnPlay;
  active: ActiveAccount | null;
  offlineAccounts: string[];
  /** Pixelgröße: 2/3/4 CSS-Pixel bei 100 % Skalierung. */
  pxSize: PxSize;
  /** Textgröße der ganzen Oberfläche: normal, groß, größer (Faktoren: app/useAppearance.ts). */
  textSize: TextSize;
  /** Bewegte Szenen (Sterne, Wolken, Glut); pausieren ohnehin, solange Minecraft läuft. */
  motion: boolean;
  /** Automatisch nach Jahreszeit oder eine dauerhaft gewählte Pumpkin-Variante. */
  pumpkin: PumpkinChoice;
  /** Das laufende Spiel in Discord zeigen (Version und Loader, sonst nichts); aus, bis der Spieler es einschaltet. */
  discordPresence: boolean;
  /**
   * Sprachwahl der Oberfläche. „system“ folgt der Browsersprache (beginnt `navigator.language`
   * mit „de“, gilt Deutsch, sonst Englisch) – der Start soll ohne Rückfrage passen.
   */
  language: LanguageChoice;
  set: (patch: SettingsPatch) => void;
  reset: () => void;
  addAccount: (name: string) => void;
  selectAccount: (account: ActiveAccount) => void;
  removeAccount: (name: string) => void;
  /** Microsoft-Konto wurde entfernt: war es aktiv, übernimmt der erste Offline-Name. */
  forgetMicrosoft: (id: string) => void;
  /** Nach dem Laden der Microsoft-Konten: fehlt das aktive, übernimmt der erste Offline-Name. */
  syncMicrosoft: (ids: string[]) => void;
}

/** Einstellungen, die `set` ändert; Konten haben eigene Aktionen. */
type SettingsPatch = Partial<
  Pick<
    SettingsState,
    "javaPath" | "memoryMb" | "minMemoryMb" | "jvmPreset" | "jvmArgs" | "launch" | "window" | "launcherOnPlay" | "pxSize" | "textSize" | "motion" | "pumpkin" | "discordPresence" | "language"
  >
>;

/** Die Werte, auf die „Zurücksetzen“ die Spieleinstellungen stellt. */
const RESETTABLE_DEFAULTS = {
  javaPath: "",
  memoryMb: null,
  minMemoryMb: null,
  jvmPreset: "balanced",
  jvmArgs: "",
  launch: EMPTY_LAUNCH,
  window: { type: "default" },
  launcherOnPlay: "keep",
} satisfies Partial<SettingsState>;

const DEFAULT_SETTINGS = {
  ...RESETTABLE_DEFAULTS,
  active: null,
  offlineAccounts: [],
  pxSize: "m",
  textSize: "m",
  motion: true,
  pumpkin: "auto",
  discordPresence: false,
  language: "system",
} satisfies Partial<SettingsState>;

/** Bis Version 2 der feste Standard für den Arbeitsspeicher; seitdem bedeutet `null` „automatisch“. */
const LEGACY_DEFAULT_MEMORY_MB = 4096;

/** Wie im Spiel und im Backend (`auth::offline_account`). */
export const isValidPlayerName = (name: string) => /^[A-Za-z0-9_]{3,16}$/.test(name);

/** Anzeigename des aktiven Kontos ("" = keins). */
export const accountName = (a: ActiveAccount | null) => (a ? (a.kind === "offline" ? a.name : a.username) : "");

const offline = (name: string | undefined): ActiveAccount | null => (name ? { kind: "offline", name } : null);

// ---------- Migration gespeicherter Einstellungen ----------

type Stored = Record<string, unknown>;

/** Version des gespeicherten Formats; jede Änderung braucht einen Schritt in `migrate`. */
const SETTINGS_VERSION = 6;

/** v1 kannte nur einen Offline-Namen, v2 eine Liste mit `offlineName` als aktivem Namen; ab v3 gilt `active` mit `offlineAccounts`. */
function migrateAccounts(old: Stored, version: number): Stored {
  const prev = old as { javaPath?: string; memoryMb?: number; offlineName?: string; offlineAccounts?: string[] };
  const name = prev.offlineName && isValidPlayerName(prev.offlineName) ? prev.offlineName : "";
  const accounts = version >= 2 ? (prev.offlineAccounts ?? []) : name ? [name] : [];
  return {
    javaPath: prev.javaPath ?? DEFAULT_SETTINGS.javaPath,
    memoryMb: prev.memoryMb == null || prev.memoryMb === LEGACY_DEFAULT_MEMORY_MB ? DEFAULT_SETTINGS.memoryMb : prev.memoryMb,
    active: offline(name),
    offlineAccounts: accounts,
  };
}

/** v4 hatte noch eine eigene Microsoft-Kennung (`msClientId`); der Launcher bringt seine mit. */
function withoutClientId(old: Stored): Stored {
  const { msClientId: _dropped, ...rest } = old;
  return rest;
}

/**
 * Hebt gespeicherte Einstellungen Schritt für Schritt auf die aktuelle Version. Felder, die ein Schritt nicht
 * kennt, ergänzt `persist` aus dem Anfangszustand, deshalb braucht nur ein Schritt zu ändern, was sich wandelt.
 */
function migrate(persisted: unknown, version: number): SettingsState {
  let state = persisted as Stored;
  if (version < 3) state = migrateAccounts(state, version);
  // v3 hatte noch die Seitenleiste; Pixelgröße und Bewegung kamen mit Pixelkino.
  if (version < 4) state = { ...state, pxSize: DEFAULT_SETTINGS.pxSize, motion: DEFAULT_SETTINGS.motion };
  if (version < 5) state = withoutClientId(state);
  // v5 kannte noch keine Sprachwahl; „system“ (Browsersprache folgen) ist der neue Standard.
  if (version < 6) state = { ...state, language: DEFAULT_SETTINGS.language };
  return state as unknown as SettingsState;
}

export const useSettings = create<SettingsState>()(
  persist(
    (set) => ({
      ...DEFAULT_SETTINGS,
      set: (patch) => set(patch),
      reset: () => set(RESETTABLE_DEFAULTS),
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
    { name: "launcher-settings", version: SETTINGS_VERSION, migrate },
  ),
);
