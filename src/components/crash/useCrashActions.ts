import { toast } from "sonner";
import { t } from "@/i18n";
import { useUpdateInstance, useUpdateMods } from "@/hooks/useInstances";
import { useInstall } from "@/hooks/usePlay";
import type { CrashFixAction } from "@/lib/crash-types";
import { formatMemory } from "@/lib/format";
import { openPage } from "@/lib/links";
import type { Instance } from "@/lib/types";

/**
 * Führt die Handgriffe des Absturzassistenten über die Hooks aus, die auch Einstellungen, Inhalte und „Reparieren“ benutzen.
 * Fehler meldet der zentrale Mutations-Toast bzw. `useInstall`; Erfolg ein Toast hier. `onAddContent` öffnet den Dialog zum
 * Hinzufügen von Inhalten mit der Suche vorbelegt.
 */
export function useCrashActions(instance: Instance, onAddContent: (query: string) => void) {
  const update = useUpdateInstance();
  const updateMods = useUpdateMods(instance.id);
  const install = useInstall();

  const saveInstance = (changed: Instance, done: string) => update.mutate(changed, { onSuccess: () => void toast.success(done) });

  function disableMod(modId: string) {
    const mod = instance.mods.find((m) => m.id === modId);
    if (!mod) return void toast.error(t("crashAssistant.modGone"));
    const mods = instance.mods.map((m) => (m.id === modId ? { ...m, enabled: false } : m));
    updateMods.mutate({ ...instance, mods }, { onSuccess: () => void toast.success(t("crashAssistant.done.disableMod", { name: mod.name })) });
  }

  function apply(action: CrashFixAction) {
    switch (action.type) {
      case "raiseMemory":
        return saveInstance({ ...instance, memoryMb: action.suggestedMb }, t("crashAssistant.done.raiseMemory", { memory: formatMemory(action.suggestedMb) }));
      case "useManagedJava":
        return saveInstance({ ...instance, javaPath: null }, t("crashAssistant.done.useManagedJava"));
      case "disableMod":
        return disableMod(action.modId);
      case "installDependency":
        return onAddContent(action.projectQuery);
      case "openUrl":
        return openPage(action.url);
      case "reinstallGameFiles":
        return install.mutate(instance);
    }
  }

  return { apply, busy: update.isPending || updateMods.isPending || install.isPending };
}
