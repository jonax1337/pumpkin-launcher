import type { ComponentProps, ReactNode } from "react";
import { create } from "zustand";
import { useI18n } from "@/i18n";
import { Actions, Button, ConfirmDialog, DescriptionList, Heading, Hint } from "@/ui";
import { kindLabel } from "@/components/accounts/useAccounts";
import { useInstances } from "@/hooks/useInstances";
import { useStorageOverview } from "@/hooks/useStorage";
import { useCopyDebugInfo, useShareLog } from "@/hooks/useSupport";
import { formatSize } from "@/lib/format";
import type { ExitPayload, LogKind } from "@/lib/types";
import { useUsableAccount } from "@/store/offline";
import { accountName, useSettings } from "@/store/settings";

const BYTES_PER_MB = 1024 * 1024;

type ShareRequest = { instanceId: string; kind: LogKind };

/** Offene Rückfrage „Log öffentlich teilen?“ (ShareLogDialog, einmal im Layout). */
const useShareAsk = create<{ request: ShareRequest | null }>(() => ({ request: null }));

/** Nach einem Absturz mit Bericht ist der Bericht das aufschlussreichere Log, sonst das des letzten Starts. */
const shareKindAfter = (crash: ExitPayload | undefined): LogKind => (crash?.crashReport ? "crashReport" : "latest");

/** „Log teilen“ (nach einem Absturz mit dessen Daten): erst die Rückfrage, dort lädt „Hochladen“ hoch und kopiert den Link. */
export const askShareLog = (instanceId: string, crash?: ExitPayload) =>
  useShareAsk.setState({ request: { instanceId, kind: shareKindAfter(crash) } });

/** Rückfrage vor dem Hochladen: was öffentlich wird und was vorher entfernt wird. Einmal im Layout. */
export function ShareLogDialog() {
  const { t } = useI18n();
  const request = useShareAsk((s) => s.request);
  const share = useShareLog();
  const close = () => useShareAsk.setState({ request: null });
  const what = request?.kind === "crashReport" ? t("components.share.whatCrashReport") : t("components.share.whatLatestLog");
  return (
    <ConfirmDialog
      open={!!request}
      onOpenChange={(o) => !o && close()}
      danger={false}
      title={t("components.share.title")}
      text={t("components.share.text", { what })}
      confirmLabel={t("components.share.upload")}
      pendingLabel={t("components.share.uploading")}
      pending={share.isPending}
      onConfirm={() => request && share.mutate(request, { onSettled: close })}
    />
  );
}

/** „Debug-Info kopieren“ im Aussehen des Aufrufers (Größe, Symbol, kompakt); mit `instanceId` samt deren Mod-Liste. */
export function DebugInfoButton({ instanceId, ...look }: Omit<ComponentProps<typeof Button>, "onClick" | "children"> & { instanceId?: string }) {
  const { t } = useI18n();
  const copy = useCopyDebugInfo(instanceId);
  return <Button {...look} disabled={copy.isPending} onClick={() => copy.mutate()}>{t("components.support.copyDebugInfo")}</Button>;
}

/** Einstellungen › Über & Support: was der Launcher über diese Installation weiß, und die Debug-Info für eine Fehlermeldung. */
export function SupportSection({ version }: { version: string }) {
  const { t } = useI18n();
  const account = useUsableAccount();
  const instances = useInstances().data;
  const memoryMb = useSettings((s) => s.memoryMb);
  const javaPath = useSettings((s) => s.javaPath);
  const dataDir = useStorageOverview().data?.dataDir;
  const rows: [string, ReactNode][] = [
    [t("common.version"), version],
    [t("settings.account.label"), account ? `${accountName(account)} (${kindLabel(account)})` : "–"],
    [t("common.instances"), instances?.length ?? "–"],
    [t("ui.memory.label"), memoryMb == null ? t("components.memory.auto") : formatSize(memoryMb * BYTES_PER_MB)],
    [t("detail.settings.javaLabel"), javaPath || t("components.memory.auto")],
    ...(dataDir ? [[t("settings.storage.location"), dataDir] as [string, ReactNode]] : []),
  ];
  return (
    <div>
      <Heading level="sub" className="mb-3">{t("settings.about.diagTitle")}</Heading>
      <DescriptionList framed items={rows.map(([label, value]) => ({ label, value }))} />
      <Actions wrap className="mt-3">
        <DebugInfoButton icon="copy" />
        <Hint className="basis-full">{t("components.support.reportAside")}</Hint>
      </Actions>
    </div>
  );
}
