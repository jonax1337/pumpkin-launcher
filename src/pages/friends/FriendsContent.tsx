import { useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router";
import { useFriendRequests, useFriendsList, useFriendsState, useHostSessions, useInvites } from "@/hooks/useFriends";
import { useI18n } from "@/i18n";
import type { FriendsState } from "@/lib/types";
import { ContextMenu, ErrorBox, PageHeader, Skel, type MenuEntry } from "@/ui";
import { ActivitySection } from "./ActivitySection";
import { AddFriendButtons, AddFriendDialog, type AddFriendTab } from "./AddFriendDialog";
import { FriendsSection } from "./FriendsSection";
import { defaultAddTab, onlineCount } from "./friendsModel";
import { NetworkBanner } from "./NetworkBanner";
import { RequestsSection } from "./RequestsSection";
import { useFriendDialogs } from "./useFriendDialogs";
import { useRetryDeliveries } from "./useRetryDeliveries";

/** Springt zu dem Abschnitt, den der Anker der Adresse nennt (`launcher.open` der Mod), sobald die Seite ihn zeigt. */
function useScrollToAnchor(ready: boolean) {
  const { hash } = useLocation();
  useEffect(() => {
    if (ready && hash) document.getElementById(hash.slice(1))?.scrollIntoView({ block: "start" });
  }, [ready, hash]);
}

/** Die benutzbare Seite: Kopf mit Zahl der Freunde online, Anfragen, Freundesliste und die Aktivität im Spiel. */
export function FriendsContent({ state }: { state: FriendsState }) {
  const { t } = useI18n();
  const navigate = useNavigate();
  const stateQuery = useFriendsState();
  const friends = useFriendsList();
  const requests = useFriendRequests();
  const invites = useInvites();
  const sessions = useHostSessions();
  const retry = useRetryDeliveries();
  const { actions, dialogs } = useFriendDialogs();
  const [adding, setAdding] = useState<AddFriendTab | null>(null);

  const error = friends.error ?? requests.error;
  useScrollToAnchor(!!friends.data && !!requests.data);
  const menu: MenuEntry[] = [
    { id: "add", text: t("friends.add.button"), icon: "plus", onSelect: () => setAdding(defaultAddTab(state.directory.state)) },
    { id: "code", text: t("friends.myCode.button"), icon: "link", onSelect: () => setAdding("mine") },
    "-",
    { id: "settings", text: t("friendsSettings.tab"), icon: "gear", onSelect: () => navigate("/settings?tab=freunde") },
    {
      id: "refresh", text: t("ui.context.refresh"),
      disabled: stateQuery.isFetching || friends.isFetching || requests.isFetching || invites.isFetching || sessions.isFetching,
      onSelect: () => void Promise.all([stateQuery.refetch(), friends.refetch(), requests.refetch(), invites.refetch(), sessions.refetch()]),
    },
  ];
  return (
    <ContextMenu items={menu}>
    <section className="page">
      <PageHeader title={t("ui.nav.friends")} count={friends.data && onlineCount(friends.data)}>
        <AddFriendButtons onAdd={setAdding} />
      </PageHeader>
      <NetworkBanner network={state.network} />
      {error ? (
        <ErrorBox className="mt-4" title={t("friends.loadFailed")} error={error} onRetry={() => void Promise.all([friends.refetch(), requests.refetch()])} />
      ) : !friends.data || !requests.data ? (
        <Skel className="mt-4" h={120} />
      ) : (
        <>
          {requests.data.length > 0 && <RequestsSection requests={requests.data} askBlock={actions.askBlock} {...retry} />}
          <FriendsSection friends={friends.data} invites={invites.data ?? []} session={sessions.data?.[0]} actions={actions} onAdd={setAdding} />
        </>
      )}
      <ActivitySection />
      {adding && <AddFriendDialog initialTab={adding} onClose={() => setAdding(null)} />}
      {dialogs}
    </section>
    </ContextMenu>
  );
}
