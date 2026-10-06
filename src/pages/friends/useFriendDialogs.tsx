import { useState, type ReactNode } from "react";
import { FriendAvatar } from "@/components/friends/FriendAvatar";
import { Fingerprint } from "@/components/friends/Fingerprint";
import { NameDialog } from "@/components/NameDialog";
import { useBlockPeer, useRemoveFriend, useRenameFriend } from "@/hooks/useFriends";
import { useConfirmTarget } from "@/hooks/useConfirmTarget";
import { useI18n } from "@/i18n";
import { FRIENDS_LIMITS } from "@/lib/friends-types";
import type { Friend } from "@/lib/types";
import { ConfirmDialog, Dialog, DialogActions, Hint } from "@/ui";

/** Wen eine Rückfrage meint: bei Freunden und bei Anfragen ist die ID die Peer-ID. */
export type Person = { id: string; name: string };

/** Was eine Zeile auslösen kann; die Dialoge dazu stehen in `useFriendDialogs`. */
export type FriendActions = {
  rename: (friend: Friend) => void;
  showFingerprint: (friend: Friend, label: string) => void;
  askRemove: (person: Person) => void;
  askBlock: (person: Person) => void;
};

/** Die Dialoge hinter den Aktionen einer Freundeszeile: Umbenennen, Fingerabdruck, Entfernen und Blockieren. */
export function useFriendDialogs(): { actions: FriendActions; dialogs: ReactNode } {
  const { t } = useI18n();
  const [renaming, setRenaming] = useState<Friend | null>(null);
  const [fingerprint, setFingerprint] = useState<{ friend: Friend; label: string } | null>(null);
  const remove = useConfirmTarget<Person>();
  const block = useConfirmTarget<Person>();
  const rename = useRenameFriend();
  const removeFriend = useRemoveFriend();
  const blockPeer = useBlockPeer();

  const dialogs = (
    <>
      {renaming && (
        <NameDialog
          key={renaming.id}
          title={t("friends.rename.title")}
          label={t("friends.rename.label")}
          help={t("friends.rename.help", { name: renaming.mcName ?? renaming.displayName })}
          initial={renaming.alias ?? ""}
          maxLength={FRIENDS_LIMITS.aliasMax}
          allowBlank
          pending={rename.isPending}
          onSubmit={(alias) => rename.mutate({ friendId: renaming.id, alias: alias || null }, { onSuccess: () => setRenaming(null) })}
          onClose={() => setRenaming(null)}
        />
      )}
      {fingerprint && <FingerprintDialog {...fingerprint} onClose={() => setFingerprint(null)} />}
      <ConfirmDialog
        {...remove.dialogProps({
          title: ({ name }) => t("friends.remove.title", { name }),
          text: ({ name }) => t("friends.remove.text", { name }),
          confirmLabel: t("common.remove"),
          pending: removeFriend.isPending,
          onConfirm: ({ id }, close) => removeFriend.mutate(id, { onSuccess: close }),
        })}
      />
      <ConfirmDialog
        {...block.dialogProps({
          title: ({ name }) => t("friends.block.title", { name }),
          text: ({ name }) => t("friends.block.text", { name }),
          confirmLabel: t("friends.block.confirm"),
          pending: blockPeer.isPending,
          onConfirm: ({ id }, close) => blockPeer.mutate(id, { onSuccess: close }),
        })}
      />
    </>
  );

  const actions: FriendActions = {
    rename: setRenaming,
    showFingerprint: (friend, label) => setFingerprint({ friend, label }),
    askRemove: remove.ask,
    askBlock: block.ask,
  };
  return { actions, dialogs };
}

/** Der Fingerabdruck groß, damit man ihn mit dem Freund auf einem zweiten Weg vergleichen kann. */
function FingerprintDialog({ friend, label, onClose }: { friend: Friend; label: string; onClose: () => void }) {
  const { t } = useI18n();
  return (
    <Dialog
      open
      onOpenChange={(open) => !open && onClose()}
      title={t("friends.fingerprint.title")}
      width={480}
      footer={<DialogActions confirm={{ label: t("common.done"), width: 124, autoFocus: true, onClick: onClose }} />}
    >
      <div className="flex items-center gap-3">
        <FriendAvatar friendId={friend.id} name={friend.mcName ?? friend.displayName} />
        <div className="min-w-0">
          <b className="vx-trunc block">{label}</b>
          {friend.mcName && <span className="vx-trunc block text-fg-3">{t("friends.fingerprint.mcName", { name: friend.mcName })}</span>}
        </div>
      </div>
      <div className="code my-4 text-center select-text">
        <Fingerprint value={friend.fingerprint} size="l" />
      </div>
      <Hint icon="info">{t("friends.fingerprint.hint", { name: label })}</Hint>
    </Dialog>
  );
}
