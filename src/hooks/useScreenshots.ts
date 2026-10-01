import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { api } from "@/lib/api";
import type { Screenshot } from "@/lib/types";

export const screenshotsKey = (instanceId: string) => ["screenshots", instanceId] as const;

/** Screenshots der Instanz; bei jedem Öffnen des Tabs frisch gelesen, das Spiel legt jederzeit neue ab. */
export function useScreenshots(instanceId: string) {
  return useQuery({ queryKey: screenshotsKey(instanceId), queryFn: () => api.screenshots(instanceId), staleTime: 0 });
}

/** In den Papierkorb; die Liste lädt auch nach einem Fehler neu (Datei z. B. schon im Explorer gelöscht). */
export function useDeleteScreenshot(instanceId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (shot: Screenshot) => api.screenshotDelete(instanceId, shot.fileName),
    onSuccess: () => toast.success("Screenshot in den Papierkorb gelegt"),
    onSettled: () => qc.invalidateQueries({ queryKey: screenshotsKey(instanceId) }),
  });
}
