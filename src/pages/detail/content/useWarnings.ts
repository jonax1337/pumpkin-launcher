import { IRIS_PROJECT_ID } from "@/components/ContentBrowser";
import { useI18n } from "@/i18n";
import { projectOf } from "@/lib/mods";
import type { Instance, Mod } from "@/lib/types";
import type { Warn } from "./types";

/** Hinweise je Inhalt und ihre Anzahl (für den Warnpunkt am Tab). Shader brauchen Iris: fehlt es, hinzufügen, ist es aus, einschalten. */
export function useWarnings(instance: Instance, onAddIris: () => void, turnOnIris: () => void) {
  const { t } = useI18n();
  const iris = instance.mods.find((m) => projectOf(m) === IRIS_PROJECT_ID);
  const irisFix = iris
    ? { actionLabel: t("detail.content.turnIrisOn"), fix: turnOnIris }
    : { actionLabel: t("detail.content.addIris"), fix: onAddIris };
  const warnsOf = (mod: Mod): Warn[] =>
    mod.kind === "shader" && !iris?.enabled ? [{ text: t("detail.content.shaderNeedsIris"), ...irisFix }] : [];
  const total = instance.mods.reduce((n, mod) => n + warnsOf(mod).length, 0);
  return { warnsOf, total };
}
