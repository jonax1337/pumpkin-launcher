import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { t } from "@/i18n";
import { api } from "@/lib/api";
import { formatSize } from "@/lib/format";
import { appKeys } from "./queryKeys";

/** Platzübersicht des Datenordners; bei jedem Öffnen frisch gemessen, Installationen und Spielen verändern sie laufend. */
export function useStorageOverview() {
  return useQuery({ queryKey: appKeys.storage, queryFn: api.storageOverview, staleTime: 0, retry: false });
}

/** „Cache leeren“: löscht, was keine Instanz braucht, und meldet, wie viel frei wurde. */
export function useClearCache() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: api.storageClearCache,
    onSuccess: (freed) => toast.success(freed > 0 ? t("settings.storage.cleared", { size: formatSize(freed) }) : t("settings.storage.nothingToClear")),
    onSettled: () => qc.invalidateQueries({ queryKey: appKeys.storage }),
  });
}
