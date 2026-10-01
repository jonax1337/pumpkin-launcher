import type { Update } from "@tauri-apps/plugin-updater";
import { Description } from "@/components/ContentBrowser";
import { installAppUpdate, useAppUpdate, useUpdateRun, WAIT_FOR_IDLE } from "@/hooks/useAppUpdate";
import { Actions, Button, Count, ErrorBox, FormRow, Hint, JobProgress } from "@/ui";

/** Einstellungen › Über: nach einer neuen Version suchen und sie erst auf Wunsch installieren. */
export function UpdateRow() {
  const { data: update, error, isFetching, isFetched, refetch } = useAppUpdate();
  const busy = useUpdateRun((s) => s.phase !== "idle");
  return (
    <FormRow label="Updates" hint="Neue Versionen kommen über GitHub">
      {update ? (
        <UpdateOffer update={update} />
      ) : error ? (
        <ErrorBox title="Die Suche nach Updates hat nicht geklappt" error={error} />
      ) : (
        isFetched && !isFetching && <Hint tone="ok">Du hast die neueste Version.</Hint>
      )}
      {!busy && (
        <Actions>
          <Button icon="redo" disabled={isFetching} onClick={() => void refetch()}>
            {isFetching ? "Sucht …" : "Nach Updates suchen"}
          </Button>
        </Actions>
      )}
    </FormRow>
  );
}

/** Gefundene Version mit Versionshinweisen und dem Ablauf Laden → (Spiel und Aufgaben abwarten, erneut bestätigen) → Installieren. */
function UpdateOffer({ update }: { update: Update }) {
  const { phase, p } = useUpdateRun();
  return (
    <>
      <b>
        Version <Count value={update.version} /> ist verfügbar
      </b>
      {update.body && <Description body={update.body} />}
      {phase === "idle" && (
        <Actions>
          <Button variant="primary" icon="dl" onClick={() => void installAppUpdate(update)}>
            Installieren und neu starten
          </Button>
        </Actions>
      )}
      {phase === "download" && <JobProgress label="Update wird geladen" p={p} />}
      {phase === "wait" && <Hint icon="info">{WAIT_FOR_IDLE}</Hint>}
      {phase === "ready" && (
        <Actions>
          <Button variant="primary" icon="redo" onClick={() => void installAppUpdate(update)}>
            Jetzt neu starten
          </Button>
        </Actions>
      )}
      {phase === "install" && <JobProgress label="Update wird installiert" p={null} />}
    </>
  );
}
