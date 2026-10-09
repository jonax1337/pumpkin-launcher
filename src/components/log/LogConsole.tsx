import { useEffect, useState } from "react";
import { useI18n } from "@/i18n";
import { Actions, Button, SearchField, SectionHeader, Segmented, Select, Spacer, Toolbar } from "@/ui";
import { askShareLog, DebugInfoButton } from "@/components/support";
import { useLogDigest } from "@/hooks/useLogDigest";
import { useLogSessions } from "@/hooks/useLogSessions";
import { copyWithToast } from "@/lib/clipboard";
import { formatDateTime } from "@/lib/format";
import { openLocalPath } from "@/lib/links";
import type { Instance, LogSession } from "@/lib/types";
import { useGame, type LogLine } from "@/store/game";
import { LOG_FILTERS, useFilteredLines, type LogFilter } from "./filter";
import { LogStat } from "./LogStat";
import { useSessionLines } from "./session";
import { LogView } from "./LogView";

/** Wert der Sitzungsauswahl für die laufende Sitzung. */
const CURRENT_SESSION = "current";

/**
 * Ausgabe des Spiels mit Filter, Suche und Mitscrollen (solange man unten ist): live, oder eine gesicherte frühere
 * Sitzung. Ein neuer Start wechselt zurück zur laufenden. Nach einem Absturz steht der Absturzassistent darüber;
 * `onAddContent` öffnet dessen Suche nach fehlenden Mods.
 */
export function LogConsole({ instance, onAddContent }: { instance: Instance; onAddContent: (query: string) => void }) {
  const { t } = useI18n();
  const live = useGame((s) => s.logs[instance.id]);
  const startedAt = useGame((s) => s.started[instance.id]);
  const [chosenSession, setChosenSession] = useState<string | null>(null);
  const sessions = useLogSessions(instance.id).data ?? [];
  // Eine Sitzung, die aus der Liste gefallen ist (Rotation), gilt nicht mehr als gewählt.
  const sessionId = sessions.some((session) => session.id === chosenSession) ? chosenSession : null;
  const lines = useSessionLines(instance.id, sessionId) ?? (sessionId ? undefined : live);
  const [filter, setFilter] = useState<LogFilter>("all");
  const [query, setQuery] = useState("");
  const { shown, highlight } = useFilteredLines(lines, filter, query);
  const digest = useLogDigest(sessionId ? undefined : live);
  useEffect(() => {
    if (startedAt != null) setChosenSession(null);
  }, [startedAt]);

  return (
    <div className="log-tab">
      <SectionHeader title={t("components.log.ariaLabel")} actions={<LogFileActions instance={instance} lines={lines} />} />
      <LogStat instance={instance} session={sessions.find((session) => session.id === sessionId)} onAddContent={onAddContent} />
      <LogToolbar
        instance={instance}
        lines={lines}
        filter={filter}
        onFilter={setFilter}
        query={query}
        onQuery={setQuery}
        sessions={sessions}
        sessionId={sessionId}
        onSession={setChosenSession}
      />
      <LogView lines={lines} shown={shown} highlight={highlight} />
      <span className="sr" role="status">{digest}</span>
    </div>
  );
}

type LogToolbarProps = {
  instance: Instance;
  lines: LogLine[] | undefined;
  filter: LogFilter;
  onFilter: (filter: LogFilter) => void;
  query: string;
  onQuery: (query: string) => void;
  sessions: LogSession[];
  /** Gewählte gesicherte Sitzung; `null` = die laufende. */
  sessionId: string | null;
  onSession: (sessionId: string | null) => void;
};

/** Kopieren und Logordner: Handgriffe am Protokoll selbst, daher im Kopf des Reiters. */
function LogFileActions({ instance, lines }: { instance: Instance; lines: LogLine[] | undefined }) {
  const { t } = useI18n();
  const logFile = useGame((s) => s.crashes[instance.id])?.logFile;
  const copy = () => copyWithToast((lines ?? []).map((l) => l.line).join("\n"), t("components.log.copySuccess"));
  return (
    <Actions>
      <Button size="s" icon="copy" disabled={!lines?.length} onClick={copy}>{t("common.copy")}</Button>
      {logFile && <Button size="s" icon="folder" onClick={() => openLocalPath(logFile)}>{t("components.log.logFile")}</Button>}
    </Actions>
  );
}

function LogToolbar({ instance, lines, filter, onFilter, query, onQuery, sessions, sessionId, onSession }: LogToolbarProps) {
  const { t } = useI18n();
  const clearLog = useGame((s) => s.clearLog);
  const crash = useGame((s) => s.crashes[instance.id]);
  const hasLines = !!lines?.length;
  const archived = sessionId != null;
  const sessionOptions = [
    { value: CURRENT_SESSION, label: t("settings.log.current") },
    ...sessions.map((session) => ({ value: session.id, label: formatDateTime(session.startedAt) })),
  ];
  // Hochgeladen wird die Logdatei auf dem Datenträger: es gibt sie nach einem Absturz oder sobald die Instanz einmal lief.
  const hasLogToShare = hasLines || !!crash || instance.lastPlayedAt != null;

  return (
    <Toolbar height={32} search="s">
      <SearchField size="s" value={query} onChange={onQuery} placeholder={t("components.log.searchPlaceholder")} />
      <Segmented
        size="s"
        label={t("components.log.filter")}
        value={filter}
        onChange={onFilter}
        items={LOG_FILTERS.map(({ value, label }) => ({ value, label: t(label) }))}
      />
      {sessions.length > 0 && (
        <Select
          size="s"
          ariaLabel={t("settings.log.session")}
          value={sessionId ?? CURRENT_SESSION}
          options={sessionOptions}
          onChange={(value) => onSession(value === CURRENT_SESSION ? null : value)}
        />
      )}
      <Spacer />
      <Button size="s" icon="share" disabled={archived || !hasLogToShare} onClick={() => askShareLog(instance.id, crash)}>
        {t("components.game.shareLog")}
      </Button>
      <DebugInfoButton size="s" icon="info" instanceId={instance.id} />
      <Button size="s" icon="trash" disabled={!hasLines || archived} onClick={() => clearLog(instance.id)}>
        {t("components.log.clear")}
      </Button>
    </Toolbar>
  );
}
