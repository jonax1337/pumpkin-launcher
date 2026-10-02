import { useRef, useState } from "react";
import { toast } from "sonner";
import { useI18n } from "@/i18n";
import { useCommitOnUnmount } from "@/hooks/useCommitOnUnmount";
import { useLatest } from "@/hooks/useLatest";
import { useUpdateInstance } from "@/hooks/useInstances";
import { splitArgs } from "@/lib/jvm";
import type { Instance } from "@/lib/types";

/** So lange (ms) wartet der Regler nach der letzten Bewegung, bevor der Arbeitsspeicher gespeichert wird. */
const MEMORY_SAVE_DELAY_MS = 400;

type ArgsField = "jvmArgs" | "gameArgs";

/**
 * Felder der Instanz-Einstellungen. Alles speichert sofort; Name und Argumente beim Verlassen des Felds oder der Seite, der Regler
 * für den Arbeitsspeicher nach kurzer Pause oder spätestens beim Verlassen der Seite. Gespeichert wird immer auf dem neuesten Stand der Instanz.
 */
export function useInstanceForm(instance: Instance) {
  const { t } = useI18n();
  const update = useUpdateInstance();
  const latest = useLatest(instance);
  const [name, setName] = useState(instance.name);
  const [memory, setMemory] = useState(instance.memoryMb);
  const memoryTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  /** Letzte Reglerstellung, die noch nicht gespeichert ist; `{ mb }` statt `mb`, weil null „automatisch“ heißt. */
  const pendingMemory = useRef<{ mb: number | null } | null>(null);

  /** Änderung auf den neuesten Stand der Instanz anwenden; `done` wird nach dem Speichern gemeldet. */
  function save(patch: Partial<Instance>, done?: string) {
    update.mutate({ ...latest.current, ...patch }, { onSuccess: () => done && toast.success(done) });
  }

  function saveName() {
    const next = name.trim();
    if (!next) return setName(latest.current.name);
    if (next !== latest.current.name) save({ name: next }, t("detail.settings.nameSaved"));
  }

  function saveArgs(field: ArgsField, text: string, done: string) {
    const next = splitArgs(text);
    if (next.join(" ") !== latest.current[field].join(" ")) save({ [field]: next }, done);
  }

  function saveMemory() {
    clearTimeout(memoryTimer.current);
    const pending = pendingMemory.current;
    pendingMemory.current = null;
    if (pending && latest.current.memoryMb !== pending.mb) save({ memoryMb: pending.mb });
  }

  function changeMemory(mb: number | null) {
    setMemory(mb);
    pendingMemory.current = { mb };
    clearTimeout(memoryTimer.current);
    memoryTimer.current = setTimeout(saveMemory, MEMORY_SAVE_DELAY_MS);
  }

  useCommitOnUnmount(saveName);
  useCommitOnUnmount(saveMemory);

  return { name, setName, saveName, saveArgs, memory, changeMemory, save };
}

export type InstanceForm = ReturnType<typeof useInstanceForm>;
