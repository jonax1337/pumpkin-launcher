import { useEffect, useState } from "react";
import { toast } from "sonner";
import { useDeleteScreenshot, useScreenshots } from "@/hooks/useScreenshots";
import { api } from "@/lib/api";
import { formatDate, formatSize } from "@/lib/format";
import type { Instance, Screenshot } from "@/lib/types";
import { Actions, Button, CardGrid, Count, Dialog, Empty, ErrorBox, Glyph, IconButton, SectionHeader, Skel } from "@/ui";

const DAY = 86_400_000;
const dayStart = (ms: number) => new Date(ms).setHours(0, 0, 0, 0);
const shotTime = new Intl.DateTimeFormat("de", { dateStyle: "medium", timeStyle: "short" });

/** „Heute“, „Gestern“, sonst das Datum. Gerundet, weil Tage mit Zeitumstellung 23 oder 25 Stunden haben. */
function dayTitle(day: number) {
  const ago = Math.round((dayStart(Date.now()) - day) / DAY);
  return ago === 0 ? "Heute" : ago === 1 ? "Gestern" : formatDate(day);
}

/** Screenshots je Kalendertag; die Liste kommt neueste zuerst, die Map behält diese Reihenfolge. */
function byDay(shots: Screenshot[]) {
  const days = new Map<number, Screenshot[]>();
  for (const shot of shots) {
    const day = dayStart(shot.takenAt);
    days.set(day, [...(days.get(day) ?? []), shot]);
  }
  return [...days];
}

const fail = (e: Error) => toast.error(e.message);

/** Screenshots der Instanz als Raster nach Tagen; ein Klick öffnet die große Ansicht. */
export function ScreenshotsTab({ instance }: { instance: Instance }) {
  const shots = useScreenshots(instance.id);
  const [shown, setShown] = useState<string | null>(null);

  if (shots.error) return <ErrorBox className="mt-4" title="Die Screenshots konnten nicht geladen werden" error={shots.error} onRetry={() => void shots.refetch()} />;
  if (!shots.data)
    return (
      <CardGrid className="mt-4" aria-busy aria-label="Wird geladen">
        {[0, 1, 2, 3].map((k) => <Skel key={k} className="aspect-video" />)}
      </CardGrid>
    );
  if (!shots.data.length)
    return (
      <Empty ill={<Glyph name="picture" pal="sand" box={64} />} title="Noch keine Screenshots">
        Drück im Spiel F2. Minecraft legt das Bild in dieser Instanz ab, und es erscheint hier.
      </Empty>
    );

  const list = shots.data;
  const current = list.find((s) => s.fileName === shown);
  return (
    <div className="pt-2">
      {byDay(list).map(([day, group]) => (
        <section key={day} className="mt-4">
          <SectionHeader title={<>{dayTitle(day)} <Count value={group.length} size={20} muted /></>} size="sub" />
          <CardGrid className="mt-2">
            {group.map((shot) => (
              <button key={shot.fileName} type="button" className="shot fx" aria-label={`Screenshot vom ${shotTime.format(shot.takenAt)}`} onClick={() => setShown(shot.fileName)}>
                {/* Hunderte Bilder in voller Auflösung: erst laden, wenn sie in den Sichtbereich kommen. */}
                <img src={api.screenshotSrc(shot)} alt="" loading="lazy" decoding="async" />
              </button>
            ))}
          </CardGrid>
        </section>
      ))}
      {current && <Lightbox instanceId={instance.id} shots={list} current={current} onShow={(s) => setShown(s?.fileName ?? null)} />}
    </div>
  );
}

/** Große Ansicht mit Blättern (auch ← →), Öffnen im Bildbetrachter, Zeigen im Ordner und Löschen in den Papierkorb. */
function Lightbox({ instanceId, shots, current, onShow }: { instanceId: string; shots: Screenshot[]; current: Screenshot; onShow: (shot: Screenshot | null) => void }) {
  const remove = useDeleteScreenshot(instanceId);
  const index = shots.indexOf(current);
  const prev = shots[index - 1];
  const next = shots[index + 1];

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.key === "ArrowLeft" ? prev : e.key === "ArrowRight" ? next : undefined;
      if (target) onShow(target);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [prev, next, onShow]);

  const title = shotTime.format(current.takenAt);
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onShow(null)}
      title={title}
      sub={`${current.fileName} · ${formatSize(current.size)}`}
      width={1200}
      footLeft={
        <Actions>
          <IconButton icon="back" label="Vorheriger Screenshot" disabled={!prev} onClick={() => onShow(prev)} />
          <Count value={`${index + 1} / ${shots.length}`} size={16} />
          <IconButton icon="chev" label="Nächster Screenshot" disabled={!next} onClick={() => onShow(next)} />
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
            onClick={() => remove.mutate(current, { onSuccess: () => onShow(next ?? prev ?? null) })}
          >
            Löschen
          </Button>
          <Button icon="folder" onClick={() => void api.revealPath(current.path).catch(fail)}>Im Ordner zeigen</Button>
          <Button variant="primary" icon="ext" onClick={() => void api.openPath(current.path).catch(fail)}>Öffnen</Button>
        </>
      }
    >
      <img className="shot-full" src={api.screenshotSrc(current)} alt={`Screenshot vom ${title}`} />
    </Dialog>
  );
}
