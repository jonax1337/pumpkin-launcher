import { useState } from "react";
import { toast } from "sonner";
import { useI18n } from "@/i18n";
import { NameDialog } from "@/components/NameDialog";
import { useConfirmTarget } from "@/hooks/useConfirmTarget";
import { api } from "@/lib/api";
import { toastError } from "@/lib/toast";
import type { Instance } from "@/lib/types";
import { Button, ConfirmDialog, Menu, Spacer, type MenuEntry } from "@/ui";
import { useAssignGroup, useDeleteMany, useExportMany } from "./useBulkActions";

/** So viele Namen nennt die Rückfrage beim Löschen, danach „und n weitere“. */
const NAMED_IN_CONFIRM = 3;

/** Namen für die Rückfrage: die ersten, dann „und n weitere“. */
function namesText(names: string[], andMore: (n: number) => string) {
  const rest = names.length - NAMED_IN_CONFIRM;
  const shown = names.slice(0, NAMED_IN_CONFIRM).join(", ");
  return rest > 0 ? `${shown} ${andMore(rest)}` : shown;
}

/**
 * Zweite Werkzeugleiste (`Toolbar alt`) im Platz der Filter, solange der Auswahlmodus an ist: Gruppe zuweisen, Exportieren (nacheinander)
 * und Löschen für die Auswahl. Sie belegt denselben Platz wie die Filterleiste, der Wechsel verschiebt nichts. `onDone` verlässt den Auswahlmodus.
 */
export function SelectionBar({ picked, groups, onSelectAll, onDone }: {
  picked: Instance[]; groups: string[]; onSelectAll: () => void; onDone: () => void;
}) {
  const { t } = useI18n();
  const assign = useAssignGroup();
  const deleteMany = useDeleteMany();
  const exportMany = useExportMany();
  const [naming, setNaming] = useState(false);
  const removal = useConfirmTarget<Instance[]>();
  const ids = picked.map((instance) => instance.id);
  const none = picked.length === 0;

  function assignGroup(group: string | null, then?: () => void) {
    const done = () => {
      toast.success(t(group ? "pages.instances.groupAssigned" : "pages.instances.groupRemoved", { n: ids.length, group: group ?? "" }));
      then?.();
    };
    assign.mutate({ ids, group }, { onSuccess: done });
  }

  function deleteSelected(targets: Instance[], closeDialog: () => void) {
    deleteMany.mutate(targets.map((instance) => instance.id), {
      onSuccess: () => {
        closeDialog();
        onDone();
      },
    });
  }

  const groupItems: MenuEntry[] = [
    ...groups.map((group) => ({ id: `group:${group}`, text: group, onSelect: () => assignGroup(group) })),
    ...(groups.length ? ["-" as const] : []),
    { id: "group-new", text: t("components.instance.newGroupMenu"), icon: "plus", onSelect: () => setNaming(true) },
    { id: "group-none", text: t("components.instance.removeFromGroup"), icon: "close", onSelect: () => assignGroup(null) },
  ];

  return (
    <div className="lib-bar" role="group" aria-label={t("pages.instances.selectionBar")}>
      <span className="lib-bar-count">{t("detail.content.selectedCount", { n: picked.length })}</span>
      <Button variant="ghost" size="s" onClick={onSelectAll}>{t("pages.instances.selectAll")}</Button>
      <Spacer />
      <Menu
        items={groupItems}
        trigger={<Button size="s" icon="tag" iconEnd="chev-down" disabled={none || assign.isPending}>{t("components.instance.group")}</Button>}
      />
      <Button size="s" icon="upload" disabled={none || !api.capabilities.exportInstance} onClick={() => void exportMany(picked).catch(toastError)}>
        {t("components.instance.exportEllipsis")}
      </Button>
      <Button size="s" icon="trash" disabled={none} onClick={() => removal.ask(picked)}>{t("common.delete")}</Button>
      <Button variant="ghost" size="s" onClick={onDone}>{t("common.done")}</Button>
      {naming && (
        <NameDialog
          title={t("components.instance.newGroupTitle")}
          label={t("components.instance.groupName")}
          help={t("pages.instances.groupHint", { n: picked.length })}
          initial=""
          maxLength={40}
          pending={assign.isPending}
          onSubmit={(group) => assignGroup(group, () => setNaming(false))}
          onClose={() => setNaming(false)}
        />
      )}
      <ConfirmDialog
        {...removal.dialogProps({
          title: () => t("pages.instances.bulkDeleteTitle"),
          text: (targets) =>
            t("pages.instances.bulkDeleteText", {
              names: namesText(targets.map((instance) => instance.name), (n) => t("pages.instances.andMore", { n })),
            }),
          pending: deleteMany.isPending,
          onConfirm: deleteSelected,
        })}
      />
    </div>
  );
}
