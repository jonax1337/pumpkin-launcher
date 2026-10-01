import { useEffect } from "react";
import { useI18n } from "@/i18n";
import { ConfirmDialog } from "@/ui";
import { useKill } from "@/hooks/usePlay";
import { useStopAsk } from "@/store/stopAsk";
import { usePhase } from "./phase";

const closeStopAsk = () => useStopAsk.setState({ instance: null });

/**
 * Rückfrage vor dem harten Beenden („Minecraft beenden?“), einmal global eingehängt (Kontomenü, neben den Konto-Dialogen).
 * Öffnen per `askStop(instance)`. ConfirmDialog: alertdialog, Fokus zuerst auf „Abbrechen“;
 * endet das Spiel von selbst, schließt sich die Frage.
 */
export function StopDialog() {
  const { t } = useI18n();
  const instance = useStopAsk((s) => s.instance);
  const phase = usePhase(instance?.id ?? "");
  const kill = useKill();
  const gameEnded = !!instance && phase !== "running" && phase !== "loading";
  useEffect(() => {
    if (gameEnded) closeStopAsk();
  }, [gameEnded]);
  return (
    <ConfirmDialog
      open={!!instance}
      onOpenChange={(open) => !open && closeStopAsk()}
      title={t("components.game.stopTitle")}
      text={t("components.game.stopText")}
      confirmLabel={t("components.game.quit")}
      pending={kill.isPending}
      onConfirm={() => {
        if (instance) kill.mutate(instance);
        closeStopAsk();
      }}
    />
  );
}
