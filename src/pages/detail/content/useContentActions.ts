import { toast } from "sonner";
import { useI18n } from "@/i18n";
import { useBackgroundTask } from "@/hooks/useBackgroundTask";
import { useUpdateMods } from "@/hooks/useInstances";
import { api } from "@/lib/api";
import type { Instance, Mod } from "@/lib/types";

/** Schalten und Aktualisieren der Inhalte einer Instanz; `titleOf` nennt den Inhalt in den Meldungen. */
export function useContentActions(instance: Instance, titleOf: (mod: Mod) => string) {
  const { t } = useI18n();
  const update = useUpdateMods(instance.id);
  const background = useBackgroundTask();

  // Ressourcenpakete schaltet das Spiel selbst ein; hier gibt es für sie keinen Schalter.
  const isSwitchable = (id: string) => instance.mods.some((m) => m.id === id && m.kind !== "resourcepack");

  function setEnabled(ids: string[], enabled: boolean) {
    const switching = new Set(ids.filter(isSwitchable));
    update.mutate({ ...instance, mods: instance.mods.map((m) => (switching.has(m.id) ? { ...m, enabled } : m)) });
  }

  function runUpdates(modIds: string[]) {
    if (!modIds.length) return;
    const single = modIds.length === 1 ? instance.mods.find((m) => m.id === modIds[0]) : undefined;
    const name = single ? titleOf(single) : "";
    background.run({
      key: single ? single.id : "updates",
      label: name ? t("detail.content.updateOneLabel", { name }) : t("detail.content.updateManyLabel", { n: modIds.length }),
      doneLabel: name ? t("detail.content.updateOneDone", { name }) : t("detail.content.updateManyDone", { n: modIds.length }),
      task: (op) => api.modrinthUpdateMods(instance.id, modIds, op),
      onDone: () => toast.success(name ? t("detail.content.oneUpToDate", { name }) : t("detail.content.manyUpdated", { n: modIds.length })),
    });
  }

  return { isSwitchable, setEnabled, runUpdates };
}
