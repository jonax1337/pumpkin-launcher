import { useState, type FormEvent } from "react";
import { toast } from "sonner";
import { useI18n } from "@/i18n";
import { PlayerNameField } from "@/components/PlayerNameField";
import { Button, Dialog, DialogActions, Hint, StatusPanel } from "@/ui";
import { startMsLogin, useAccountUi } from "@/store/accountUi";
import { isValidPlayerName, useSettings } from "@/store/settings";
import { ThenSub } from "./ThenSub";

/** Dialog „Spielername hinzufügen“; aus „Spielen“ heraus (`then`) setzt er danach den Start fort. */
export function AddOfflineDialog() {
  const { t } = useI18n();
  const open = useAccountUi((s) => s.offline);
  const then = useAccountUi((s) => s.then);
  const addAccount = useSettings((s) => s.addAccount);
  const [name, setName] = useState("");
  const close = () => {
    useAccountUi.setState({ offline: false, then: null });
    setName("");
  };

  function submit(e: FormEvent) {
    e.preventDefault();
    if (!isValidPlayerName(name)) return;
    addAccount(name);
    // Startet danach das Spiel, zeigt der Spielen-Knopf den Fortschritt; eine Meldung wäre doppelt.
    if (!then) toast.success(t("components.account.playerNameActive", { name }));
    close();
    then?.run();
  }

  // Beim Spielen: statt Namen mit Microsoft anmelden; `then` bleibt stehen und startet nach der Anmeldung.
  function microsoft() {
    useAccountUi.setState({ offline: false });
    setName("");
    void startMsLogin();
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => !o && close()}
      title={then ? t("components.account.askName") : t("components.account.addPlayerName")}
      sub={then ? <ThenSub label={then.label} /> : undefined}
      size="s"
      height="s"
      footer={
        <DialogActions
          cancel={t("common.cancel")}
          confirm={{
            label: then ? t("components.account.saveAndPlay") : t("common.add"),
            className: then ? "w-[196px]" : "w-[140px]",
            form: "off-form",
            icon: then ? "play" : undefined,
            disabled: !isValidPlayerName(name),
          }}
        />
      }
    >
      <form id="off-form" onSubmit={submit}>
        {/* Zwei Zeilen reserviert: der kürzere Fehler ersetzt den Hilfetext, ohne dass etwas nachrückt */}
        <PlayerNameField value={name} onChange={setName} help={t("components.playerName.helpLong")} reserveLines={2} />
      </form>
      {!then && (
        <StatusPanel className="add-offline-note" icon="info" title={t("components.account.offlineNoteTitle")}>
          {t("components.account.offlineNoteText")}
        </StatusPanel>
      )}
      {then && (
        <>
          <div className="or">{t("components.common.or")}</div>
          <Button icon="microsoft" className="w-full" onClick={microsoft}>{t("components.account.msLogin")}</Button>
          <Hint className="add-offline-hint">{t("components.account.neededForServers")}</Hint>
        </>
      )}
    </Dialog>
  );
}
