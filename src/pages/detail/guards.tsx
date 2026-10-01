import type { ComponentProps } from "react";
import { Button, Tip } from "@/ui";
import { usePhase } from "@/components/game";
import { useContentState } from "@/hooks/useContent";
import type { Instance, QuickPlay } from "@/lib/types";

/** Warum Spieldateien gerade nicht angefasst werden und nichts startet (null = frei); das Backend lässt nur einen Vorgang zu. */
export function useBusyReason(instanceId: string): string | null {
  const phase = usePhase(instanceId);
  const contentBusy = useContentState((s) => s.active != null);
  if (phase === "running") return "Minecraft läuft gerade. Beende es zuerst.";
  if (phase === "preparing" || phase === "starting") return "Minecraft startet gerade.";
  if (contentBusy) return "Gerade läuft ein Vorgang. Warte, bis er fertig ist.";
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
