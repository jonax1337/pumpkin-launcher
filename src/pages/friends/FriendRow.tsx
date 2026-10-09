import { toast } from "sonner";
import { FriendAvatar, SelfAsserted } from "@/components/friends/FriendAvatar";
import { useAcknowledgeFriend, useInviteGuests } from "@/hooks/useFriends";
import { useI18n, type TKey } from "@/i18n";
import { relativeTime } from "@/lib/format";
import type { Friend, HostSession, Invite } from "@/lib/types";
import { cn } from "@/lib/utils";
import { Button, Cell, Chip, Icon, IconButton, ListRow, Menu, RowTitle, StatusDot, Tip, type MenuEntry } from "@/ui";
import { canInvite, friendName } from "./friendsModel";
import { requestInviteDialog } from "./inviteRequest";
import type { FriendActions } from "./useFriendDialogs";

const SECOND_MS = 1000;

/**
 * Im schmalen Bereich der Liste (Container „friends-list“, bis 640 px; siehe FriendsContent): drei Spalten, Name oben, darunter Status,
 * dann die Aktion; das Menü rückt in die Ecke. Eine Hinweiszeile nimmt die ganze Breite und lässt die erste Spalte weg.
 */
const NARROW = {
  row: "@max-[640px]/friends-list:grid-cols-[40px_minmax(0,1fr)_36px] @max-[640px]/friends-list:gap-2 @max-[640px]/friends-list:py-3",
  presence: "@max-[640px]/friends-list:col-2 @max-[640px]/friends-list:row-2 @max-[640px]/friends-list:flex-wrap",
  action: "@max-[640px]/friends-list:col-2 @max-[640px]/friends-list:row-3 @max-[640px]/friends-list:justify-start",
  menu: "@max-[640px]/friends-list:col-3 @max-[640px]/friends-list:row-1",
  noteLead: "@max-[640px]/friends-list:hidden",
  noteText: "@max-[640px]/friends-list:col-[1/-1]",
  noteAction: "@max-[640px]/friends-list:col-[1/-1] @max-[640px]/friends-list:justify-start",
} as const;

const PRESENCE_LABEL: Record<Friend["presence"], TKey> = {
  offline: "friends.presence.offline",
  online: "friends.presence.online",
  playing: "friends.presence.playing",
};

/** Die Zeile unter dem Namen: wer wo steht, oder warum noch nichts zu sehen ist. */
function useSubline() {
  const { t } = useI18n();
  return (friend: Friend): string => {
    if (friend.removedByPeer) return t("friends.sub.removedByPeer");
    if (!friend.confirmed) return t("friends.sub.unconfirmed", { name: friendName(friend) });
    if (friend.presence === "playing") return t("friends.sub.playing");
    if (friend.presence === "online") return t("friends.sub.online");
    return friend.lastSeen ? t("friends.sub.lastSeen", { time: relativeTime(friend.lastSeen * SECOND_MS) }) : t("friends.sub.offline");
  };
}

/** Anwesenheit: Bei bestätigten Freunden steht sie schon (farbig) in der Zeile unter dem Namen und am Punkt des Kopfes; der Chip nennt sie nur, wo die Zeile etwas anderes sagt. „Relay“ dahinter, wenn die Verbindung nicht direkt ist. */
function PresenceCell({ friend, className }: { friend: Friend; className?: string }) {
  const { t } = useI18n();
  const tone = friend.presence === "playing" ? "acc" : friend.presence === "online" ? "run" : undefined;
  return (
    <Cell flex className={className}>
      {!friend.confirmed && <Chip size="s" tone={tone}>{t(PRESENCE_LABEL[friend.presence])}</Chip>}
      {friend.path === "relay" && (
        <Tip label={t("friends.path.relayTip")} describe>
          <Chip size="s">{t("friends.path.relay")}</Chip>
        </Tip>
      )}
    </Cell>
  );
}

/** „Beitreten“ bei einer offenen Einladung, sonst „Einladen“, solange ich teile und der Freund online ist. */
function ActionCell({ friend, label, invite, session, className }: { friend: Friend; label: string; invite: Invite | undefined; session: HostSession | undefined; className?: string }) {
  const { t } = useI18n();
  return (
    <Cell flex align="end" className={className}>
      {invite ? (
        <Button size="s" variant="primary" icon="play" onClick={() => requestInviteDialog(invite.id)}>{t("friends.action.join")}</Button>
      ) : (
        session && canInvite(friend, session) && <InviteButton friend={friend} label={label} session={session} />
      )}
    </Cell>
  );
}

/** Während des Sendens nennt der Knopf den Vorgang; danach verschwindet er (der Freund ist eingeladen), darum bestätigt ein Toast. */
function InviteButton({ friend, label, session }: { friend: Friend; label: string; session: HostSession }) {
  const { t } = useI18n();
  const inviteGuests = useInviteGuests();
  // Der Knopf ist beim Abschluss schon weg, deshalb kein Callback von `mutate`; Fehler meldet der zentrale Mutations-Handler.
  const invite = () =>
    inviteGuests
      .mutateAsync({ sessionId: session.id, friendIds: [friend.id] })
      .then(() => toast.success(t("friends.action.invited", { name: label })), () => undefined);
  return (
    <Button size="s" icon="share" disabled={inviteGuests.isPending} onClick={invite}>
      {inviteGuests.isPending ? t("friends.action.inviting") : t("friends.action.invite")}
    </Button>
  );
}

function RowMenu({ friend, label, actions, className }: { friend: Friend; label: string; actions: FriendActions; className?: string }) {
  const { t } = useI18n();
  const person = { id: friend.id, name: label };
  const items: MenuEntry[] = [
    { id: "rename", text: t("common.rename"), icon: "edit", onSelect: () => actions.rename(friend) },
    { id: "fingerprint", text: t("friends.menu.fingerprint"), icon: "eye", onSelect: () => actions.showFingerprint(friend, label) },
    "-",
    { id: "remove", text: t("common.remove"), icon: "trash", bad: true, onSelect: () => actions.askRemove(person) },
    { id: "block", text: t("friends.menu.block"), icon: "stop", bad: true, onSelect: () => actions.askBlock(person) },
  ];
  return (
    <Menu
      trigger={<IconButton icon="more" size="s" className={className} label={t("components.instance.moreActionsFor", { name: label })} tip={t("components.instance.moreActions")} />}
      items={items}
    />
  );
}

/** Ein Freund; ein offener Hinweis (Umbenennung, neue Identität) steht als eigene Zeile darunter. */
export function FriendRow({ friend, label, invite, session, actions }: {
  friend: Friend; label: string; invite: Invite | undefined; session: HostSession | undefined; actions: FriendActions;
}) {
  const { t } = useI18n();
  const subline = useSubline();
  const gone = friend.removedByPeer;
  const onNow = !gone && (friend.presence === "online" || friend.presence === "playing");
  return (
    <>
      <ListRow off={gone} className={NARROW.row}>
        <span className="relative grid place-items-center">
          <FriendAvatar friendId={friend.id} name={friendName(friend)} />
          {!gone && <StatusDot tone={onNow ? "run" : undefined} />}
        </span>
        <SelfAsserted><RowTitle title={label} sub={onNow ? <span className="text-(color:--run)">{subline(friend)}</span> : subline(friend)} /></SelfAsserted>
        {gone ? <span className={NARROW.presence} /> : <PresenceCell friend={friend} className={NARROW.presence} />}
        {gone ? (
          <Cell flex align="end" className={NARROW.action}>
            <Button size="s" onClick={() => actions.askRemove({ id: friend.id, name: label })}>{t("common.remove")}</Button>
          </Cell>
        ) : (
          <ActionCell friend={friend} label={label} invite={invite} session={session} className={NARROW.action} />
        )}
        {gone ? <span className={NARROW.menu} /> : <RowMenu friend={friend} label={label} actions={actions} className={NARROW.menu} />}
      </ListRow>
      {friend.notice && <NoticeRow friend={friend} label={label} />}
    </>
  );
}

function NoticeRow({ friend, label }: { friend: Friend; label: string }) {
  const { t } = useI18n();
  const acknowledge = useAcknowledgeFriend();
  const notice = friend.notice!;
  const identityChanged = notice.type === "identityChanged";
  const text = identityChanged
    ? t("friends.notice.identityChanged", { name: label })
    : t("friends.notice.renamed", { previous: notice.previousName, name: label });
  return (
    <ListRow tone={identityChanged ? "warn" : "run"} className={cn("min-h-11 py-1.5", NARROW.row)}>
      <span className={NARROW.noteLead} />
      <span className={cn("friends-notice col-[2/4]", NARROW.noteText)}>
        <Icon name={identityChanged ? "warn" : "info"} size="s" tone={identityChanged ? "warn" : undefined} />
        <span>{text}</span>
      </span>
      <Cell flex align="end" className={NARROW.noteAction}>
        <Button size="s" disabled={acknowledge.isPending} onClick={() => acknowledge.mutate(friend.id)}>{t("friends.notice.ok")}</Button>
      </Cell>
    </ListRow>
  );
}
