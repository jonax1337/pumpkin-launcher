import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { crashKeys } from "./queryKeys";
import { defaultMemory } from "./useMemory";

/**
 * Befunde zum letzten Absturz der Instanz. Sie beschreiben diesen Absturz und bleiben stehen, auch wenn der Nutzer etwas
 * behebt: Sonst verdoppelte ein zweiter Klick auf „RAM erhöhen“ den neuen Wert noch einmal. `useGameEvents` lädt sie nach
 * jedem Spielende neu.
 */
export function useCrashDiagnosis(instanceId: string) {
  const qc = useQueryClient();
  return useQuery({
    queryKey: crashKeys.diagnosis(instanceId),
    queryFn: async () => api.crashDiagnose(instanceId, await defaultMemory(qc)),
    staleTime: Infinity,
    gcTime: Infinity,
    retry: false,
  });
}
