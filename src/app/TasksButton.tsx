import { useState } from "react";
import { useNavigate } from "react-router";
import { useI18n } from "@/i18n";
import { cancelContent } from "@/hooks/useContent";
import { useInstances } from "@/hooks/useInstances";
import { useCancelInstall } from "@/hooks/usePlay";
import { useRunningTasks } from "@/hooks/useRunningTasks";
import { progressLabel, progressShare } from "@/lib/progress";
import { installStepLabel } from "@/lib/types";
import { useTasks, type DoneTask } from "@/store/tasks";
import { BarButton, Button, Cell, Empty, Icon, JobProgress, List, ListRow, Popover, RowTitle, SectionHeader } from "@/ui";

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

/** Mittlerer Fortschritt der Aufgaben, deren Fortschritt bekannt ist (`null` = keine). */
function averageProgress(tasks: LiveTask[]) {
  const shares = tasks.flatMap((task) => task.p ?? []);
  return shares.length ? shares.reduce((sum, share) => sum + share, 0) / shares.length : null;
}

/** Aufgaben-Knopf der Seitenleiste mit Zähler und Mini-Balken; öffnet die laufenden und die fertigen Aufgaben. */
export function TasksButton() {
  const { t } = useI18n();
  const live = useLiveTasks();
  const history = useTasks((s) => s.history);
  const clear = useTasks((s) => s.clear);
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const runningAria = t(live.length === 1 ? "ui.tasks.ariaRunning.one" : "ui.tasks.ariaRunning.other", { count: live.length });

  return (
    <Popover
      open={open}
      onOpenChange={setOpen}
      label={t("ui.tasks.title")}
      tip={t("ui.tasks.title")}
      width={400}
      side="right"
      trigger={
        // Feste Glyphe; Zähler und Mini-Balken liegen daneben bzw. darunter, nie darauf
        <BarButton
          side
          activity={{ count: live.length, p: averageProgress(live) }}
          aria-label={live.length > 0 ? runningAria : t("ui.tasks.title")}
        >
          <Icon name="tasks" />
        </BarButton>
      }
    >
      {/* Ohne Fertige kein Knopf; der Kopf bleibt 32 px hoch */}
      <SectionHeader
        title={t("ui.tasks.title")}
        as="h2"
        size="card"
        actions={history.length > 0 && <Button variant="ghost" size="s" bleed="end" onClick={clear}>{t("ui.tasks.clearDone")}</Button>}
      />
      {live.length || history.length ? (
        <List variant="tasks" divided aria-label={t("ui.tasks.title")}>
          {live.map((job) => (
            <ListRow key={job.id}>
              <Icon name="dl" tone="acc" />
              <JobProgress
                label={job.label}
                sub={job.sub}
                p={job.p}
                onCancel={job.cancel}
                cancelLabel={t("ui.job.cancelAria", { label: job.label })}
              />
            </ListRow>
          ))}
          {history.map((done) => (
            <DoneRow key={done.id} task={done} onOpen={(to) => { setOpen(false); navigate(to); }} />
          ))}
        </List>
      ) : (
        <Empty size="pane" mood="sleep" title={t("ui.tasks.emptyTitle")}>{t("ui.tasks.emptyBody")}</Empty>
      )}
    </Popover>
  );
}

/** Fertige Aufgabe; „Öffnen“ führt zu ihrem Ergebnis, wo es eins gibt. */
function DoneRow({ task, onOpen }: { task: DoneTask; onOpen: (to: string) => void }) {
  const { t } = useI18n();
  const { to } = task;
  return (
    <ListRow>
      <Icon name={task.state === "done" ? "check" : "warn"} tone={task.state === "done" ? "run" : "bad"} />
      <RowTitle title={task.label} sub={task.sub} />
      <Cell align="end" flex>
        {to && <Button size="s" onClick={() => onOpen(to)}>{t("common.open")}</Button>}
      </Cell>
    </ListRow>
  );
}
