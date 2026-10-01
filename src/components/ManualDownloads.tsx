import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { create } from "zustand";
import { Button, Chip, Dialog, DialogActions, Hint, List, ListRow, RowTitle } from "@/ui";
import { useI18n } from "@/i18n";
import { api } from "@/lib/api";
import { openPage } from "@/lib/links";
import type { BlockedFile } from "@/lib/modrinth";
import { instanceKeys } from "@/hooks/useInstances";

interface Target { instanceId: string; instanceName: string; items: BlockedFile[] }

const useManual = create<{ target: Target | null; set: (t: Target | null) => void }>((set) => ({ target: null, set: (target) => set({ target }) }));

/** Öffnet den Dialog „Von Hand laden“ (für einzelne Mods, die CurseForge nur über die Webseite ausliefert). */
export const openManualDownloads = (target: Target) => useManual.getState().set(target);

const POLL_MS = 2500;

/**
 * Manche Autoren erlauben den Download ihrer Mods nur über CurseForge. Das umgeht Pumpkin Launcher nicht: Der Nutzer lädt
 * die Datei dort selbst, der Launcher sieht sie im Downloads-Ordner (Größe und Prüfsumme müssen stimmen) und baut sie ein.
 */
export function ManualDownloads() {
  const { t } = useI18n();
  const target = useManual((s) => s.target);
  const set = useManual((s) => s.set);
  const qc = useQueryClient();
  const [done, setDone] = useState<Set<number>>(new Set());
  const items = target?.items ?? [];
  const pending = items.filter((i) => !done.has(i.fileId));
  const reported = useRef(false);

  // Das Event kommt vom Backend, wenn ein Modpack-Import Dateien übrig lässt.
  useEffect(() => {
    let off: (() => void) | undefined;
    let gone = false;
    void api.onContentBlocked(async (p) => {
      const instance = await api.getInstance(p.instanceId).catch(() => null);
      setDone(new Set());
      reported.current = false;
      useManual.getState().set({ instanceId: p.instanceId, instanceName: instance?.name ?? t("components.manual.fallbackInstance"), items: p.items });
    }).then((fn) => (gone ? fn() : (off = fn)));
    return () => {
      gone = true;
      off?.();
    };
  }, []);

  // Nach dem Schließen beginnt der nächste Dialog frisch.
  useEffect(() => {
    if (!target) {
      setDone(new Set());
      reported.current = false;
    }
  }, [target]);

  // Solange der Dialog offen ist, nach den Dateien im Downloads-Ordner sehen. Die nächste Runde startet erst nach der
  // vorigen, damit sich wartende Anfragen (CurseForge drosselt) nicht stapeln.
  useEffect(() => {
    if (!target || pending.length === 0) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    const tick = async () => {
      for (const item of pending) {
        if (stopped) return;
        try {
          const updated = await api.curseforgeAdoptDownload(target.instanceId, item.projectId, item.fileId, item.fileName);
          if (updated) {
            setDone((d) => new Set(d).add(item.fileId));
            qc.setQueryData(instanceKeys.detail(updated.id), updated);
            void qc.invalidateQueries({ queryKey: instanceKeys.all });
          }
        } catch (err) {
          toast.error(t("components.manual.adoptFailed", { name: item.name }), { description: err instanceof Error ? err.message : String(err) });
          setDone((d) => new Set(d).add(item.fileId));
        }
      }
      if (!stopped) timer = setTimeout(() => void tick(), POLL_MS);
    };
    timer = setTimeout(() => void tick(), POLL_MS);
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target, pending.length]);

  useEffect(() => {
    if (target && items.length > 0 && pending.length === 0 && !reported.current) {
      reported.current = true;
      toast.success(items.length === 1 ? t("components.manual.installedOne", { name: items[0].name }) : t("components.manual.installedAll", { n: items.length }));
      const timer = setTimeout(() => set(null), 1200);
      return () => clearTimeout(timer);
    }
  }, [target, items.length, pending.length, set, items]);

  return (
    <Dialog
      open={!!target}
      onOpenChange={(o) => {
        if (!o) {
          set(null);
          setDone(new Set());
        }
      }}
      title={pending.length === 1 ? t("components.manual.titleOne") : t("components.manual.titleMany", { n: pending.length || items.length })}
      sub={target?.instanceName}
      width={560}
      footer={<DialogActions cancel={pending.length ? t("components.manual.later") : t("common.done")} />}
    >
      <Hint icon="info">{t("components.manual.hint")}</Hint>
      <List variant="versions" aria-label={t("components.manual.listLabel")} className="mt-3">
        {items.map((i) => (
          <ListRow key={i.fileId}>
            <RowTitle title={i.name} sub={i.fileName} />
            {done.has(i.fileId) ? (
              <Chip icon="check">{t("components.manual.builtIn")}</Chip>
            ) : (
              <>
                <Chip size="s" dot>{t("components.manual.waiting")}</Chip>
                <Button size="s" icon="ext" onClick={() => openPage(i.url)}>{t("common.open")}</Button>
              </>
            )}
          </ListRow>
        ))}
      </List>
    </Dialog>
  );
}
