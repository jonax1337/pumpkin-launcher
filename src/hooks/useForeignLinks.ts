import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { t } from "@/i18n";
import { api } from "@/lib/api";
import { deepLinkKeys } from "./queryKeys";

/** Ob `modrinth://` und `curseforge://` dem Launcher gehören; im Browser und auf macOS wird nicht gefragt. */
export function useForeignLinks() {
  return useQuery({
    queryKey: deepLinkKeys.foreign,
    queryFn: api.foreignLinksEnabled,
    enabled: api.capabilities.foreignSchemes,
    staleTime: 0,
    retry: false,
  });
}

/** Überlässt die Links dem Launcher oder gibt sie wieder frei; das Ergebnis ist der Stand, den das System danach meldet. */
export function useSetForeignLinks() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: api.setForeignLinks,
    onSuccess: (enabled) => {
      qc.setQueryData(deepLinkKeys.foreign, enabled);
      toast.success(t(enabled ? "deepLinks.settings.enabledToast" : "deepLinks.settings.disabledToast"));
    },
    onSettled: () => qc.invalidateQueries({ queryKey: deepLinkKeys.foreign }),
  });
}
