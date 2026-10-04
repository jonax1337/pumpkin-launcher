import { useEffect, useId } from "react";
import { useRetryIngame, useSetIngameEnabled } from "@/hooks/useFriends";
import { useInstance } from "@/hooks/useInstances";
import { useI18n } from "@/i18n";
import type { IngameFailureKind, Instance } from "@/lib/types";
import { Button, Dialog } from "@/ui";
import { runBreakerChoice, type BreakerChoice } from "./breakerModel";

const DIALOG_WIDTH_PX = 480;

/**
 * Das Spiel ist beim Start gescheitert und der Launcher hat das Freunde-Menü der Instanz ausgeschaltet (INGAME 3.8): hier wählt der
 * Spieler, ob es ohne Freunde-Menü weitergeht oder ob der Start es noch einmal versucht. Beide Wege starten das Spiel, der Dialog
 * schließt dafür vorher; `onStart` gehört dem, der nach dem Schließen noch da ist (usePlay hinge sonst an diesem Dialog).
 * Schlägt der Zustand fehl, bleibt er offen (der Fehler erscheint als Toast) und es startet nichts.
 */
export function IngameBreakerDialog({ instanceId, reason, onStart, onClose }: {
  instanceId: string; reason: IngameFailureKind; onStart: (instance: Instance) => Promise<void>; onClose: () => void;
}) {
  const { data: instance, isError } = useInstance(instanceId);
  // Eine Instanz, die es nicht mehr gibt, hat nichts mehr zu fragen: der Dialog darf keinen anderen aufhalten.
  useEffect(() => {
    if (isError) onClose();
  }, [isError, onClose]);
  return instance && <BreakerChoices instance={instance} reason={reason} onStart={onStart} onClose={onClose} />;
}

function BreakerChoices({ instance, reason, onStart, onClose }: {
  instance: Instance; reason: IngameFailureKind; onStart: (instance: Instance) => Promise<void>; onClose: () => void;
}) {
  const { t } = useI18n();
  const textId = useId();
  const switchOff = useSetIngameEnabled(instance.id);
  const retry = useRetryIngame(instance.id);
  const pending = switchOff.isPending || retry.isPending;

  const choose = (choice: BreakerChoice) =>
    runBreakerChoice(choice, {
      switchOff: () => switchOff.mutateAsync(false),
      retry: () => retry.mutateAsync(),
      start: () => {
        onClose();
        return onStart(instance);
      },
    }).catch(() => undefined); // Den Fehler meldet der zentrale Mutations-Toast; der Dialog bleibt offen.

  return (
    <Dialog
      open
      onOpenChange={(open) => !open && onClose()}
      title={t("friendsHost.breaker.title")}
      width={DIALOG_WIDTH_PX}
      role="alertdialog"
      describedBy={textId}
      busy={pending}
      footer={
        <>
          <Button disabled={pending} onClick={() => void choose("retryAnyway")}>{t("friendsHost.breaker.retry")}</Button>
          <Button variant="primary" disabled={pending} onClick={() => void choose("startWithout")}>{t("friendsHost.breaker.startWithout")}</Button>
        </>
      }
    >
      <p id={textId}>{t("friendsHost.breaker.text")}</p>
      <p className="mt-2 text-fg-3">
        {t("friendsHost.breaker.detail", { instance: instance.name, failure: t(`friendsHost.ingame.failure.${reason}`) })}
      </p>
    </Dialog>
  );
}
