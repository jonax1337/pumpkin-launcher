import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { defaultMemory } from "@/hooks/useInstances";
import { api } from "@/lib/api";
import { openPage } from "@/lib/links";
import type { LogKind } from "@/lib/types";

/** Hochladen zu mclo.gs, Link in die Zwischenablage; Fehler beim Hochladen meldet der zentrale Mutations-Toast. */
export function useShareLog() {
  return useMutation({
    mutationFn: ({ instanceId, kind }: { instanceId: string; kind: LogKind }) => api.shareLog(instanceId, kind),
    onSuccess: async (url) => {
      // Klappt das Kopieren nicht, steht der Link trotzdem im Toast: das Hochladen war erfolgreich.
      const copied = await navigator.clipboard.writeText(url).then(() => true, () => false);
      toast.success(copied ? "Link kopiert" : "Log geteilt", {
        description: url,
        duration: 15_000,
        action: { label: "Öffnen", onClick: () => openPage(url) },
      });
    },
  });
}

/** Debug-Info in die Zwischenablage. Scheitern kann praktisch nur das Kopieren. */
export function useCopyDebugInfo() {
  const qc = useQueryClient();
  return useMutation({
    meta: { ownErrorToast: true },
    mutationFn: async () => navigator.clipboard.writeText(await api.debugInfo(await defaultMemory(qc))),
    onSuccess: () => toast.success("Debug-Info kopiert", { description: "Füge sie in deinen Fehlerbericht ein." }),
    onError: () => toast.error("Kopieren hat nicht geklappt"),
  });
}
