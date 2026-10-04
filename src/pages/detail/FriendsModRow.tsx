import { useIngameStatus } from "@/hooks/useFriends";
import { t, useI18n } from "@/i18n";
import { LOADER_LABELS, type IngameReason, type IngameStatus, type Instance } from "@/lib/types";
import { Chip, StatusPanel } from "@/ui";

/** Die Zeile zum Freunde-Menü im Spiel (INGAME 3.9): nur der Stand und, wenn es nicht läuft, der Grund. Kein Angebot, nichts zu installieren. */
export function FriendsModRow({ instance }: { instance: Instance; busy?: string | null }) {
  useI18n();
  const status = useIngameStatus(instance.id).data;
  if (!status) return null;
  return (
    <StatusPanel
      size="s"
      icon="box"
      title={t("friendsHost.ingame.name")}
      actions={<Chip dot tone={status.state === "connected" ? "run" : undefined}>{statusText(status, instance)}</Chip>}
    />
  );
}

function statusText(status: IngameStatus, instance: Instance): string {
  switch (status.state) {
    case "active":
      return t("friendsHost.ingame.active", { loader: LOADER_LABELS[status.node?.loader ?? instance.loader], minecraft: instance.minecraftVersion });
    case "connected":
      return t("friendsHost.ingame.connected");
    case "off":
    case "autoOff":
    case "unavailable":
      return status.reason ? reasonText(status.reason, instance) : t("friendsHost.ingame.off");
  }
}

function reasonText(reason: IngameReason, instance: Instance): string {
  const loader = LOADER_LABELS[instance.loader];
  switch (reason.type) {
    case "noNode":
    case "unverified":
      return t(`friendsHost.ingame.reason.${reason.type}`, { loader, minecraft: instance.minecraftVersion });
    case "loaderTooOld":
      return t("friendsHost.ingame.reason.loaderTooOld", { loader, need: reason.need });
    case "javaTooOld":
      return t("friendsHost.ingame.reason.javaTooOld", { need: reason.need });
    case "breaker":
      return t("friendsHost.ingame.reason.breaker", { failure: t(`friendsHost.ingame.failure.${reason.reason}`) });
    default:
      return t(`friendsHost.ingame.reason.${reason.type}`);
  }
}
