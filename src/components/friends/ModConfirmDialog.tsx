import { useEffect, useId } from "react";
import { useConfirmFriendsMod } from "@/hooks/useFriends";
import { useI18n } from "@/i18n";
import { api } from "@/lib/api";
import { toastError } from "@/lib/toast";
import { cn } from "@/lib/utils";
import type { ModConfirmEvent } from "@/lib/types";
import { Button, DescriptionList, Dialog, DialogActions, Hint } from "@/ui";
import { confirmOperationLine, scopeSentenceKey } from "./modRequestModel";
import { opText } from "./modRequestText";
import { useConsentGuard } from "./useConsentGuard";

const DENY_WIDTH = "w-[124px]";
const ALLOW_WIDTH = "w-[210px]";

/**
 * Die Mod einer Instanz will etwas tun, was nur der Launcher erlauben kann: eine Welt teilen oder die Freundesliste ändern
 * (docs/bridge/README.md, "Operations and consent"). Der Dialog nennt den Bereich, das Spiel und den Vorgang; die Namen darin sind reiner Text.
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
      size="s"
      role="alertdialog"
      describedBy={textId}
      busy={answer.isPending}
      footer={
        <>
          <DialogActions cancel={{ label: t("friendsInvite.mod.deny"), className: DENY_WIDTH, autoFocus: true, disabled: answer.isPending }} />
          <Button
            variant="primary"
            className={ALLOW_WIDTH}
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
      <DescriptionList
        size="s"
        end
        className="mt-3"
        items={[
          { label: t("friendsInvite.mod.game"), value: confirm.instanceName },
          { label: t("friendsInvite.mod.operation"), value: opText(confirmOperationLine(confirm)) },
        ]}
      />
      {/* Der Platz bleibt reserviert: der Hinweis verschwindet, ohne dass der Dialog springt. */}
      <Hint className={cn("mt-3", guard.armed && "invisible")}>{t("friendsInvite.mod.wait")}</Hint>
    </Dialog>
  );
}
