import { useEffect, useRef, type RefObject } from "react";
import { useNavigate } from "react-router";
import { useI18n } from "@/i18n";
import { AddCard, CardStrip, SceneCard, SceneCardSkel } from "@/ui";
import { loaderLine } from "@/components/common";
import { InstanceIcon } from "@/components/InstanceIcon";
import { useInstanceMenu } from "@/components/instance";
import { NewInstanceDialog } from "@/components/NewInstanceDialog";
import { PlayButton } from "@/components/play/PlayButton";
import { StatusChip } from "@/components/play/StatusChip";
import { relativeTime } from "@/lib/format";
import { instanceUrl } from "@/lib/routes";
import type { Instance } from "@/lib/types";
import { motionOff } from "@/pixel/scene";
import { useLook } from "@/store/look";

const scrollBehavior = () => (motionOff() ? "auto" : "smooth");

/**
 * Miniatur in der Leiste „Deine Instanzen“: Klick (Leertaste) zeigt sie oben im Hero, Doppelklick oder Enter öffnet sie.
 * Status-Chip oben links (nicht an der gewählten: ihren Zustand zeigt der Spielen-Knopf im Hero), beim Überfahren oder Fokus ein kleiner Spielen-Knopf oben rechts (wie Poster). Rechtsklick: Instanz-Menü.
 */
function MiniCard({ instance, current, onPick, hintId }: { instance: Instance; current: boolean; onPick: () => void; hintId: string }) {
  const { t } = useI18n();
  const look = useLook(instance.id);
  const items = useInstanceMenu(instance);
  const navigate = useNavigate();
  const open = () => navigate(instanceUrl(instance.id));
  return (
    <li data-id={instance.id}>
      <SceneCard
        look={look}
        art={<InstanceIcon instance={instance} bio={look.bio} />}
        title={instance.name}
        sub={`${loaderLine(instance)} · ${relativeTime(instance.lastPlayedAt, true)}`}
        current={current}
        status={current ? undefined : <StatusChip instance={instance} small loudOnly />}
        primary={<PlayButton instance={instance} size="i" />}
        menu={items}
        tip={t("pages.home.miniCardTip")}
        tipSide="bottom"
        hit={{
          onClick: onPick,
          onDoubleClick: open,
          onKeyDown: (e) => {
            // Enter öffnet, Leertaste wählt (Standard-Klick)
            if (e.key !== "Enter" || e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
            e.preventDefault();
            open();
          },
          describedBy: hintId,
        }}
      />
    </li>
  );
}

/** Platzhalter einer Karte beim Laden: dieselbe Platte wie die echte Karte (Bild, Namensschild), damit die Seite nicht springt. */
export function RailSkeleton({ n }: { n: number }) {
  return (
    <CardStrip aria-hidden>
      {Array.from({ length: n }, (_, k) => (
        <li key={k}>
          <SceneCardSkel />
        </li>
      ))}
    </CardStrip>
  );
}

/** Hält die gewählte Miniatur sichtbar (nicht beim ersten Anzeigen: die zuletzt gespielte steht ohnehin vorn). */
function useKeepVisible(rail: RefObject<HTMLUListElement | null>, currentId: string) {
  const first = useRef(true);
  useEffect(() => {
    if (first.current) return void (first.current = false);
    // Nur die Leiste waagerecht scrollen: scrollIntoView würde bei Zoom auch die Seite verschieben.
    const el = rail.current;
    const card = el?.querySelector<HTMLElement>(`[data-id="${CSS.escape(currentId)}"]`);
    if (!el || !card) return;
    const left = card.getBoundingClientRect().left - el.getBoundingClientRect().left + el.scrollLeft;
    const right = left + card.offsetWidth;
    const to = left < el.scrollLeft ? left : right > el.scrollLeft + el.clientWidth ? right - el.clientWidth : null;
    if (to !== null) el.scrollTo({ left: to, behavior: scrollBehavior() });
  }, [currentId]);
}

/**
 * Leiste „Deine Instanzen“ (Klick wählt die Instanz für den Hero, Doppelklick/Enter öffnet sie): Liste mit Knöpfen,
 * Pfeile nur in Richtungen, in die noch etwas kommt.
 */
export function Rail({ instances, current, onPick }: { instances: Instance[]; current: string; onPick: (id: string) => void }) {
  const { t } = useI18n();
  const rail = useRef<HTMLUListElement>(null);
  useKeepVisible(rail, current);

  return (
    <>
      <CardStrip
        listRef={rail}
        itemCount={instances.length}
        prevLabel={t("pages.home.scrollBack")}
        nextLabel={t("pages.home.scrollForward")}
        aria-labelledby="cont-h"
      >
        {instances.map((i) => (
          <MiniCard key={i.id} instance={i} current={i.id === current} onPick={() => onPick(i.id)} hintId="rail-hint" />
        ))}
        <li>
          <NewInstanceDialog>
            <AddCard label={t("components.newInstance.title")} />
          </NewInstanceDialog>
        </li>
      </CardStrip>
      <span id="rail-hint" className="sr">{t("pages.home.railHint")}</span>
    </>
  );
}
