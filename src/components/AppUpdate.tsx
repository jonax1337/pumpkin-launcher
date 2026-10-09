import type { Update } from "@tauri-apps/plugin-updater";
import { Description } from "@/components/Description";
import { installAppUpdate, useAppUpdate, waitForIdle } from "@/hooks/useAppUpdate";
import { useUpdateRun } from "@/store/updateRun";
import { Actions, Button, Chip, Count, Hint, Icon, JobProgress, Panel, Surface } from "@/ui";
import { ErrorBox } from "@/components/ErrorBox";
import { useI18n } from "@/i18n";

/** Stand der Suche als Chip in der Versionskarte: „Aktuell“ nach einer Suche ohne Fund, sonst die gefundene Version. */
export function UpdateChip() {
  const { t } = useI18n();
  const { data: update, error, isFetching, isFetched } = useAppUpdate();
  if (update) return <Chip tone="acc">{t("components.update.newChip", { version: update.version })}</Chip>;
  if (error || !isFetched || isFetching) return null;
  return <Chip tone="run">{t("components.update.currentChip")}</Chip>;
}

/** „Nach Updates suchen“; solange ein Update geladen oder installiert wird, gibt es ihn nicht. */
export function UpdateCheckButton() {
  const { t } = useI18n();
  const { isFetching, refetch } = useAppUpdate();
  const busy = useUpdateRun((s) => s.phase !== "idle");
  if (busy) return null;
  return (
    <Button size="s" icon="refresh" disabled={isFetching} onClick={() => void refetch()}>
      {isFetching ? t("components.update.searching") : t("components.update.checkNow")}
    </Button>
  );
}

/** Ergebnis der Suche unter der Versionskarte: die gefundene Version oder der Fehler; „aktuell“ sagt schon der Chip. */
export function UpdateDetails() {
  const { t } = useI18n();
  const { data: update, error } = useAppUpdate();
  if (update) return <UpdateOffer update={update} />;
  if (error) return <ErrorBox className="mt-4" title={t("components.update.searchFailed")} error={error} />;
  return null;
}

/** Gefundene Version mit Versionshinweisen und dem Ablauf Laden → (Spiel und Aufgaben abwarten, erneut bestätigen) → Installieren. */
function UpdateOffer({ update }: { update: Update }) {
  const { t, tAround } = useI18n();
  const { phase, p } = useUpdateRun();
  const [availableBefore, availableAfter] = tAround("components.update.available", "version");
  return (
    <Panel level="sunk" className="mt-4 grid gap-3.5 p-4">
      <div className="flex items-center gap-3.5">
        <Surface kind="slot" as="span" className="grid size-12 flex-none place-items-center text-[color:var(--acc-hi,var(--acc))]"><Icon name="update" size="l" /></Surface>
        <div className="grid gap-1">
          <b>
            {availableBefore}
            <Count value={update.version} />
            {availableAfter}
          </b>
          <span className="text-ctl-s text-(--fg-2)">{t("components.update.current", { version: update.currentVersion })}</span>
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
