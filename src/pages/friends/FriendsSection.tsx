import { useMemo, useState } from "react";
import { useNavigate } from "react-router";
import { useI18n } from "@/i18n";
import type { Friend, HostSession, Invite } from "@/lib/types";
import { Count, Empty, IconButton, List, SearchField, SectionHeader, Segmented, Toolbar } from "@/ui";
import { FriendRow } from "./FriendRow";
import { friendLabels, inviteFrom, onlineCount, visibleFriends } from "./friendsModel";
import type { FriendActions } from "./useFriendDialogs";

type Scope = "all" | "online";

/** Suche, Filter „Alle/Online“ und die Liste der Freunde; ohne Freunde der Leerzustand (die Wege zum Hinzufügen stehen im Seitenkopf). */
export function FriendsSection({ friends, invites, session, actions }: {
  friends: Friend[]; invites: Invite[]; session: HostSession | undefined; actions: FriendActions;
}) {
  const { t } = useI18n();
  const navigate = useNavigate();
  const [query, setQuery] = useState("");
  const [scope, setScope] = useState<Scope>("all");
  const labels = useMemo(() => friendLabels(friends), [friends]);

  if (friends.length === 0) return <Empty title={t("friends.empty.title")}>{t("friends.empty.body")}</Empty>;
  const visible = visibleFriends(friends, labels, { query, onlineOnly: scope === "online" });
  return (
    <section>
      <SectionHeader
        title={<>{t("friends.list.title")}<Count value={friends.length} muted /></>}
        as="h2"
        actions={
          <>
            <span className="friends-online">{t("friends.presence.online")}: {onlineCount(friends)}</span>
            <IconButton icon="settings" size="s" label={t("common.settings")} tip={t("common.settings")} onClick={() => navigate("/settings?tab=freunde")} />
          </>
        }
      />
      <Toolbar search="m" className="friends-toolbar">
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
