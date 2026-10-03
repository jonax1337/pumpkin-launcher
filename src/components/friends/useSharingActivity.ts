import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { friendKeys } from "@/hooks/queryKeys";
import { useFriendsState } from "@/hooks/useFriends";
import { api } from "@/lib/api";
import type { HostSession } from "@/lib/types";
import { friendsActive } from "@/pages/friends/friendsModel";
import { hostNameOf, nextJoin, type ActiveJoin } from "./sharingModel";

export type SharingActivity = { session: HostSession | undefined; join: ActiveJoin | null };

const endedSession = (sessionId: string) => (sessions: HostSession[] | undefined) => sessions?.filter((s) => s.id !== sessionId);

/**
 * Was gerade geteilt wird oder wem man beigetreten ist, und hält es über die Ereignisse aktuell. Die Fensterleiste hängt es
 * für die ganze App ein; Abschnitt „Teilen“, Chip und Rückfrage beim Schließen lesen denselben Stand.
 * Auch LAN-Port und Mod-Verbindung der Instanzen laufen hier ein, denn nur die Leiste ist immer da.
 */
export function useSharingActivity(): SharingActivity {
  const qc = useQueryClient();
  const active = friendsActive(useFriendsState().data);
  const sessions = useQuery({ queryKey: friendKeys.hostSessions, queryFn: api.hostSessions, enabled: active }).data;
  const [join, setJoin] = useState<ActiveJoin | null>(null);
  useEffect(() => {
    const subs = [
      api.onHostSession(({ session }) => qc.setQueryData(friendKeys.hostSessions, [session])),
      api.onHostSessionEnded(({ sessionId }) => qc.setQueryData(friendKeys.hostSessions, endedSession(sessionId))),
      api.onLanChanged(({ instanceId, lan }) => qc.setQueryData(friendKeys.lan(instanceId), lan)),
      api.onFriendsMod(({ instanceId }) => void qc.invalidateQueries({ queryKey: friendKeys.modStatus(instanceId) })),
      api.onJoinSession((event) =>
        setJoin((current) => nextJoin(current, event, hostNameOf(qc.getQueryData(friendKeys.invites), event.inviteId)))),
    ];
    return () => subs.forEach((subscription) => subscription.then((unlisten) => unlisten()));
  }, [qc]);
  return { session: active ? sessions?.[0] : undefined, join };
}
