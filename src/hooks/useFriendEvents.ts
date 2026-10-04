import { useEffect } from "react";
import { useQueryClient, type QueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { activityText, withActivity } from "@/components/friends/modRequestModel";
import { opText } from "@/components/friends/modRequestText";
import { t, type TKey } from "@/i18n/core";
import { api } from "@/lib/api";
import { ACTION_TOAST_MS } from "@/lib/toast";
import type {
  Friend, FriendPresenceEvent, FriendRequest, FriendRequestRefusedEvent, FriendsState, HostSession, IngameFailedEvent, Invite, InviteRevokedEvent,
  JoinSessionEvent, LanEvent, ModActivityEntry, NetworkStatus, RequestRefusal,
} from "@/lib/types";
import { requestInviteDialog } from "@/pages/friends/inviteRequest";
import { useModOpenNavigation } from "@/pages/friends/useFriendsNav";
import { applyJoinSession, dropInviteDialog, queueFriendDialog, queueModConfirm } from "@/store/friendsUi";
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

const withoutRequest = (requestId: string) => (requests: FriendRequest[] | undefined) =>
  requests?.filter((request) => request.id !== requestId);

/** Warum der Besitzer des Codes eine eigene Anfrage endgültig abgelehnt hat; die Texte sind die der Fehlermeldungen beim Einlösen. */
const REFUSAL_REASONS: Record<RequestRefusal, TKey> = {
  codeUsed: "errors.friends.codeUsed",
  alreadyFriends: "errors.friends.alreadyFriends",
  unsupported: "errors.friends.protocolUnsupported",
};

/** Die Gegenseite der Anfrage: der Minecraft-Name, bei einem Code seine letzten Zeichen. */
const requestTarget = ({ mcName, codeTail }: FriendRequest) =>
  mcName ?? (codeTail ? t("friends.requests.codeTitle", { tail: codeTail }) : t("friends.requests.codeTitleNoTail"));

/** Die Anfrage ist im Backend schon gelöscht: sie verschwindet sofort aus der Liste, und ein Toast sagt, woran sie scheiterte. */
function onRequestRefused(qc: QueryClient, { request, reason }: FriendRequestRefusedEvent) {
  qc.setQueryData(friendKeys.requests, withoutRequest(request.id));
  void qc.invalidateQueries({ queryKey: friendKeys.requests });
  toast.warning(t("friends.requests.refused", { target: requestTarget(request), reason: t(REFUSAL_REASONS[reason]) }));
}

/**
 * Ein Vorgang aus dem Spiel: vorn in die Liste und als Toast; ein Vorgang, der nicht lief, als Warnung. Ist die Liste noch nicht
 * geladen, holt das Backend sie samt diesem Vorgang: ein Eintrag allein gälte sonst als ganze, frische Liste.
 */
function onModActivity(qc: QueryClient, entry: ModActivityEntry) {
  if (qc.getQueryData(friendKeys.modActivity)) qc.setQueryData(friendKeys.modActivity, (list: ModActivityEntry[] = []) => withActivity(list, entry));
  else void qc.invalidateQueries({ queryKey: friendKeys.modActivity });
  const show = entry.ok ? toast : toast.warning;
  show(t(entry.ok ? "friends.activity.toast" : "friends.activity.toastFailed", { text: opText(activityText(entry)) }));
}

/** Das Freunde-Menü hat den Start vermutlich zum Absturz gebracht: der Launcher hat es ausgeschaltet und fragt, wie es weitergeht. */
const onIngameFailed = ({ instanceId, reason }: IngameFailedEvent) => queueFriendDialog({ kind: "breaker", instanceId, reason });

/**
 * Hält alles aktuell, was Freunde im Backend ändern, auf jeder Seite: `friends-changed` lädt die Freunde-Abfragen neu,
 * Anwesenheit, Netzstatus, Einladungen, geteilte Welt und LAN-Port ändern nur den einen Wert im Zwischenspeicher.
 * Einmal im Layout einhängen.
 */
export function useFriendEvents() {
  const qc = useQueryClient();
  useModOpenNavigation();
  useEffect(() => {
    const subs = [
      api.onFriendsChanged(() => void qc.invalidateQueries({ queryKey: friendKeys.all })),
      api.onFriendRequest(() => void qc.invalidateQueries({ queryKey: friendKeys.requests })),
      api.onFriendRequestRefused((event) => onRequestRefused(qc, event)),
      api.onFriendPresence((event) => qc.setQueryData(friendKeys.list, withPresence(event))),
      api.onFriendsNetwork((network) => qc.setQueryData(friendKeys.state, withNetwork(network))),
      api.onFriendInvite(({ invite }) => onInvite(qc, invite)),
      api.onFriendInviteRevoked((event) => onInviteRevoked(qc, event)),
      api.onHostSession(({ session }) => qc.setQueryData(friendKeys.hostSessions, withSession(session))),
      api.onHostSessionEnded(({ sessionId }) => qc.setQueryData(friendKeys.hostSessions, withoutSession(sessionId))),
      api.onJoinSession(onJoinSession),
      api.onLanChanged((event) => qc.setQueryData(friendKeys.lan(event.instanceId), withLan(event))),
      api.onFriendsMod(({ instanceId }) => void qc.invalidateQueries({ queryKey: friendKeys.modStatus(instanceId) })),
      api.onFriendsModConfirm(queueModConfirm),
      api.onFriendsModActivity((entry) => onModActivity(qc, entry)),
      api.onFriendsIngameFailed(onIngameFailed),
    ];
    return () => subs.forEach((p) => p.then((unlisten) => unlisten()));
  }, [qc]);
}
