import { removeWithDependencies } from "@/lib/mods";
import type { Mod } from "@/lib/types";
import type { Entry, Ghost, Row } from "./types";

/** Platzhalter an ihrer alten Stelle einsetzen (aufsteigend, damit die Stellen stimmen). */
export function insertGhosts(rows: Row[], ghosts: Ghost[]): Entry[] {
  const entries: Entry[] = [...rows];
  [...ghosts].sort((a, b) => a.at - b.at).forEach((ghost) => entries.splice(Math.min(ghost.at, entries.length), 0, ghost));
  return entries;
}

/**
 * Was ein Entfernen von `ids` bewirkt: die Inhalte danach, alles Entfernte (die Gewählten samt Abhängigkeiten, die niemand
 * mehr braucht) und je Abhängigkeit den Namen dessen, dessentwegen sie mit geht.
 */
export function planRemoval(mods: Mod[], ids: string[], titleOf: (mod: Mod) => string) {
  let remaining = mods;
  const removed: Mod[] = [];
  const alongWith = new Map<string, string>();
  for (const id of ids) {
    const result = removeWithDependencies(remaining, id);
    remaining = result.mods;
    removed.push(...result.removed);
    result.removed.slice(1).forEach((dependency) => alongWith.set(dependency.id, titleOf(result.removed[0])));
  }
  return { mods: remaining, removed, alongWith };
}
