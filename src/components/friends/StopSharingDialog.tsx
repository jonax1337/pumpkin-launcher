import { useStopHosting } from "@/hooks/useFriends";
import { useI18n } from "@/i18n";
import type { HostSession } from "@/lib/types";
import { ConfirmDialog } from "@/ui";

/** Rückfrage vor „Teilen beenden“: alle Gäste werden getrennt. `session` null = geschlossen. */
export function StopSharingDialog({ session, onClose }: { session: HostSession | null; onClose: () => void }) {
  const { t } = useI18n();
  const stop = useStopHosting();
  return (
    <ConfirmDialog
      open={session !== null}
      onOpenChange={(open) => !open && onClose()}
      title={t("friendsHost.stop.title")}
      text={t("friendsHost.stop.text")}
      confirmLabel={t("friendsHost.share.stop")}
      pending={stop.isPending}
      onConfirm={() => session && stop.mutate(session.id, { onSuccess: onClose })}
    />
  );
}
