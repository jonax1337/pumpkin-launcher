import { useI18n } from "@/i18n";
import type { DegradedReason, NetworkStatus } from "@/lib/types";
import { Chip, StatusPanel } from "@/ui";

const REASON_KEY = {
  relayUnreachable: "friends.network.relayUnreachable",
  bindFailed: "friends.network.bindFailed",
} as const satisfies Record<DegradedReason, string>;

/**
 * Zeigt den Zustand der Verbindung für Freunde: verbunden mit dem Relay (mit Online-Marke) oder, wenn sie fehlt, was los ist;
 * die Seite bleibt benutzbar, alle Freunde erscheinen dann offline.
 */
export function NetworkBanner({ network }: { network: NetworkStatus }) {
  const { t } = useI18n();
  if (network.type === "online") {
    return (
      <StatusPanel
        tone="acc"
        icon="wifi"
        role="status"
        className="flex-wrap"
        title={t("friends.network.online.title", { host: network.relayHost })}
        actions={<Chip tone="run">{t("friends.presence.online")}</Chip>}
      >
        {t("friends.network.online.body")}
      </StatusPanel>
    );
  }
  if (network.type !== "degraded") return null;
  return (
    <StatusPanel tone="bad" icon="wifi" role="status" className="flex-wrap" title={t(`${REASON_KEY[network.reason]}.title`)}>
      {t(`${REASON_KEY[network.reason]}.body`)}
    </StatusPanel>
  );
}
