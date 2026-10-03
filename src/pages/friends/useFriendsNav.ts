import { useQuery } from "@tanstack/react-query";
import { friendKeys } from "@/hooks/queryKeys";
import { useFriendsState } from "@/hooks/useFriends";
import { api } from "@/lib/api";
import { friendsActive, friendsBadgeCount } from "./friendsModel";
import { useFriendsLive } from "./useFriendsLive";

/**
 * Was die Seitenleiste von Freunden zeigt: ob der Eintrag fehlt (ohne Schlüsselbund gibt es keine Freunde) und die Zahl daran.
 * Die Listen fragt nur, wer Freunde eingeschaltet hat; ein ausgeschaltetes Backend soll dafür nicht angefragt werden.
 */
export function useFriendsNav() {
  useFriendsLive();
  const state = useFriendsState().data;
  const active = friendsActive(state);
  const requests = useQuery({ queryKey: friendKeys.requests, queryFn: api.friendRequests, enabled: active }).data;
  const invites = useQuery({ queryKey: friendKeys.invites, queryFn: api.invitesList, enabled: active }).data;
  const friends = useQuery({ queryKey: friendKeys.list, queryFn: api.friendsList, enabled: active }).data;
  return {
    hidden: state?.availability === "noSecretStore",
    badge: active ? friendsBadgeCount(requests ?? [], invites ?? [], friends ?? []) : 0,
  };
}
