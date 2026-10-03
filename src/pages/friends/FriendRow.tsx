import { FriendAvatar, SelfAsserted } from "@/components/friends/FriendAvatar";
import { useAcknowledgeFriend, useInviteGuests } from "@/hooks/useFriends";
import { useI18n, type TKey } from "@/i18n";
import { relativeTime } from "@/lib/format";
import type { Friend, HostSession, Invite } from "@/lib/types";
import { Button, Cell, Chip, Icon, IconButton, ListRow, Menu, RowTitle, Tip, type MenuEntry } from "@/ui";
import { canInvite } from "./friendsModel";
import { requestInviteDialog } from "./inviteRequest";
import type { FriendActions } from "./useFriendDialogs";

const SECOND_MS = 1000;

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
    if (!friend.confirmed) return t("friends.sub.unconfirmed", { name: friend.displayName });
    if (friend.presence === "playing") return t("friends.sub.playing");
    if (friend.presence === "online") return t("friends.sub.online");
    return friend.lastSeen ? t("friends.sub.lastSeen", { time: relativeTime(friend.lastSeen * SECOND_MS) }) : t("friends.sub.offline");
  };
}

/** Anwesenheit als Punkt und Text, nie nur als Farbe; „Relay“ dahinter, wenn die Verbindung nicht direkt ist. */
function PresenceCell({ friend }: { friend: Friend }) {
  const { t } = useI18n();
  const tone = friend.presence === "playing" ? "acc" : friend.presence === "online" ? "run" : undefined;
  return (
    <Cell flex>
      <Chip size="s" dot tone={tone}>{t(PRESENCE_LABEL[friend.presence])}</Chip>
      {friend.path === "relay" && (
        <Tip label={t("friends.path.relayTip")} describe>
          <Chip size="s">{t("friends.path.relay")}</Chip>
        </Tip>
      )}
    </Cell>
  );
}

/** „Beitreten“ bei einer offenen Einladung, sonst „Einladen“, solange ich teile und der Freund online ist. */
function ActionCell({ friend, invite, session }: { friend: Friend; invite: Invite | undefined; session: HostSession | undefined }) {
  const { t } = useI18n();
  return (
    <Cell flex align="end">
      {invite ? (
        <Button size="s" variant="primary" icon="play" onClick={() => requestInviteDialog(invite.id)}>{t("friends.action.join")}</Button>
      ) : (
        session && canInvite(friend, session) && <InviteButton friend={friend} session={session} />
      )}
    </Cell>
  );
}

function InviteButton({ friend, session }: { friend: Friend; session: HostSession }) {
  const { t } = useI18n();
  const inviteGuests = useInviteGuests();
  return (
    <Button size="s" icon="share" disabled={inviteGuests.isPending} onClick={() => inviteGuests.mutate({ sessionId: session.id, friendIds: [friend.id] })}>
      {t("friends.action.invite")}
    </Button>
  );
}

function RowMenu({ friend, label, actions }: { friend: Friend; label: string; actions: FriendActions }) {
  const { t } = useI18n();
  const person = { id: friend.id, name: label };
  const items: MenuEntry[] = [
    { id: "rename", text: t("common.rename"), icon: "file", onSelect: () => actions.rename(friend) },
    { id: "fingerprint", text: t("friends.menu.fingerprint"), icon: "eye", onSelect: () => actions.showFingerprint(friend, label) },
    "-",
    { id: "remove", text: t("common.remove"), icon: "trash", bad: true, onSelect: () => actions.askRemove(person) },
    { id: "block", text: t("friends.menu.block"), icon: "stop", bad: true, onSelect: () => actions.askBlock(person) },
  ];
  return (
    <Menu
      trigger={<IconButton icon="more" size="s" label={t("components.instance.moreActionsFor", { name: label })} tip={t("components.instance.moreActions")} />}
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
  return (
    <>
      <ListRow off={gone}>
        <span className="grid place-items-center"><FriendAvatar friendId={friend.id} name={friend.displayName} /></span>
        <SelfAsserted><RowTitle title={label} sub={subline(friend)} /></SelfAsserted>
        {gone ? <span /> : <PresenceCell friend={friend} />}
        {gone ? (
          <Cell flex align="end">
            <Button size="s" onClick={() => actions.askRemove({ id: friend.id, name: label })}>{t("common.remove")}</Button>
          </Cell>
        ) : (
          <ActionCell friend={friend} invite={invite} session={session} />
        )}
        {gone ? <span /> : <RowMenu friend={friend} label={label} actions={actions} />}
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
    <ListRow data-note="" data-tone={identityChanged ? "warn" : undefined}>
      <span />
      <span className="flex min-w-0 items-center gap-2 text-[13px] text-fg-2">
        <Icon name={identityChanged ? "warn" : "info"} size="s" tone={identityChanged ? "warn" : undefined} />
        <span className="min-w-0">{text}</span>
      </span>
      <Cell flex align="end">
        <Button size="s" disabled={acknowledge.isPending} onClick={() => acknowledge.mutate(friend.id)}>{t("friends.notice.ok")}</Button>
      </Cell>
    </ListRow>
  );
}
