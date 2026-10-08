import type { t as translate } from "@/i18n";
import { platform } from "@/lib/platform";

/** Befehlstaste in der Schreibweise von `aria-keyshortcuts`: Cmd unter macOS, sonst Strg. */
const MOD = platform === "macos" ? "Meta" : "Control";

/** Kürzel mit Befehlstaste, z. B. `withMod("N")` → "Control+N". */
export const withMod = (key: string) => `${MOD}+${key}`;

/** Kürzel außerhalb der Bereichswechsel (Strg+1…, siehe mainTabs.ts); eine Quelle für Tooltips, `aria-keyshortcuts` und die Übersicht. */
export const SHORTCUT = {
  settings: withMod(","),
  newInstance: withMod("N"),
  play: withMod("Enter"),
  search: withMod("F"),
  palette: withMod("K"),
} as const;

/** Taste ohne Befehlstaste: fokussiert die Suche der Seite. */
export const SEARCH_KEY = "/";
/** Taste ohne Befehlstaste: öffnet die Übersicht der Kürzel. */
export const HELP_KEY = "?";

/** Lesbare Schreibweise für Menschen: "Control+N" → "Strg+N" bzw. "Ctrl+N", "Meta+N" → "Cmd+N". */
export function shortcutLabel(shortcut: string, t: typeof translate) {
  return shortcut
    .split("+")
    .map((key) => (key === "Control" ? t("ui.shortcut.ctrl") : key === "Meta" ? "Cmd" : key))
    .join("+");
}
