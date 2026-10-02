import { useState } from "react";
import { QueryList } from "@/components/QueryList";
import { SkelList } from "@/components/SkelList";
import { useScreenshots, useTrashScreenshots } from "@/hooks/useScreenshots";
import { api } from "@/lib/api";
import { dayLabel, dayStart, formatDateTime } from "@/lib/format";
import { revealLocalPath } from "@/lib/links";
import { useI18n } from "@/i18n";
import type { Instance, Screenshot } from "@/lib/types";
import { Button, CardGrid, Count, Empty, Glyph, Icon, SectionHeader, Spacer, Toolbar } from "@/ui";
import { Lightbox } from "./screenshots/Lightbox";

/** So viele Platzhalter zeigt das Raster, solange die Liste lädt. */
const SKELETON_COUNT = 4;

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

/** Screenshots der Instanz als Raster nach Tagen; ein Klick öffnet die große Ansicht, „Auswählen“ markiert mehrere. */
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
            <SkelList n={SKELETON_COUNT} className="aspect-video" />
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

/** Dateiname des Bilds, dessen Kachel den Fokus bekommt; ist es gelöscht, die Seite. */
const focusShot = (fileName: string) =>
  (document.querySelector<HTMLElement>(`[data-shot="${CSS.escape(fileName)}"]`) ?? document.querySelector<HTMLElement>(".view"))?.focus();

function Gallery({ instanceId, shots }: { instanceId: string; shots: Screenshot[] }) {
  const { t } = useI18n();
  // Dateiname des gezeigten Bilds; `null` = keins.
  const [shown, setShown] = useState<string | null>(null);
  // Auswahlmodus mit den gewählten Dateinamen; `null` = aus.
  const [picked, setPicked] = useState<ReadonlySet<string> | null>(null);
  const trash = useTrashScreenshots(instanceId);
  const current = shots.find((s) => s.fileName === shown);
  const chosen = shots.filter((s) => picked?.has(s.fileName));

  const toggle = (fileName: string) =>
    setPicked((now) => {
      const next = new Set(now);
      if (!next.delete(fileName)) next.add(fileName);
      return next;
    });
  const removeChosen = () => {
    trash(chosen);
    setPicked(new Set());
  };

  return (
    <>
      <Toolbar
        label={t("detail.screenshots.selectToolbar")}
        alt={
          <>
            <span><Count value={chosen.length} minDigits={2} /> {t("detail.screenshots.selectedCount")}</span>
            <Button variant="ghost" size="s" onClick={() => setPicked(new Set(chosen.length === shots.length ? [] : shots.map((s) => s.fileName)))}>
              {chosen.length === shots.length ? t("detail.screenshots.selectNone") : t("detail.screenshots.selectAll")}
            </Button>
            <Spacer />
            <Button size="s" icon="folder" disabled={!chosen.length} onClick={() => revealLocalPath(chosen[0].path)}>
              {t("components.instance.revealInFolder")}
            </Button>
            <Button size="s" icon="trash" disabled={!chosen.length} onClick={removeChosen}>{t("common.delete")}</Button>
            <Button variant="ghost" size="s" onClick={() => setPicked(null)}>{t("detail.screenshots.selectDone")}</Button>
          </>
        }
        altActive={picked != null}
      >
        <Spacer />
        <Button size="s" icon="check" onClick={() => setPicked(new Set())}>{t("detail.screenshots.select")}</Button>
      </Toolbar>
      {byDay(shots).map(([day, group]) => (
        <section key={day} className="mt-4">
          <SectionHeader as="h2" title={<>{dayLabel(day)} <Count value={group.length} size={20} muted /></>} size="sub" />
          <CardGrid className="mt-2">
            {group.map((shot) => (
              <button
                key={shot.fileName}
                type="button"
                className="shot fx"
                data-shot={shot.fileName}
                data-selected={picked?.has(shot.fileName) ? "" : undefined}
                aria-label={t("detail.screenshots.shotAria", { date: formatDateTime(shot.takenAt) })}
                aria-pressed={picked ? picked.has(shot.fileName) : undefined}
                onClick={() => (picked ? toggle(shot.fileName) : setShown(shot.fileName))}
              >
                {/* Hunderte Bilder in voller Auflösung: erst laden, wenn sie in den Sichtbereich kommen. */}
                <img src={api.screenshotSrc(shot)} alt="" loading="lazy" decoding="async" />
                {picked && (
                  <span className="shot-mark" aria-hidden>
                    {picked.has(shot.fileName) && <Icon name="check" size="s" />}
                  </span>
                )}
              </button>
            ))}
          </CardGrid>
        </section>
      ))}
      {current && (
        <Lightbox
          instanceId={instanceId}
          shots={shots}
          current={current}
          onShow={setShown}
          onClose={() => setShown(null)}
          onClosed={focusShot}
        />
      )}
    </>
  );
}
