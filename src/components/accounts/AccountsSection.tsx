import { useI18n } from "@/i18n";
import { Actions, Avatar, Button, Empty, ErrorBox, Hint, List, ListRow, RowTitle, Skel } from "@/ui";
import { openAddOffline, startMsLogin } from "@/store/accountUi";
import { useOfflineAllowed, useUsableAccount } from "@/store/offline";
import { accountName, useSettings, type ActiveAccount } from "@/store/settings";
import { isActiveAccount, keyOf, kindLabel, useAllAccounts, useRemoveAccount } from "./useAccounts";

/** Konten verwalten (Einstellungen). */
export function AccountsSection() {
  const { t } = useI18n();
  const active = useUsableAccount();
  const offlineAllowed = useOfflineAllowed((s) => s.allowed);
  const { accounts, query } = useAllAccounts();
  const { remove, pending } = useRemoveAccount();

  return (
    <>
      {query.isPending && accounts.length === 0 ? (
        <Skel h={60} />
      ) : accounts.length ? (
        <List variant="accounts" aria-label={t("components.account.accounts")}>
          {accounts.map((account) => (
            <AccountRow key={keyOf(account)} account={account} active={active} onRemove={remove} removing={pending} />
          ))}
        </List>
      ) : (
        <Empty
          size="pane"
          title={t("components.account.noneYet")}
        >
          {offlineAllowed ? t("components.account.noneOfflineAllowed") : t("components.account.msLoginPrompt")}
        </Empty>
      )}
      {query.error && (
        <ErrorBox className="mt-3" title={t("components.account.msLoadFailed")} error={query.error} onRetry={() => void query.refetch()} />
      )}
      <Actions wrap className="mt-3">
        <Button icon="user" onClick={() => void startMsLogin()}>{t("components.account.msLogin")}</Button>
        {offlineAllowed && <Button icon="plus" onClick={openAddOffline}>{t("components.account.addPlayerName")}</Button>}
      </Actions>
      <Hint className="mt-2.5 max-w-[70ch]">
        {offlineAllowed ? t("components.account.offlineHint") : t("components.onboarding.msHintRequired")}
      </Hint>
    </>
  );
}

/** Ein Konto mit „Wechseln“ (sofern nicht aktiv) und Entfernen bzw. Abmelden; `removing`: eine Abmeldung läuft schon. */
function AccountRow({ account, active, onRemove, removing }: {
  account: ActiveAccount; active: ActiveAccount | null; onRemove: (account: ActiveAccount) => void; removing: boolean;
}) {
  const { t } = useI18n();
  const select = useSettings((s) => s.selectAccount);
  const name = accountName(account);
  const isActive = isActiveAccount(active, account);
  return (
    <ListRow selected={isActive}>
      <Avatar name={name} />
      <RowTitle title={name} sub={`${kindLabel(account)}${isActive ? ` · ${t("components.account.active")}` : ""}`} />
      {!isActive && <Button size="s" onClick={() => select(account)}>{t("components.account.switch")}</Button>}
      <Button variant="ghost" size="s" disabled={account.kind === "microsoft" && removing} onClick={() => onRemove(account)}>
        {account.kind === "microsoft" ? t("components.account.signOutPlain") : t("common.remove")}
      </Button>
    </ListRow>
  );
}
