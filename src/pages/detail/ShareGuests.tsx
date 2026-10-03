import { useMemo } from "react";
import { ConnectionText } from "@/components/friends/ConnectionText";
import { FriendAvatar } from "@/components/friends/FriendAvatar";
import { canKick, canReinvite, guestStatus, type GuestStatus } from "@/components/friends/sharingModel";
import { useFriendsList, useInviteGuests, useKickGuest } from "@/hooks/useFriends";
import { useI18n, type TKey } from "@/i18n";
import type { HostSession, SessionGuest } from "@/lib/types";
import { friendLabels } from "@/pages/friends/friendsModel";
import { Button, Cell, Chip, IconButton, List, ListRow, Menu, RowTitle } from "@/ui";

const STATUS_LABEL: Record<GuestStatus, TKey> = {
  invited: "friendsHost.guest.invited",
  connected: "friendsHost.guest.connected",
  declined: "friendsHost.guest.declined",
  kicked: "friendsHost.guest.kicked",
  left: "friendsHost.guest.left",
};

/** Die Gäste der Sitzung mit Zustand, Weg und Antwortzeit; abgelehnte und entfernte lassen sich erneut einladen. */
export function ShareGuests({ session }: { session: HostSession }) {
  const { t } = useI18n();
  const friends = useFriendsList().data;
  const labels = useMemo(() => friendLabels(friends ?? []), [friends]);
  return (
    <List variant="friends" className="mt-3" aria-label={t("friendsHost.share.guestsLabel")}>
      {session.guests.map((guest) => (
        <GuestRow key={guest.friendId} sessionId={session.id} guest={guest} label={labels.get(guest.friendId) ?? guest.displayName} />
      ))}
    </List>
  );
}

function GuestRow({ sessionId, guest, label }: { sessionId: string; guest: SessionGuest; label: string }) {
  const { t } = useI18n();
  const invite = useInviteGuests();
  const kick = useKickGuest();
  const status = guestStatus(guest);
  return (
    <ListRow>
      <span className="grid place-items-center"><FriendAvatar friendId={guest.friendId} name={guest.displayName} /></span>
      <RowTitle title={label} sub={guest.path && <ConnectionText path={guest.path} rttMs={guest.rttMs} />} />
      <Cell flex>
        <Chip size="s" dot tone={status === "connected" ? "run" : undefined}>{t(STATUS_LABEL[status])}</Chip>
      </Cell>
      <Cell flex align="end">
        {canReinvite(guest) && (
          <Button size="s" icon="share" disabled={invite.isPending} onClick={() => invite.mutate({ sessionId, friendIds: [guest.friendId] })}>
            {t("friendsHost.guest.reinvite")}
          </Button>
        )}
      </Cell>
      {canKick(guest) ? (
        <Menu
          trigger={<IconButton icon="more" size="s" label={t("components.instance.moreActionsFor", { name: label })} tip={t("components.instance.moreActions")} />}
          items={[{ id: "kick", text: t("friendsHost.guest.kick"), icon: "x", bad: true, disabled: kick.isPending, onSelect: () => kick.mutate({ sessionId, friendId: guest.friendId }) }]}
        />
      ) : (
        <span />
      )}
    </ListRow>
  );
}
