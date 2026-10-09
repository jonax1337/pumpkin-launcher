import { useRef, useState } from "react";
import { Actions, Button, Cell, ConfirmDialog, cssVars, FormRow, FormSection, Hint, List, ListRow, RowTitle, Skel, Surface } from "@/ui";
import { cn } from "@/lib/utils";
import { ErrorBox } from "@/components/ErrorBox";
import { loaderLine } from "@/components/common";
import { useI18n } from "@/i18n";
import { useConfirmTarget } from "@/hooks/useConfirmTarget";
import { useInstances } from "@/hooks/useInstances";
import { useClearCache, useInstancesMoveRunning, useSetInstancesDir, useStorageOverview } from "@/hooks/useStorage";
import { api } from "@/lib/api";
import { formatSize } from "@/lib/format";
import { toastError } from "@/lib/toast";
import type { Instance, StorageOverview } from "@/lib/types";
import { PanelActions } from "./PanelActions";
import { SettingsInfo } from "./SettingsInfo";

const BYTES_PER_MB = 1024 * 1024;

/** Pfad als eingelassene Platte: umbricht statt zu überlaufen. */
const PATH = "block px-3 py-2 font-mono text-ctl-m wrap-anywhere text-(--fg-2)";

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
        <Surface kind="slot" as="code" className={PATH}>{overview.dataDir}</Surface>
        <Actions wrap>
          <Button size="s" icon="folder" onClick={() => void api.storageOpenDir().catch(toastError)}>{t("settings.storage.openFolder")}</Button>
        </Actions>
      </FormRow>
      {overview.freeMb != null && (
        <FormRow label={t("settings.storage.free")}><p>{t("settings.storage.freeOnDrive", { size: formatSize(overview.freeMb * BYTES_PER_MB) })}</p></FormRow>
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
        <Surface kind="slot" as="code" className={PATH}>{overview.instancesDir}</Surface>
        <Actions wrap>
          <Button size="s" icon="folder" disabled={busy} onClick={() => void api.storageOpenInstancesDir().catch(toastError)}>{t("settings.storage.openFolder")}</Button>
          <Button size="s" icon="edit" disabled={busy} onClick={() => void pickFolder()}>{t(move.isPending ? "settings.storage.moving" : "settings.storage.changeFolder")}</Button>
        </Actions>
      </FormRow>
      {overview.instancesFreeMb != null && (
        <FormRow label={t("settings.storage.free")}><p>{t("settings.storage.freeOnDrive", { size: formatSize(overview.instancesFreeMb * BYTES_PER_MB) })}</p></FormRow>
      )}
      <ConfirmDialog
        {...confirm.dialogProps({
          title: () => t("settings.storage.moveTitle"),
          text: (path) => <>{t("settings.storage.moveConfirm")}<code className="mt-3 block wrap-anywhere">{path}</code></>,
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

/** Farbe je Posten, gemeinsam für Segment und Legende. */
const SEGMENT_COLOR: Record<string, string> = { instances: "bg-(--acc)", cache: "bg-(--warn)", shared: "bg-(--fg-3)" };

/** Belegung als gestapelte Segmente mit Legende (Instanzen, Mod-Cache, geteilte Dateien); die Summe steht im Kopf der Platte. */
function StorageBar({ overview }: { overview: StorageOverview }) {
  const { t } = useI18n();
  const parts = [
    { id: "instances", label: t("common.instances"), bytes: overview.instances.reduce((sum, { bytes }) => sum + bytes, 0) },
    { id: "cache", label: t("settings.storage.modCache"), bytes: overview.modCacheBytes },
    { id: "shared", label: t("settings.storage.shared"), bytes: overview.sharedBytes },
  ];
  const total = parts.reduce((sum, { bytes }) => sum + bytes, 0);
  const shown = parts.filter(({ bytes }) => bytes > 0);
  const summary = shown.map(({ label, bytes }) => `${label} ${formatSize(bytes)}`).join(", ");
  return (
    <>
      <PanelActions><span className="text-(--fg-2)">{t("settings.storage.total", { size: formatSize(total) })}</span></PanelActions>
      <Surface kind="pit" className="flex h-8 gap-(--px) p-(--px)" role="img" aria-label={`${t("settings.storage.barLabel")}: ${summary}`}>
        {shown.map(({ id, bytes }) => (
          <span key={id} className={cn("min-w-0 flex-none basis-(--w)", SEGMENT_COLOR[id])} style={cssVars({ "--w": `${(bytes / total) * 100}%` })} />
        ))}
      </Surface>
      <ul className="mt-3 mb-5 flex flex-wrap gap-x-6 gap-y-2 p-0 text-ctl-m text-(--fg-2)" aria-hidden>
        {shown.map(({ id, label, bytes }) => (
          <li key={id} className="flex items-center gap-2">
            <i className={cn("size-3 border-(length:--px) border-(--edge)", SEGMENT_COLOR[id])} />
            {label} <b className="text-(--fg)">{formatSize(bytes)}</b>
          </li>
        ))}
      </ul>
    </>
  );
}

/** Platz je Instanz, im Mod-Cache und in den geteilten Dateien. */
function Usage({ overview, instances }: { overview: StorageOverview; instances: Instance[] }) {
  const { t } = useI18n();
  return (
    <FormSection title={t("settings.storage.usageSection")} level={3}>
      <List flat aria-label={t("settings.storage.usageSection")}>
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
          <Button variant="danger" size="s" icon="trash" disabled={unusedBytes === 0 || clear.isPending} onClick={() => clear.mutate()}>
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
  if (overview.isPending) return <Skel className="h-[220px]" />;
  if (overview.isError) {
    return <ErrorBox title={t("settings.storage.loadFailed")} error={overview.error} onRetry={() => void overview.refetch()} />;
  }
  return (
    <>
      <SettingsInfo title={t("settings.tabStorage")}>
        <FormSection title={t("settings.storage.changeFolder")} level={3}><p>{t("settings.storage.moveInfo")}</p></FormSection>
        <FormSection title={t("settings.storage.usageSection")} level={3}><p>{t("settings.storage.hardlinkNote")}</p></FormSection>
      </SettingsInfo>
      <StorageBar overview={overview.data} />
      <InstanceFolder overview={overview.data} />
      <DataFolder overview={overview.data} />
      <Usage overview={overview.data} instances={instances} />
      <ClearCache unusedBytes={overview.data.unusedCacheBytes} />
    </>
  );
}
