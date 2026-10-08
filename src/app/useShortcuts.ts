import { useEffect } from "react";
import { useNavigate, type NavigateFunction } from "react-router";
import { showShortcuts } from "@/components/ShortcutsDialog";
import { platform } from "@/lib/platform";
import { newInstanceUrl } from "@/lib/routes";
import { dialogOpen } from "./dialogOpen";
import { TABS } from "./mainTabs";
import { openPalette } from "./palette/CommandPalette";
import { HELP_KEY, SEARCH_KEY } from "./shortcuts";

/** Eingabearten, in die man nichts tippt (dort bleiben auch die Einzeltasten frei). */
const NON_TEXT_INPUT_TYPES = ["checkbox", "radio", "button", "submit", "reset", "range", "file", "color"];

/** Fokus in einem Feld, in das getippt wird. */
function typing(el: Element | null) {
  if (!(el instanceof HTMLElement)) return false;
  if (el.isContentEditable || el instanceof HTMLTextAreaElement) return true;
  return el instanceof HTMLInputElement && !NON_TEXT_INPUT_TYPES.includes(el.type);
}

/** Fokus in einem geöffneten Menü oder einer Auswahlliste: dort gehören Buchstaben der Tippsuche. */
const inPopup = (el: Element | null) => !!el?.closest("[role=menu], [role=listbox]");

/** Befehlstaste allein (ohne Alt/Umschalt): unter macOS Cmd, sonst Strg; die jeweils andere stört. */
function commandOnly(e: KeyboardEvent) {
  const [command, other] = platform === "macos" ? [e.metaKey, e.ctrlKey] : [e.ctrlKey, e.metaKey];
  return command && !other && !e.altKey && !e.shiftKey;
}

/** Keine Befehlstaste und kein Alt: Umschalt bleibt erlaubt, "?" und "/" brauchen sie je nach Tastaturbelegung. */
const plainKey = (e: KeyboardEvent) => !e.ctrlKey && !e.metaKey && !e.altKey;

const isShown = (el: HTMLElement) => el.getClientRects().length > 0 && getComputedStyle(el).visibility === "visible";

/** Die sichtbare erste Fundstelle unter `.view` (die Seite; Dialoge und Seitenleiste zählen nicht). */
const visibleInPage = <E extends HTMLElement>(selector: string) =>
  [...document.querySelectorAll<E>(`.view ${selector}`)].find(isShown);

function focusPageSearch() {
  const field = visibleInPage<HTMLInputElement>("input[type=search]");
  field?.focus();
  field?.select();
  return !!field;
}

/** Spielen der Seite (Start, Instanz): derselbe Klick wie auf dem Knopf, also auch „Beenden“ mit Rückfrage. */
function clickMainPlay() {
  const button = visibleInPage<HTMLButtonElement>("[data-main-play]");
  button?.click();
  return !!button;
}

/**
 * Befehle mit Befehlstaste. In Textfeldern gelten nur Strg+Zahl, Strg+F und Strg+K (die Palette lässt das Feld unberührt):
 * Strg+Enter ist dort eine Eingabegeste, Strg+N und Strg+, ließen beim Wegnavigieren Getipptes verloren gehen.
 * `true`, wenn die Taste etwas ausgelöst hat.
 */
function runCommand(key: string, navigate: NavigateFunction, inField: boolean) {
  const tab = TABS[Number(key) - 1];
  if (tab) {
    navigate(tab.to);
    return true;
  }
  const command = key.toLowerCase();
  if (command === "f") return focusPageSearch();
  if (command === "k") {
    openPalette();
    return true;
  }
  if (inField) return false;
  switch (command) {
    case ",":
      navigate("/settings");
      return true;
    case "n":
      navigate(newInstanceUrl());
      return true;
    case "enter":
      return clickMainPlay();
    default:
      return false;
  }
}

/** Einzeltasten; sie gelten nur, wo nicht getippt wird. */
function runPlainKey(key: string) {
  if (key === SEARCH_KEY) return focusPageSearch();
  if (key !== HELP_KEY) return false;
  showShortcuts();
  return true;
}

/**
 * Strg+1…n wechselt den Bereich, Strg+K öffnet die Befehlspalette, Strg+, die Einstellungen, Strg+N „Neue Instanz“,
 * Strg+Enter „Spielen“, Strg+F und "/" fokussieren die Suche der Seite, "?" zeigt die Übersicht (macOS: Cmd statt Strg).
 * Bei offenem Dialog nichts (sonst gingen Eingaben verloren, und die Palette öffnet sich nie über einem anderen Dialog);
 * Einzeltasten nur außerhalb von Textfeldern und Menüs, Befehle in Textfeldern nur Strg+Zahl, Strg+F und Strg+K.
 */
export function useShortcuts() {
  const navigate = useNavigate();
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.defaultPrevented || dialogOpen()) return;
      const focused = document.activeElement;
      const handled = commandOnly(e)
        ? runCommand(e.key, navigate, typing(focused))
        : plainKey(e) && !typing(focused) && !inPopup(focused) && runPlainKey(e.key);
      if (handled) e.preventDefault();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [navigate]);
}
