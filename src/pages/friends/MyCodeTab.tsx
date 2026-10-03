import { useCreateFriendCode, useFriendCodes, useRevokeFriendCode } from "@/hooks/useFriends";
import { useI18n } from "@/i18n";
import { copyWithToast } from "@/lib/clipboard";
import { friendCodeBodyGroups } from "@/lib/friendCode";
import { FRIENDS_LIMITS } from "@/lib/friends-types";
import { relativeTime } from "@/lib/format";
import type { FriendCode } from "@/lib/types";
import { Button, Chip, ErrorBox, Hint, Icon, List, ListRow, RowTitle, SectionHeader, Skel } from "@/ui";
import { activeCodeCount } from "./friendsModel";

const SECOND_MS = 1000;

/**
 * Eigener Code: erzeugen (der volle Code erscheint genau einmal) und die aktiven Codes verwalten.
 * `create` gehört dem Dialog, damit der neue Code einen Wechsel des Reiters überlebt.
 */
export function MyCodeTab({ create }: { create: ReturnType<typeof useCreateFriendCode> }) {
  const { t } = useI18n();
  const codes = useFriendCodes();
  const atLimit = activeCodeCount(codes.data ?? []) >= FRIENDS_LIMITS.maxActiveCodes;
  // Der Code gilt nur, solange es seinen Eintrag noch gibt; ein widerrufener verschwindet auch aus der Anzeige.
  const fresh = create.data?.code && codes.data?.some((code) => code.id === create.data.id) ? create.data : undefined;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2.5">
        <div>
          <Button variant="primary" icon="link" disabled={atLimit || create.isPending} onClick={() => create.mutate()}>
            {t("friends.myCode.create")}
          </Button>
        </div>
        <Hint icon="info">{t("friends.myCode.hint", { days: FRIENDS_LIMITS.codeTtlSecs / 86_400 })}</Hint>
        {atLimit && <Hint tone="warn">{t("friends.myCode.limit", { max: FRIENDS_LIMITS.maxActiveCodes })}</Hint>}
      </div>
      {fresh && <FreshCode code={fresh.code!} />}
      <div>
        <SectionHeader title={t("friends.myCode.active")} size="card" as="h3" />
        <ActiveCodes codes={codes} />
      </div>
    </div>
  );
}

/** Der Code in Vierergruppen, die beim Umbruch zusammenbleiben. */
function FreshCode({ code }: { code: string }) {
  const { t } = useI18n();
  return (
    <div className="flex flex-col items-start gap-2.5">
      <div className="code w-full text-[26px] leading-[1.35] tracking-[.05em] select-text">
        {friendCodeBodyGroups(code).map((group, i) => (
          <span key={i} className="mr-[.45em] inline-block">{i === 0 ? FRIENDS_LIMITS.codePrefix + group : group}</span>
        ))}
      </div>
      <Button icon="copy" onClick={() => copyWithToast(code, t("friends.myCode.copied"))}>{t("common.copy")}</Button>
    </div>
  );
}

function ActiveCodes({ codes }: { codes: ReturnType<typeof useFriendCodes> }) {
  const { t } = useI18n();
  if (codes.error) return <ErrorBox title={t("friends.myCode.loadFailed")} error={codes.error} onRetry={() => void codes.refetch()} />;
  if (!codes.data) return <Skel h={60} />;
  if (codes.data.length === 0) return <Hint>{t("friends.myCode.none")}</Hint>;
  return (
    <List variant="accounts" aria-label={t("friends.myCode.active")}>
      {codes.data.map((code) => (
        <CodeRow key={code.id} code={code} />
      ))}
    </List>
  );
}

function CodeRow({ code }: { code: FriendCode }) {
  const { t } = useI18n();
  const revoke = useRevokeFriendCode();
  return (
    <ListRow>
      <span className="vx-av" data-box="32"><Icon name="link" size="l" /></span>
      <RowTitle
        title={t("friends.requests.codeTitle", { tail: code.tail })}
        sub={code.used ? <Chip size="s" icon="check">{t("friends.myCode.used")}</Chip> : t("friends.myCode.expires", { time: relativeTime(code.expiresAt * SECOND_MS) })}
      />
      <Button size="s" variant="ghost" disabled={revoke.isPending} onClick={() => revoke.mutate(code.id)}>{t("friends.myCode.revoke")}</Button>
    </ListRow>
  );
}
