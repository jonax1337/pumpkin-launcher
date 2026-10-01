import { useEffect, useState } from "react";
import { QueryList } from "@/components/QueryList";
import { SkelList } from "@/components/SkelList";
import { useDeleteScreenshot, useScreenshots } from "@/hooks/useScreenshots";
import { api } from "@/lib/api";
import { dayLabel, dayStart, formatDateTime, formatSize } from "@/lib/format";
import { openLocalPath, revealLocalPath } from "@/lib/links";
import { useI18n } from "@/i18n";
import type { Instance, Screenshot } from "@/lib/types";
import { Actions, Button, CardGrid, Count, Dialog, Empty, Glyph, IconButton, SectionHeader } from "@/ui";

/** Screenshots je Kalendertag; die Liste kommt neueste zuerst, die Map behält diese Reihenfolge. */
function byDay(shots: Screenshot[]) {
  const days = new Map<number, Screenshot[]>();
  for (const shot of shots) {
    const day = dayStart(shot.takenAt);
    const group = days.get(day);
    if (group) group.push(shot);
    else days.set(day, [shot]);
  }
  return [...days];
}

/** Screenshots der Instanz als Raster nach Tagen; ein Klick öffnet die große Ansicht. */
export function ScreenshotsTab({ instance }: { instance: Instance }) {
  const { t } = useI18n();
  const shots = useScreenshots(instance.id);
  return (
    <div className="pt-2">
      <QueryList
        query={shots}
        error={t("detail.screenshots.loadError")}
        loading={
          <CardGrid aria-busy aria-label={t("common.loading")}>
            <SkelList n={4} className="aspect-video" />
          </CardGrid>
        }
        empty={
          <Empty ill={<Glyph name="picture" pal="sand" box={64} />} title={t("detail.screenshots.emptyTitle")}>
            {t("detail.screenshots.emptyHint")}
          </Empty>
        }
      >
        {(list) => <Gallery instanceId={instance.id} shots={list} />}
      </QueryList>
    </div>
  );
}

function Gallery({ instanceId, shots }: { instanceId: string; shots: Screenshot[] }) {
  const { t } = useI18n();
  // Dateiname des gezeigten Bilds; `null` = keins.
  const [shown, setShown] = useState<string | null>(null);
  const current = shots.find((s) => s.fileName === shown);
  return (
    <>
      {byDay(shots).map(([day, group]) => (
        <section key={day} className="mt-4">
          <SectionHeader title={<>{dayLabel(day)} <Count value={group.length} size={20} muted /></>} size="sub" />
          <CardGrid className="mt-2">
            {group.map((shot) => (
              <button key={shot.fileName} type="button" className="shot fx" aria-label={t("detail.screenshots.shotAria", { date: formatDateTime(shot.takenAt) })} onClick={() => setShown(shot.fileName)}>
                {/* Hunderte Bilder in voller Auflösung: erst laden, wenn sie in den Sichtbereich kommen. */}
                <img src={api.screenshotSrc(shot)} alt="" loading="lazy" decoding="async" />
              </button>
            ))}
          </CardGrid>
        </section>
      ))}
      {current && <Lightbox instanceId={instanceId} shots={shots} current={current} onShow={setShown} />}
    </>
  );
}

/** Große Ansicht mit Blättern (auch ← →), Öffnen im Bildbetrachter, Zeigen im Ordner und Löschen in den Papierkorb. */
function Lightbox({ instanceId, shots, current, onShow }: { instanceId: string; shots: Screenshot[]; current: Screenshot; onShow: (fileName: string | null) => void }) {
  const { t } = useI18n();
  const remove = useDeleteScreenshot(instanceId);
  const index = shots.indexOf(current);
  const prev = shots[index - 1]?.fileName ?? null;
  const next = shots[index + 1]?.fileName ?? null;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.key === "ArrowLeft" ? prev : e.key === "ArrowRight" ? next : null;
      if (target) onShow(target);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [prev, next, onShow]);

  const title = formatDateTime(current.takenAt);
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onShow(null)}
      title={title}
      sub={`${current.fileName} · ${formatSize(current.size)}`}
      width={1200}
      footLeft={
        <Actions>
          <IconButton icon="back" label={t("detail.screenshots.prevAria")} disabled={!prev} onClick={() => onShow(prev)} />
          <Count value={`${index + 1} / ${shots.length}`} size={16} />
          <IconButton icon="chev" label={t("detail.screenshots.nextAria")} disabled={!next} onClick={() => onShow(next)} />
        </Actions>
      }
      footer={
        <>
          {/* Ohne Rückfrage: der Papierkorb macht das Löschen umkehrbar. */}
          <Button
            variant="ghost"
            tone="bad"
            icon="trash"
            disabled={remove.isPending}
            onClick={() => remove.mutate(current, { onSuccess: () => onShow(next ?? prev) })}
          >
            {t("common.delete")}
          </Button>
          <Button icon="folder" onClick={() => revealLocalPath(current.path)}>{t("components.instance.revealInFolder")}</Button>
          <Button variant="primary" icon="ext" onClick={() => openLocalPath(current.path)}>{t("common.open")}</Button>
        </>
      }
    >
      <img className="shot-full" src={api.screenshotSrc(current)} alt={t("detail.screenshots.shotAria", { date: title })} />
    </Dialog>
  );
}
