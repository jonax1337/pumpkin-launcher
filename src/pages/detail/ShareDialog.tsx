import { useMemo, useState } from "react";
import { FriendAvatar } from "@/components/friends/FriendAvatar";
import { invitableFriends, seatsLeft } from "@/components/friends/sharingModel";
import { useFriendsList, useHostSessions, useInviteGuests, useStartHosting } from "@/hooks/useFriends";
import { useI18n } from "@/i18n";
import type { Friend, Instance } from "@/lib/types";
import { friendLabels } from "@/pages/friends/friendsModel";
import { Checkbox, Dialog, DialogActions, Empty, Field, Hint } from "@/ui";

const DIALOG_WIDTH_PX = 520;
const DIALOG_HEIGHT_PX = 520;
const CONFIRM_WIDTH_PX = 130;
const AVATAR_BOX = 28;

/**
 * Wen man einlädt und ob der Weltname in der Einladung steht. Ohne laufende Sitzung startet „Teilen“ erst das Teilen (mit dem
 * geprüften Port des Backends oder dem von Hand eingegebenen `port`), danach folgen die Einladungen; mit Sitzung lädt es nur ein.
 * Der Aufrufer hängt den Dialog nur ein, solange er offen ist.
 */
export function ShareDialog({ instance, port, onClose }: { instance: Instance; port: number | null; onClose: () => void }) {
  const { t } = useI18n();
  const friends = useFriendsList().data;
  const running = useHostSessions().data?.[0];
  const session = running?.instanceId === instance.id ? running : undefined;
  const labels = useMemo(() => friendLabels(friends ?? []), [friends]);
  const candidates = invitableFriends(friends ?? [], labels, session);
  const limit = seatsLeft(session);
  const [picked, setPicked] = useState<ReadonlySet<string>>(new Set());
  const [showWorldName, setShowWorldName] = useState(false);
  const startHosting = useStartHosting();
  const inviteGuests = useInviteGuests();
  const pending = startHosting.isPending || inviteGuests.isPending;
  // Wer inzwischen offline ging, ist nicht mehr wählbar und zählt nicht mit.
  const chosen = candidates.filter((friend) => picked.has(friend.id));
  const full = chosen.length >= limit;

  const toggle = (friendId: string, on: boolean) =>
    setPicked((current) => new Set(on ? [...current, friendId] : [...current].filter((id) => id !== friendId)));

  async function share() {
    try {
      const target = session ?? (await startHosting.mutateAsync({ instanceId: instance.id, port, showWorldName }));
      await inviteGuests.mutateAsync({ sessionId: target.id, friendIds: chosen.map((friend) => friend.id) });
      onClose();
    } catch {
      // Beide Mutationen melden ihren Fehler über den zentralen Handler des Clients; der Dialog bleibt für einen neuen Versuch offen.
    }
  }

  return (
    <Dialog
      open
      onOpenChange={(open) => !open && onClose()}
      title={session ? t("friendsHost.dialog.titleMore") : t("friendsHost.dialog.title")}
      width={DIALOG_WIDTH_PX}
      height={DIALOG_HEIGHT_PX}
      busy={pending}
      footLeft={chosen.length === 0 && candidates.length > 0 ? t("friendsHost.dialog.needFriend") : null}
      footer={
        <DialogActions
          cancel={t("common.cancel")}
          confirm={{
            label: pending ? t("friendsHost.dialog.pending") : session ? t("friendsHost.dialog.confirmMore") : t("friendsHost.dialog.confirm"),
            width: CONFIRM_WIDTH_PX,
            disabled: chosen.length === 0 || pending,
            onClick: () => void share(),
          }}
        />
      }
    >
      <div className="flex flex-col gap-4">
        {candidates.length === 0 ? (
          <Empty size="pane" title={t("friendsHost.dialog.noFriends")}>{t("friendsHost.dialog.noFriendsHint")}</Empty>
        ) : (
          <Field label={t("friendsHost.dialog.friends")} group help={t("friendsHost.dialog.friendsHelp", { n: limit })}>
            <FriendChoices friends={candidates} labels={labels} picked={picked} full={full} onToggle={toggle} />
          </Field>
        )}
        {!session && (
          <div className="flex flex-col gap-1">
            <Checkbox checked={showWorldName} onChange={setShowWorldName}>{t("friendsHost.dialog.worldName")}</Checkbox>
            <Hint>{t("friendsHost.dialog.worldNameHelp")}</Hint>
          </div>
        )}
        <div className="flex flex-col gap-2">
          <Hint icon="info">{t("friendsHost.dialog.infoVisible")}</Hint>
          <Hint icon="info">{t("friendsHost.dialog.infoHomeNet")}</Hint>
        </div>
      </div>
    </Dialog>
  );
}

/** Die Freunde zum Ankreuzen; ist die Zahl der Plätze erreicht, bleiben nur die schon gewählten ansprechbar. */
function FriendChoices({ friends, labels, picked, full, onToggle }: {
  friends: Friend[]; labels: Map<string, string>; picked: ReadonlySet<string>; full: boolean; onToggle: (friendId: string, on: boolean) => void;
}) {
  return (
    <div className="flex flex-col gap-1">
      {friends.map((friend) => (
        <Checkbox
          key={friend.id}
          checked={picked.has(friend.id)}
          disabled={full && !picked.has(friend.id)}
          onChange={(on) => onToggle(friend.id, on)}
        >
          <span className="flex min-w-0 items-center gap-3">
            <FriendAvatar friendId={friend.id} name={friend.mcName ?? friend.displayName} box={AVATAR_BOX} />
            <span className="ell">{labels.get(friend.id)}</span>
          </span>
        </Checkbox>
      ))}
    </div>
  );
}
