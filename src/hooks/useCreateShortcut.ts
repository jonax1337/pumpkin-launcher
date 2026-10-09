import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import { t } from "@/i18n";
import { api } from "@/lib/api";
import { revealLocalPath } from "@/lib/links";
import { renderShortcutIcon } from "@/lib/shortcutIcon";
import { ACTION_TOAST_MS } from "@/lib/toast";
import type { Instance } from "@/lib/types";

/**
 * Legt eine Desktop-Verknüpfung zur Instanz an, mit dem Icon der Instanz (eigenes Bild, Modpack-Icon oder Pixel-Icon);
 * der Toast führt zur Datei im Dateimanager. Das Icon ist Zierde: lässt es sich nicht zeichnen, trägt die Verknüpfung das des Launchers.
 */
export function useCreateShortcut() {
  return useMutation({
    mutationFn: async (instance: Instance) => {
      const iconPng = await renderShortcutIcon(instance).catch((error: unknown) => {
        console.warn("Icon der Verknüpfung nicht gezeichnet", error);
        return null;
      });
      return api.createShortcut(instance.id, iconPng);
    },
    onSuccess: (path, instance) =>
      toast.success(t("deepLinks.shortcut.created", { name: instance.name }), {
        description: t("deepLinks.shortcut.createdHint"),
        duration: ACTION_TOAST_MS,
        action: { label: t("components.instance.revealInFolder"), onClick: () => revealLocalPath(path) },
      }),
  });
}
