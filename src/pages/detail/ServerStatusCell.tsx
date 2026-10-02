import type { UseQueryResult } from "@tanstack/react-query";
import { Cell, Chip } from "@/ui";
import { useI18n } from "@/i18n";
import type { ServerStatus } from "@/lib/types";

/** Status eines Servers in seiner Zeile: „Nicht erreichbar“, Spieler und Antwortzeit oder, solange keine Antwort da ist, „Prüft…“. */
export function ServerStatusCell({ status }: { status: UseQueryResult<ServerStatus> }) {
  const { t } = useI18n();
  const { data } = status;
  return (
    <Cell flex align="end">
      {status.isError ? (
        <Chip size="s" dot>{t("detail.servers.unreachable")}</Chip>
      ) : data ? (
        <>
          <Chip size="s" tone="run" dot>
            {data.playersOnline}/{data.playersMax}
            <span className="sr">{t("detail.servers.playersSr", { online: data.playersOnline, max: data.playersMax })}</span>
          </Chip>
          <span data-hide="720">{t("detail.servers.latency", { ms: data.latencyMs })}</span>
        </>
      ) : (
        <span role="status">{t("detail.servers.checking")}</span>
      )}
    </Cell>
  );
}
