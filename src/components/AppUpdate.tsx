import type { Update } from "@tauri-apps/plugin-updater";
import { Description } from "@/components/Description";
import { installAppUpdate, useAppUpdate, waitForIdle } from "@/hooks/useAppUpdate";
import { useUpdateRun } from "@/store/updateRun";
import { Actions, Button, Chip, Count, ErrorBox, Hint, Icon, JobProgress, Panel } from "@/ui";
import { useI18n } from "@/i18n";

/** Stand der Suche als Chip in der Versionskarte: „Aktuell“ nach einer Suche ohne Fund, sonst die gefundene Version. */
export function UpdateChip() {
  const { t } = useI18n();
  const { data: update, error, isFetching, isFetched } = useAppUpdate();
  if (update) return <Chip tone="acc">{t("components.update.newChip", { version: update.version })}</Chip>;
  if (error || !isFetched || isFetching) return null;
  return <Chip tone="run" dot>{t("components.update.currentChip")}</Chip>;
}

/** „Nach Updates suchen“; solange ein Update geladen oder installiert wird, gibt es ihn nicht. */
export function UpdateCheckButton() {
  const { t } = useI18n();
  const { isFetching, refetch } = useAppUpdate();
  const busy = useUpdateRun((s) => s.phase !== "idle");
  if (busy) return null;
  return (
    <Button icon="refresh" disabled={isFetching} onClick={() => void refetch()}>
      {isFetching ? t("components.update.searching") : t("components.update.checkNow")}
    </Button>
  );
}

/** Ergebnis der Suche unter der Versionskarte: die gefundene Version oder der Fehler; „aktuell“ sagt schon der Chip. */
export function UpdateDetails() {
  const { t } = useI18n();
  const { data: update, error } = useAppUpdate();
  if (update) return <UpdateOffer update={update} />;
  if (error) return <ErrorBox className="update-error" title={t("components.update.searchFailed")} error={error} />;
  return null;
}

/** Gefundene Version mit Versionshinweisen und dem Ablauf Laden → (Spiel und Aufgaben abwarten, erneut bestätigen) → Installieren. */
function UpdateOffer({ update }: { update: Update }) {
  const { t, tAround } = useI18n();
  const { phase, p } = useUpdateRun();
  const [availableBefore, availableAfter] = tAround("components.update.available", "version");
  return (
    <Panel level="sunk" pad="m" className="update-offer">
      <div className="update-offer-head">
        <span className="vx-slot update-offer-tile"><Icon name="update" size="l" /></span>
        <div className="update-offer-name">
          <b>
            {availableBefore}
            <Count value={update.version} />
            {availableAfter}
          </b>
          <span>{t("components.update.current", { version: update.currentVersion })}</span>
        </div>
      </div>
      {update.body && <Description body={update.body} />}
      {phase === "idle" && (
        <Actions>
          <Button variant="primary" icon="download" onClick={() => void installAppUpdate(update)}>
            {t("components.update.installAndRestart")}
          </Button>
        </Actions>
      )}
      {phase === "download" && <JobProgress label={t("components.update.downloading")} p={p} />}
      {phase === "wait" && <Hint icon="info">{waitForIdle()}</Hint>}
      {phase === "ready" && (
        <Actions>
          <Button variant="primary" icon="refresh" onClick={() => void installAppUpdate(update)}>
            {t("components.update.restartNow")}
          </Button>
        </Actions>
      )}
      {phase === "install" && <JobProgress label={t("components.update.installing")} p={null} />}
    </Panel>
  );
}
