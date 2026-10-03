import { useEffect, useId } from "react";
import { useConfirmFriendsMod } from "@/hooks/useFriends";
import { useI18n } from "@/i18n";
import { api } from "@/lib/api";
import { toastError } from "@/lib/toast";
import type { ModConfirmEvent } from "@/lib/types";
import { Dialog, DialogActions } from "@/ui";

const DIALOG_WIDTH_PX = 480;
const BUTTON_WIDTH_PX = 124;

/**
 * Die Mod einer Instanz will die Welt zum ersten Mal in diesem Spiel teilen: nur eine Bestätigung im Launcher lässt sie das
 * tun (Spezifikation 7.4). Das Fenster kommt dafür nach vorn, falls es beim Start minimiert wurde.
 * „Ablehnen“ ist der Startfokus: Enter gibt nichts frei.
 */
export function ModConfirmDialog({ confirm, onClose }: { confirm: ModConfirmEvent; onClose: () => void }) {
  const { t } = useI18n();
  const textId = useId();
  const answer = useConfirmFriendsMod();
  const names = confirm.friends.map((friend) => friend.displayName).join(", ");

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
        <DialogActions
          cancel={{ label: t("friendsInvite.mod.deny"), width: BUTTON_WIDTH_PX, autoFocus: true, disabled: answer.isPending }}
          confirm={{ label: t("friendsInvite.mod.allow"), width: BUTTON_WIDTH_PX, disabled: answer.isPending, onClick: () => reply(true) }}
        />
      }
    >
      <p id={textId}>{t("friendsInvite.mod.text", { instance: confirm.instanceName, names })}</p>
    </Dialog>
  );
}
