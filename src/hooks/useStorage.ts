import { useIsMutating, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { t } from "@/i18n";
import { api } from "@/lib/api";
import { formatSize } from "@/lib/format";
import { appKeys, instanceKeys, instanceRelatedKeys, logKeys, screenshotKeys, worldKeys } from "./queryKeys";

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

const SET_INSTANCES_DIR_KEY = ["storage", "set-instances-dir"] as const;

/** Läuft ein Verschieben (auch nach einem Tabwechsel, wenn die Ansicht neu gemountet wurde)? */
export function useInstancesMoveRunning() {
  return useIsMutating({ mutationKey: SET_INSTANCES_DIR_KEY }) > 0;
}

export function useSetInstancesDir() {
  const qc = useQueryClient();
  return useMutation({
    mutationKey: SET_INSTANCES_DIR_KEY,
    mutationFn: api.storageSetInstancesDir,
    onSuccess: async ({ overview, retainedSourceDir }) => {
      await qc.cancelQueries({ queryKey: appKeys.storage });
      qc.setQueryData(appKeys.storage, overview);
      if (retainedSourceDir) {
        toast.warning(t("settings.storage.sourceRetained", { path: retainedSourceDir }), { duration: Infinity });
      } else {
        toast.success(t("settings.storage.moved"));
      }
      const keys = [
        appKeys.storage,
        ...instanceRelatedKeys,
        ...overview.instances.flatMap(({ id }) => [
          worldKeys.all(id), logKeys.all(id), screenshotKeys.list(id), instanceKeys.exportEntries(id),
        ]),
      ];
      await Promise.all(keys.map((queryKey) => qc.invalidateQueries({ queryKey })));
    },
  });
}
