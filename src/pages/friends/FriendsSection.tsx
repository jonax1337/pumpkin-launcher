import { useMemo, useState } from "react";
import { useI18n } from "@/i18n";
import type { Friend, HostSession, Invite } from "@/lib/types";
import { Empty, List, SearchField, SectionHeader, Segmented, Toolbar } from "@/ui";
import { AddFriendButtons, type AddFriendTab } from "./AddFriendDialog";
import { FriendRow } from "./FriendRow";
import { friendLabels, inviteFrom, visibleFriends } from "./friendsModel";
import type { FriendActions } from "./useFriendDialogs";

type Scope = "all" | "online";

/** Suche, Filter „Alle/Online“ und die Liste der Freunde; ohne Freunde der Leerzustand mit beiden Wegen zum Hinzufügen. */
export function FriendsSection({ friends, invites, session, actions, onAdd }: {
  friends: Friend[]; invites: Invite[]; session: HostSession | undefined; actions: FriendActions; onAdd: (tab: AddFriendTab) => void;
}) {
  const { t } = useI18n();
  const [query, setQuery] = useState("");
  const [scope, setScope] = useState<Scope>("all");
  const labels = useMemo(() => friendLabels(friends), [friends]);

  if (friends.length === 0) {
    return (
      <Empty title={t("friends.empty.title")} actions={<AddFriendButtons onAdd={onAdd} />}>
        {t("friends.empty.body")}
      </Empty>
    );
  }
  const visible = visibleFriends(friends, labels, { query, onlineOnly: scope === "online" });
  return (
    <section className="mt-6">
      <SectionHeader title={t("friends.list.title")} size="sub" as="h2" />
      <Toolbar search="m" className="mt-2 mb-3">
        <SearchField value={query} onChange={setQuery} placeholder={t("friends.search.placeholder")} />
        <Segmented
          label={t("friends.filter.label")}
          value={scope}
          onChange={setScope}
          items={[
            { value: "all", label: t("common.all") },
            { value: "online", label: t("friends.presence.online") },
          ]}
        />
      </Toolbar>
      {visible.length === 0 ? (
        <Empty size="pane" title={t("friends.search.noMatches")} />
      ) : (
        <List variant="friends" aria-label={t("friends.list.title")}>
          {visible.map((friend) => (
            <FriendRow key={friend.id} friend={friend} label={labels.get(friend.id)!} invite={inviteFrom(invites, friend)} session={session} actions={actions} />
          ))}
        </List>
      )}
    </section>
  );
}
