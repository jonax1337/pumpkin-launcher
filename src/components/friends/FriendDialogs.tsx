import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { dialogOpen } from "@/app/dialogOpen";
import { InviteDialog } from "@/components/friends/InviteDialog";
import { ModConfirmDialog } from "@/components/friends/ModConfirmDialog";
import { instanceKeys } from "@/hooks/queryKeys";
import { inviteToastId } from "@/hooks/useFriendEvents";
import { useInvites, useJoinInvite } from "@/hooks/useFriends";
import { usePlay } from "@/hooks/usePlay";
import { api } from "@/lib/api";
import { toastError } from "@/lib/toast";
import { useInviteRequest } from "@/pages/friends/inviteRequest";
import { closeFriendDialog, openNextFriendDialog, queueFriendDialog, useFriendsUi } from "@/store/friendsUi";

/** So oft schaut ein wartender Dialog nach, ob der offene geschlossen wurde. */
const FREE_POLL_MS = 400;

/** „Beitreten“ in der Freundesliste und „Ansehen“ im Toast bitten um genau diese Einladung: sie kommt in die Warteschlange. */
function useInviteRequests() {
  const inviteId = useInviteRequest((request) => request.inviteId);
  useEffect(() => {
    if (!inviteId) return;
    queueFriendDialog({ kind: "invite", inviteId });
    useInviteRequest.setState({ inviteId: null });
  }, [inviteId]);
}

/** Öffnet den nächsten wartenden Dialog, sobald kein anderer Dialog der App offen ist: nie zwei zugleich. */
function useOpenWhenFree(hasWaiting: boolean) {
  useEffect(() => {
    if (!hasWaiting) return;
    const openIfFree = () => {
      if (!dialogOpen()) openNextFriendDialog();
    };
    openIfFree();
    const poll = setInterval(openIfFree, FREE_POLL_MS);
    return () => clearInterval(poll);
  }, [hasWaiting]);
}

/**
 * Der Beitritt zu einer Freundeswelt. `usePlay` installiert die Instanz, falls sie fehlt, und erst danach öffnet `inviteJoin`
 * den Tunnel (Spezifikation 6.2, 10.4 Schritt 3): ein Tunnel, der auf ein noch ladendes Spiel wartet, liefe in seine Fristen.
 * Fehler zeigen `usePlay` und die Mutation als Toast.
 */
function useStartJoin() {
  const qc = useQueryClient();
  const play = usePlay();
  const joinInvite = useJoinInvite();
  return async (inviteId: string, instanceId: string) => {
    const openFriendJoin = async () => {
      const { joinId, address } = await joinInvite.mutateAsync({ inviteId, instanceId });
      return { joinId, address };
    };
    try {
      const instance = await qc.fetchQuery({ queryKey: instanceKeys.detail(instanceId), queryFn: () => api.getInstance(instanceId) });
      await play(instance, undefined, null, openFriendJoin);
    } catch (error) {
      toastError(error as Error);
    }
  };
}

/** Der Dialog einer Einladung; verschwindet die Einladung (widerrufen, abgelaufen, abgelehnt), schließt er. */
function InviteHost({ inviteId, onJoin }: { inviteId: string; onJoin: (instanceId: string) => void }) {
  const invites = useInvites();
  const invite = invites.data?.find((known) => known.id === inviteId);
  const gone = invites.data !== undefined && !invite;
  useEffect(() => {
    if (gone) closeFriendDialog();
  }, [gone]);
  useEffect(() => void toast.dismiss(inviteToastId(inviteId)), [inviteId]);
  return invite && <InviteDialog invite={invite} onJoin={onJoin} onClose={closeFriendDialog} />;
}

/**
 * Die globalen Dialoge der Freunde, einmal im Layout: Einladungen und die Bitte der Mod, von jeder Seite aus erreichbar.
 * Es ist immer nur einer offen; was dazukommt, wartet (`useFriendsUi().dialogs`).
 */
export function FriendDialogs() {
  const { active, waiting } = useFriendsUi((state) => state.dialogs);
  const startJoin = useStartJoin();
  useInviteRequests();
  useOpenWhenFree(active === null && waiting.length > 0);

  if (active?.kind === "invite") {
    const { inviteId } = active;
    const join = (instanceId: string) => {
      closeFriendDialog();
      void startJoin(inviteId, instanceId);
    };
    return <InviteHost key={inviteId} inviteId={inviteId} onJoin={join} />;
  }
  if (active?.kind === "modConfirm") return <ModConfirmDialog key={active.confirm.requestId} confirm={active.confirm} onClose={closeFriendDialog} />;
  return null;
}
