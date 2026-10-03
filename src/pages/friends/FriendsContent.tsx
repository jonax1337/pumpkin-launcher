import { useState } from "react";
import { useFriendRequests, useFriendsList, useHostSessions, useInvites } from "@/hooks/useFriends";
import { useI18n } from "@/i18n";
import type { FriendsState } from "@/lib/types";
import { ErrorBox, PageHeader, Skel } from "@/ui";
import { AddFriendButtons, AddFriendDialog, type AddFriendTab } from "./AddFriendDialog";
import { FriendsSection } from "./FriendsSection";
import { onlineCount } from "./friendsModel";
import { NetworkBanner } from "./NetworkBanner";
import { RequestsSection } from "./RequestsSection";
import { useFriendDialogs } from "./useFriendDialogs";
import { useRetryDeliveries } from "./useRetryDeliveries";

/** Die benutzbare Seite: Kopf mit Zahl der Freunde online, Anfragen und Freundesliste. */
export function FriendsContent({ state }: { state: FriendsState }) {
  const { t } = useI18n();
  const friends = useFriendsList();
  const requests = useFriendRequests();
  const invites = useInvites();
  const sessions = useHostSessions();
  const retry = useRetryDeliveries();
  const { actions, dialogs } = useFriendDialogs();
  const [adding, setAdding] = useState<AddFriendTab | null>(null);

  const error = friends.error ?? requests.error;
  return (
    <>
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
      {adding && <AddFriendDialog initialTab={adding} onClose={() => setAdding(null)} />}
      {dialogs}
    </>
  );
}
