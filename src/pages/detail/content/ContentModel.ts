import { createContext, useContext } from "react";
import type { MenuEntry } from "@/ui";
import type { ModUpdate } from "@/lib/content-types";
import type { ContentSort } from "@/lib/contentSort";
import type { FileFacts, Mod } from "@/lib/types";
import type { Warn } from "./types";

/** Auswahl der Ressourcenpakete im Spiel (`options.txt`), wie Zeilen und Panel sie brauchen. */
export type PackControls = {
  /** Die Auswahl ist gelesen; sonst bleibt nur der Hinweis, Pakete im Spiel einzuschalten. */
  available: boolean;
  /** Warum gerade nichts geändert wird (läuft das Spiel, läuft ein Vorgang); `null` = frei. */
  blocked: string | null;
  isActive: (mod: Mod) => boolean;
  /** Das Spiel hat das Paket als nicht zur Version passend gemeldet. */
  isIncompatible: (mod: Mod) => boolean;
  setActive: (mod: Mod, active: boolean) => void;
};

/** Was die Zeilen, Kacheln und Platzhalter der Inhaltsliste vom Tab brauchen, ohne dass er es durch jede Ebene reicht. */
export type ContentModel = {
  mode: "list" | "grid";
  /** Abhängigkeiten eingerückt unter ihrem Nutzer (nur in der Standard-Sortierung). */
  grouped: boolean;
  sort: ContentSort;
  factsOf: (mod: Mod) => FileFacts | undefined;
  packs: PackControls;
  titleOf: (mod: Mod) => string;
  iconOf: (mod: Mod) => string | null | undefined;
  descriptionOf: (mod: Mod) => string | undefined;
  warnsOf: (mod: Mod) => Warn[];
  /** Gibt es überhaupt Hinweise (dann hat die Liste die Spalte dafür)? */
  hasWarnings: boolean;
  updateFor: Map<string, ModUpdate>;
  /** Läuft gerade ein Vorgang (dann sind Aktionen gesperrt)? */
  locked: boolean;
  isUpdating: (mod: Mod) => boolean;
  /** Läuft „Alle aktualisieren“? */
  updatingAll: boolean;
  /** Fortschritt 0–1 des laufenden Updates; `null` = unbekannt. */
  updateShare: number | null;
  picked: Set<string>;
  /** Die gewählten Inhalte, die es noch gibt. */
  pickedLive: string[];
  togglePick: (id: string, on: boolean) => void;
  pickMany: (ids: string[], on: boolean) => void;
  clearPicked: () => void;
  isSwitchable: (id: string) => boolean;
  setEnabled: (ids: string[], enabled: boolean) => void;
  runUpdates: (ids: string[]) => void;
  /** Mehrere Updates erst nach einer Rückfrage mit alt und neu; ein einzelnes startet gleich. */
  askUpdates: (ids: string[]) => void;
  remove: (ids: string[]) => void;
  menuFor: (mod: Mod) => MenuEntry[];
  undo: (group: string) => void;
  /** Id des Textes für Screenreader, auf den der Menüknopf der Zeile verweist. */
  descriptionId: (mod: Mod) => string;
};

const ContentModelContext = createContext<ContentModel | null>(null);

export const ContentModelProvider = ContentModelContext.Provider;

export function useContentModel(): ContentModel {
  const model = useContext(ContentModelContext);
  if (!model) throw new Error("useContentModel braucht einen ContentModelProvider");
  return model;
}
