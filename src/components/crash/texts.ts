import type { TKey } from "@/i18n";
import type { CrashDiagnosis, CrashDiagnosisId, CrashSeverity } from "@/lib/crash-types";
import { formatMemory } from "@/lib/format";
import type { Tone } from "@/ui";

interface DiagnosisText {
  title: TKey;
  body: TKey;
}

/** Titel und Text je Befund; die Kennungen gibt das Backend vor (`services/crashdiagnosis`). */
export const DIAGNOSIS_TEXTS: Record<CrashDiagnosisId, DiagnosisText> = {
  outOfMemory: { title: "crashAssistant.outOfMemory.title", body: "crashAssistant.outOfMemory.body" },
  outOfMemoryAtLimit: { title: "crashAssistant.outOfMemory.title", body: "crashAssistant.outOfMemoryAtLimit.body" },
  javaVersion: { title: "crashAssistant.javaVersion.title", body: "crashAssistant.javaVersion.body" },
  javaVersionUnknown: { title: "crashAssistant.javaVersion.title", body: "crashAssistant.javaVersionUnknown.body" },
  missingDependency: { title: "crashAssistant.missingDependency.title", body: "crashAssistant.missingDependency.body" },
  mixinFailure: { title: "crashAssistant.mixinFailure.title", body: "crashAssistant.mixinFailure.body" },
  duplicateMods: { title: "crashAssistant.duplicateMods.title", body: "crashAssistant.duplicateMods.body" },
  graphicsDriver: { title: "crashAssistant.graphicsDriver.title", body: "crashAssistant.graphicsDriver.body" },
  portInUse: { title: "crashAssistant.portInUse.title", body: "crashAssistant.portInUse.body" },
  gameFiles: { title: "crashAssistant.gameFiles.title", body: "crashAssistant.gameFiles.body" },
  suspectMods: { title: "crashAssistant.suspectMods.title", body: "crashAssistant.suspectMods.body" },
};

export const SEVERITY_TONE: Record<CrashSeverity, Extract<Tone, "bad" | "warn" | "neutral">> = {
  error: "bad",
  warning: "warn",
  info: "neutral",
};

/** Die Schwere in Worten, für Vorleser (das Symbol allein sagt sie nicht). */
export const SEVERITY_LABELS: Record<CrashSeverity, TKey> = {
  error: "crashAssistant.severity.error",
  warning: "crashAssistant.severity.warning",
  info: "crashAssistant.severity.info",
};

/** Werte für die Platzhalter des Texts: Arbeitsspeicher (`currentMb`) steht lesbar („8 GB“) unter dem Namen ohne `Mb`. */
export function textParams({ params }: CrashDiagnosis): Record<string, string> {
  return Object.fromEntries(
    Object.entries(params).map(([key, value]): [string, string] => (key.endsWith("Mb") ? [key.slice(0, -2), formatMemory(Number(value))] : [key, value])),
  );
}
