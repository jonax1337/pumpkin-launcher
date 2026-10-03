import { useState } from "react";
import { useResetFriends } from "@/hooks/useFriends";
import { useI18n } from "@/i18n";
import { startMsLogin } from "@/store/accountUi";
import { Button, ButtonLink, ConfirmDialog, Empty, StatusPanel } from "@/ui";
import type { FriendsGate as Gate } from "./friendsModel";

/** Wohin „Freunde aktivieren“ führt: der Reiter „Freunde“ der Einstellungen, der den Einwilligungsdialog öffnet. */
export const FRIENDS_SETTINGS_URL = "/settings?tab=freunde";

/** Was die Seite statt der Freundesliste zeigt, solange Freunde nicht nutzbar sind. */
export function FriendsGate({ gate }: { gate: Gate }) {
  const { t } = useI18n();
  switch (gate) {
    case "noSecretStore":
      return <StatusPanel className="mt-4" tone="warn" title={t("friends.gate.noKeyring.title")}>{t("friends.gate.noKeyring.body")}</StatusPanel>;
    case "identityLost":
      return <IdentityLost />;
    case "disabled":
      return (
        <Empty
          size="page"
          title={t("friends.gate.disabled.title")}
          actions={<ButtonLink to={FRIENDS_SETTINGS_URL} variant="primary" icon="users">{t("friends.gate.disabled.action")}</ButtonLink>}
        >
          {t("friends.gate.disabled.body")}
        </Empty>
      );
    case "noMicrosoftAccount":
      return (
        <StatusPanel
          className="mt-4"
          icon="user"
          title={t("friends.gate.noAccount.title")}
          actions={<Button icon="user" onClick={() => void startMsLogin()}>{t("components.account.msLogin")}</Button>}
        >
          {t("friends.gate.noAccount.body")}
        </StatusPanel>
      );
  }
}

/** Der Schlüssel fehlt, die Daten sind noch da: es hilft nur ein Neuanfang, und der löscht alles. */
function IdentityLost() {
  const { t } = useI18n();
  const [asking, setAsking] = useState(false);
  const reset = useResetFriends();
  return (
    <>
      <StatusPanel
        className="mt-4"
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
