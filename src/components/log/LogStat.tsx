import { useI18n } from "@/i18n";
import { Button, Count, StatusPanel } from "@/ui";
import { lastPlayedLine } from "@/components/common";
import { crashHeadline, OpenCrashReportButton } from "@/components/play/crash";
import { usePhase } from "@/components/play/phase";
import { useNow } from "@/components/play/useNow";
import { formatClock } from "@/lib/format";
import type { Instance } from "@/lib/types";
import { useGame } from "@/store/game";
import { askStop } from "@/store/stopAsk";

// Abstände oben 12, unten 10: die Höhe der Konsole rechnet damit (.console).
const PLACE = "mt-3 mb-2.5";

/** Kopfzeile des Protokolls: läuft, abgestürzt oder Ruhe. */
export function LogStat({ instance }: { instance: Instance }) {
  const { t } = useI18n();
  const phase = usePhase(instance.id);
  const crash = useGame((s) => s.crashes[instance.id]);
  const since = useGame((s) => s.started[instance.id]);
  const now = useNow(phase === "running");
  if (phase === "running")
    return (
      <StatusPanel
        size="s"
        tone="run"
        icon="term"
        className={PLACE}
        title={<>{t("components.game.running")}{since && <> {t("components.game.since")} <Count value={formatClock(now - since)} /></>}.</>}
        actions={<Button size="s" icon="stop" onClick={() => askStop(instance)}>{t("components.game.quitEllipsis")}</Button>}
      >
        {t("components.log.liveNote")}
      </StatusPanel>
    );
  if (crash)
    return (
      <StatusPanel
        size="s"
        tone="bad"
        className={PLACE}
        title={`${crashHeadline(crash)}.`}
        actions={crash.crashReport && <OpenCrashReportButton path={crash.crashReport} size="s" />}
      >
        {crash.crashReport ? t("components.log.crashReportHelp") : t("components.log.tailShowsCause")}
      </StatusPanel>
    );
  // Wie man zu Ausgabe kommt, sagt der Leerzustand der Konsole; hier nur Stand und Aufbewahrung
  return (
    <StatusPanel size="s" icon="info" className={PLACE} title={`${lastPlayedLine(instance)}.`}>
      {t("components.log.clearedOnExit")}
    </StatusPanel>
  );
}
