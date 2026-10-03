import { SelfAsserted } from "@/components/friends/FriendAvatar";
import { Fingerprint } from "@/components/friends/Fingerprint";
import { useAnswerFriendRequest, useCancelFriendRequest } from "@/hooks/useFriends";
import { useI18n } from "@/i18n";
import { FRIENDS_LIMITS } from "@/lib/friends-types";
import type { FriendRequest } from "@/lib/types";
import { Avatar, Button, Hint, Icon, IconButton, List, ListRow, Menu, RowTitle, SectionHeader } from "@/ui";
import { codeMayBeExpired } from "./friendsModel";
import type { Person } from "./useFriendDialogs";

const SECOND_MS = 1000;

type RequestActions = {
  retryNow: () => void;
  cooling: boolean;
  askBlock: (person: Person) => void;
};

/** Offene Anfragen: eingehende zum Annehmen, eigene mit dem Stand der Zustellung. */
export function RequestsSection({ requests, ...actions }: { requests: FriendRequest[] } & RequestActions) {
  const { t } = useI18n();
  return (
    <section className="mt-6">
      <SectionHeader title={t("friends.requests.title")} size="sub" as="h2" />
      <List variant="accounts" aria-label={t("friends.requests.title")}>
        {requests.map((request) => (
          <RequestRow key={request.id} request={request} {...actions} />
        ))}
      </List>
    </section>
  );
}

function RequestRow({ request, ...actions }: { request: FriendRequest } & RequestActions) {
  switch (request.state) {
    case "pending":
      return <IncomingRow request={request} askBlock={actions.askBlock} />;
    case "delivering":
      return <DeliveringRow request={request} retryNow={actions.retryNow} cooling={actions.cooling} />;
    case "awaitingAnswer":
      return <AwaitingRow request={request} />;
  }
}

/** Name samt Fingerabdruck: der Name ist selbst angegeben, der Fingerabdruck gehört zum Schlüssel dahinter. */
function Requester({ request, aside }: { request: FriendRequest; aside?: string }) {
  const name = request.displayName ?? "?";
  return (
    <>
      <span className="grid place-items-center">
        <SelfAsserted><Avatar name={name} /></SelfAsserted>
      </span>
      <RowTitle title={name} aside={aside} sub={request.fingerprint && <Fingerprint value={request.fingerprint} />} />
    </>
  );
}

function IncomingRow({ request, askBlock }: { request: FriendRequest; askBlock: (person: Person) => void }) {
  const { t } = useI18n();
  const answer = useAnswerFriendRequest();
  const name = request.displayName ?? "?";
  return (
    <ListRow>
      <Requester request={request} />
      <Button size="s" variant="primary" disabled={answer.isPending} onClick={() => answer.mutate({ requestId: request.id, accept: true })}>
        {t("friends.requests.accept")}
      </Button>
      <Button size="s" disabled={answer.isPending} onClick={() => answer.mutate({ requestId: request.id, accept: false })}>
        {t("friends.requests.decline")}
      </Button>
      {request.peerId && (
        <Menu
          trigger={<IconButton icon="more" size="s" label={t("components.instance.moreActionsFor", { name })} tip={t("components.instance.moreActions")} />}
          items={[{ id: "block", text: t("friends.menu.block"), icon: "stop", bad: true, onSelect: () => askBlock({ id: request.peerId!, name }) }]}
        />
      )}
    </ListRow>
  );
}

function DeliveringRow({ request, retryNow, cooling }: { request: FriendRequest; retryNow: () => void; cooling: boolean }) {
  const { t } = useI18n();
  const cancel = useCancelFriendRequest();
  const expired = codeMayBeExpired(request, FRIENDS_LIMITS.codeTtlSecs, Date.now() / SECOND_MS);
  return (
    <ListRow>
      <span className="vx-av" data-box="32"><Icon name="link" size="l" /></span>
      <RowTitle
        title={request.codeTail ? t("friends.requests.codeTitle", { tail: request.codeTail }) : t("friends.requests.codeTitleNoTail")}
        sub={t("friends.requests.delivering")}
        meta={expired ? <Hint tone="warn">{t("friends.requests.maybeExpired")}</Hint> : undefined}
      />
      <Button size="s" icon="redo" disabled={cooling} onClick={retryNow}>{t("friends.requests.deliverNow")}</Button>
      <Button size="s" variant="ghost" disabled={cancel.isPending} onClick={() => cancel.mutate(request.id)}>{t("friends.requests.withdraw")}</Button>
    </ListRow>
  );
}

function AwaitingRow({ request }: { request: FriendRequest }) {
  const { t } = useI18n();
  const cancel = useCancelFriendRequest();
  return (
    <ListRow>
      <Requester request={request} aside={t("friends.requests.awaiting")} />
      <Button size="s" variant="ghost" disabled={cancel.isPending} onClick={() => cancel.mutate(request.id)}>{t("friends.requests.withdraw")}</Button>
    </ListRow>
  );
}
