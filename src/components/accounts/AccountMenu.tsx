import { useNavigate } from "react-router";
import { useI18n } from "@/i18n";
import { StopDialog } from "@/components/play/StopDialog";
import { BarButton, Icon, Menu, MenuHead, MenuItem, MenuLabel, MenuSep } from "@/ui";
import { openAddOffline, startMsLogin, useAccountUi } from "@/store/accountUi";
import { useOfflineAllowed, useUsableAccount } from "@/store/offline";
import { accountName, useSettings } from "@/store/settings";
import { AccountAvatar } from "./AccountAvatar";
import { AddOfflineDialog } from "./AddOfflineDialog";
import { MsLoginDialog } from "./MsLoginDialog";
import { isActiveAccount, keyOf, kindLabel, useAllAccounts, useRemoveAccount } from "./useAccounts";

/** Kontomenü oben rechts: Kopf + Name, Konten wechseln, anmelden, Spielername hinzufügen. */
export function AccountMenu() {
  const { t } = useI18n();
  const active = useUsableAccount();
  const allowed = useOfflineAllowed((s) => s.allowed);
  const select = useSettings((s) => s.selectAccount);
  const { accounts } = useAllAccounts();
  const { remove } = useRemoveAccount();
  const open = useAccountUi((s) => s.menu);
  const navigate = useNavigate();
  const name = accountName(active);

  return (
    <>
      <Menu
        open={open}
        onOpenChange={(o) => useAccountUi.setState({ menu: o })}
        wide
        trigger={
          <BarButton
            aria-label={
              name
                ? t("components.account.switchWith", { name })
                : t(allowed ? "components.account.noNameChoose" : "components.account.notLoggedInChoose")
            }
            label={name || t(allowed ? "components.account.noName" : "components.account.notLoggedIn")}
            tone={name ? undefined : "warn"}
            iconEnd="chev-down"
          >
            {/* Ohne Namen: Warnsymbol statt Kopf (Form, nicht nur gelbe Schrift) */}
            {active ? <AccountAvatar account={active} /> : <Icon name="warn" tone="warn" />}
          </BarButton>
        }
      >
        {active && (
          <>
            <MenuHead lead={<AccountAvatar account={active} />} title={name} sub={kindLabel(active)} />
            <MenuSep />
          </>
        )}
        {accounts.length > 0 && (
          <>
            <MenuLabel>{t("components.account.accounts")}</MenuLabel>
            {accounts.map((account) => (
              <MenuItem
                key={keyOf(account)}
                sub={kindLabel(account)}
                lead={<AccountAvatar account={account} />}
                checked={isActiveAccount(active, account)}
                onSelect={() => select(account)}
              >
                {accountName(account)}
              </MenuItem>
            ))}
            <MenuSep />
          </>
        )}
        <MenuItem icon="microsoft" onSelect={() => void startMsLogin()}>{t("components.account.msLogin")}</MenuItem>
        {allowed && <MenuItem icon="user" onSelect={openAddOffline}>{t("components.account.addPlayerName")}</MenuItem>}
        <MenuItem icon="skins" onSelect={() => navigate("/skins")}>{t("components.account.skins")}</MenuItem>
        <MenuItem icon="settings" onSelect={() => navigate("/settings#konten")}>{t("common.settings")}</MenuItem>
        {active?.kind === "microsoft" && (
          <>
            <MenuSep />
            <MenuItem bad icon="logout" onSelect={() => remove(active)}>{t("components.account.signOutNamed", { name })}</MenuItem>
          </>
        )}
      </Menu>
      <MsLoginDialog />
      <AddOfflineDialog />
      {/* Globale Rückfrage „Minecraft beenden?“ (askStop); hier, weil das Kontomenü immer eingehängt ist */}
      <StopDialog />
    </>
  );
}
