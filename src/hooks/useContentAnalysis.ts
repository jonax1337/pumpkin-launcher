import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { MINUTE } from "@/lib/time";
import type { Instance, Mod } from "@/lib/types";
import { contentKeys } from "./queryKeys";

/** Dateigröße und Metadaten ändern sich nur, wenn sich die Inhaltsliste ändert; dann wechselt der Schlüssel. */
const ANALYSIS_STALE_MS = 5 * MINUTE;

/** Kurzer Stand der Inhaltsliste (welche Dateien, ob ein): ändert sich die Liste, liest das Backend neu. */
function signatureOf(mods: Mod[]) {
  let hash = 5381;
  for (const m of mods) for (const c of `${m.fileName}|${m.sha1}|${m.enabled}`) hash = (hash * 33 + c.charCodeAt(0)) >>> 0;
  return `${mods.length}:${hash}`;
}

/**
 * Größe und Datum der Dateien samt Hinweisen aus den Mod-Metadaten. Beim Wechsel der Liste bleibt der alte Stand stehen,
 * bis der neue da ist (die Liste springt nicht).
 */
export function useContentAnalysis(instance: Instance) {
  return useQuery({
    queryKey: contentKeys.analysis(instance.id, signatureOf(instance.mods)),
    queryFn: () => api.contentAnalysis(instance.id),
    enabled: instance.mods.length > 0,
    staleTime: ANALYSIS_STALE_MS,
    placeholderData: (previous) => previous,
    retry: false,
  });
}
