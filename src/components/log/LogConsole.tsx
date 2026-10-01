import { useState } from "react";
import { useI18n } from "@/i18n";
import { Button, SearchField, Segmented, Spacer, Toolbar } from "@/ui";
import { askShareLog, DebugInfoButton } from "@/components/support";
import { useLogDigest } from "@/hooks/useLogDigest";
import { WIDTH } from "@/lib/breakpoints";
import { copyWithToast } from "@/lib/clipboard";
import { openLocalPath } from "@/lib/links";
import type { Instance } from "@/lib/types";
import { useGame, type LogLine } from "@/store/game";
import { LOG_FILTERS, useFilteredLines, type LogFilter } from "./filter";
import { LogStat } from "./LogStat";
import { LogView } from "./LogView";

/** Live-Ausgabe des Spiels mit Filter, Suche und Mitscrollen (solange man unten ist). */
export function LogConsole({ instance }: { instance: Instance }) {
  const lines = useGame((s) => s.logs[instance.id]);
  const [filter, setFilter] = useState<LogFilter>("all");
  const [query, setQuery] = useState("");
  const { shown, highlight } = useFilteredLines(lines, filter, query);
  const digest = useLogDigest(lines);

  return (
    <>
      <LogStat instance={instance} />
      <LogToolbar instance={instance} lines={lines} filter={filter} onFilter={setFilter} query={query} onQuery={setQuery} />
      <LogView lines={lines} shown={shown} highlight={highlight} />
      <span className="sr" role="status">{digest}</span>
    </>
  );
}

type LogToolbarProps = {
  instance: Instance;
  lines: LogLine[] | undefined;
  filter: LogFilter;
  onFilter: (filter: LogFilter) => void;
  query: string;
  onQuery: (query: string) => void;
};

function LogToolbar({ instance, lines, filter, onFilter, query, onQuery }: LogToolbarProps) {
  const { t } = useI18n();
  const clearLog = useGame((s) => s.clearLog);
  const crash = useGame((s) => s.crashes[instance.id]);
  const logFile = crash?.logFile;
  const hasLines = !!lines?.length;
  const copy = () => copyWithToast((lines ?? []).map((l) => l.line).join("\n"), t("components.log.copySuccess"));

  return (
    <Toolbar search="s" className="mb-2.5">
      <SearchField size="s" value={query} onChange={onQuery} placeholder={t("components.log.searchPlaceholder")} />
      <Segmented
        size="s"
        label={t("components.log.filter")}
        value={filter}
        onChange={onFilter}
        items={LOG_FILTERS.map(({ value, label }) => ({ value, label: t(label) }))}
      />
      <Spacer />
      <Button size="s" icon="copy" compactBelow={WIDTH.sm} disabled={!hasLines} onClick={copy}>{t("common.copy")}</Button>
      <Button
        size="s"
        icon="ul"
        compactBelow={WIDTH.xl}
        onClick={() => askShareLog(instance.id, crash)}
      >
        {t("components.game.shareLog")}
      </Button>
      <DebugInfoButton size="s" icon="info" compactBelow={WIDTH.xl} />
      {logFile && (
        <Button size="s" icon="folder" compactBelow={WIDTH.sm} onClick={() => openLocalPath(logFile)}>{t("components.log.logFile")}</Button>
      )}
      <Button
        size="s"
        icon="trash"
        compactBelow={WIDTH.sm}
        disabled={!hasLines}
        onClick={() => clearLog(instance.id)}
      >
        {t("components.log.clear")}
      </Button>
    </Toolbar>
  );
}
