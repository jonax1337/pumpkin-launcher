import { useLayoutEffect, useRef, useState } from "react";
import { useI18n } from "@/i18n";
import { EmptyState } from "@/components/EmptyState";
import { Button, Surface } from "@/ui";
import { cn } from "@/lib/utils";
import type { LogLine } from "@/store/game";
import { LogRow } from "./LogRow";

/** So nah am unteren Rand (px) gilt die Ansicht als „unten“ und läuft mit neuen Zeilen mit. */
const FOLLOW_TOLERANCE_PX = 24;

/** Der Körper der Konsole füllt den Rahmen und scrollt; die Zeilen stehen unumbrochen (lange Zeilen scrollen waagerecht). */
const BODY = "absolute inset-0 overflow-auto px-3.5 py-3 text-ctl-s leading-[1.65] font-mono whitespace-pre select-text [scrollbar-gutter:stable] forced-colors:[border:1px_solid_CanvasText] forced-colors:[clip-path:none]";
/** Fokusring um den Rahmen: der Körper ist gekerbt und schnitte einen eigenen Ring ab, deshalb zeichnet ihn der Rahmen. */
const RING = [
  "has-[>[role=log]:focus-visible]:after:absolute has-[>[role=log]:focus-visible]:after:inset-[calc(var(--u2)*-1)] has-[>[role=log]:focus-visible]:after:z-5",
  "has-[>[role=log]:focus-visible]:after:pointer-events-none has-[>[role=log]:focus-visible]:after:bg-(--focus) has-[>[role=log]:focus-visible]:after:[clip-path:var(--ring)]",
  "forced-colors:has-[>[role=log]:focus-visible]:after:bg-[Highlight]",
].join(" ");
/** Der Knopf „Nach unten“ blendet sich ein, sobald die Ansicht nicht mehr unten ist. */
const HIDDEN = "invisible opacity-0 [transition:opacity_.15s_var(--ease),visibility_0s_linear_.15s]";
const SHOWN = "visible opacity-100 [transition:opacity_.15s_var(--ease),visibility_0s]";

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
    <div className={cn("console relative min-h-[260px] flex-1", RING)}>
      <Surface
        kind="pit"
        deep
        ref={body}
        className={BODY}
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
      </Surface>
      {shown.length === 0 && (
        <div className="pointer-events-none absolute inset-0 grid place-items-center">
          {lines?.length ? (
            <EmptyState size="pane" title={t("components.log.noMatches")}>{t("components.log.noLinesForFilter")}</EmptyState>
          ) : (
            <EmptyState size="pane" mood="sleep" title={t("components.log.noOutputYet")}>{t("components.log.startInstanceHint")}</EmptyState>
          )}
        </div>
      )}
      <Button
        size="s"
        icon="arrow-down"
        className={cn("absolute right-[22px] bottom-3.5", follow ? HIDDEN : SHOWN)}
        onClick={() => setFollow(true)}
      >
        {t("components.log.scrollDown")}
      </Button>
    </div>
  );
}
