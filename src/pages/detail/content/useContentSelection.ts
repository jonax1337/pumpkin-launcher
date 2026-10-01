import { useEffect, useRef, useState } from "react";
import { useI18n } from "@/i18n";
import type { Mod } from "@/lib/types";

/**
 * Mehrfachauswahl der Inhalte. `say` meldet Screenreadern die Anzahl (Entfernen sagt der Toast selbst an,
 * deshalb schweigt `dropRemoved` die nächste Änderung). Gewählte Inhalte, die es nicht mehr gibt, zählen nicht.
 */
export function useContentSelection(liveIds: Set<string>, say: (text: string) => void) {
  const { t } = useI18n();
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const quietNextChange = useRef(false);
  const pickedLive = [...picked].filter((id) => liveIds.has(id));

  const count = pickedLive.length;
  const lastCount = useRef(count);
  useEffect(() => {
    if (count === lastCount.current) return;
    lastCount.current = count;
    if (quietNextChange.current) return void (quietNextChange.current = false);
    say(count ? t("detail.content.selectedCount", { n: count }) : t("detail.content.selectionCleared"));
  }, [count]);

  return {
    picked,
    pickedLive,
    toggle: (id: string, on: boolean) => setPicked((p) => withIds(p, [id], on)),
    setMany: (ids: string[], on: boolean) => setPicked((p) => withIds(p, ids, on)),
    clear: () => setPicked(new Set()),
    /** Entferntes aus der Auswahl nehmen; die Ansage dazu übernimmt der Toast. */
    dropRemoved: (removed: Mod[]) => {
      quietNextChange.current = picked.size > 0 && removed.some((mod) => picked.has(mod.id));
      setPicked((p) => new Set([...p].filter((id) => !removed.some((mod) => mod.id === id))));
    },
  };
}

/** `ids` zur Auswahl hinzugefügt (`on`) oder aus ihr entfernt, ohne die alte Menge zu ändern. */
function withIds(selection: Set<string>, ids: string[], on: boolean) {
  const next = new Set(selection);
  for (const id of ids) {
    if (on) next.add(id);
    else next.delete(id);
  }
  return next;
}
