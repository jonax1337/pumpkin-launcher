import { useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { instanceKeys } from "@/hooks/queryKeys";
import { useUpdateMods } from "@/hooks/useInstances";
import { undoRemove } from "@/lib/mods";
import type { Instance, Mod } from "@/lib/types";
import { planRemoval } from "./ghosts";
import type { Ghost } from "./types";

/** Was ein Entfernen vorher gab, damit „Rückgängig“ es wiederherstellen kann. */
type RemovedGroup = { before: Mod[]; removed: Mod[] };

/** Wohin der Platzhalter kommt (`indexOf`) und wie er heißt (`titleOf`). */
type Placement = { titleOf: (mod: Mod) => string; indexOf: (mod: Mod) => number };

/**
 * Entfernte Inhalte bleiben als Platzhalter an ihrer Stelle stehen, bis sie wiederhergestellt werden oder die Seite
 * neu lädt. `remove` und `undo` ändern die Instanz selbst; `ghosts` sind die, deren Inhalt tatsächlich fehlt.
 */
export function useRemovedGhosts(instance: Instance) {
  const qc = useQueryClient();
  const update = useUpdateMods(instance.id);
  const [ghosts, setGhosts] = useState<Ghost[]>([]);
  const groups = useRef(new Map<string, RemovedGroup>());
  const liveIds = new Set(instance.mods.map((m) => m.id));

  /**
   * Entfernt `ids` samt Abhängigkeiten, die niemand mehr braucht. Gibt Gruppe und Entferntes zurück,
   * `null` wenn nichts zu entfernen war.
   */
  function remove(ids: string[], { titleOf, indexOf }: Placement) {
    const { mods, removed, alongWith } = planRemoval(instance.mods, ids, titleOf);
    if (!removed.length) return null;
    const group = `g${Date.now()}`;
    groups.current.set(group, { before: instance.mods, removed });
    const added = removed.map((mod): Ghost => ({
      type: "ghost", mod, title: titleOf(mod), at: indexOf(mod), group, main: ids.includes(mod.id), by: alongWith.get(mod.id),
    }));
    setGhosts((all) => [...all, ...added]);
    update.mutate({ ...instance, mods });
    return { group, removed };
  }

  /**
   * Stellt die Gruppe wieder her. Gibt den Platzhalter zurück, der dabei verschwand (die Hauptzeile),
   * `undefined` wenn nichts zu tun war.
   */
  function undo(group: string) {
    const entry = groups.current.get(group);
    if (!entry) return;
    groups.current.delete(group);
    const members = ghosts.filter((ghost) => ghost.group === group);
    setGhosts((all) => all.filter((ghost) => ghost.group !== group));
    // Aktuellen Stand nehmen: in der Zwischenzeit können weitere Änderungen passiert sein.
    const current = qc.getQueryData<Instance>(instanceKeys.detail(instance.id));
    if (!current || entry.removed.some((mod) => current.mods.some((c) => c.id === mod.id))) return;
    update.mutate({ ...current, mods: undoRemove(current.mods, entry.before, entry.removed) });
    return members.find((ghost) => ghost.main) ?? members[0];
  }

  return { ghosts: ghosts.filter((ghost) => !liveIds.has(ghost.mod.id)), remove, undo };
}
