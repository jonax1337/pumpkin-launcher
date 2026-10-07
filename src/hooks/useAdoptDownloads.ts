import { useEffect, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { t } from "@/i18n";
import { api } from "@/lib/api";
import type { BlockedFile } from "@/lib/content-types";
import { errorMessage } from "@/lib/errors";
import { instanceSaved } from "./useInstances";

/** Dateien, die der Nutzer von Hand laden muss, und die Instanz, in die sie kommen. */
export interface ManualTarget {
  instanceId: string;
  instanceName: string;
  items: BlockedFile[];
}

/** Das Backend meldet Dateien, die ein Modpack-Import nicht selbst laden durfte (Event `content-blocked`). */
export function useBlockedDownloads(onBlocked: (target: ManualTarget) => void) {
  useEffect(() => {
    let off: (() => void) | undefined;
    let gone = false;
    void api
      .onContentBlocked(async ({ instanceId, items }) => {
        const instance = await api.getInstance(instanceId).catch(() => null);
        onBlocked({ instanceId, instanceName: instance?.name ?? t("components.manual.fallbackInstance"), items });
      })
      .then((unlisten) => (gone ? unlisten() : (off = unlisten)));
    return () => {
      gone = true;
      off?.();
    };
  }, [onBlocked]);
}

const POLL_MS = 2500;
/** So lange bleibt der Dialog nach der letzten gefundenen Datei stehen, damit man „Eingebaut“ noch sieht. */
const AUTO_CLOSE_MS = 1200;

/**
 * Sieht im Downloads-Ordner nach den Dateien von `target` und baut gefundene ein. Die nächste Runde startet erst nach der
 * vorigen, damit sich wartende Anfragen (CurseForge drosselt) nicht stapeln. `onFinished` läuft kurz nach der letzten Datei.
 * Der Zustand gehört zu genau einem Ziel: für ein neues Ziel den Aufrufer mit neuem `key` einhängen.
 */
export function useAdoptDownloads(target: ManualTarget | null, onFinished: () => void) {
  const qc = useQueryClient();
  const [done, setDone] = useState<Set<number>>(new Set());
  const pending = useMemo(() => target?.items.filter((i) => !done.has(i.fileId)) ?? [], [target, done]);
  const allFound = !!target && target.items.length > 0 && pending.length === 0;

  useEffect(() => {
    if (!target || pending.length === 0) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    const markDone = (fileId: number) => setDone((d) => new Set(d).add(fileId));
    const tick = async () => {
      for (const item of pending) {
        if (stopped) return;
        try {
          const updated = await api.curseforgeAdoptDownload(target.instanceId, item);
          if (updated) {
            markDone(item.fileId);
            void instanceSaved(qc, updated);
          }
        } catch (err) {
          toast.error(t("components.manual.adoptFailed", { name: item.name }), { description: errorMessage(err) });
          markDone(item.fileId);
        }
      }
      if (!stopped) timer = setTimeout(() => void tick(), POLL_MS);
    };
    timer = setTimeout(() => void tick(), POLL_MS);
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [target, pending, qc]);

  useEffect(() => {
    if (!allFound) return;
    const { items } = target;
    toast.success(items.length === 1 ? t("components.manual.installedOne", { name: items[0].name }) : t("components.manual.installedAll", { n: items.length }));
    const timer = setTimeout(onFinished, AUTO_CLOSE_MS);
    return () => clearTimeout(timer);
  }, [allFound, target, onFinished]);

  return { done, pending };
}
