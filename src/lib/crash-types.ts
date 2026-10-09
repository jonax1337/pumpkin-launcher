// Befunde des Absturzassistenten; Gegenstück zu `services/crashdiagnosis` im Backend.

/** Wie schwer ein Befund wiegt: Ursache gefunden, wahrscheinlich oder nur ein Hinweis. */
export type CrashSeverity = "error" | "warning" | "info";

/** Was die Oberfläche für einen Befund ausführen kann; getaggt wie `FixAction` im Backend. */
export type CrashFixAction =
  | { type: "raiseMemory"; suggestedMb: number }
  | { type: "useManagedJava" }
  | { type: "installDependency"; projectQuery: string }
  | { type: "disableMod"; modId: string }
  | { type: "openUrl"; url: string }
  | { type: "reinstallGameFiles" };

/** Kennung eines Befunds; bestimmt seinen Text (`components/crash/texts.ts`). */
export type CrashDiagnosisId =
  | "outOfMemory"
  | "outOfMemoryAtLimit"
  | "javaVersion"
  | "javaVersionUnknown"
  | "missingDependency"
  | "mixinFailure"
  | "duplicateMods"
  | "graphicsDriver"
  | "portInUse"
  | "gameFiles"
  | "suspectMods";

/** Ein Befund mit kurzen Auszügen aus dem Bericht (`evidence`), den Werten für seinen Text (`params`) und Handgriffen. */
export interface CrashDiagnosis {
  id: CrashDiagnosisId;
  severity: CrashSeverity;
  evidence: string[];
  params: Record<string, string>;
  actions: CrashFixAction[];
}
