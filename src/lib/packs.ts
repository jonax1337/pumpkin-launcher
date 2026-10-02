// Reihenfolge der Ressourcenpakete in `options.txt`: das letzte Paket der Liste gewinnt. Reine Funktionen auf dieser Liste;
// Einträge, die nicht aus der Inhaltsliste stammen (`vanilla`, `fabric`), bleiben, wo sie sind.
import type { Mod } from "./types";

const FILE_PREFIX = "file/";

/** Eintrag eines Ressourcenpakets in `options.txt`. */
export const packId = (mod: Mod) => `${FILE_PREFIX}${mod.fileName}`;

export type MoveDirection = "up" | "down";

/** Die gewählten Pakete der Inhaltsliste, wichtigstes zuerst (so zeigt auch das Spiel sie an). */
export function activePacks(selection: string[], packs: Mod[]): Mod[] {
  const byId = new Map(packs.map((mod) => [packId(mod), mod]));
  return [...selection].reverse().flatMap((id) => byId.get(id) ?? []);
}

/** Paket zuoberst einreihen; ist es schon gewählt, ändert sich nichts. */
export const activate = (selection: string[], id: string): string[] => (selection.includes(id) ? selection : [...selection, id]);

export const deactivate = (selection: string[], id: string): string[] => selection.filter((entry) => entry !== id);

/**
 * Paket in der Anzeige (wichtigstes zuerst) um eine Stelle verschieben: es tauscht mit dem nächsten Paket aus
 * `managed`. Am Rand oder bei einem Paket, das nicht gewählt ist, bleibt die Liste, wie sie ist.
 */
export function move(selection: string[], id: string, direction: MoveDirection, managed: (id: string) => boolean): string[] {
  const from = selection.indexOf(id);
  if (from < 0) return selection;
  // Oben = wichtiger = weiter hinten in der Datei.
  const step = direction === "up" ? 1 : -1;
  let to = from + step;
  while (to >= 0 && to < selection.length && !managed(selection[to])) to += step;
  if (to < 0 || to >= selection.length) return selection;
  const next = [...selection];
  [next[from], next[to]] = [next[to], next[from]];
  return next;
}
