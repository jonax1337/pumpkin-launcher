import { useNavigate } from "react-router";
import { useI18n } from "@/i18n";
import { StopDialog } from "@/components/play/StopDialog";
import { Avatar, BarButton, Icon, Menu, type MenuEntry } from "@/ui";
import { openAddOffline, startMsLogin, useAccountUi } from "@/store/accountUi";
import { useOfflineAllowed, useUsableAccount } from "@/store/offline";
import { accountName, useSettings } from "@/store/settings";
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

  const items: MenuEntry[] = [
    ...(accounts.length ? [{ label: t("components.account.accounts") } as const] : []),
    ...accounts.map((account): MenuEntry => ({
      id: keyOf(account),
      text: accountName(account),
      sub: kindLabel(account),
      lead: <Avatar name={accountName(account)} />,
      checked: isActiveAccount(active, account),
      onSelect: () => select(account),
    })),
    ...(accounts.length ? ["-" as const] : []),
    { id: "ms", text: t("components.account.msLogin"), icon: "user", onSelect: () => void startMsLogin() },
    ...(allowed ? [{ id: "off", text: t("components.account.addPlayerName"), icon: "plus" as const, onSelect: openAddOffline }] : []),
    { id: "skins", text: t("components.account.skins"), icon: "shirt", onSelect: () => navigate("/skins") },
    { id: "set", text: t("common.settings"), icon: "gear", onSelect: () => navigate("/settings#konten") },
    ...(active?.kind === "microsoft"
      ? [
          "-" as const,
          {
            id: "out",
            text: t("components.account.signOutNamed", { name }),
            icon: "power" as const,
            bad: true,
            onSelect: () => remove(active),
          },
        ]
      : []),
  ];

  return (
    <>
      <Menu
        open={open}
        onOpenChange={(o) => useAccountUi.setState({ menu: o })}
        width={320}
        items={items}
        trigger={
          <BarButton
            aria-label={
              name
                ? t("components.account.switchWith", { name })
                : t(allowed ? "components.account.noNameChoose" : "components.account.notLoggedInChoose")
            }
            label={name || t(allowed ? "components.account.noName" : "components.account.notLoggedIn")}
            tone={name ? undefined : "warn"}
            iconEnd="chevd"
          >
            {/* Ohne Namen: Warnsymbol statt Kopf (Form, nicht nur gelbe Schrift) */}
            {name ? <Avatar name={name} /> : <Icon name="warn" tone="warn" />}
          </BarButton>
        }
      />
      <MsLoginDialog />
      <AddOfflineDialog />
      {/* Globale Rückfrage „Minecraft beenden?“ (askStop); hier, weil das Kontomenü immer eingehängt ist */}
      <StopDialog />
    </>
  );
}
