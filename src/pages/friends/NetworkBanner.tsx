import { useI18n } from "@/i18n";
import type { DegradedReason, NetworkStatus } from "@/lib/types";
import { StatusPanel } from "@/ui";

const REASON_KEY = {
  relayUnreachable: "friends.network.relayUnreachable",
  bindFailed: "friends.network.bindFailed",
} as const satisfies Record<DegradedReason, string>;

/** Meldet, wenn der Launcher keine Verbindung für Freunde hat; die Seite bleibt benutzbar, alle Freunde erscheinen dann offline. */
export function NetworkBanner({ network }: { network: NetworkStatus }) {
  const { t } = useI18n();
  if (network.type !== "degraded") return null;
  return (
    <StatusPanel className="mt-4" tone="bad" role="status" title={t(`${REASON_KEY[network.reason]}.title`)}>
      {t(`${REASON_KEY[network.reason]}.body`)}
    </StatusPanel>
  );
}
