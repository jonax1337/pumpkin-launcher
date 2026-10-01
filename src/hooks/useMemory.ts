import { useQuery, type QueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { autoMemoryMb, MEMORY_FALLBACK_MAX_MB, MEMORY_FALLBACK_MB, maxMemoryMb } from "@/lib/format";
import { useSettings } from "@/store/settings";
import { appKeys } from "./queryKeys";

const systemMemoryQuery = { queryKey: appKeys.systemMemory, queryFn: api.systemMemoryMb, staleTime: Infinity, retry: false } as const;

/**
 * Arbeitsspeicher: `value` ist der Standard für alle Instanzen (eigene Wahl oder automatisch),
 * `max` die Obergrenze für Regler, `total` der Speicher des PCs (null, solange unbekannt).
 */
export function useMemory() {
  const chosen = useSettings((s) => s.memoryMb);
  const { data: total = null } = useQuery(systemMemoryQuery);
  const auto = total == null ? MEMORY_FALLBACK_MB : autoMemoryMb(total);
  return { value: chosen ?? auto, auto, total, max: total == null ? MEMORY_FALLBACK_MAX_MB : maxMemoryMb(total), isAuto: chosen == null };
}

/** RAM für Instanzen ohne eigene Einstellung, wie ihn der Start übergibt. */
export async function defaultMemory(qc: QueryClient) {
  const chosen = useSettings.getState().memoryMb;
  if (chosen != null) return chosen;
  try {
    return autoMemoryMb(await qc.fetchQuery(systemMemoryQuery));
  } catch {
    return MEMORY_FALLBACK_MB;
  }
}
