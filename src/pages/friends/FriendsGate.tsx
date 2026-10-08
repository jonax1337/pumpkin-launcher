import { useState } from "react";
import { FriendsOptInDialog } from "@/components/friends/FriendsOptInDialog";
import { useResetFriends } from "@/hooks/useFriends";
import { useI18n } from "@/i18n";
import { startMsLogin } from "@/store/accountUi";
import { Button, ConfirmDialog, Empty, StatusPanel, Workspace, WorkspaceContent } from "@/ui";
import type { FriendsGate as Gate } from "./friendsModel";

/** Was die Seite statt der Freundesliste zeigt, solange Freunde nicht nutzbar sind. */
export function FriendsGate({ gate }: { gate: Gate }) {
  const { t } = useI18n();
  switch (gate) {
    case "noSecretStore":
      return <StatusPanel tone="warn" title={t("friends.gate.noKeyring.title")}>{t("friends.gate.noKeyring.body")}</StatusPanel>;
    case "identityLost":
      return <IdentityLost />;
    case "disabled":
      return <Disabled />;
    case "noMicrosoftAccount":
      return (
        <StatusPanel
          icon="user"
          title={t("friends.gate.noAccount.title")}
          actions={<Button icon="microsoft" onClick={() => void startMsLogin()}>{t("components.account.msLogin")}</Button>}
        >
          {t("friends.gate.noAccount.body")}
        </StatusPanel>
      );
  }
}

/** Freunde sind aus: „Freunde aktivieren“ öffnet den Einwilligungsdialog gleich auf der Seite. */
function Disabled() {
  const { t } = useI18n();
  const [optingIn, setOptingIn] = useState(false);
  return (
    <>
      <Workspace>
        <WorkspaceContent>
          <Empty
            size="pane"
            title={t("friends.gate.disabled.title")}
            actions={<Button variant="primary" icon="friends" onClick={() => setOptingIn(true)}>{t("friends.gate.disabled.action")}</Button>}
          >
            {t("friends.gate.disabled.body")}
          </Empty>
        </WorkspaceContent>
      </Workspace>
      {optingIn && <FriendsOptInDialog onClose={() => setOptingIn(false)} />}
    </>
  );
}

/** Der Schlüssel fehlt, die Daten sind noch da: es hilft nur ein Neuanfang, und der löscht alles. */
function IdentityLost() {
  const { t } = useI18n();
  const [asking, setAsking] = useState(false);
  const reset = useResetFriends();
  return (
    <>
      <StatusPanel
        tone="bad"
        role="alert"
        title={t("friends.gate.lost.title")}
        actions={<Button variant="danger" onClick={() => setAsking(true)}>{t("friends.gate.lost.action")}</Button>}
      >
        {t("friends.gate.lost.body")}
      </StatusPanel>
      <ConfirmDialog
        open={asking}
        onOpenChange={setAsking}
        title={t("friends.gate.lost.confirmTitle")}
        text={t("friends.gate.lost.confirmText")}
        confirmLabel={t("friends.gate.lost.action")}
        pending={reset.isPending}
        onConfirm={() => reset.mutate(undefined, { onSuccess: () => setAsking(false) })}
      />
    </>
  );
}
