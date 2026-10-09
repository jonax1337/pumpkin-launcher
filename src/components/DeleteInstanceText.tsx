import { useExportBackups, useWorldBackups } from "@/hooks/useWorlds";
import { useI18n } from "@/i18n";
import type { Instance } from "@/lib/types";
import { Button, StatusPanel } from "@/ui";

/**
 * Text der Rückfrage beim Löschen einer Instanz: was verschwindet. Die Weltsicherungen gehören zur Instanz und
 * gehen mit ihr verloren; gibt es welche, nennt der Text es und bietet an, sie vorher in einen Ordner zu kopieren.
 */
export function DeleteInstanceText({ instance }: { instance: Instance }) {
  const { t } = useI18n();
  const backups = useWorldBackups(instance.id, null).data;
  const exportBackups = useExportBackups(instance.id);
  const count = backups?.length ?? 0;
  return (
    <>
      {t("components.instance.deleteText")}
      {count > 0 && (
        // Als Spans, weil der Text in einem <p> steht
        <StatusPanel
          as="span"
          tone="warn"
          icon="warn"
          className="mt-4"
          title={t(count === 1 ? "components.instance.backupsNotice.one" : "components.instance.backupsNotice.other", { count })}
        >
          <span className="mt-1.5 block">
            <Button size="s" icon="backup" disabled={exportBackups.isPending} onClick={() => exportBackups.mutate()}>
              {t("components.instance.exportBackups")}
            </Button>
          </span>
        </StatusPanel>
      )}
    </>
  );
}
