import { useMutation, useQuery, useQueryClient, type MutationMeta } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type { FriendsEnableInput, FriendsSettings, FriendsState } from "@/lib/types";
import { MINUTE } from "@/lib/time";
import { setFriendsEnabled } from "@/store/friendsUi";
import { friendKeys } from "./queryKeys";

/** Skins ändern sich selten, und das Backend hält sie ohnehin 24 Stunden im Zwischenspeicher. */
const FRIEND_SKIN_STALE_MS = 60 * MINUTE;

/** Holt den Stand und spiegelt `enabled` für den Spielstart, auch wenn gerade keine Seite die Abfrage zeigt. */
async function fetchFriendsState(): Promise<FriendsState> {
  const state = await api.friendsState();
  setFriendsEnabled(state.enabled);
  return state;
}

export const useFriendsState = () => useQuery({ queryKey: friendKeys.state, queryFn: fetchFriendsState });

export const useFriendsList = () => useQuery({ queryKey: friendKeys.list, queryFn: api.friendsList });

export const useFriendRequests = () => useQuery({ queryKey: friendKeys.requests, queryFn: api.friendRequests });

export const useFriendCodes = () => useQuery({ queryKey: friendKeys.codes, queryFn: api.friendCodes });

export const useBlockedPeers = () => useQuery({ queryKey: friendKeys.blocked, queryFn: api.friendsBlocked });

export const useInvites = () => useQuery({ queryKey: friendKeys.invites, queryFn: api.invitesList });

export const useHostSessions = () => useQuery({ queryKey: friendKeys.hostSessions, queryFn: api.hostSessions });

/** Skin des Freundes als data:-URL; `null`, solange keiner bekannt ist. Mojang fragt nur das Backend. */
export function useFriendSkin(friendId: string) {
  return useQuery({
    queryKey: friendKeys.skin(friendId),
    queryFn: () => api.friendSkin(friendId),
    staleTime: FRIEND_SKIN_STALE_MS,
    retry: false,
  }).data;
}

/**
 * Abgleich einer Einladung mit den eigenen Instanzen; das Backend fordert dafür beim Gastgeber das Manifest an.
 * Er gilt nur für den Augenblick (`staleTime: 0`): wer den Dialog erneut öffnet, hat seine Mods inzwischen vielleicht geändert.
 */
export function useInvitePlan(inviteId: string | null) {
  return useQuery({
    queryKey: friendKeys.plan(inviteId ?? ""),
    queryFn: () => api.invitePlan(inviteId!),
    enabled: inviteId != null,
    staleTime: 0,
    retry: false,
  });
}

/** Geprüfter LAN-Port der Instanz; `lan-changed` hält ihn aktuell. */
export const useLanStatus = (instanceId: string) =>
  useQuery({ queryKey: friendKeys.lan(instanceId), queryFn: () => api.lanStatus(instanceId) });

export const useFriendsModStatus = (instanceId: string) =>
  useQuery({ queryKey: friendKeys.modStatus(instanceId), queryFn: () => api.friendsModStatus(instanceId) });

/** Änderung an Freunden, Anfragen, Codes oder Sitzungen; danach lädt alles unter `friendKeys.all` neu. */
function useFriendsChange<V = void, R = unknown>(change: (v: V) => Promise<R>, meta?: MutationMeta) {
  const qc = useQueryClient();
  return useMutation({ mutationFn: change, meta, onSuccess: () => qc.invalidateQueries({ queryKey: friendKeys.all }) });
}

/** Änderung, die den neuen Gesamtstand zurückgibt; er ersetzt den Stand der Abfrage sofort. */
function useStateChange<V = void>(change: (v: V) => Promise<FriendsState>) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: change,
    onSuccess: (state) => {
      qc.setQueryData(friendKeys.state, state);
      setFriendsEnabled(state.enabled);
      return qc.invalidateQueries({ queryKey: friendKeys.all });
    },
  });
}

export const useEnableFriends = () => useStateChange((input: FriendsEnableInput) => api.friendsEnable(input));

export const useDisableFriends = () => useStateChange(api.friendsDisable);

export const useUpdateFriendsSettings = () => useStateChange((settings: FriendsSettings) => api.friendsUpdateSettings(settings));

export const useRotateFriendsIdentity = () => useStateChange(api.friendsRotateIdentity);

export const useResetFriends = () => useStateChange(api.friendsReset);

export const useCreateFriendCode = () => useFriendsChange(api.friendCodeCreate);

export const useRevokeFriendCode = () => useFriendsChange(api.friendCodeRevoke);

export const useAddFriend = () => useFriendsChange(api.friendAdd);

/** Den Fehler meldet der Dialog selbst: „nicht auffindbar“ steht dort als Hinweis mit Ausweg, nicht als Toast. */
export const useAddFriendByName = () => useFriendsChange(api.friendAddByName, { ownErrorToast: true });

export const useAnswerFriendRequest = () =>
  useFriendsChange(({ requestId, accept }: { requestId: string; accept: boolean }) => api.friendRequestAnswer(requestId, accept));

export const useCancelFriendRequest = () => useFriendsChange(api.friendRequestCancel);

export const useRenameFriend = () =>
  useFriendsChange(({ friendId, alias }: { friendId: string; alias: string | null }) => api.friendRename(friendId, alias));

export const useAcknowledgeFriend = () => useFriendsChange(api.friendAcknowledge);

export const useRemoveFriend = () => useFriendsChange(api.friendRemove);

export const useBlockPeer = () => useFriendsChange(api.friendBlock);

export const useUnblockPeer = () => useFriendsChange(api.friendUnblock);

/** Stellt sofort zu; was dabei passiert, meldet `friends-changed`. */
export const useRetryFriendsNow = () => useMutation({ mutationFn: api.friendsRetryNow });

export const useStartHosting = () =>
  useFriendsChange(({ instanceId, port, showWorldName }: { instanceId: string; port: number | null; showWorldName: boolean }) =>
    api.hostStart(instanceId, port, showWorldName));

export const useInviteGuests = () =>
  useFriendsChange(({ sessionId, friendIds }: { sessionId: string; friendIds: string[] }) => api.hostInvite(sessionId, friendIds));

export const useKickGuest = () =>
  useFriendsChange(({ sessionId, friendId }: { sessionId: string; friendId: string }) => api.hostKick(sessionId, friendId));

export const useStopHosting = () => useFriendsChange(api.hostStop);

export const useDeclineInvite = () => useFriendsChange(api.inviteDecline);

export const useJoinInvite = () =>
  useMutation({ mutationFn: ({ inviteId, instanceId }: { inviteId: string; instanceId: string }) => api.inviteJoin(inviteId, instanceId) });

export const useLeaveJoin = () => useMutation({ mutationFn: api.joinLeave });

export const useConfirmFriendsMod = () =>
  useMutation({ mutationFn: ({ requestId, allow }: { requestId: string; allow: boolean }) => api.friendsModConfirm(requestId, allow) });
