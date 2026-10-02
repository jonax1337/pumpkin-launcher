import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { defaultExportRequest } from "@/components/ExportDialog";
import { enqueueContent, mustWait } from "@/hooks/contentQueue";
import { instanceKeys } from "@/hooks/queryKeys";
import { startContentInstall, withTarget } from "@/hooks/useContent";
import { useI18n } from "@/i18n";
import { api } from "@/lib/api";
import { revealLocalPath } from "@/lib/links";
import { packFileName } from "@/lib/mods";
import type { Instance } from "@/lib/types";

/**
 * Wendet `action` der Reihe nach auf jede Id an, auch wenn eine fehlschlägt; danach meldet der Fehler der ersten.
 * So bleibt bei einer laufenden Instanz der Rest nicht liegen.
 */
async function forEachInOrder(ids: string[], action: (id: string) => Promise<unknown>) {
  let firstError: unknown;
  for (const id of ids) {
    try {
      await action(id);
    } catch (error) {
      firstError ??= error;
    }
  }
  if (firstError) throw firstError;
}

/** Mehreren Instanzen auf einmal eine Gruppe geben (`null` = aus der Gruppe nehmen). */
export function useAssignGroup() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ ids, group }: { ids: string[]; group: string | null }) => forEachInOrder(ids, (id) => api.setInstanceGroup(id, group)),
    onSettled: () => qc.invalidateQueries({ queryKey: instanceKeys.all }),
  });
}

/** Mehrere Instanzen löschen. */
export function useDeleteMany() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (ids: string[]) =>
      forEachInOrder(ids, async (id) => {
        await api.deleteInstance(id);
        qc.removeQueries({ queryKey: instanceKeys.detail(id) });
      }),
    onSettled: () => qc.invalidateQueries({ queryKey: instanceKeys.all }),
  });
}

/**
 * Mehrere Instanzen nacheinander als `.mrpack` in einen gewählten Ordner schreiben, mit den Standard-Einträgen eines
 * Exports; vorhandene Dateien im Ordner bleiben unberührt. Ein Vorgang im Aufgaben-Menü (Abbrechen stoppt auch die
 * übrigen), der Toast führt zur letzten Datei. Läuft schon ein Vorgang, wird der Export vorgemerkt; der Toast kommt
 * auch, wenn die Auswahlleiste inzwischen geschlossen ist.
 */
export function useExportMany() {
  const { t } = useI18n();
  return async (instances: Instance[]) => {
    const [folder] = await api.pickPaths({ directory: true });
    if (!folder) return;
    const paths = await api.exportTargets(folder, instances.map((instance) => packFileName(instance.name, t("common.instance"))));
    const last = instances[instances.length - 1];
    const label = t("pages.instances.exportManyTask", { n: instances.length });
    const run = withTarget(
      "export:selection",
      async (operationId) => {
        for (const [index, instance] of instances.entries()) {
          const entries = await api.exportEntries(instance.id);
          await api.exportInstance(instance.id, defaultExportRequest(instance, entries), paths[index], operationId);
        }
        return api.getInstance(last.id);
      },
      label,
      { cancellable: true, doneLabel: t("pages.instances.exportManyDone", { n: instances.length }) },
    );
    const reportDone = () =>
      toast.success(t("pages.instances.exportManyDone", { n: instances.length }), {
        description: folder,
        action: { label: t("components.instance.revealInFolder"), onClick: () => revealLocalPath(paths[paths.length - 1]) },
      });
    if (mustWait()) toast(t("components.pack.queuedToast", { name: label }));
    enqueueContent({ target: "export:selection", label, start: () => startContentInstall(run, reportDone) });
  };
}
