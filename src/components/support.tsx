import type { ComponentProps } from "react";
import { create } from "zustand";
import { useI18n } from "@/i18n";
import { Actions, Button, ConfirmDialog, FormRow } from "@/ui";
import { useCopyDebugInfo, useShareLog } from "@/hooks/useSupport";
import { openPage } from "@/lib/links";
import type { ExitPayload, LogKind } from "@/lib/types";

const REPO_URL = "https://github.com/jonax1337/pumpkin-launcher";

type ShareRequest = { instanceId: string; kind: LogKind };

/** Offene Rückfrage „Log öffentlich teilen?“ (ShareLogDialog, einmal im Layout). */
const useShareAsk = create<{ request: ShareRequest | null }>(() => ({ request: null }));

/** „Log teilen“: erst die Rückfrage, dort lädt „Hochladen“ hoch und kopiert den Link. */
export const askShareLog = (instanceId: string, kind: LogKind) => useShareAsk.setState({ request: { instanceId, kind } });

/** Nach einem Absturz mit Bericht ist der Bericht das aufschlussreichere Log, sonst das des letzten Starts. */
export const shareKindAfter = (crash: ExitPayload | undefined): LogKind => (crash?.crashReport ? "crashReport" : "latest");

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
      text={t("components.share.text", { was: what })}
      confirmLabel={t("components.share.upload")}
      pendingLabel={t("components.share.uploading")}
      pending={share.isPending}
      onConfirm={() => request && share.mutate(request, { onSettled: close })}
    />
  );
}

/** „Debug-Info kopieren“ im Aussehen des Aufrufers (Größe, Symbol, kompakt). */
export function DebugInfoButton(look: Omit<ComponentProps<typeof Button>, "onClick" | "children">) {
  const { t } = useI18n();
  const copy = useCopyDebugInfo();
  return <Button {...look} disabled={copy.isPending} onClick={() => copy.mutate()}>{t("components.support.copyDebugInfo")}</Button>;
}

/** Einstellungen › Support: Fehler melden mit Debug-Info, Fragen in den Diskussionen. */
export function SupportSection() {
  const { t } = useI18n();
  return (
    <>
      <FormRow
        label={t("components.support.reportBug")}
        hint={t("components.support.reportHint")}
        aside={t("components.support.reportAside")}
      >
        <Actions wrap>
          <Button icon="ext" onClick={() => openPage(`${REPO_URL}/issues/new/choose`)}>{t("components.support.reportBug")}</Button>
          <DebugInfoButton icon="info" />
        </Actions>
      </FormRow>
      <FormRow label={t("components.support.questionsLabel")} hint={t("components.support.questionsHint")}>
        <Actions>
          <Button icon="ext" onClick={() => openPage(`${REPO_URL}/discussions`)}>{t("components.support.openDiscussions")}</Button>
        </Actions>
      </FormRow>
    </>
  );
}
