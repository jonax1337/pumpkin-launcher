import type { ComponentProps } from "react";
import { Button, Tip } from "@/ui";
import { usePhase } from "@/components/play/phase";
import { useContentState } from "@/store/contentState";
import { useI18n } from "@/i18n";
import type { Instance, QuickPlay } from "@/lib/types";

/**
 * Warum die Instanz gerade nicht gestartet oder geändert wird (null = frei): ihr Spiel startet oder läuft, oder ein
 * Vorgang arbeitet an ihr. Das Backend sperrt je Instanz, Vorgänge an anderen Instanzen stören also nicht.
 */
export function useInstanceBusyReason(instanceId: string): string | null {
  const { t } = useI18n();
  const phase = usePhase(instanceId);
  const jobWorksOnInstance = useContentState((s) => s.instanceIds.includes(instanceId));
  if (phase === "running") return t("detail.busy.gameRunning");
  if (phase === "preparing" || phase === "starting") return t("detail.busy.gameStarting");
  if (jobWorksOnInstance) return t("detail.busy.jobRunning");
  return null;
}

/**
 * Wie `useInstanceBusyReason`, und gesperrt, solange irgendein Inhalts-Vorgang läuft: für Aktionen, die selbst einen
 * starten, denn die Oberfläche führt nur einen zur Zeit aus (auch an einer anderen Instanz).
 */
export function useBusyReason(instanceId: string): string | null {
  const { t } = useI18n();
  const instanceReason = useInstanceBusyReason(instanceId);
  const jobRunning = useContentState((s) => s.active != null);
  return instanceReason ?? (jobRunning ? t("detail.busy.jobRunning") : null);
}

/** Knopf, der gesperrt erreichbar bleibt und den Grund (`blocked`) im Tooltip nennt. */
export function GuardedButton({ blocked, onClick, ...props }: { blocked: string | null } & ComponentProps<typeof Button>) {
  return (
    <Tip label={blocked} describe>
      <Button {...props} aria-disabled={blocked ? true : undefined} onClick={(e) => !blocked && onClick?.(e)} />
    </Tip>
  );
}

/** Gemeinsame Eigenschaften der Abschnitte „Welten“ und „Server“: `busy` ist der Sperrgrund aus `useInstanceBusyReason`. */
export type SectionProps = { instance: Instance; busy: string | null; onPlay: (target: QuickPlay) => void };
