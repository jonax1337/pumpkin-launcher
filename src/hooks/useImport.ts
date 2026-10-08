import { useState } from "react";
import { type QueryClient, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { t } from "@/i18n";
import { api } from "@/lib/api";
import { isCancelled } from "@/lib/errors";
import { squareIcon } from "@/lib/image";
import { MINUTE } from "@/lib/time";
import type { ForeignInstance, Instance } from "@/lib/types";
import { useFreshImports } from "@/store/freshImports";
import { useContentInstall, withTarget } from "./useContent";
import { instanceSaved } from "./useInstances";
import { importKeys } from "./queryKeys";

/** Instanzen anderer Launcher an den Standardorten; die Suche liest nur die Platte. */
export function useForeignInstances(enabled = true) {
  return useQuery({ queryKey: importKeys.foreign, queryFn: () => api.importDetect(null), enabled, staleTime: MINUTE, retry: false });
}

/** Noch nicht importiert und von Pumpkin Launcher startbar: im Onboarding gezählt und per „Alle auswählen“ gewählt. */
export const importable = (f: ForeignInstance) => !f.imported && !f.unsupported;

/** Eine zum Import gewählte Instanz mit dem Namen, den die neue Instanz bekommt. */
export interface ForeignChoice {
  source: ForeignInstance;
  name: string;
}

/** Erkannte und per „Ordner wählen…“ ergänzte Instanzen samt Auswahl und Namen. Gewählt ist nur, was der Nutzer wählt. */
export function useForeignSelection(enabled: boolean) {
  const detected = useForeignInstances(enabled);
  const [added, setAdded] = useState<ForeignInstance[]>([]);
  const [picked, setPicked] = useState<ReadonlySet<string>>(new Set());
  const [renamed, setRenamed] = useState<Record<string, string>>({});
  const all = [...(detected.data ?? []), ...added.filter((a) => !detected.data?.some((d) => d.path === a.path))];
  const selectable = all.filter(importable);
  const isChosen = (f: ForeignInstance) => picked.has(f.path) && importable(f);
  const nameOf = (f: ForeignInstance) => renamed[f.path] ?? f.name;
  const chosen: ForeignChoice[] = all.filter(isChosen).map((source) => ({ source, name: nameOf(source).trim() }));

  function toggle(source: ForeignInstance) {
    const rest = [...picked].filter((p) => p !== source.path);
    setPicked(new Set(picked.has(source.path) ? rest : [...rest, source.path]));
  }

  const chooseAll = () => setPicked(new Set(selectable.map((f) => f.path)));
  const clear = () => setPicked(new Set());
  const rename = (source: ForeignInstance, name: string) => setRenamed((r) => ({ ...r, [source.path]: name }));

  async function addFolder(folder: string) {
    const found = (await api.importDetect(folder)).filter((f) => !all.some((a) => a.path === f.path));
    if (!found.length) return void toast(t("hooks.import.noNewInFolder"));
    setAdded((a) => [...a, ...found]);
  }

  return { detected, all, selectable, chosen, isChosen, toggle, chooseAll, clear, nameOf, rename, addFolder };
}

export type ForeignSelection = ReturnType<typeof useForeignSelection>;

/** Ziel des Imports im Content-Zustand, damit die Zeile der Instanz ihren Fortschritt zeigt. */
export const importTarget = (source: ForeignInstance) => `import:${source.path}`;

/** Der Import einer Instanz als abbrechbarer Vorgang im Aufgaben-Menü. */
const importTask = ({ source, name }: ForeignChoice) =>
  withTarget(
    importTarget(source),
    (op) => api.importInstance({ root: source.root, path: source.path, name }, op),
    t("hooks.import.instanceTask", { name }),
    { cancellable: true, doneLabel: t("hooks.import.instanceTaskDone", { name }) },
  );

/** Das eigene Icon der fremden Instanz wird das Icon der neuen: quadratisch und klein wie jedes eigene Bild. */
async function adoptIcon(qc: QueryClient, instance: Instance, icon: string) {
  const image = new Image();
  image.src = icon;
  await image.decode();
  instanceSaved(qc, await api.setInstanceIcon(instance.id, { type: "image", src: await squareIcon(image) }));
}

/**
 * Importiert Instanzen nacheinander (die Oberfläche führt nur einen Inhalts-Vorgang zur Zeit aus); jede erscheint mit Fortschritt
 * im Aufgaben-Menü. Wird eine abgebrochen, im Dialog oder im Aufgaben-Menü, entfällt der Rest. `run` liefert die
 * angelegten Instanzen und merkt sie für die Bibliothek vor, die sie hervorhebt.
 */
export function useImportInstances() {
  const install = useContentInstall();
  const qc = useQueryClient();
  const [running, setRunning] = useState(false);

  async function run(choices: ForeignChoice[]): Promise<Instance[]> {
    setRunning(true);
    const created: Instance[] = [];
    try {
      for (const choice of choices) {
        try {
          const instance = await install.mutateAsync(importTask(choice));
          if (!instance) continue;
          created.push(instance);
          // Ein Icon, das sich nicht lesen lässt, lässt die Instanz beim automatischen Icon; der Import selbst ist geglückt.
          if (choice.source.icon) void adoptIcon(qc, instance, choice.source.icon).catch((err) => console.warn("Icon nicht übernommen", err));
        } catch (err) {
          // Andere Fehler meldet der zentrale Toast und das Aufgaben-Menü; die übrigen Instanzen laufen weiter.
          if (isCancelled(err)) break;
        }
      }
    } finally {
      setRunning(false);
      void qc.invalidateQueries({ queryKey: importKeys.foreign });
    }
    useFreshImports.getState().mark(created.map((i) => i.id));
    return created;
  }

  return { run, running };
}
