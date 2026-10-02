import { useCallback } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast, type ExternalToast } from "sonner";
import { create } from "zustand";
import { t } from "@/i18n";
import { api } from "@/lib/api";
import { toastError } from "@/lib/toast";
import type { Screenshot } from "@/lib/types";
import { screenshotKeys } from "./queryKeys";

/** So lange (ms) bleibt „Rückgängig“ möglich, bevor die Screenshots in den Papierkorb wandern. */
const UNDO_MS = 6500;

interface TrashingState {
  /** Dateinamen je Instanz, die gleich gelöscht werden: die Liste blendet sie bis dahin aus. */
  pending: Record<string, string[]>;
  hide: (instanceId: string, names: string[]) => void;
  show: (instanceId: string, names: string[]) => void;
}

const useTrashing = create<TrashingState>()((set) => ({
  pending: {},
  hide: (instanceId, names) => set((s) => ({ pending: { ...s.pending, [instanceId]: [...(s.pending[instanceId] ?? []), ...names] } })),
  show: (instanceId, names) =>
    set((s) => ({ pending: { ...s.pending, [instanceId]: (s.pending[instanceId] ?? []).filter((name) => !names.includes(name)) } })),
}));

/** Screenshots der Instanz; bei jedem Öffnen des Tabs frisch gelesen, das Spiel legt jederzeit neue ab. */
export function useScreenshots(instanceId: string) {
  const pending = useTrashing((s) => s.pending[instanceId]);
  const withoutPending = useCallback((list: Screenshot[]) => (pending?.length ? list.filter((s) => !pending.includes(s.fileName)) : list), [pending]);
  return useQuery({ queryKey: screenshotKeys.list(instanceId), queryFn: () => api.screenshots(instanceId), staleTime: 0, select: withoutPending });
}

const trashedText = (shots: Screenshot[]) =>
  shots.length === 1 ? t("hooks.screenshot.trashed.one") : t("hooks.screenshot.trashed.other", { count: shots.length });

/**
 * Legt Screenshots in den Papierkorb, aber erst nach einer Frist: sofort verschwinden sie aus der Liste, ein Toast bietet
 * „Rückgängig“. Die Liste lädt auch nach einem Fehler neu (Datei z. B. schon im Dateimanager gelöscht).
 * `toastOptions` stellt den Toast um, z. B. weg von der Stelle, die die große Ansicht verdeckt.
 */
export function useTrashScreenshots(instanceId: string) {
  const qc = useQueryClient();
  return useCallback(
    (shots: Screenshot[], toastOptions?: ExternalToast) => {
      const names = shots.map((s) => s.fileName);
      const { hide, show } = useTrashing.getState();
      hide(instanceId, names);
      const trash = async () => {
        const results = await Promise.allSettled(names.map((name) => api.screenshotDelete(instanceId, name)));
        results.forEach((result) => result.status === "rejected" && toastError(result.reason));
        await qc.invalidateQueries({ queryKey: screenshotKeys.list(instanceId) });
        show(instanceId, names);
      };
      const timer = setTimeout(() => void trash(), UNDO_MS);
      const undo = () => {
        clearTimeout(timer);
        show(instanceId, names);
      };
      toast(trashedText(shots), { duration: UNDO_MS, action: { label: t("ui.list.undo"), onClick: undo }, ...toastOptions });
    },
    [instanceId, qc],
  );
}

/** Kopiert den Screenshot als Bild in die Zwischenablage; ein Toast meldet das Ergebnis. */
export async function copyScreenshot(instanceId: string, shot: Screenshot, toastOptions?: ExternalToast) {
  try {
    const png = new Blob([await api.screenshotRead(instanceId, shot.fileName)], { type: "image/png" });
    await navigator.clipboard.write([new ClipboardItem({ [png.type]: png })]);
    toast.success(t("hooks.screenshot.copied"), toastOptions);
  } catch {
    toast.error(t("hooks.screenshot.copyFailed"), toastOptions);
  }
}
