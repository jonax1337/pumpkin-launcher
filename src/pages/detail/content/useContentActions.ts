import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { useI18n } from "@/i18n";
import { useBackgroundTask } from "@/hooks/useBackgroundTask";
import { useUpdateMods } from "@/hooks/useInstances";
import { catalogKeys } from "@/hooks/queryKeys";
import { api } from "@/lib/api";
import type { ContentVersion } from "@/lib/content-types";
import type { Instance, Mod } from "@/lib/types";
import type { AppliedChange } from "./types";

/**
 * Schalten, Festhalten, Aktualisieren und Version wechseln der Inhalte einer Instanz; `titleOf` nennt den Inhalt in den
 * Meldungen. `onApplied` bekommt, was ein Update oder Wechsel geändert hat (für „Rückgängig“).
 */
export function useContentActions(instance: Instance, titleOf: (mod: Mod) => string, onApplied: (change: AppliedChange) => void) {
  const { t } = useI18n();
  const qc = useQueryClient();
  const update = useUpdateMods(instance.id);
  const background = useBackgroundTask();

  // Ressourcenpakete schaltet das Spiel selbst ein; hier gibt es für sie keinen Schalter.
  const isSwitchable = (id: string) => instance.mods.some((m) => m.id === id && m.kind !== "resourcepack");

  function setEnabled(ids: string[], enabled: boolean) {
    const switching = new Set(ids.filter(isSwitchable));
    update.mutate({ ...instance, mods: instance.mods.map((m) => (switching.has(m.id) ? { ...m, enabled } : m)) });
  }

  /** Festhalten nimmt Inhalte aus der Update-Prüfung; Loslassen prüft sie neu. */
  function setPinned(ids: string[], pinned: boolean) {
    const pinning = new Set(ids);
    update.mutate(
      { ...instance, mods: instance.mods.map((m) => (pinning.has(m.id) ? { ...m, pinned } : m)) },
      { onSuccess: () => void qc.invalidateQueries({ queryKey: catalogKeys.updates(instance.id) }) },
    );
  }

  function runUpdates(modIds: string[]) {
    if (!modIds.length) return;
    const single = modIds.length === 1 ? instance.mods.find((m) => m.id === modIds[0]) : undefined;
    const name = single ? titleOf(single) : "";
    const before = instance.mods;
    const doneLabel = name ? t("detail.content.updateOneDone", { name }) : t("detail.content.updateManyDone", { n: modIds.length });
    background.run({
      key: single ? single.id : "updates",
      instanceId: instance.id,
      label: name ? t("detail.content.updateOneLabel", { name }) : t("detail.content.updateManyLabel", { n: modIds.length }),
      doneLabel,
      task: (op) => api.modrinthUpdateMods(instance.id, modIds, op),
      onDone: (result) => {
        onApplied({ before, after: result.mods, text: doneLabel });
        toast.success(name ? t("detail.content.oneUpToDate", { name }) : t("detail.content.manyUpdated", { n: modIds.length }));
      },
    });
  }

  function switchVersion(mod: Mod, version: ContentVersion) {
    const name = titleOf(mod);
    const before = instance.mods;
    const doneLabel = t("detail.content.switchDone", { name, version: version.version_number });
    background.run({
      key: mod.id,
      instanceId: instance.id,
      label: t("detail.content.switchLabel", { name, version: version.version_number }),
      doneLabel,
      task: (op) => api.modrinthSwitchVersion(instance.id, mod.id, version.id, op),
      onDone: (result) => onApplied({ before, after: result.mods, text: doneLabel }),
    });
  }

  return { isSwitchable, setEnabled, setPinned, runUpdates, switchVersion };
}
