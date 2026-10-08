import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react";
import { useNavigate } from "react-router";
import { useI18n } from "@/i18n";
import { AddCard, IconButton, SceneCard } from "@/ui";
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

/**
 * Wallpaper-Karten und Abstand in der Leiste „Deine Instanzen“;
 * wie in ui/card.css und .rail (home.css).
 */
export const TILE_W = 256;
export const TILE_H = 144;
const TILE_GAP = 14;
const TILE_STEP = TILE_W + TILE_GAP;

/** Rundung beim Messen der Scrollposition (px). */
const SCROLL_EDGE_TOLERANCE_PX = 1;

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
        sub={`${loaderLine(instance)} · ${relativeTime(instance.lastPlayedAt)}`}
        current={current}
        status={current ? undefined : <StatusChip instance={instance} small loudOnly />}
        primary={<PlayButton instance={instance} size="i" />}
        menu={items}
        tip={t("pages.home.miniCardTip")}
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

/** Ob links und rechts der Leiste noch etwas wartet (für die Pfeile); misst bei jeder Größen- und Scrolländerung. */
function useRailEdges(rail: RefObject<HTMLUListElement | null>, itemCount: number) {
  const [edge, setEdge] = useState({ left: false, right: false });
  const measure = () => {
    const el = rail.current;
    if (!el) return;
    const left = el.scrollLeft > SCROLL_EDGE_TOLERANCE_PX;
    const right = el.scrollLeft + el.clientWidth < el.scrollWidth - SCROLL_EDGE_TOLERANCE_PX;
    setEdge((e) => (e.left === left && e.right === right ? e : { left, right }));
  };
  useLayoutEffect(() => {
    measure();
    const el = rail.current;
    if (!el) return;
    const resizes = new ResizeObserver(measure);
    resizes.observe(el);
    return () => resizes.disconnect();
  }, [itemCount]);
  return { edge, measure };
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
  const { edge, measure } = useRailEdges(rail, instances.length);
  useKeepVisible(rail, current);

  // Blättert um ganze Kacheln, mindestens eine.
  function page(direction: 1 | -1) {
    const el = rail.current;
    if (!el) return;
    const step = Math.max(1, Math.floor(el.clientWidth / TILE_STEP) - 1) * TILE_STEP;
    el.scrollBy({ left: direction * step, behavior: scrollBehavior() });
  }

  return (
    <div className="railwrap" data-l={edge.left || undefined} data-r={edge.right || undefined}>
      <ul className="rail" aria-labelledby="cont-h" ref={rail} onScroll={measure}>
        {instances.map((i) => (
          <MiniCard key={i.id} instance={i} current={i.id === current} onPick={() => onPick(i.id)} hintId="rail-hint" />
        ))}
        <li>
          <NewInstanceDialog>
            <AddCard label={t("components.newInstance.title")} />
          </NewInstanceDialog>
        </li>
      </ul>
      <span id="rail-hint" className="sr">{t("pages.home.railHint")}</span>
      {/* Nur für die Maus: per Tastatur scrollt die Leiste mit dem Fokus mit. */}
      <IconButton
        variant="secondary"
        onScene
        icon="chev-left"
        label={t("pages.home.scrollBack")}
        tip={false}
        className="rarr l"
        tabIndex={-1}
        aria-hidden
        onClick={() => page(-1)}
      />
      <IconButton
        variant="secondary"
        onScene
        icon="chev-right"
        label={t("pages.home.scrollForward")}
        tip={false}
        className="rarr r"
        tabIndex={-1}
        aria-hidden
        onClick={() => page(1)}
      />
    </div>
  );
}
