import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { t } from "@/i18n";
import { catalogKeys, instanceKeys } from "@/hooks/queryKeys";
import { useUpdateMods } from "@/hooks/useInstances";
import { undoUpdate } from "@/lib/mods";
import type { Instance } from "@/lib/types";
import type { AppliedChange } from "./types";

/**
 * Das letzte Update oder der letzte Versionswechsel lässt sich zurücknehmen, solange der Nutzer die Leiste nicht schließt:
 * die alten Dateien liegen im Cache des Backends und kommen mit dem alten Stand der Liste zurück.
 */
export function useUpdateRollback(instance: Instance) {
  const qc = useQueryClient();
  const save = useUpdateMods(instance.id);
  const [applied, setApplied] = useState<AppliedChange | null>(null);

  function undo() {
    if (!applied) return;
    // Aktueller Stand: seit dem Update kann sich etwas geändert haben.
    const current = qc.getQueryData<Instance>(instanceKeys.detail(instance.id)) ?? instance;
    save.mutate(
      { ...current, mods: undoUpdate(current.mods, applied.before, applied.after) },
      {
        onSuccess: () => {
          toast(t("detail.content.updateUndone"));
          void qc.invalidateQueries({ queryKey: catalogKeys.allUpdates });
        },
      },
    );
    setApplied(null);
  }

  return { applied, record: setApplied, undo, dismiss: () => setApplied(null) };
}
