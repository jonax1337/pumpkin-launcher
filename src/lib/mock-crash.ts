// Nur im Browser-Dev-Modus dynamisch geladen (siehe api.ts); im Release-Build nicht enthalten.
import type { Backend } from "./backend";
import type { CrashDiagnosis, CrashFixAction } from "./crash-types";
import { maxMemoryMb } from "./format";
import { MOCK_SYSTEM_MEMORY_MB } from "./mock-game";
import { findInstance, wait, type MockContext } from "./mock-util";
import type { Instance } from "./types";

/** Schrittweite, auf die das Backend den Vorschlag rundet. */
const MEMORY_STEP_MB = 512;

/** So viele Mods des Mocks stehen im vorgeführten Verdacht. */
const MOCK_SUSPECTS = 2;

const HEAP_LINE = "java.lang.OutOfMemoryError: Java heap space";

/** Wie das Backend: doppelter RAM, höchstens bis zur Obergrenze des PCs; steht die Instanz dort, gibt es nur die Erklärung. */
function memoryDiagnosis(currentMb: number): CrashDiagnosis {
  const limitMb = maxMemoryMb(MOCK_SYSTEM_MEMORY_MB);
  const suggestedMb = Math.min(Math.ceil((currentMb * 2) / MEMORY_STEP_MB) * MEMORY_STEP_MB, limitMb);
  if (suggestedMb <= currentMb)
    return { id: "outOfMemoryAtLimit", severity: "error", evidence: [HEAP_LINE], params: { currentMb: String(currentMb), limitMb: String(limitMb) }, actions: [] };
  return {
    id: "outOfMemory",
    severity: "error",
    evidence: [HEAP_LINE],
    params: { currentMb: String(currentMb), suggestedMb: String(suggestedMb) },
    actions: [{ type: "raiseMemory", suggestedMb }],
  };
}

/** Verdacht auf die ersten Mods der Instanz; ohne Mods entfällt er. */
function suspectsDiagnosis(instance: Instance): CrashDiagnosis[] {
  const suspects = instance.mods.filter((m) => m.kind === "mod" && m.enabled).slice(0, MOCK_SUSPECTS);
  if (!suspects.length) return [];
  return [{
    id: "suspectMods",
    severity: "warning",
    evidence: ['java.lang.NullPointerException: Cannot invoke "Object.hashCode()" because "key" is null'],
    params: { mods: suspects.map((m) => m.name).join(", ") },
    actions: suspects.map((m): CrashFixAction => ({ type: "disableMod", modId: m.id })),
  }];
}

/** Absturzassistent im Browser: immer ein voller Heap, dazu der Verdacht auf Mods der Instanz. */
export function createCrashMock({ db }: MockContext) {
  return {
    async crashDiagnose(instanceId, defaultMemoryMb) {
      await wait();
      const instance = findInstance(db, instanceId);
      return [memoryDiagnosis(instance.memoryMb ?? defaultMemoryMb), ...suspectsDiagnosis(instance)];
    },
  } satisfies Partial<Backend>;
}
