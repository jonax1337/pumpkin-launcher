import { t, useI18n, type TKey } from "@/i18n";
import type { PathKind } from "@/lib/types";
import { Count } from "@/ui";

const PATH_LABEL: Record<PathKind, TKey> = { direct: "friendsHost.path.direct", relay: "friendsHost.path.relay" };
const PATH_TIP: Record<PathKind, TKey> = { direct: "friendsHost.path.directTip", relay: "friends.path.relayTip" };

export const pathLabel = (path: PathKind): string => t(PATH_LABEL[path]);

/** Was der Weg bedeutet: direkt zwischen den Launchern oder über einen Relay-Server. */
export const pathTip = (path: PathKind): string => t(PATH_TIP[path]);

/** Die Antwortzeit in Pixelschrift mit reservierter Breite, damit wechselnde Werte nichts verschieben. */
export function Rtt({ ms }: { ms: number }) {
  const { tAround } = useI18n();
  const [before, after] = tAround("friendsHost.guest.rtt", "ms");
  return <>{before}<Count value={ms} size={16} minDigits={3} />{after}</>;
}

/** „Direkt · 38 ms“; ohne Messung nur der Weg. */
export function ConnectionText({ path, rttMs }: { path: PathKind; rttMs: number | null }) {
  return (
    <>
      {pathLabel(path)}
      {rttMs != null && <> · <Rtt ms={rttMs} /></>}
    </>
  );
}
