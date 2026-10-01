import { MutationCache, QueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { isCancelled } from "@/lib/errors";
import { CANCELLED } from "@/lib/types";

/** Abfragen ohne eigene Angabe gelten kurz als frisch; was seltener wechselt, setzt `staleTime` selbst (hooks/staleTimes.ts). */
const DEFAULT_STALE_MS = 30_000;

/**
 * Der eine Client der App: auch Code außerhalb von React (Stores, Anmeldeablauf) kommt so an den Cache.
 * Mutations-Fehler zentral als Toast; Mutationen mit eigenem Fehler-Toast setzen `meta.ownErrorToast`.
 * Query-Fehler zeigen die Seiten inline.
 */
export const queryClient = new QueryClient({
  mutationCache: new MutationCache({
    onError: (err, _vars, _ctx, mutation) => {
      if (mutation.meta?.ownErrorToast) return;
      // Abbrechen war Absicht: neutral melden, nicht als Fehler.
      if (isCancelled(err)) toast(CANCELLED);
      else toast.error(err.message);
    },
  }),
  defaultOptions: {
    queries: { staleTime: DEFAULT_STALE_MS, refetchOnWindowFocus: false, retry: 1 },
  },
});
