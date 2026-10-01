import { useEffect } from "react";
import { useNavigate } from "react-router";
import { platform } from "@/lib/platform";
import { newInstanceUrl } from "@/lib/routes";
import { dialogOpen } from "./dialogOpen";
import { TABS } from "./mainTabs";

/** Eingabearten, in die man nichts tippt (dort gehört Strg+N/Strg+, nicht dem Feld). */
const NON_TEXT_INPUT_TYPES = ["checkbox", "radio", "button", "submit", "reset", "range", "file", "color"];

/** Fokus in einem Feld, in das getippt wird. */
function typing(el: Element | null) {
  if (!(el instanceof HTMLElement)) return false;
  if (el.isContentEditable || el instanceof HTMLTextAreaElement) return true;
  return el instanceof HTMLInputElement && !NON_TEXT_INPUT_TYPES.includes(el.type);
}

/** Befehlstaste allein (ohne Alt/Umschalt): unter macOS Cmd, sonst Strg; die jeweils andere stört. */
function commandOnly(e: KeyboardEvent) {
  const [command, other] = platform === "macos" ? [e.metaKey, e.ctrlKey] : [e.ctrlKey, e.metaKey];
  return command && !other && !e.altKey && !e.shiftKey;
}

/**
 * Strg+1…3 wechselt den Bereich, Strg+, öffnet die Einstellungen, Strg+N „Neue Instanz“ (macOS: Cmd statt Strg).
 * Bei offenem Dialog nichts (sonst gingen Eingaben verloren); in Textfeldern nur Strg+Zahl.
 */
export function useShortcuts() {
  const navigate = useNavigate();
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (!commandOnly(e) || e.defaultPrevented) return;
      if (dialogOpen()) return;
      const tab = TABS[Number(e.key) - 1];
      if (tab) {
        e.preventDefault();
        navigate(tab.to);
        return;
      }
      if (typing(document.activeElement)) return;
      if (e.key === ",") {
        e.preventDefault();
        navigate("/settings");
      } else if (e.key.toLowerCase() === "n") {
        e.preventDefault();
        navigate(newInstanceUrl());
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [navigate]);
}
