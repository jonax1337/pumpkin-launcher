import type { ReactNode } from "react";
import { useNavigate } from "react-router";
import { useI18n } from "@/i18n";
import { Button } from "@/ui";
import { lastPlayedLine } from "@/components/common";
import { useCancelInstall } from "@/hooks/usePlay";
import { formatCount } from "@/lib/format";
import { instanceUrl } from "@/lib/routes";
import { installStepLabel, type ExitPayload, type Instance, type InstallProgress } from "@/lib/types";
import { cn } from "@/lib/utils";
import { useGame } from "@/store/game";
import { CrashActions } from "./crash";
import { usePhase, type Phase } from "./phase";

/** Gemeinsame Optik der Statuszeilen: `lead` wird vorgelesen, `tail` (Zähler) und `acts` (Knöpfe) nicht. */
function StatusLine({ lead, tail, acts }: { lead?: ReactNode; tail?: ReactNode; acts?: ReactNode }) {
  return (
    <>
      <span className="ptxt">
        <span aria-live="polite">{lead}</span>
        {tail}
      </span>
      {acts}
    </>
  );
}

function PreparingStatus({ instance, progress, onScene }: { instance: Instance; progress: InstallProgress; onScene?: boolean }) {
  const { t } = useI18n();
  const cancel = useCancelInstall();
  return (
    <StatusLine
      lead={<b>{installStepLabel(progress.step, instance.loader)}</b>}
      tail={progress.total > 1 && (
        <> {t("components.game.countOf", { done: formatCount(progress.done), total: formatCount(progress.total) })}</>
      )}
      acts={
        <Button
          variant="ghost"
          size="s"
          icon="x"
          onScene={onScene}
          className="pcancel"
          disabled={cancel.isPending}
          onClick={() => cancel.mutate(instance.id)}
        >
          {t("common.cancel")}
        </Button>
      }
    />
  );
}

function RunningStatus({ onScene, onViewLog }: { onScene?: boolean; onViewLog: () => void }) {
  const { t } = useI18n();
  return (
    <StatusLine
      // Laufzeit steht im Knopf („Läuft seit …“); hier nur für Screenreader die Zustandsänderung.
      lead={<span className="sr">{t("components.game.mcRunningSr")}</span>}
      acts={
        <Button variant="ghost" size="s" icon="term" onScene={onScene} className="plog" onClick={onViewLog}>
          {t("components.game.viewLog")}
        </Button>
      }
    />
  );
}

function CrashedStatus({ crash, instance, onScene, onViewLog }: {
  crash: ExitPayload; instance: Instance; onScene?: boolean; onViewLog: () => void;
}) {
  return (
    // Dass es abgestürzt ist, sagen Knopf, Hinweis und Protokoll schon; hier stehen nur die Wege weiter.
    <StatusLine acts={<CrashActions crash={crash} instance={instance} onScene={onScene} onViewLog={onViewLog} />} />
  );
}

/**
 * Statuszeile unter dem Spielen-Knopf (32 px, feste Höhe): Schritt mit Abbrechen, Weg zum Protokoll, nach einem Absturz Bericht und Protokoll.
 * Die Laufzeit steht im Knopf, nicht hier.
 * Vorgelesen wird nur der Anfang (`lead`, ändert sich mit dem Zustand); Zähler und Uhr stehen außerhalb der Live-Region.
 * Ein fehlender Spielername steht nur im Knopf („Erst Spielernamen festlegen“), „Nicht installiert“ nur im Knopf/Chip.
 * `showLast={false}`: „Zuletzt gespielt“ steht schon woanders (Start: Metazeile im Hero).
 * `onScene`: Knöpfe über einer Szene (Grundplatte, harter Schatten).
 */
export function PlayStatus({ instance, showLast = true, onScene }: { instance: Instance; showLast?: boolean; onScene?: boolean }) {
  const phase = usePhase(instance.id);
  return (
    <div className={cn("pstat", phase === "running" && "run")}>
      <PhaseStatus instance={instance} phase={phase} showLast={showLast} onScene={onScene} />
    </div>
  );
}

function PhaseStatus({ instance, phase, showLast, onScene }: { instance: Instance; phase: Phase; showLast: boolean; onScene?: boolean }) {
  const { t } = useI18n();
  const progress = useGame((s) => s.installs[instance.id]);
  const crash = useGame((s) => s.crashes[instance.id]);
  const navigate = useNavigate();
  const toLog = () => navigate(instanceUrl(instance.id, "console"));

  if (phase === "preparing" && progress) return <PreparingStatus instance={instance} progress={progress} onScene={onScene} />;
  if (phase === "starting") return <StatusLine lead={t("components.game.mcStarting")} tail={t("components.game.windowSoon")} />;
  if (phase === "running") return <RunningStatus onScene={onScene} onViewLog={toLog} />;
  if (phase === "crashed" && crash) return <CrashedStatus crash={crash} instance={instance} onScene={onScene} onViewLog={toLog} />;
  return <StatusLine lead={phase === "installed" && showLast ? lastPlayedLine(instance) : null} />;
}
