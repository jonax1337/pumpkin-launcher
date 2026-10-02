import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { appKeys } from "./queryKeys";

/** Java-Installationen des Rechners; die Suche ist kurz und nur ein Angebot, ein Fehler heißt „keine gefunden“. */
export function useJavaInstalls() {
  return useQuery({ queryKey: appKeys.javaInstalls, queryFn: api.detectJava, staleTime: Infinity, retry: false });
}
