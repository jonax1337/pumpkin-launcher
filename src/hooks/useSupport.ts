import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { t } from "@/i18n";
import { defaultMemory } from "@/hooks/useMemory";
import { api } from "@/lib/api";
import { openPage } from "@/lib/links";
import { ACTION_TOAST_MS } from "@/lib/toast";
import type { LogKind } from "@/lib/types";

/** Hochladen zu mclo.gs, Link in die Zwischenablage; Fehler beim Hochladen meldet der zentrale Mutations-Toast. */
export function useShareLog() {
  return useMutation({
    mutationFn: ({ instanceId, kind }: { instanceId: string; kind: LogKind }) => api.shareLog(instanceId, kind),
    onSuccess: async (url) => {
      // Klappt das Kopieren nicht, steht der Link trotzdem im Toast: das Hochladen war erfolgreich.
      const copied = await navigator.clipboard.writeText(url).then(() => true, () => false);
      toast.success(copied ? t("hooks.support.linkCopied") : t("hooks.support.logShared"), {
        description: url,
        duration: ACTION_TOAST_MS,
        action: { label: t("common.open"), onClick: () => openPage(url) },
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
    onSuccess: () => toast.success(t("hooks.support.debugCopied"), { description: t("hooks.support.debugHint") }),
    onError: () => toast.error(t("components.common.copyFailed")),
  });
}
