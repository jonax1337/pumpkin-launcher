import { useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { api } from "@/lib/api";
import type { ForeignInstance, Instance } from "@/lib/types";
import { cancelContent, cancellable, useContentInstall, withTarget } from "./useContent";

const foreignKey = ["foreign-instances"];

/** Instanzen anderer Launcher an den Standardorten; die Suche liest nur die Platte. */
export function useForeignInstances(enabled = true) {
  return useQuery({ queryKey: foreignKey, queryFn: () => api.importDetect(null), enabled, staleTime: 60_000, retry: false });
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
    if (!found.length) return void toast("In diesem Ordner gibt es keine neuen Instanzen.");
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
 * im Aufgaben-Menü. `cancel` bricht die laufende ab und lässt den Rest aus. `run` liefert die zuletzt importierte.
 */
export function useImportInstances() {
  const install = useContentInstall();
  const qc = useQueryClient();
  const [running, setRunning] = useState(false);
  const stopped = useRef(false);

  async function run(sources: ForeignInstance[]): Promise<Instance | null> {
    stopped.current = false;
    setRunning(true);
    let last: Instance | null = null;
    try {
      for (const source of sources) {
        if (stopped.current) break;
        const task = cancellable(withTarget(importTarget(source), (op) => api.importInstance(source, op), `${source.name} importieren`));
        // Fehler meldet der zentrale Toast und das Aufgaben-Menü; die übrigen Instanzen laufen weiter.
        last = (await install.mutateAsync(task).catch(() => null)) ?? last;
      }
    } finally {
      setRunning(false);
      void qc.invalidateQueries({ queryKey: foreignKey });
    }
    return last;
  }

  function cancel() {
    stopped.current = true;
    cancelContent();
  }

  return { run, cancel, running };
}
