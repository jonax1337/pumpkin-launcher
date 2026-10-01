import { createContext, useContext } from "react";
import type { MenuEntry } from "@/ui";
import type { ModUpdate } from "@/lib/content-types";
import type { Mod } from "@/lib/types";
import type { Warn } from "./types";

/** Was die Zeilen, Kacheln und Platzhalter der Inhaltsliste vom Tab brauchen, ohne dass er es durch jede Ebene reicht. */
export type ContentModel = {
  mode: "list" | "grid";
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
