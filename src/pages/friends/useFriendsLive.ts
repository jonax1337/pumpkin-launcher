import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { friendKeys } from "@/hooks/queryKeys";
import { api } from "@/lib/api";
import type { Friend, FriendPresenceEvent, FriendsState, NetworkStatus } from "@/lib/types";

const withPresence = ({ friendId, presence, path }: FriendPresenceEvent) => (friends: Friend[] | undefined) =>
  friends?.map((friend) => (friend.id === friendId ? { ...friend, presence, path } : friend));

const withNetwork = (network: NetworkStatus) => (state: FriendsState | undefined) => state && { ...state, network };

/**
 * Hält Liste, Anfragen und Netzstatus aktuell, solange die Seitenleiste steht: `friends-changed` und neue Anfragen laden neu,
 * Anwesenheit und Netzstatus ändern nur den einen Wert im Zwischenspeicher.
 */
export function useFriendsLive() {
  const qc = useQueryClient();
  useEffect(() => {
    const subs = [
      api.onFriendsChanged(() => void qc.invalidateQueries({ queryKey: friendKeys.all })),
      api.onFriendRequest(() => void qc.invalidateQueries({ queryKey: friendKeys.requests })),
      api.onFriendPresence((event) => qc.setQueryData(friendKeys.list, withPresence(event))),
      api.onFriendsNetwork((network) => qc.setQueryData(friendKeys.state, withNetwork(network))),
    ];
    return () => subs.forEach((p) => p.then((unlisten) => unlisten()));
  }, [qc]);
}
