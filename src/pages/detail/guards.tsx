import type { ComponentProps } from "react";
import { Button, Tip } from "@/ui";
import { usePhase } from "@/components/game";
import { useContentState } from "@/hooks/useContent";
import { useI18n } from "@/i18n";
import type { Instance, QuickPlay } from "@/lib/types";

/** Warum Spieldateien gerade nicht angefasst werden und nichts startet (null = frei); das Backend lässt nur einen Vorgang zu. */
export function useBusyReason(instanceId: string): string | null {
  const { t } = useI18n();
  const phase = usePhase(instanceId);
  const contentBusy = useContentState((s) => s.active != null);
  if (phase === "running") return t("detail.busy.gameRunning");
  if (phase === "preparing" || phase === "starting") return t("detail.busy.gameStarting");
  if (contentBusy) return t("detail.busy.jobRunning");
  return null;
}

/** Knopf, der gesperrt erreichbar bleibt und den Grund (`blocked`) im Tooltip nennt. */
export function GuardedButton({ blocked, onClick, ...props }: { blocked: string | null } & ComponentProps<typeof Button>) {
  return (
    <Tip label={blocked} describe>
      <Button {...props} aria-disabled={blocked ? true : undefined} onClick={(e) => !blocked && onClick?.(e)} />
    </Tip>
  );
}

/** Gemeinsame Eigenschaften der Abschnitte „Welten“ und „Server“: `busy` ist der Sperrgrund aus `useBusyReason`. */
export type SectionProps = { instance: Instance; busy: string | null; onPlay: (target: QuickPlay) => void };
