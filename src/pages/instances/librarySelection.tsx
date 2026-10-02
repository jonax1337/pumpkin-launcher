import { createContext, useContext, useEffect, useRef, useState, type MouseEvent } from "react";
import { useI18n } from "@/i18n";
import { rangeBetween } from "./libraryModel";

/** Mehrfachauswahl der Bibliothek: was gewählt ist und wie Klicks auf Karten und Zeilen sie ändern. */
export type LibrarySelection = {
  /** Auswahlmodus: ein Klick wählt, statt die Instanz zu öffnen. */
  picking: boolean;
  /** Gewählte Instanzen, die gerade sichtbar sind (Filter können gewählte ausblenden). */
  picked: string[];
  isPicked: (id: string) => boolean;
  toggle: (id: string) => void;
  /** Klick auf Karte oder Zeile: Strg/Cmd wählt einzeln, Umschalt einen Bereich, im Auswahlmodus jeder Klick. Sonst öffnet die Instanz. */
  handleClick: (id: string, event: MouseEvent) => void;
  /** Alle sichtbaren Instanzen wählen. */
  selectAll: () => void;
  startPicking: () => void;
  /** Auswahl verwerfen und den Auswahlmodus verlassen. */
  stopPicking: () => void;
};

const SelectionContext = createContext<LibrarySelection | null>(null);
export const LibrarySelectionProvider = SelectionContext.Provider;

export function useLibrarySelection(): LibrarySelection {
  const selection = useContext(SelectionContext);
  if (!selection) throw new Error("useLibrarySelection braucht den LibrarySelectionProvider");
  return selection;
}

/**
 * Auswahl über die sichtbaren Instanzen in Anzeigereihenfolge `order` (für Bereiche per Umschalt-Klick).
 * `say` meldet Screenreadern die Anzahl.
 */
export function useSelectionState(order: string[], say: (text: string) => void): LibrarySelection {
  const { t } = useI18n();
  const [chosen, setChosen] = useState<ReadonlySet<string>>(new Set());
  const [selecting, setSelecting] = useState(false);
  const anchor = useRef<string | null>(null);
  const picked = order.filter((id) => chosen.has(id));
  const picking = selecting || picked.length > 0;

  const count = picked.length;
  const lastCount = useRef(count);
  useEffect(() => {
    if (count === lastCount.current) return;
    lastCount.current = count;
    say(count ? t("detail.content.selectedCount", { n: count }) : t("detail.content.selectionCleared"));
  }, [count]);

  function add(ids: string[], on: boolean) {
    setChosen((previous) => {
      const next = new Set(previous);
      for (const id of ids) (on ? next.add(id) : next.delete(id));
      return next;
    });
  }

  function toggle(id: string) {
    add([id], !chosen.has(id));
    anchor.current = id;
  }

  function handleClick(id: string, event: MouseEvent) {
    const range = event.shiftKey && anchor.current ? rangeBetween(order, anchor.current, id) : [];
    if (range.length) {
      event.preventDefault();
      add(range, true);
    } else if (event.shiftKey || event.ctrlKey || event.metaKey || picking) {
      event.preventDefault();
      toggle(id);
    }
  }

  function stopPicking() {
    setChosen(new Set());
    setSelecting(false);
    anchor.current = null;
  }

  return {
    picking,
    picked,
    isPicked: (id) => chosen.has(id),
    toggle,
    handleClick,
    selectAll: () => add(order, true),
    startPicking: () => setSelecting(true),
    stopPicking,
  };
}
