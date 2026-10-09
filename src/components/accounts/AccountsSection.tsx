import { useI18n } from "@/i18n";
import { Button, Chip, Hint, Icon, IconButton, List, ListRow, RowTitle, Skel } from "@/ui";
import { EmptyState } from "@/components/EmptyState";
import { ErrorBox } from "@/components/ErrorBox";
import { openAddOffline, startMsLogin } from "@/store/accountUi";
import { useOfflineAllowed, useUsableAccount } from "@/store/offline";
import { accountName, useSettings, type ActiveAccount } from "@/store/settings";
import { AccountAvatar } from "./AccountAvatar";
import { isActiveAccount, keyOf, kindLabel, useAllAccounts, useRemoveAccount } from "./useAccounts";

/** „Microsoft-Konto hinzufügen“ und (wo erlaubt) „Spielername hinzufügen“; stehen im Kopf der Einstellungen › Konten. */
export function AccountAddButtons() {
  const { t } = useI18n();
  const offlineAllowed = useOfflineAllowed((s) => s.allowed);
  return (
    <>
      <Button variant="primary" size="s" icon="microsoft" onClick={() => void startMsLogin()}>{t("components.account.msLogin")}</Button>
      {offlineAllowed && <Button size="s" icon="user" onClick={openAddOffline}>{t("components.account.addPlayerName")}</Button>}
    </>
  );
}

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
        <Skel className="h-[60px]" />
      ) : accounts.length ? (
        <List spaced aria-label={t("components.account.accounts")}>
          {accounts.map((account) => (
            <AccountRow key={keyOf(account)} account={account} active={active} onRemove={remove} removing={pending} />
          ))}
        </List>
      ) : (
        <EmptyState
          size="pane"
          title={t("components.account.noneYet")}
        >
          {offlineAllowed ? t("components.account.noneOfflineAllowed") : t("components.account.msLoginPrompt")}
        </EmptyState>
      )}
      {query.error && (
        <ErrorBox className="accounts-note" title={t("components.account.msLoadFailed")} error={query.error} onRetry={() => void query.refetch()} />
      )}
      <Hint className="accounts-note">
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
  const microsoft = account.kind === "microsoft";
  return (
    <ListRow plate="row" selected={isActive}>
      <AccountAvatar account={account} box={48} />
      <RowTitle
        title={name}
        sub={
          <span className="inline-flex items-center gap-1.5">
            <Icon name={microsoft ? "microsoft" : "user"} size="s" />
            {kindLabel(account)}
          </span>
        }
      />
      {isActive && <Chip tone="acc" size="s" icon="check">{t("components.account.active")}</Chip>}
      {!isActive && <Button size="s" onClick={() => select(account)}>{t("components.account.switch")}</Button>}
      {microsoft ? (
        <Button variant="ghost" size="s" icon="logout" disabled={removing} onClick={() => onRemove(account)}>{t("components.account.signOutPlain")}</Button>
      ) : (
        <IconButton icon="trash" size="s" label={t("common.remove")} onClick={() => onRemove(account)} />
      )}
    </ListRow>
  );
}
