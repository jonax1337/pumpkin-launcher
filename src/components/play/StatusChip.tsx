import type { ReactNode } from "react";
import { useI18n } from "@/i18n";
import { Chip, Count } from "@/ui";
import type { Instance } from "@/lib/types";
import { useInstallPercent } from "./installPercent";
import { LOUD_PHASES, usePhase, type Phase } from "./phase";

type ChipTone = "run" | "acc" | "bad";
type Translate = ReturnType<typeof useI18n>["t"];

/** Text und Farbe des Chips je Phase; beim Installieren zählt `percent` mit. */
function chipLook(phase: Phase, percent: number | null, t: Translate): [ReactNode, ChipTone | undefined] {
  switch (phase) {
    case "running":
      return [t("components.game.running"), "run"];
    case "preparing":
      return [<>{t("components.game.installing")} <Count value={percent ?? 0} minDigits={3} />&nbsp;%</>, "acc"];
    case "starting":
      return [t("components.game.starting"), "acc"];
    case "crashed":
      return [t("components.game.crashed"), "bad"];
    case "missing":
      return [t("components.game.notInstalled"), undefined];
    case "installed":
      return [t("components.game.ready"), undefined];
    case "loading":
      return [t("components.common.checking"), undefined];
  }
}

/**
 * Status als Chip (Poster, Mini-Karte, Listen-Statusspalte, oben links): Breite nach Inhalt, feste Höhe.
 * Die Prozentzahl steht in Pixelschrift mit fester Stellenbreite, damit der Chip beim Zählen nicht springt.
 * `loudOnly`: im ruhigen Normalfall nichts zeigen. `small`: Chip s (22 px), sonst m (28 px).
 */
export function StatusChip({ instance, small, loudOnly }: { instance: Instance; small?: boolean; loudOnly?: boolean }) {
  const { t } = useI18n();
  const phase = usePhase(instance.id);
  const percent = useInstallPercent(instance);
  if (loudOnly && !LOUD_PHASES.includes(phase)) return null;
  const [text, tone] = chipLook(phase, percent, t);
  // Text in einem Span: sonst setzt der Chip seinen Flex-Abstand zwischen Wort, Zahl und „%“.
  return <Chip size={small ? "s" : "m"} tone={tone}><span>{text}</span></Chip>;
}
