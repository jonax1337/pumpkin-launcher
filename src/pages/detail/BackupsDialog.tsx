import { Actions, ConfirmDialog, Dialog, DialogActions, Empty, IconButton, List, ListRow, RowTitle } from "@/ui";
import { QueryList } from "@/components/QueryList";
import { useConfirmTarget } from "@/hooks/useConfirmTarget";
import { useDeleteBackup, useWorldBackups, useWorldJobs } from "@/hooks/useWorlds";
import { formatDateTime, formatSize } from "@/lib/format";
import { useI18n } from "@/i18n";
import type { Instance, WorldBackup } from "@/lib/types";
import { GuardedButton } from "./guards";
import { WORLD_DIALOG_WIDTH } from "./worldDialog";

/** Sicherungen einer Welt (`world`) oder aller Welten (`null`): wiederherstellen (immer als neue Welt) oder löschen. */
export function BackupsDialog({ instance, world, busy, onClose }: {
  instance: Instance; world: string | null; busy: string | null; onClose: () => void;
}) {
  const { t } = useI18n();
  const backups = useWorldBackups(instance.id, world);
  const { restore } = useWorldJobs(instance);
  const remove = useDeleteBackup(instance.id);
  const removal = useConfirmTarget<WorldBackup>();
  return (
    <Dialog
      open
      onOpenChange={(open) => !open && onClose()}
      title={t("detail.worlds.backupsTitle")}
      sub={world ?? instance.name}
      width={WORLD_DIALOG_WIDTH}
      footer={<DialogActions cancel={t("common.close")} />}
    >
      <QueryList
        query={backups}
        error={t("detail.worlds.backupsLoadError")}
        empty={<Empty size="pane" title={t("detail.worlds.backupsEmptyTitle")}>{t("detail.worlds.backupsEmptyHint")}</Empty>}
      >
        {(list) => (
          <List variant="versions" aria-label={t("detail.worlds.backupsTitle")}>
            {list.map((backup) => (
              <ListRow key={backup.id}>
                {/* Für eine Welt zählt der Zeitpunkt; in der Liste aller Welten zuerst, welche es ist. */}
                {world == null ? (
                  <RowTitle title={backup.world} sub={`${formatDateTime(backup.createdAt)} · ${formatSize(backup.sizeBytes)}`} />
                ) : (
                  <RowTitle title={formatDateTime(backup.createdAt)} sub={formatSize(backup.sizeBytes)} />
                )}
                <Actions gap={4}>
                  <GuardedButton size="s" icon="redo" blocked={busy} disabled={restore.isPending} onClick={() => restore.mutate(backup)}>
                    {t("detail.worlds.restoreAction")}
                  </GuardedButton>
                  <IconButton
                    size="s"
                    icon="trash"
                    label={t("detail.worlds.backupDeleteAria", { date: formatDateTime(backup.createdAt) })}
                    tip={t("common.delete")}
                    onClick={() => removal.ask(backup)}
                  />
                </Actions>
              </ListRow>
            ))}
          </List>
        )}
      </QueryList>
      <ConfirmDialog
        {...removal.dialogProps({
          title: () => t("detail.worlds.backupDeleteTitle"),
          text: (backup) => t("detail.worlds.backupDeleteText", { world: backup.world, date: formatDateTime(backup.createdAt) }),
          pending: remove.isPending,
          onConfirm: (backup, close) => remove.mutate(backup, { onSuccess: close }),
        })}
      />
    </Dialog>
  );
}
