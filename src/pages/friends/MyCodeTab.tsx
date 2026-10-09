import { useCreateFriendCode, useFriendCodes, useRevokeFriendCode } from "@/hooks/useFriends";
import { useI18n } from "@/i18n";
import { copyWithToast } from "@/lib/clipboard";
import { friendCodeBodyGroups } from "@/lib/friendCode";
import { FRIENDS_LIMITS } from "@/lib/friends-types";
import { relativeTime } from "@/lib/format";
import type { FriendCode } from "@/lib/types";
import { ErrorBox } from "@/components/ErrorBox";
import { Button, Chip, Hint, IconButton, List, ListRow, RowTitle, SectionHeader, Skel, Surface } from "@/ui";
import { IconTile } from "./IconTile";
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
    <div className="friends-mycode">
      <div className="friends-mycode-create">
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
        <SectionHeader title={t("friends.myCode.active")} level="card" />
        <ActiveCodes codes={codes} />
      </div>
    </div>
  );
}

/** Der Code in Vierergruppen, die beim Umbruch zusammenbleiben. */
function FreshCode({ code }: { code: string }) {
  const { t } = useI18n();
  return (
    <Surface kind="slot" className="flex w-full items-center justify-between gap-3.5 py-2.5 pr-2.5 pl-[18px]">
      <div className="flex min-w-0 flex-wrap gap-x-[.45em] gap-y-0 text-[length:calc(24px*var(--tz))] leading-[1.3] font-normal font-(family-name:--f-px) tracking-[.05em] text-(color:--copper) select-text [text-shadow:var(--tsh)]">
        {friendCodeBodyGroups(code).map((group, i) => (
          <span key={i} className="whitespace-nowrap">{i === 0 ? FRIENDS_LIMITS.codePrefix + group : group}</span>
        ))}
      </div>
      <IconButton variant="secondary" icon="copy" label={t("common.copy")} onClick={() => copyWithToast(code, t("friends.myCode.copied"))} />
    </Surface>
  );
}

function ActiveCodes({ codes }: { codes: ReturnType<typeof useFriendCodes> }) {
  const { t } = useI18n();
  if (codes.error) return <ErrorBox title={t("friends.myCode.loadFailed")} error={codes.error} onRetry={() => void codes.refetch()} />;
  if (!codes.data) return <Skel className="h-[60px]" />;
  if (codes.data.length === 0) return <Hint>{t("friends.myCode.none")}</Hint>;
  return (
    <List spaced aria-label={t("friends.myCode.active")}>
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
    <ListRow plate="row">
      <IconTile icon="key" />
      <RowTitle
        title={t("friends.requests.codeTitle", { tail: code.tail })}
        sub={code.used ? <Chip size="s" icon="check">{t("friends.myCode.used")}</Chip> : t("friends.myCode.expires", { time: relativeTime(code.expiresAt * SECOND_MS) })}
      />
      <Button size="s" variant="ghost" disabled={revoke.isPending} onClick={() => revoke.mutate(code.id)}>{t("friends.myCode.revoke")}</Button>
    </ListRow>
  );
}
