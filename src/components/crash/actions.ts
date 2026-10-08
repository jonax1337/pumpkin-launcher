import { t } from "@/i18n";
import type { CrashFixAction } from "@/lib/crash-types";
import { formatMemory } from "@/lib/format";
import type { Instance } from "@/lib/types";
import type { IconName } from "@/ui";

export const ACTION_ICONS: Record<CrashFixAction["type"], IconName> = {
  raiseMemory: "up",
  useManagedJava: "x",
  installDependency: "search",
  disableMod: "power",
  openUrl: "ext",
  reinstallGameFiles: "redo",
};

/** Ist der Handgriff schon getan? Dann zeigt der Knopf es und ist aus. */
export function isApplied(action: CrashFixAction, instance: Instance): boolean {
  switch (action.type) {
    case "raiseMemory":
      return instance.memoryMb === action.suggestedMb;
    case "useManagedJava":
      return !instance.javaPath;
    case "disableMod":
      return instance.mods.find((m) => m.id === action.modId)?.enabled === false;
    default:
      return false;
  }
}

/**
 * Beschriftung des Knopfs. `siblings` sind alle Handgriffe des Befunds: tragen zwei auszuschaltende Mods denselben Namen
 * (dieselbe Mod doppelt), unterscheidet der Dateiname sie.
 */
export function actionLabel(action: CrashFixAction, instance: Instance, siblings: CrashFixAction[]): string {
  switch (action.type) {
    case "raiseMemory":
      return t("crashAssistant.action.raiseMemory", { memory: formatMemory(action.suggestedMb) });
    case "useManagedJava":
      return t("crashAssistant.action.useManagedJava");
    case "installDependency":
      return t("crashAssistant.action.installDependency", { query: action.projectQuery });
    case "disableMod":
      return t("crashAssistant.action.disableMod", { name: modLabel(action.modId, instance, siblings) });
    case "openUrl":
      return t("crashAssistant.action.openUrl");
    case "reinstallGameFiles":
      return t("crashAssistant.action.reinstallGameFiles");
  }
}

function modLabel(modId: string, instance: Instance, siblings: CrashFixAction[]): string {
  const mod = instance.mods.find((m) => m.id === modId);
  if (!mod) return modId;
  const sharesName = siblings.some((a) => a.type === "disableMod" && a.modId !== modId && instance.mods.find((m) => m.id === a.modId)?.name === mod.name);
  return sharesName ? mod.fileName : mod.name;
}
