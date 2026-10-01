import { useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type { ForeignInstance, Instance } from "@/lib/types";
import { cancelActive, useContentInstall, withTarget } from "./useContent";

const foreignKey = ["foreign-instances"];

/** Instanzen anderer Launcher an den Standardorten; die Suche liest nur die Platte. */
export function useForeignInstances(enabled = true) {
  return useQuery({ queryKey: foreignKey, queryFn: () => api.importDetect(null), enabled, staleTime: 60_000, retry: false });
}

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
        const task = withTarget(importTarget(source), (op) => api.importInstance(source, op), `${source.name} importieren`);
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
    cancelActive();
  }

  return { run, cancel, running };
}
