import { useEffect, useId } from "react";
import { useConfirmFriendsMod } from "@/hooks/useFriends";
import { useI18n } from "@/i18n";
import { api } from "@/lib/api";
import { toastError } from "@/lib/toast";
import { cn } from "@/lib/utils";
import type { ModConfirmEvent } from "@/lib/types";
import { Button, Dialog, DialogActions, Hint } from "@/ui";
import { confirmOperationLine, scopeSentenceKey } from "./modRequestModel";
import { opText } from "./modRequestText";
import { useConsentGuard } from "./useConsentGuard";

const DIALOG_WIDTH_PX = 480;
const DENY_WIDTH_PX = 124;
const ALLOW_WIDTH_PX = 210;

/**
 * Die Mod einer Instanz will etwas tun, was nur der Launcher erlauben kann: eine Welt teilen oder die Freundesliste ändern
 * (INGAME 5.5). Der Dialog nennt den Bereich, das Spiel und den Vorgang; die Namen darin sind reiner Text.
 * „Ablehnen“ ist der Startfokus, Enter gibt nichts frei; „Erlauben“ bleibt gegen Fehlklicks gesperrt (`useConsentGuard`).
 * Das Fenster kommt nach vorn, falls es beim Start minimiert wurde.
 */
export function ModConfirmDialog({ confirm, onClose }: { confirm: ModConfirmEvent; onClose: () => void }) {
  const { t } = useI18n();
  const textId = useId();
  const answer = useConfirmFriendsMod();
  const guard = useConsentGuard();

  useEffect(() => void api.setLauncherWindow("restore").catch(toastError), []);

  // Auch ein Fehler schließt: das Backend vergisst die Bitte nach zwei Minuten und beim Spielende (dann NotFound).
  const reply = (allow: boolean) => answer.mutate({ requestId: confirm.requestId, allow }, { onSettled: onClose });

  return (
    <Dialog
      open
      onOpenChange={(open) => !open && reply(false)}
      title={t("friendsInvite.mod.title")}
      width={DIALOG_WIDTH_PX}
      role="alertdialog"
      describedBy={textId}
      busy={answer.isPending}
      footer={
        <>
          <DialogActions cancel={{ label: t("friendsInvite.mod.deny"), width: DENY_WIDTH_PX, autoFocus: true, disabled: answer.isPending }} />
          <Button
            variant="primary"
            width={ALLOW_WIDTH_PX}
            disabled={!guard.armed || answer.isPending}
            onPointerDown={guard.onPointerDown}
            onClick={(event) => guard.activate(event, () => reply(true))}
          >
            {t("friendsInvite.mod.allow")}
          </Button>
        </>
      }
    >
      <p id={textId}>{t(scopeSentenceKey(confirm.scope))}</p>
      <dl className="kv mt-3">
        <dt>{t("friendsInvite.mod.game")}</dt>
        <dd>{confirm.instanceName}</dd>
        <dt>{t("friendsInvite.mod.operation")}</dt>
        <dd className="min-w-0 break-words">{opText(confirmOperationLine(confirm))}</dd>
      </dl>
      {/* Der Platz bleibt reserviert: der Hinweis verschwindet, ohne dass der Dialog springt. */}
      <Hint className={cn("mt-3", guard.armed && "invisible")}>{t("friendsInvite.mod.wait")}</Hint>
    </Dialog>
  );
}
