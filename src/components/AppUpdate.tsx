import type { Update } from "@tauri-apps/plugin-updater";
import { Description } from "@/components/Description";
import { installAppUpdate, useAppUpdate, useUpdateRun, waitForIdle } from "@/hooks/useAppUpdate";
import { Actions, Button, Count, ErrorBox, FormRow, Hint, JobProgress } from "@/ui";
import { useI18n } from "@/i18n";

/** Einstellungen › Über: nach einer neuen Version suchen und sie erst auf Wunsch installieren. */
export function UpdateRow() {
  const { t } = useI18n();
  const { data: update, error, isFetching, isFetched, refetch } = useAppUpdate();
  const busy = useUpdateRun((s) => s.phase !== "idle");
  return (
    <FormRow label={t("common.updates")} hint={t("components.update.hint")}>
      {update ? (
        <UpdateOffer update={update} />
      ) : error ? (
        <ErrorBox title={t("components.update.searchFailed")} error={error} />
      ) : (
        isFetched && !isFetching && <Hint tone="ok">{t("components.update.upToDate")}</Hint>
      )}
      {!busy && (
        <Actions>
          <Button icon="redo" disabled={isFetching} onClick={() => void refetch()}>
            {isFetching ? t("components.update.searching") : t("components.update.checkNow")}
          </Button>
        </Actions>
      )}
    </FormRow>
  );
}

/** Gefundene Version mit Versionshinweisen und dem Ablauf Laden → (Spiel und Aufgaben abwarten, erneut bestätigen) → Installieren. */
function UpdateOffer({ update }: { update: Update }) {
  const { t } = useI18n();
  const { phase, p } = useUpdateRun();
  return (
    <>
      <b>
        {t("components.update.availableBefore")} <Count value={update.version} /> {t("components.update.availableAfter")}
      </b>
      {update.body && <Description body={update.body} />}
      {phase === "idle" && (
        <Actions>
          <Button variant="primary" icon="dl" onClick={() => void installAppUpdate(update)}>
            {t("components.update.installAndRestart")}
          </Button>
        </Actions>
      )}
      {phase === "download" && <JobProgress label={t("components.update.downloading")} p={p} />}
      {phase === "wait" && <Hint icon="info">{waitForIdle()}</Hint>}
      {phase === "ready" && (
        <Actions>
          <Button variant="primary" icon="redo" onClick={() => void installAppUpdate(update)}>
            {t("components.update.restartNow")}
          </Button>
        </Actions>
      )}
      {phase === "install" && <JobProgress label={t("components.update.installing")} p={null} />}
    </>
  );
}
