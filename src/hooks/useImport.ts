import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { t } from "@/i18n";
import { api } from "@/lib/api";
import { isCancelled } from "@/lib/errors";
import { MINUTE } from "@/lib/time";
import type { ForeignInstance, Instance } from "@/lib/types";
import { useContentInstall, withTarget } from "./useContent";
import { importKeys } from "./queryKeys";

/** Instanzen anderer Launcher an den Standardorten; die Suche liest nur die Platte. */
export function useForeignInstances(enabled = true) {
  return useQuery({ queryKey: importKeys.foreign, queryFn: () => api.importDetect(null), enabled, staleTime: MINUTE, retry: false });
}

/** Noch nicht importiert und von Pumpkin Launcher startbar: vorgewählt und im Onboarding gezählt. */
export const importable = (f: ForeignInstance) => !f.imported && !f.unsupported;

/** Erkannte und per „Ordner wählen…“ ergänzte Instanzen samt Auswahl; ohne eigene Wahl gilt die Vorauswahl. */
export function useForeignSelection(enabled: boolean) {
  const detected = useForeignInstances(enabled);
  const [added, setAdded] = useState<ForeignInstance[]>([]);
  const [picked, setPicked] = useState<Set<string> | null>(null);
  const all = [...(detected.data ?? []), ...added.filter((a) => !detected.data?.some((d) => d.path === a.path))];
  const chosenPaths = picked ?? new Set(all.filter(importable).map((f) => f.path));
  const isChosen = (f: ForeignInstance) => chosenPaths.has(f.path);

  function toggle(source: ForeignInstance) {
    const rest = [...chosenPaths].filter((p) => p !== source.path);
    setPicked(new Set(chosenPaths.has(source.path) ? rest : [...rest, source.path]));
  }

  async function addFolder(folder: string) {
    const found = (await api.importDetect(folder)).filter((f) => !all.some((a) => a.path === f.path));
    if (!found.length) return void toast(t("hooks.import.noNewInFolder"));
    setAdded((a) => [...a, ...found]);
    setPicked((p) => p && new Set([...p, ...found.filter(importable).map((f) => f.path)]));
  }

  return { detected, all, chosen: all.filter(isChosen), isChosen, toggle, addFolder };
}

export type ForeignSelection = ReturnType<typeof useForeignSelection>;

/** Ziel des Imports im Content-Zustand, damit die Zeile der Instanz ihren Fortschritt zeigt. */
export const importTarget = (source: ForeignInstance) => `import:${source.path}`;

/**
 * Importiert Instanzen nacheinander (das Backend erlaubt nur einen Vorgang zur Zeit); jede erscheint mit Fortschritt
 * im Aufgaben-Menü. Wird eine abgebrochen, im Dialog oder im Aufgaben-Menü, entfällt der Rest. `run` liefert die zuletzt importierte.
 */
export function useImportInstances() {
  const install = useContentInstall();
  const qc = useQueryClient();
  const [running, setRunning] = useState(false);

  async function run(sources: ForeignInstance[]): Promise<Instance | null> {
    setRunning(true);
    let last: Instance | null = null;
    try {
      for (const source of sources) {
        const task = withTarget(importTarget(source), (op) => api.importInstance(source, op), t("hooks.import.instanceTask", { name: source.name }), { cancellable: true, doneLabel: t("hooks.import.instanceTaskDone", { name: source.name }) });
        try {
          last = (await install.mutateAsync(task)) ?? last;
        } catch (err) {
          // Andere Fehler meldet der zentrale Toast und das Aufgaben-Menü; die übrigen Instanzen laufen weiter.
          if (isCancelled(err)) break;
        }
      }
    } finally {
      setRunning(false);
      void qc.invalidateQueries({ queryKey: importKeys.foreign });
    }
    return last;
  }

  return { run, running };
}
