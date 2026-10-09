import { useEffect, useEffectEvent, useRef, useState } from "react";
import { Actions, Disclosure, FormRow, FormSection, Hint, Skel } from "@/ui";
import { SourceTag } from "@/components/catalog/SourceTag";
import { useI18n } from "@/i18n";
import { changesLine, usePackReports, usePackStatus, usePackUpdate, type PackStatus } from "@/hooks/usePackUpdate";
import { api } from "@/lib/api";
import { toastError } from "@/lib/toast";
import { retryPerFrame, revealAndFocus, UPDATE_FOCUS_RETRY_FRAMES } from "../content/focus";
import type { Instance, PackChanges, PackUpdateOutcome } from "@/lib/types";
import { GuardedButton, useBusyReason } from "../guards";
import { PackUpdateDialog } from "./PackUpdateDialog";

/** Breite des Platzhalters, solange Name und Version des Packs laden. */
const NAME_SKELETON_WIDTH = 220;

/**
 * Modpack der Instanz: Name, Version und Quelle, verfügbare Updates und das letzte Ergebnis. Ohne Modpack nichts.
 * `requested`: der Kopf „Pack-Update“ wurde angeklickt; der Abschnitt kommt in den Blick, der Knopf bekommt den Fokus,
 * danach meldet `onShown` die Anfrage als erledigt (sonst käme sie beim nächsten Öffnen der Einstellungen wieder).
 */
export function PackSection({ instance, requested = false, onShown }: { instance: Instance; requested?: boolean; onShown?: () => void }) {
  const { t } = useI18n();
  const status = usePackStatus(instance);
  const report = usePackReports((reports) => reports[instance.id]);
  const section = useRef<HTMLElement>(null);
  const present = !!status;
  const reportShown = useEffectEvent(() => onShown?.());
  useEffect(() => {
    if (!requested || !present) return;
    section.current?.scrollIntoView({ block: "start" });
    return retryPerFrame(() => {
      const shown = revealAndFocus(section.current?.querySelector<HTMLElement>("button:not(:disabled)") ?? null);
      if (shown) reportShown();
      return shown;
    }, UPDATE_FOCUS_RETRY_FRAMES);
  }, [requested, present]);
  if (!status) return null;
  return (
    <FormSection plate title={t("detail.pack.section")} ref={section}>
      <FormRow label={t("detail.pack.label")} aside={t("detail.pack.aside")}>
        <PackIdentity status={status} />
      </FormRow>
      <FormRow label={t("detail.pack.updatesLabel")}>
        {status.source ? <VersionUpdates instance={instance} status={status} /> : <FileUpdate instance={instance} />}
      </FormRow>
      {report && (
        <FormRow label={t("detail.pack.lastUpdate")}>
          <PackReport outcome={report} />
        </FormRow>
      )}
    </FormSection>
  );
}

/** „Fabulously Optimized · 8.0.3“ mit dem Anbieter; aus einer Datei mit diesem Hinweis. */
function PackIdentity({ status }: { status: PackStatus }) {
  const { t } = useI18n();
  if (status.loading) return <Skel h={40} w={NAME_SKELETON_WIDTH} />;
  return (
    <Actions wrap className="st-inline">
      <span>{[status.name, status.version].filter(Boolean).join(" · ") || t("detail.pack.unknownVersion")}</span>
      {status.source ? <SourceTag source={status.source} /> : <span className="st-muted">{t("detail.pack.fromFile")}</span>}
    </Actions>
  );
}

/** Update auf die neueste Version oder eine andere wählen; die Wahl samt Änderungsprotokoll im Dialog. */
function VersionUpdates({ instance, status }: { instance: Instance; status: PackStatus }) {
  const { t } = useI18n();
  const busy = useBusyReason(instance.id);
  const [choosing, setChoosing] = useState(false);
  const { latest } = status;
  const note = status.error
    ? t("detail.pack.unreachable")
    : latest
      ? t("detail.pack.updateAvailable", { version: latest.version_number })
      : t("detail.pack.upToDate");
  return (
    <>
      <Actions>
        <GuardedButton
          size="s"
          blocked={busy}
          variant={latest ? "primary" : "secondary"}
          icon={latest ? "update" : "swap"}
          disabled={status.loading || !status.versions.length}
          onClick={() => setChoosing(true)}
        >
          {latest ? t("detail.pack.updateTo", { version: latest.version_number }) : t("detail.pack.chooseVersion")}
        </GuardedButton>
      </Actions>
      {!status.loading && <Hint tone={status.error ? "warn" : latest ? "ok" : "neutral"}>{note}</Hint>}
      {choosing && <PackUpdateDialog instance={instance} status={status} onClose={() => setChoosing(false)} />}
    </>
  );
}

/** Instanz aus einer `.mrpack`-Datei: Update aus einer neueren Datei desselben Packs (nur in der App, der Browser kennt keine Pfade). */
function FileUpdate({ instance }: { instance: Instance }) {
  const { t } = useI18n();
  const busy = useBusyReason(instance.id);
  const update = usePackUpdate(instance);
  const pickable = api.capabilities.pickPaths;
  async function pick() {
    const [path] = await api.pickPaths({ filters: [{ name: t("components.export.fileFilter"), extensions: ["mrpack"] }] });
    if (path) update.start({ type: "file", path });
  }
  return (
    <>
      <Actions>
        <GuardedButton size="s" blocked={busy} icon="file" disabled={!pickable || update.isPending} onClick={() => void pick().catch(toastError)}>
          {t("detail.pack.fromNewerFile")}
        </GuardedButton>
      </Actions>
      <Hint>{pickable ? t("detail.pack.fileHint") : t("components.export.appOnly")}</Hint>
    </>
  );
}

const CHANGE_KINDS: (keyof PackChanges)[] = ["added", "updated", "removed", "kept"];

/** Zusammenfassung des letzten Updates; je Art die Dateien zum Aufklappen. */
function PackReport({ outcome }: { outcome: PackUpdateOutcome }) {
  const { t } = useI18n();
  return (
    <>
      <span className="st-report">{changesLine(outcome)}</span>
      {CHANGE_KINDS.filter((kind) => outcome.changes[kind].length).map((kind) => (
        <Disclosure key={kind} summary={`${t(`detail.pack.list.${kind}`)} (${outcome.changes[kind].length})`}>
          <ul className="st-list">
            {outcome.changes[kind].map((path) => <li key={path}>{path}</li>)}
          </ul>
        </Disclosure>
      ))}
    </>
  );
}
