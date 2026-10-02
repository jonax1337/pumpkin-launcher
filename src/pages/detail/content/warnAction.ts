import { t } from "@/i18n";
import type { Mod } from "@/lib/types";
import type { Warn } from "./types";
import type { Finding } from "./useWarnings";

/** Was ein Hinweis auslösen kann; der Tab kennt die Wege, der Hinweis selbst nicht. */
export type WarnActions = {
  addContent: () => void;
  turnOnIris: () => void;
  switchOff: () => void;
  pickVersion: () => void;
};

/**
 * Der Weg, einen Hinweis zu beheben. Fehlendes hinzufügen, Iris einschalten; eine doppelte oder für einen anderen Loader
 * gebaute Mod ausschalten (rückgängig zu machen); bei falscher Minecraft-Version eine andere Version wählen, wo es sie
 * gibt, sonst ausschalten. Reine Funktion, deshalb Modul-`t`.
 */
export function warnAction({ kind }: Finding, mod: Mod, actions: WarnActions): Pick<Warn, "actionLabel" | "fix"> {
  const switchOff = { actionLabel: t("detail.content.switchOff"), fix: actions.switchOff };
  switch (kind) {
    case "irisMissing":
      return { actionLabel: t("detail.content.addIris"), fix: actions.addContent };
    case "irisOff":
      return { actionLabel: t("detail.content.turnIrisOn"), fix: actions.turnOnIris };
    case "missingDependency":
      return { actionLabel: t("detail.content.warnAdd"), fix: actions.addContent };
    case "wrongMinecraft":
      return mod.source.type === "modrinth" ? { actionLabel: t("detail.content.warnPickVersion"), fix: actions.pickVersion } : switchOff;
    case "duplicate":
    case "wrongLoader":
    case "shadersUnsupported":
      return switchOff;
  }
}
