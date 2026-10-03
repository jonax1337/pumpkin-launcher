import { useEffect } from "react";
import { useQueryClient, type QueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { t } from "@/i18n/core";
import { api } from "@/lib/api";
import { ACTION_TOAST_MS } from "@/lib/toast";
import type {
  Friend, FriendPresenceEvent, FriendsState, HostSession, Invite, InviteRevokedEvent, JoinSessionEvent, LanEvent, NetworkStatus,
} from "@/lib/types";
import { requestInviteDialog } from "@/pages/friends/inviteRequest";
import { applyJoinSession, dropInviteDialog, queueFriendDialog } from "@/store/friendsUi";
import { friendKeys } from "./queryKeys";

const withPresence = ({ friendId, presence, path }: FriendPresenceEvent) => (friends: Friend[] | undefined) =>
  friends?.map((friend) => (friend.id === friendId ? { ...friend, presence, path } : friend));

const withNetwork = (network: NetworkStatus) => (state: FriendsState | undefined) => state && { ...state, network };

const withInvite = (invite: Invite) => (invites: Invite[] | undefined) => invites && [...invites.filter((known) => known.id !== invite.id), invite];

const withoutInvite = (inviteId: string) => (invites: Invite[] | undefined) => invites?.filter((invite) => invite.id !== inviteId);

/** Der Host teilt höchstens eine Welt (8.4): das Ereignis ersetzt sie, ein Ende leert die Liste. */
const withSession = (session: HostSession) => () => [session];

const withoutSession = (sessionId: string) => (sessions: HostSession[] | undefined) => sessions?.filter((session) => session.id !== sessionId);

/** Der Toast einer Einladung; er verschwindet, sobald ihr Dialog offen ist, damit er dessen Knöpfe nicht verdeckt. */
export const inviteToastId = (inviteId: string) => `friend-invite-${inviteId}`;

/**
 * Eine neue Einladung: sofort in den Stand der Abfrage (der Dialog braucht sie gleich), als Toast und als Dialog, der wartet,
 * wenn gerade ein anderer offen ist. Das Neuladen holt nach, was das Ereignis nicht trägt.
 */
function onInvite(qc: QueryClient, invite: Invite) {
  qc.setQueryData(friendKeys.invites, withInvite(invite));
  void qc.invalidateQueries({ queryKey: friendKeys.invites });
  toast(t("friendsInvite.toast", { name: invite.fromName, title: invite.title }), {
    id: inviteToastId(invite.id),
    duration: ACTION_TOAST_MS,
    action: { label: t("friendsInvite.view"), onClick: () => requestInviteDialog(invite.id) },
  });
  queueFriendDialog({ kind: "invite", inviteId: invite.id });
}

/** Der Gastgeber nimmt die Einladung zurück: ihr Dialog schließt, und ein Toast sagt, wer aufgehört hat. */
function onInviteRevoked(qc: QueryClient, { inviteId }: InviteRevokedEvent) {
  const invite = qc.getQueryData<Invite[]>(friendKeys.invites)?.find((known) => known.id === inviteId);
  qc.setQueryData(friendKeys.invites, withoutInvite(inviteId));
  dropInviteDialog(inviteId);
  if (invite) toast(t("friendsInvite.revoked", { name: invite.fromName }));
}

/** Ein Beitritt ohne `left` endet nicht auf Wunsch des Nutzers: der Grund erscheint als Toast. */
function onJoinSession(event: JoinSessionEvent) {
  applyJoinSession(event);
  if (event.state.type !== "ended" || event.state.reason === "left") return;
  const message = t("friendsInvite.ended", { reason: t(`friendsInvite.end.${event.state.reason}`) });
  if (event.state.reason === "error") toast.error(message);
  else toast(message);
}

const withLan = ({ lan }: LanEvent) => () => lan;

/**
 * Hält alles aktuell, was Freunde im Backend ändern, auf jeder Seite: `friends-changed` lädt die Freunde-Abfragen neu,
 * Anwesenheit, Netzstatus, Einladungen, geteilte Welt und LAN-Port ändern nur den einen Wert im Zwischenspeicher.
 * Einmal im Layout einhängen.
 */
export function useFriendEvents() {
  const qc = useQueryClient();
  useEffect(() => {
    const subs = [
      api.onFriendsChanged(() => void qc.invalidateQueries({ queryKey: friendKeys.all })),
      api.onFriendRequest(() => void qc.invalidateQueries({ queryKey: friendKeys.requests })),
      api.onFriendPresence((event) => qc.setQueryData(friendKeys.list, withPresence(event))),
      api.onFriendsNetwork((network) => qc.setQueryData(friendKeys.state, withNetwork(network))),
      api.onFriendInvite(({ invite }) => onInvite(qc, invite)),
      api.onFriendInviteRevoked((event) => onInviteRevoked(qc, event)),
      api.onHostSession(({ session }) => qc.setQueryData(friendKeys.hostSessions, withSession(session))),
      api.onHostSessionEnded(({ sessionId }) => qc.setQueryData(friendKeys.hostSessions, withoutSession(sessionId))),
      api.onJoinSession(onJoinSession),
      api.onLanChanged((event) => qc.setQueryData(friendKeys.lan(event.instanceId), withLan(event))),
      api.onFriendsMod(({ instanceId }) => void qc.invalidateQueries({ queryKey: friendKeys.modStatus(instanceId) })),
      api.onFriendsModConfirm((confirm) => queueFriendDialog({ kind: "modConfirm", confirm })),
    ];
    return () => subs.forEach((p) => p.then((unlisten) => unlisten()));
  }, [qc]);
}
