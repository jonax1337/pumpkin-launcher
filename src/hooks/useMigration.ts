import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router";
import { toast } from "sonner";
import { useI18n } from "@/i18n";
import { t as translate } from "@/i18n/core";
import { api } from "@/lib/api";
import { instanceUrl } from "@/lib/routes";
import type { Instance, MigrationOutcome, MigrationTarget, ModChange } from "@/lib/types";
import { useBackgroundTask } from "./useBackgroundTask";
import { lifecycleKeys } from "./queryKeys";

/** Vorschau eines Wechsels: was mit jedem Inhalt passiert und ob er nur als Kopie geht; ohne Ziel keine Abfrage. */
export function useMigrationCheck(instanceId: string, target: MigrationTarget | null) {
  return useQuery({
    queryKey: lifecycleKeys.migrationCheck(instanceId, target?.minecraftVersion ?? "", target?.loader ?? "vanilla", target?.loaderVersion ?? null),
    queryFn: () => api.migrateCheck(instanceId, target!),
    enabled: !!target,
    staleTime: 0,
    retry: false,
  });
}

/** „Mitgenommen: 3 · Ausgeschaltet: 1 · Welten gesichert: 2“; leere Posten fallen weg. */
function outcomeLine({ changes, worldBackups }: MigrationOutcome) {
  const count = (...outcomes: ModChange["outcome"][]) => changes.filter((c) => outcomes.includes(c.outcome)).length;
  const counts = [
    ["detail.migrate.summary.carried", count("update", "add")],
    ["detail.migrate.summary.disabled", count("disable")],
    ["detail.pack.summary.worlds", worldBackups],
  ] as const;
  return counts.filter(([, n]) => n > 0).map(([key, n]) => translate(key, { n })).join(" · ") || undefined;
}

/**
 * Wechsel von Minecraft-Version oder Loader im Hintergrund (Aufgaben-Menü, abbrechbar): `inPlace` ändert die Instanz
 * selbst, `asCopy` legt eine Kopie an und wechselt nur sie.
 */
export function useMigration(instance: Instance) {
  const { t } = useI18n();
  const { run, isPending } = useBackgroundTask();
  const navigate = useNavigate();
  const label = (target: MigrationTarget) => ({ name: instance.name, version: target.minecraftVersion });

  const inPlace = (target: MigrationTarget) =>
    run({
      key: `migrate:${instance.id}`,
      instanceId: instance.id,
      label: t("detail.migrate.task", label(target)),
      doneLabel: t("detail.migrate.taskDone", label(target)),
      cancellable: true,
      task: (operationId) =>
        api.migrateInstance(instance.id, target, operationId).then((outcome) => {
          toast.success(t("detail.migrate.doneToast", label(target)), { description: outcomeLine(outcome) });
          return outcome.instance;
        }),
    });

  const asCopy = (target: MigrationTarget) =>
    run({
      key: `migrate:${instance.id}`,
      instanceId: instance.id,
      label: t("detail.migrate.copyTask", label(target)),
      doneLabel: t("detail.migrate.copyTaskDone", label(target)),
      cancellable: true,
      task: (operationId) =>
        api.duplicateMigrate(instance.id, target, operationId).then((outcome) => {
          toast.success(t("detail.migrate.copyToast", { name: outcome.instance.name }), {
            description: outcomeLine(outcome),
            action: { label: t("common.open"), onClick: () => navigate(instanceUrl(outcome.instance.id)) },
          });
          return outcome.instance;
        }),
    });

  return { inPlace, asCopy, isPending };
}
