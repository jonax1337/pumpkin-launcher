import { IRIS_PROJECT_ID, irisSupported } from "@/components/catalog/iris";
import { useI18n } from "@/i18n";
import { projectOf } from "@/lib/mods";
import { LOADER_LABELS, type ContentIssue, type Instance, type Mod } from "@/lib/types";

/** Was einen Hinweis auslöst; der Weg, ihn zu beheben, hängt davon ab (siehe `warnAction`). */
export type FindingKind = "irisMissing" | "irisOff" | "shadersUnsupported" | ContentIssue["kind"];

/** Hinweis zu einem Inhalt, noch ohne den Weg zur Lösung. `text` passt in einen Chip, `detail` erklärt mehr. */
export type Finding = { kind: FindingKind; text: string; detail?: string };

/**
 * Hinweise je Inhalt und ihre Anzahl (für den Warnpunkt am Tab). Shader brauchen Iris: fehlt es, hinzufügen, ist es aus,
 * einschalten; wo es Iris nicht gibt (Forge, NeoForge), laufen Shader nicht. Dazu die Hinweise aus den Mod-Metadaten: fehlende Abhängigkeit, doppelte Mod, falscher Loader,
 * falsche Minecraft-Version.
 */
export function useWarnings(instance: Instance, issues: ContentIssue[]) {
  const { t } = useI18n();
  const iris = instance.mods.find((m) => projectOf(m) === IRIS_PROJECT_ID);
  const loader = LOADER_LABELS[instance.loader];

  /** Was Shadern in dieser Instanz im Weg steht; null, wenn Iris da und an ist. */
  const shaderFinding = (): Finding | null => {
    if (!irisSupported(instance))
      return { kind: "shadersUnsupported", text: t("detail.content.shadersUnsupported", { loader }), detail: t("detail.content.shadersUnsupportedDetail", { loader }) };
    if (iris?.enabled) return null;
    return { kind: iris ? "irisOff" : "irisMissing", text: t("detail.content.shaderNeedsIris") };
  };

  const issueFinding = ({ kind, subject }: ContentIssue): Finding => {
    switch (kind) {
      case "missingDependency":
        return { kind, text: t("detail.content.warnMissing", { name: subject }), detail: t("detail.content.warnMissingDetail", { name: subject }) };
      case "duplicate":
        return { kind, text: t("detail.content.warnDuplicate"), detail: t("detail.content.warnDuplicateDetail", { files: subject }) };
      case "wrongLoader":
        return {
          kind,
          text: t("detail.content.warnWrongLoader"),
          detail: t("detail.content.warnWrongLoaderDetail", { loaders: subject, loader }),
        };
      case "wrongMinecraft":
        return {
          kind,
          text: t("detail.content.warnWrongMinecraft", { version: instance.minecraftVersion }),
          detail: t("detail.content.warnWrongMinecraftDetail", { range: subject, version: instance.minecraftVersion }),
        };
    }
  };

  const issuesOf = (mod: Mod) => issues.filter((issue) => issue.modId === mod.id).map(issueFinding);
  const shader = shaderFinding();
  const findingsOf = (mod: Mod): Finding[] => [...(mod.kind === "shader" && shader ? [shader] : []), ...issuesOf(mod)];
  const total = instance.mods.reduce((n, mod) => n + findingsOf(mod).length, 0);
  return { findingsOf, total };
}
