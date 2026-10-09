import { useState } from "react";
import { EmptyState } from "@/components/EmptyState";
import { useNavigate } from "react-router";
import { useI18n } from "@/i18n";
import { dequeueContent } from "@/hooks/contentQueue";
import { cancelContent } from "@/hooks/useContent";
import { useInstances } from "@/hooks/useInstances";
import { useCancelInstall } from "@/hooks/usePlay";
import { useRunningTasks } from "@/hooks/useRunningTasks";
import { progressLabel, progressShare } from "@/lib/progress";
import { installStepLabel } from "@/lib/types";
import { useContentQueue, type QueuedContent } from "@/store/contentQueue";
import { useTasks, type DoneTask } from "@/store/tasks";
import { BarButton, Button, Cell, Chip, Icon, IconButton, JobProgress, List, ListRow, Popover, RowTitle, SectionHeader, type ListLayout } from "@/ui";

/** Aufgabenliste: 64 px hohe Zeilen mit voller Trennlinie. */
const TASK_LIST: ListLayout = { cols: "32px minmax(0,1fr) 44px 32px", gap: 8, pad: "0 4px 0 6px", rowHeight: 64 };

type LiveTask = { id: string; label: string; sub: string; p: number | null; cancel?: () => void };

/** Zeilen der laufenden Aufgaben, mit „Abbrechen“, wo das Backend es kann. */
function useLiveTasks(): LiveTask[] {
  const { t } = useI18n();
  const { installs, content } = useRunningTasks();
  const cancelInstall = useCancelInstall();
  const { data: instances } = useInstances();
  const instanceOf = (id: string) => instances?.find((i) => i.id === id);
  const live = Object.values(installs ?? {}).map((p): LiveTask => ({
    id: `i-${p.instanceId}`,
    label: t("ui.tasks.installing", { name: instanceOf(p.instanceId)?.name ?? t("common.instance") }),
    sub: installStepLabel(p.step, instanceOf(p.instanceId)?.loader ?? "vanilla"),
    p: p.total > 0 ? p.done / p.total : null,
    cancel: () => cancelInstall.mutate(p.instanceId),
  }));
  if (content)
    live.push({
      id: `c-${content.active}`,
      label: content.label ?? t("ui.tasks.loadingContents"),
      sub: progressLabel(content.progress),
      p: progressShare(content.progress),
      cancel: content.cancellable ? cancelContent : undefined,
    });
  return live;
}

/** Zeile eines vorgemerkten Vorgangs; „Entfernen“ nimmt ihn aus der Warteschlange. */
function QueuedRow({ job }: { job: QueuedContent }) {
  const { t } = useI18n();
  return (
    <ListRow still>
      <Icon name="hourglass" tone="muted" />
      <RowTitle size="s" className="gap-[5px]" title={job.label} sub={t("ui.tasks.queuedSub")} />
      <Cell align="end" flex>
        <IconButton size="s" icon="close" label={t("ui.tasks.unqueueAria", { label: job.label })} onClick={() => dequeueContent(job.id)} />
      </Cell>
    </ListRow>
  );
}

/** Mittlerer Fortschritt der Aufgaben, deren Fortschritt bekannt ist (`null` = keine). */
function averageProgress(tasks: LiveTask[]) {
  const shares = tasks.flatMap((task) => task.p ?? []);
  return shares.length ? shares.reduce((sum, share) => sum + share, 0) / shares.length : null;
}

/** Aufgaben-Knopf der Seitenleiste mit Zähler und Mini-Balken; öffnet die laufenden und die fertigen Aufgaben. */
export function TasksButton() {
  const { t } = useI18n();
  const live = useLiveTasks();
  const queued = useContentQueue((s) => s.jobs);
  const history = useTasks((s) => s.history);
  const clear = useTasks((s) => s.clear);
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const pending = live.length + queued.length;
  const runningAria = t(pending === 1 ? "ui.tasks.ariaRunning.one" : "ui.tasks.ariaRunning.other", { count: pending });

  return (
    <Popover
      open={open}
      onOpenChange={setOpen}
      label={t("ui.tasks.title")}
      tip={t("ui.tasks.title")}
      side="right"
      trigger={
        // Feste Glyphe; Zähler und Mini-Balken liegen daneben bzw. darunter, nie darauf
        <BarButton
          side
          activity={{ count: pending, p: averageProgress(live) }}
          aria-label={pending > 0 ? runningAria : t("ui.tasks.title")}
        >
          <Icon name="tasks" size="l" />
        </BarButton>
      }
    >
      {/* Ohne Fertige kein Knopf; der Kopf bleibt 32 px hoch */}
      <SectionHeader
        title={t("ui.tasks.title")}
        as="h2"
        level="card"
        info={pending > 0 && <Chip tone="acc">{t("ui.tasks.activeCount", { count: pending })}</Chip>}
        actions={history.length > 0 && <Button variant="ghost" size="s" bleed="end" onClick={clear}>{t("ui.tasks.clearDone")}</Button>}
      />
      {pending || history.length ? (
        <List divided="strong" {...TASK_LIST} aria-label={t("ui.tasks.title")}>
          {live.map((job) => (
            <ListRow key={job.id} still>
              <Icon name="download" tone="acc" />
              <JobProgress
                full
                label={job.label}
                sub={job.sub}
                p={job.p}
                onCancel={job.cancel}
                cancelLabel={t("ui.job.cancelAria", { label: job.label })}
              />
            </ListRow>
          ))}
          {queued.map((job) => (
            <QueuedRow key={job.id} job={job} />
          ))}
          {history.map((done) => (
            <DoneRow key={done.id} task={done} onOpen={(to) => { setOpen(false); navigate(to); }} />
          ))}
        </List>
      ) : (
        <EmptyState size="pane" mood="sleep" title={t("ui.tasks.emptyTitle")}>{t("ui.tasks.emptyBody")}</EmptyState>
      )}
    </Popover>
  );
}

/** Fertige Aufgabe; „Öffnen“ führt zu ihrem Ergebnis, wo es eins gibt. */
function DoneRow({ task, onOpen }: { task: DoneTask; onOpen: (to: string) => void }) {
  const { t } = useI18n();
  const { to } = task;
  const fail = task.state === "fail";
  return (
    <ListRow still tone={fail ? "bad" : undefined} bar={fail} className={fail ? "py-2" : undefined}>
      <Icon name={task.state === "done" ? "success" : "warn"} tone={task.state === "done" ? "run" : "bad"} />
      <RowTitle size="s" wrap={fail} clamp={fail ? 3 : undefined} className="gap-[5px]" title={task.label} sub={<span title={task.sub}>{task.sub}</span>} />
      <Cell align="end" flex className="col-[3/-1]">
        {to && <Button size="s" onClick={() => onOpen(to)}>{t("common.open")}</Button>}
      </Cell>
    </ListRow>
  );
}
