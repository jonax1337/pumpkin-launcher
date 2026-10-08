import { useNavigate } from "react-router";
import { useFriendsState } from "@/hooks/useFriends";
import { useI18n } from "@/i18n";
import { useAllAccounts } from "@/components/accounts/useAccounts";
import { ContextMenu, ErrorBox, Page, PageHeader, Skel, type MenuEntry } from "@/ui";
import { FriendsContent } from "./friends/FriendsContent";
import { FriendsGate } from "./friends/FriendsGate";
import { friendsGate } from "./friends/friendsModel";
import "./friends/friends.css";

/** Freunde: Anfragen und Liste. Ist die Funktion nicht nutzbar, steht an ihrer Stelle der Grund mit dem nächsten Schritt. */
export function FriendsPage() {
  const { t } = useI18n();
  const navigate = useNavigate();
  const state = useFriendsState();
  const { accounts, query } = useAllAccounts();
  const hasMicrosoftAccount = accounts.some((account) => account.kind === "microsoft");
  const gate = state.data ? friendsGate(state.data, hasMicrosoftAccount) : null;
  const needsAccount = state.data?.enabled && state.data.availability === "available";
  const accountPending = needsAccount && query.isPending;
  const accountError = needsAccount && query.error;
  const menu: MenuEntry[] = [
    { id: "settings", text: t("friendsSettings.tab"), icon: "settings", onSelect: () => navigate("/settings?tab=freunde") },
    {
      id: "refresh", text: t("ui.context.refresh"), disabled: state.isFetching || query.isFetching,
      onSelect: () => void Promise.all([state.refetch(), query.refetch()]),
    },
  ];

  if (state.data && !gate && !accountError && !accountPending) return <FriendsContent state={state.data} />;
  return (
    <ContextMenu items={menu}>
    <Page className="friends-page">
      <PageHeader title={t("ui.nav.friends")} />
      {accountError ? (
        <ErrorBox title={t("components.account.msLoadFailed")} error={accountError} onRetry={() => void query.refetch()} />
      ) : accountPending ? (
        <Skel h={120} />
      ) : gate ? (
        <FriendsGate gate={gate} />
      ) : state.error ? (
        <ErrorBox title={t("friends.loadFailed")} error={state.error} onRetry={() => void state.refetch()} />
      ) : (
        <Skel h={120} />
      )}
    </Page>
    </ContextMenu>
  );
}
