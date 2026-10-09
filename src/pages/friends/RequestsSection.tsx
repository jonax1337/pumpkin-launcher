import { SelfAsserted } from "@/components/friends/FriendAvatar";
import { Fingerprint } from "@/components/friends/Fingerprint";
import { useAnswerFriendRequest, useCancelFriendRequest } from "@/hooks/useFriends";
import { useI18n } from "@/i18n";
import { FRIENDS_LIMITS } from "@/lib/friends-types";
import type { FriendRequest } from "@/lib/types";
import { Avatar, Button, Count, Hint, IconButton, List, ListRow, Menu, RowTitle, SectionHeader, Tip } from "@/ui";
import { codeMayBeExpired, REQUESTS_ANCHOR, requestLine, requestName } from "./friendsModel";
import { IconTile } from "./IconTile";
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
    <section id={REQUESTS_ANCHOR}>
      <SectionHeader title={<>{t("friends.requests.title")}<Count value={requests.length} muted /></>} size="sub" as="h2" />
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

/** Der Minecraft-Name einer Anfrage per Name: das Verzeichnis hat ihn geprüft, anders als den Anzeigenamen. */
function CheckedMcName({ name }: { name: string }) {
  const { t } = useI18n();
  return (
    <Tip label={t("friends.requests.nameChecked")} describe>
      <span>{t("friends.requests.minecraft", { name })}</span>
    </Tip>
  );
}

/** Der Fingerabdruck gehört zum Schlüssel dahinter; bei einer Anfrage per Name steht der geprüfte Minecraft-Name davor. */
function RequesterSub({ request }: { request: FriendRequest }) {
  if (!request.fingerprint) return null;
  const fingerprint = <Fingerprint value={request.fingerprint} />;
  if (request.via !== "name" || !request.mcName) return fingerprint;
  return (
    <span className="friends-checked">
      <CheckedMcName name={request.mcName} />
      {fingerprint}
    </span>
  );
}

/** Name samt Fingerabdruck: der Name ist selbst angegeben, der Fingerabdruck gehört zum Schlüssel dahinter. */
function Requester({ request, aside }: { request: FriendRequest; aside?: string }) {
  const name = requestName(request);
  return (
    <>
      <span className="friends-av">
        <SelfAsserted><Avatar name={name} /></SelfAsserted>
      </span>
      <RowTitle title={name} aside={aside} sub={<RequesterSub request={request} />} />
    </>
  );
}

function IncomingRow({ request, askBlock }: { request: FriendRequest; askBlock: (person: Person) => void }) {
  const { t } = useI18n();
  const answer = useAnswerFriendRequest();
  const name = requestName(request);
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

/** Die Person einer eigenen Anfrage per Name: ihr Minecraft-Name, den das Verzeichnis geprüft hat. */
function NameTarget({ name, title, aside, sub }: { name: string; title: string; aside?: string; sub?: string }) {
  return (
    <>
      <span className="friends-av"><Avatar name={name} /></span>
      <RowTitle title={title} aside={aside} sub={sub} />
    </>
  );
}

/** Der Besitzer des Codes (oder die Person, deren Name man schrieb) ist noch nicht online: „Jetzt zustellen“ versucht es sofort. */
function DeliveringRow({ request, retryNow, cooling }: { request: FriendRequest; retryNow: () => void; cooling: boolean }) {
  const { t } = useI18n();
  const cancel = useCancelFriendRequest();
  const line = requestLine(request);
  const expired = codeMayBeExpired(request, FRIENDS_LIMITS.codeTtlSecs, Date.now() / SECOND_MS);
  return (
    <ListRow>
      {request.via === "name" ? (
        <NameTarget name={line.params.name} title={line.params.name} sub={t(line.key, line.params)} />
      ) : (
        <>
          <IconTile icon="link" />
          <RowTitle
            title={request.codeTail ? t("friends.requests.codeTitle", { tail: request.codeTail }) : t("friends.requests.codeTitleNoTail")}
            sub={t(line.key, line.params)}
            meta={expired ? <Hint tone="warn">{t("friends.requests.maybeExpired")}</Hint> : undefined}
          />
        </>
      )}
      <Button size="s" icon="refresh" disabled={cooling} onClick={retryNow}>{t("friends.requests.deliverNow")}</Button>
      <Button size="s" variant="ghost" disabled={cancel.isPending} onClick={() => cancel.mutate(request.id)}>{t("friends.requests.withdraw")}</Button>
    </ListRow>
  );
}

function AwaitingRow({ request }: { request: FriendRequest }) {
  const { t } = useI18n();
  const cancel = useCancelFriendRequest();
  const line = requestLine(request);
  return (
    <ListRow>
      {request.via === "name" ? (
        <NameTarget name={line.params.name} title={t("friends.requests.toName", line.params)} aside={t(line.key, line.params)} />
      ) : (
        <Requester request={request} aside={t(line.key, line.params)} />
      )}
      <Button size="s" variant="ghost" disabled={cancel.isPending} onClick={() => cancel.mutate(request.id)}>{t("friends.requests.withdraw")}</Button>
    </ListRow>
  );
}
