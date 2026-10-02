import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { logKeys } from "./queryKeys";

/** Gesicherte Protokolle früherer Sitzungen, neueste zuerst; nach jedem Spielende lädt `useGameEvents` sie neu. */
export function useLogSessions(instanceId: string) {
  return useQuery({ queryKey: logKeys.sessions(instanceId), queryFn: () => api.logSessions(instanceId), retry: false });
}

/** Text einer gesicherten Sitzung; er ändert sich nie mehr. `null` = die laufende Sitzung, nichts zu laden. */
export function useLogSession(instanceId: string, sessionId: string | null) {
  return useQuery({
    queryKey: logKeys.session(instanceId, sessionId ?? ""),
    queryFn: () => api.logSessionRead(instanceId, sessionId!),
    enabled: sessionId != null,
    staleTime: Infinity,
  });
}
