import { useState } from "react";
import { useI18n } from "@/i18n";
import { Choice, ConfirmDialog, Empty, ErrorBox, Glyph, Hint, IconButton } from "@/ui";
import { loaderLine } from "@/components/common";
import { useConfirmTarget } from "@/hooks/useConfirmTarget";
import { useDeleteTemplate, useTemplates } from "@/hooks/useTemplates";
import { api } from "@/lib/api";
import { formatDate } from "@/lib/format";
import type { Template } from "@/lib/types";
import { ChoiceList, ChoiceListSkeleton } from "./ChoiceList";
import type { TabContext, TabModel } from "./tab";

const SKELETON_ROWS = 2;

/** Neue Instanz aus einer gespeicherten Vorlage; Vorlagen lassen sich hier auch löschen. */
function TemplatePane({ selected, onSelect }: { selected: string | null; onSelect: (template: Template | null) => void }) {
  const { t } = useI18n();
  const templates = useTemplates();
  const del = useDeleteTemplate();
  const removal = useConfirmTarget<Template>();

  if (templates.error) return <ErrorBox title={t("components.template.loadFailed")} error={templates.error} onRetry={() => void templates.refetch()} />;
  if (templates.isPending) return <ChoiceListSkeleton n={SKELETON_ROWS} />;
  if (!templates.data.length)
    return (
      <Empty ill={<Glyph name="chest" pal="sand" box={64} />} title={t("components.template.noneYet")} size="pane">
        {t("components.template.noneYetHint")}
      </Empty>
    );

  return (
    <>
      <ChoiceList>
        {templates.data.map((tpl) => (
          <div key={tpl.id} className="flex items-center gap-1">
            <Choice
              className="min-w-0 flex-1"
              media={<Glyph name="chest" pal="sand" />}
              title={tpl.name}
              sub={`${loaderLine(tpl)} · ${t(tpl.modCount === 1 ? "components.template.entryCount.one" : "components.template.entryCount.other", { n: tpl.modCount })} · ${t("components.template.savedAt", { date: formatDate(tpl.createdAt) })}`}
              selected={selected === tpl.id}
              onClick={() => onSelect(tpl)}
            />
            <IconButton size="s" icon="trash" tone="bad" label={t("components.template.deleteNamed", { name: tpl.name })} tip={t("components.template.delete")} disabled={del.isPending} onClick={() => removal.ask(tpl)} />
          </div>
        ))}
      </ChoiceList>
      <Hint className="mt-3">{t("components.template.saveHint")}</Hint>
      <ConfirmDialog
        {...removal.dialogProps({
          title: (tpl) => t("components.template.deleteQuotedTitle", { name: tpl.name }),
          text: () => t("components.template.deleteText"),
          pending: del.isPending,
          onConfirm: (tpl, close) =>
            del.mutate(tpl.id, {
              onSuccess: () => {
                if (selected === tpl.id) onSelect(null);
                close();
              },
            }),
        })}
      />
    </>
  );
}

/** Reiter „Vorlage“: Instanz aus einer gespeicherten Vorlage. */
export function useTemplateTab(ctx: TabContext): TabModel {
  const { t } = useI18n();
  const [template, setTemplate] = useState<Template | null>(null);

  function submit() {
    if (!template) return;
    ctx.background.run({
      key: `template:${template.id}`,
      label: t("components.newInstance.createTemplateTask", { name: template.name }),
      doneLabel: t("components.newInstance.createTemplateTaskDone", { name: template.name }),
      cancellable: true,
      task: (operationId) => api.templateCreateInstance(template.id, template.name, operationId),
      onDone: ctx.onCreated,
    });
  }

  return {
    valid: !!template && !ctx.active,
    label: ctx.runningLabel ?? t("components.newInstance.create"),
    hint: template ? t("components.newInstance.noWorldsInTemplate") : t("components.newInstance.pickTemplate"),
    queues: true,
    busy: false,
    submit,
    renderPane: () => <TemplatePane selected={template?.id ?? null} onSelect={setTemplate} />,
  };
}
