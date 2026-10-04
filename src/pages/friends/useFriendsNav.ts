import { useEffect } from "react";
import { useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router";
import { FRIENDS_PATH } from "@/app/mainTabs";
import { friendKeys } from "@/hooks/queryKeys";
import { useFriendsState } from "@/hooks/useFriends";
import { api } from "@/lib/api";
import { toastError } from "@/lib/toast";
import type { Invite } from "@/lib/types";
import { friendsActive, friendsBadgeCount, modOpenDestination, type ModOpenDestination } from "./friendsModel";
import { requestInviteDialog } from "./inviteRequest";

/** Der Reiter „Freunde“ in den Einstellungen (pages/Settings.tsx). */
const FRIENDS_SETTINGS_URL = "/settings?tab=freunde";

/**
 * Was die Seitenleiste von Freunden zeigt: ob der Eintrag fehlt (ohne Schlüsselbund gibt es keine Freunde) und die Zahl daran.
 * Die Listen fragt nur, wer Freunde eingeschaltet hat; ein ausgeschaltetes Backend soll dafür nicht angefragt werden.
 */
export function useFriendsNav() {
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

const friendsUrl = (anchor: string | null) => (anchor ? `${FRIENDS_PATH}#${anchor}` : FRIENDS_PATH);

/** Die älteste offene Einladung; sie kommt aus dem Zwischenspeicher oder, wenn die Seite sie noch nicht geladen hat, vom Backend. */
async function oldestInvite(qc: QueryClient): Promise<Invite | undefined> {
  const invites = await qc.fetchQuery({ queryKey: friendKeys.invites, queryFn: api.invitesList });
  return invites[0];
}

/**
 * `friends-mod-open`: die Mod bittet, die Freunde zu zeigen. Das Fenster holt das Backend selbst nach vorn (und nie, solange ein
 * Dialog offen ist); hier geht die Oberfläche an die Stelle, die das Ziel nennt. Einmal im Layout einhängen.
 */
export function useModOpenNavigation() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  useEffect(() => {
    const show = async (destination: ModOpenDestination) => {
      if (destination.page === "settings") return navigate(FRIENDS_SETTINGS_URL);
      navigate(friendsUrl(destination.anchor));
      const invite = destination.showInvite ? await oldestInvite(qc) : undefined;
      if (invite) requestInviteDialog(invite.id);
    };
    const subscription = api.onFriendsModOpen(({ target }) => void show(modOpenDestination(target)).catch(toastError));
    return () => void subscription.then((unlisten) => unlisten());
  }, [navigate, qc]);
}
