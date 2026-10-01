import { useLayoutEffect, useRef, useState } from "react";
import { useI18n } from "@/i18n";
import { Button, Empty } from "@/ui";
import { cn } from "@/lib/utils";
import type { LogLine } from "@/store/game";
import { LogRow } from "./LogRow";

/** So nah am unteren Rand (px) gilt die Ansicht als „unten“ und läuft mit neuen Zeilen mit. */
const FOLLOW_TOLERANCE_PX = 24;

/** Die Ausgabe selbst: scrollt mit, solange man unten ist; `lines` sind alle, `shown` die gefilterten Zeilen. */
export function LogView({ lines, shown, highlight }: { lines: LogLine[] | undefined; shown: LogLine[]; highlight: RegExp | null }) {
  const { t } = useI18n();
  const body = useRef<HTMLDivElement>(null);
  const [follow, setFollow] = useState(true);

  useLayoutEffect(() => {
    const el = body.current;
    if (el && follow) el.scrollTop = el.scrollHeight;
  }, [shown, follow]);

  return (
    <div className="console">
      <div
        ref={body}
        className="cbody"
        tabIndex={0}
        role="log"
        aria-live="off"
        aria-label={t("components.log.ariaLabel")}
        onScroll={(e) => {
          const el = e.currentTarget;
          setFollow(el.scrollHeight - el.scrollTop - el.clientHeight < FOLLOW_TOLERANCE_PX);
        }}
      >
        {shown.map((line) => <LogRow key={line.id} line={line} highlight={highlight} />)}
      </div>
      <div className="none" style={{ visibility: shown.length ? "hidden" : "visible" }}>
        {lines?.length ? (
          <Empty size="pane" title={t("components.log.noMatches")}>{t("components.log.noLinesForFilter")}</Empty>
        ) : (
          <Empty size="pane" mood="sleep" title={t("components.log.noOutputYet")}>{t("components.log.startInstanceHint")}</Empty>
        )}
      </div>
      <Button
        size="s"
        icon="down"
        className={cn("down", !follow && "show")}
        onClick={() => setFollow(true)}
      >
        {t("components.log.scrollDown")}
      </Button>
    </div>
  );
}
