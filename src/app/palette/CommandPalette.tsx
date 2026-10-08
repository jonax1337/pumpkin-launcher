import { useId, useState, type KeyboardEvent } from "react";
import { useNavigate } from "react-router";
import { create } from "zustand";
import { useAnnouncement } from "@/hooks/useAnnouncement";
import { usePlay } from "@/hooks/usePlay";
import { useI18n } from "@/i18n";
import { usePaletteRecent } from "@/store/paletteRecent";
import { Dialog, TextField } from "@/ui";
import {
  arrangeItems, firstRunnableIndex, flattenSections, moveActive,
  type ActiveMove, type PaletteItem, type PaletteSection,
} from "./paletteModel";
import { discoverSearchItem, type InstanceActions } from "./paletteProviders";
import { optionId, PaletteList } from "./PaletteList";
import { usePaletteCommands } from "./usePaletteCommands";

const usePaletteOpen = create<{ open: boolean }>(() => ({ open: false }));

/** Öffnet die Befehlspalette (Strg+K, unter macOS Cmd+K). */
export const openPalette = () => usePaletteOpen.setState({ open: true });
const closePalette = () => usePaletteOpen.setState({ open: false });

function moveOf(key: string): ActiveMove | null {
  switch (key) {
    case "ArrowDown":
      return "down";
    case "ArrowUp":
      return "up";
    case "Home":
      return "home";
    case "End":
      return "end";
    default:
      return null;
  }
}

/** Der Inhalt der offenen Palette; er entsteht bei jedem Öffnen neu, damit Suchtext und Auswahl leer beginnen. */
function PaletteBody({ play }: { play: InstanceActions["play"] }) {
  const { t } = useI18n();
  const navigate = useNavigate();
  const listId = useId();
  const [query, setQuery] = useState("");
  const [activeId, setActiveId] = useState<string | null>(null);
  const commands = usePaletteCommands(play);
  const recentIds = usePaletteRecent((s) => s.recentIds);
  const remember = usePaletteRecent((s) => s.remember);

  const text = query.trim();
  const matches = arrangeItems(commands, query, recentIds);
  const sections: PaletteSection[] = text
    ? [...matches, { id: "search", items: [discoverSearchItem(text, navigate)] }]
    : matches;
  const items = flattenSections(sections);
  // Die Auswahl hängt an der Kennung des Eintrags und nicht an der Stelle: ändert sich die Liste, bleibt sie dort, wo sie war.
  const found = items.findIndex((item) => item.id === activeId);
  const activeIndex = found >= 0 ? found : firstRunnableIndex(items);
  const active: PaletteItem | undefined = items[activeIndex];

  const matchCount = flattenSections(matches).length;
  const summary = matchCount === 0
    ? t("palette.noResults", { query: text })
    : t(matchCount === 1 ? "palette.results.one" : "palette.results.other", { count: matchCount });
  const [said] = useAnnouncement(text, summary);

  function runItem(item: PaletteItem) {
    if (item.disabledReason) return;
    // Die Suche steckt den getippten Text im Titel und ist kein Befehl, den man später wieder sucht.
    if (item.group !== "search") remember(item.id);
    closePalette();
    item.run();
  }

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.nativeEvent.isComposing || e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) return;
    const move = moveOf(e.key);
    if (move) {
      e.preventDefault();
      setActiveId(items[moveActive(activeIndex, items.length, move)]?.id ?? null);
    } else if (e.key === "Enter" && active) {
      e.preventDefault();
      runItem(active);
    }
  }

  return (
    <div className="vx-pal">
      <TextField
        role="combobox"
        aria-expanded
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={active && optionId(listId, active)}
        aria-label={t("palette.inputLabel")}
        placeholder={t("palette.placeholder")}
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setActiveId(null);
        }}
        onKeyDown={onKeyDown}
      />
      {text && matchCount === 0 && <div className="vx-pal-empty">{t("palette.noResults", { query: text })}</div>}
      <PaletteList id={listId} sections={sections} active={active} onActivate={(item) => setActiveId(item.id)} onRun={runItem} />
      <div className="sr" role="status" aria-live="polite" aria-atomic="true">{said}</div>
    </div>
  );
}

/**
 * Befehlspalette: ein Textfeld und darunter alle Instanzen, Seiten und Aktionen, nach der Eingabe gefiltert.
 * Dialog des Kits (Fokusfalle, Fokus zurück an den Auslöser, `dialogOpen`); einmal im Layout eingehängt, geöffnet mit `openPalette`.
 */
export function CommandPalette() {
  const { t } = useI18n();
  const open = usePaletteOpen((s) => s.open);
  // Hier und nicht im Inhalt: der Start läuft weiter, wenn sich die Palette schon geschlossen hat.
  const playGame = usePlay();
  const startGame: InstanceActions["play"] = (instance, quickPlay) => void playGame(instance, undefined, quickPlay);
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => usePaletteOpen.setState({ open: next })}
      title={t("palette.title")}
      width={640}
      height={560}
      footLeft={t("palette.hint")}
    >
      <PaletteBody play={startGame} />
    </Dialog>
  );
}
