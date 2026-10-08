import { useRef, useState } from "react";
import { Actions, Button, Cell, ConfirmDialog, ErrorBox, FormRow, FormSection, Hint, List, ListRow, RowTitle, Skel } from "@/ui";
import { loaderLine } from "@/components/common";
import { useI18n } from "@/i18n";
import { useConfirmTarget } from "@/hooks/useConfirmTarget";
import { useInstances } from "@/hooks/useInstances";
import { useClearCache, useInstancesMoveRunning, useSetInstancesDir, useStorageOverview } from "@/hooks/useStorage";
import { api } from "@/lib/api";
import { formatSize } from "@/lib/format";
import { toastError } from "@/lib/toast";
import type { Instance, StorageOverview } from "@/lib/types";
import { SettingsInfo } from "./SettingsInfo";

const BYTES_PER_MB = 1024 * 1024;

/** Instanzen mit ihrem Platz, die größten zuerst; was es nicht mehr gibt, fällt weg. */
function instanceUsage(overview: StorageOverview, instances: Instance[]) {
  return overview.instances
    .flatMap(({ id, bytes }) => instances.filter((instance) => instance.id === id).map((instance) => ({ instance, bytes })))
    .sort((a, b) => b.bytes - a.bytes);
}

/** Datenordner: Ort, freier Platz und wo der Platz bleibt. */
function DataFolder({ overview }: { overview: StorageOverview }) {
  const { t } = useI18n();
  return (
    <FormSection title={t("settings.storage.folderSection")} level={3}>
      <FormRow label={t("settings.storage.location")} hint={t("settings.storage.locationHint")}>
        <Actions wrap>
          <code className="text-fg-2 break-all">{overview.dataDir}</code>
          <Button icon="folder" onClick={() => void api.storageOpenDir().catch(toastError)}>{t("settings.storage.openFolder")}</Button>
        </Actions>
      </FormRow>
      {overview.freeMb != null && (
        <FormRow label={t("settings.storage.free")}>{t("settings.storage.freeOnDrive", { size: formatSize(overview.freeMb * BYTES_PER_MB) })}</FormRow>
      )}
    </FormSection>
  );
}

function InstanceFolder({ overview }: { overview: StorageOverview }) {
  const { t } = useI18n();
  const move = useSetInstancesDir();
  const confirm = useConfirmTarget<string>();
  const selecting = useRef(false);
  const submitting = useRef(false);
  const [picking, setPicking] = useState(false);
  const moveRunning = useInstancesMoveRunning();
  const busy = picking || move.isPending || moveRunning;

  async function pickFolder() {
    if (selecting.current || submitting.current) return;
    selecting.current = true;
    setPicking(true);
    try {
      const [path] = await api.pickPaths({ directory: true, title: t("settings.storage.chooseInstances") });
      if (path && path !== overview.instancesDir) confirm.ask(path);
    } catch (error) {
      toastError(error instanceof Error ? error : new Error(String(error)));
    } finally {
      selecting.current = false;
      setPicking(false);
    }
  }

  function relocate(path: string, close: () => void) {
    if (submitting.current || moveRunning) return;
    submitting.current = true;
    move.mutate(path, {
      onSuccess: close,
      onSettled: () => { submitting.current = false; },
    });
  }

  return (
    <FormSection title={t("settings.storage.instancesSection")} level={3}>
      <FormRow label={t("settings.storage.location")} hint={t("settings.storage.instancesHint")}>
        <Actions wrap>
          <code className="text-fg-2 break-all">{overview.instancesDir}</code>
          <Button icon="folder" disabled={busy} onClick={() => void api.storageOpenInstancesDir().catch(toastError)}>{t("settings.storage.openFolder")}</Button>
          <Button disabled={busy} onClick={() => void pickFolder()}>{t(move.isPending ? "settings.storage.moving" : "settings.storage.changeFolder")}</Button>
        </Actions>
      </FormRow>
      {overview.instancesFreeMb != null && (
        <FormRow label={t("settings.storage.free")}>{t("settings.storage.freeOnDrive", { size: formatSize(overview.instancesFreeMb * BYTES_PER_MB) })}</FormRow>
      )}
      <SettingsInfo title={t("settings.storage.changeFolder")}>
        <p>{t("settings.storage.moveInfo")}</p>
      </SettingsInfo>
      <ConfirmDialog
        {...confirm.dialogProps({
          title: () => t("settings.storage.moveTitle"),
          text: (path) => <>{t("settings.storage.moveConfirm")}<code className="mt-3 block break-all">{path}</code></>,
          confirmLabel: t("settings.storage.moveButton"),
          pending: move.isPending,
          onConfirm: relocate,
        })}
        danger={false}
        pendingLabel={t("settings.storage.moving")}
      />
    </FormSection>
  );
}

/** Platz je Instanz, im Mod-Cache und in den geteilten Dateien. */
function Usage({ overview, instances }: { overview: StorageOverview; instances: Instance[] }) {
  const { t } = useI18n();
  return (
    <FormSection title={t("settings.storage.usageSection")} level={3}>
      <List variant="versions" aria-label={t("settings.storage.usageSection")}>
        {instanceUsage(overview, instances).map(({ instance, bytes }) => (
          <ListRow key={instance.id}>
            <RowTitle title={instance.name} sub={loaderLine(instance)} />
            <Cell align="end">{formatSize(bytes)}</Cell>
          </ListRow>
        ))}
        <ListRow>
          <RowTitle title={t("settings.storage.modCache")} sub={t("settings.storage.modCacheNote")} />
          <Cell align="end">{formatSize(overview.modCacheBytes)}</Cell>
        </ListRow>
        <ListRow>
          <RowTitle title={t("settings.storage.shared")} sub={t("settings.storage.sharedNote")} />
          <Cell align="end">{formatSize(overview.sharedBytes)}</Cell>
        </ListRow>
      </List>
      <div className="mt-2.5">
        <SettingsInfo title={t("settings.storage.usageSection")}>
          <p>{t("settings.storage.hardlinkNote")}</p>
        </SettingsInfo>
      </div>
    </FormSection>
  );
}

/** „Cache leeren“: löscht nur, was keine Instanz mehr braucht. */
function ClearCache({ unusedBytes }: { unusedBytes: number }) {
  const { t } = useI18n();
  const clear = useClearCache();
  return (
    <FormSection title={t("settings.storage.cleanSection")} level={3}>
      <FormRow label={t("settings.storage.clearLabel")} hint={t("settings.storage.clearHint")}>
        <Actions wrap>
          <Button icon="trash" disabled={unusedBytes === 0 || clear.isPending} onClick={() => clear.mutate()}>
            {t("settings.storage.clearButton")}
          </Button>
          <Hint>{unusedBytes > 0 ? t("settings.storage.unused", { size: formatSize(unusedBytes) }) : t("settings.storage.nothingUnused")}</Hint>
        </Actions>
      </FormRow>
    </FormSection>
  );
}

/** Einstellungen › Speicher: Datenordner, Platz je Instanz und Cache. */
export function StorageTab() {
  const { t } = useI18n();
  const overview = useStorageOverview();
  const instances = useInstances().data ?? [];
  if (overview.isPending) return <Skel h={220} />;
  if (overview.isError) {
    return <ErrorBox title={t("settings.storage.loadFailed")} error={overview.error} onRetry={() => void overview.refetch()} />;
  }
  return (
    <>
      <InstanceFolder overview={overview.data} />
      <DataFolder overview={overview.data} />
      <Usage overview={overview.data} instances={instances} />
      <ClearCache unusedBytes={overview.data.unusedCacheBytes} />
    </>
  );
}
