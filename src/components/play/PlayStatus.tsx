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

/** Zeile der Statuszeile: 32 px, feste Höhe, damit sich nichts verschiebt, wenn sich der Zustand ändert. Der Platzhalter (`PlayStatusSkel`) reserviert dieselbe Höhe. */
const STATUS_ROW = "flex h-8 min-w-0 items-center gap-1.5 text-[length:calc(13px*var(--tz))] text-(color:--fg-2)";

/** Leere Statuszeile: reserviert die Höhe von `PlayStatus`, solange noch keine Instanz da ist. */
export function PlayStatusSkel({ className }: { className?: string }) {
  return <div className={cn(STATUS_ROW, className)} />;
}

/** Gemeinsame Optik der Statuszeilen: `lead` wird vorgelesen, `tail` (Zähler) und `acts` (Knöpfe) nicht. `quiet`: die Meldung nimmt keinen Platz ein (nur für Screenreader). */
function StatusLine({ lead, tail, acts, quiet }: { lead?: ReactNode; tail?: ReactNode; acts?: ReactNode; quiet?: boolean }) {
  return (
    <>
      <span className={cn("min-w-0 overflow-hidden text-ellipsis whitespace-nowrap", quiet && "absolute")}>
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
      lead={<b className="font-semibold text-(color:--fg) [text-shadow:var(--tsh)]">{installStepLabel(progress.step, instance.loader)}</b>}
      tail={progress.total > 1 && (
        <> {t("components.game.countOf", { done: formatCount(progress.done), total: formatCount(progress.total) })}</>
      )}
      acts={
        <Button
          variant="ghost"
          size="s"
          icon="close"
          onScene={onScene}
          className="ml-2"
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
      quiet
      // Laufzeit steht im Knopf („Läuft seit …“); hier nur für Screenreader die Zustandsänderung.
      lead={<span className="sr">{t("components.game.mcRunningSr")}</span>}
      acts={
        // Über der Szene steht der Knopf bündig mit dem Text darüber (Hero).
        <Button variant="ghost" size="s" icon="terminal" onScene={onScene} bleed={onScene ? "start" : undefined} onClick={onViewLog}>
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
export function PlayStatus({ instance, showLast = true, onScene, className }: { instance: Instance; showLast?: boolean; onScene?: boolean; className?: string }) {
  const phase = usePhase(instance.id);
  return (
    <div className={cn(STATUS_ROW, className)}>
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
