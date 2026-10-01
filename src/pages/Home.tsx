import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { Buddy } from "@/branding/Brand";
import { useI18n } from "@/i18n";
import { useNavigate } from "react-router";
import { isGameLive, PlayButton, PlayStatus, StatusChip, usePhase } from "@/components/game";
import { InstanceMenuButton, useInstanceMenu } from "@/components/instance";
import { loaderLine } from "@/components/common";
import { NewInstanceDialog } from "@/components/NewInstanceDialog";
import { SkelList } from "@/components/SkelList";
import { Onboarding } from "@/components/Onboarding";
import { useModUpdates } from "@/hooks/useContent";
import { byRecent, pickRecentInstance, useInstances } from "@/hooks/useInstances";
import { usePlay } from "@/hooks/usePlay";
import { relativeTime, updatesLabel } from "@/lib/format";
import { instanceUrl } from "@/lib/routes";
import { quickPlayTarget, type Instance } from "@/lib/types";
import { PixelScene } from "@/pixel/PixelScene";
import { motionOff } from "@/pixel/scene";
import { useLook } from "@/store/look";
import { AddCard, Button, ButtonLink, Count, ErrorBox, IconButton, Meta, SceneCard, SectionHeader, Skel } from "@/ui";

/**
 * Buddy schläft neben dem Spielen-Knopf (rechts hinter dem Menü, gleiche Zeile) und hängt an ihm: Läuft die Instanz nicht, schläft er;
 * Überfahren oder Fokus auf „Spielen“ weckt ihn (winkt); Laden/Installieren/Starten zeigt die Lade-Animation,
 * beim Spielen ist er wach (Standbild, die App pausiert Animationen, solange ein Spiel läuft), nach einem Absturz schaut er erschrocken.
 */
function HomeBuddy({ instanceId, awake }: { instanceId: string; awake: boolean }) {
  const phase = usePhase(instanceId);
  const mood = phase === "crashed" ? "oops" : phase === "running" ? "idle"
    : ["loading", "preparing", "starting"].includes(phase) ? "loading" : awake ? "hello" : "sleep";
  return <Buddy mood={mood} size={120} className="buddy-rest" />;
}

/** Titel und Metazeile der ausgewählten Instanz (Infos als Text; Knöpfe nur für „Updates“ und „Weiterspielen in …“). */
function HeroInfo({ instance }: { instance: Instance }) {
  const { t } = useI18n();
  // Update-Abfrage nur für die Hero-Instanz und nur mit Inhalten; 10 Minuten gecacht (wie im Detail).
  const updates = useModUpdates(instance.id, instance.mods.length > 0);
  const phase = usePhase(instance.id);
  const play = usePlay();
  const n = instance.mods.length;
  const u = updates.data?.length ?? 0;
  // Während des Spiels sagt der Knopf „Läuft seit …“; „Zuletzt gespielt in dieser Minute“ wäre doppelt.
  const playing = isGameLive(phase);
  // Der Ordnername statt des Weltnamens: den kennt nur die Weltenliste, und die liest jede Welt vom Datenträger.
  const resume = playing || phase === "preparing" ? null : instance.lastQuickPlay;
  return (
    <div className="hero-k rise">
      <div className="titlebox">
        <h1 title={instance.name}>{instance.name}</h1>
      </div>
      <div className="hmeta">
        <Meta
          onScene
          className="overflow-hidden"
          items={[
            loaderLine(instance),
            <><Count value={n} /> {n === 1 ? t("pages.home.contentCount.one") : t("pages.home.contentCount.other")}</>,
            !playing && (instance.lastPlayedAt != null ? t("components.game.lastPlayed", { zeit: relativeTime(instance.lastPlayedAt) }) : t("format.neverPlayed")),
          ]}
        />
        {u > 0 && (
          <ButtonLink to={instanceUrl(instance.id, "content")} size="s" icon="up" count={u} onScene>
            {updatesLabel(u)}
          </ButtonLink>
        )}
        {resume && (
          <Button size="s" icon="play" onScene onClick={() => void play(instance, undefined, resume)}>
            {t("pages.home.resumeIn", { welt: quickPlayTarget(resume) })}
          </Button>
        )}
      </div>
    </div>
  );
}

/**
 * Miniatur in der Leiste „Deine Instanzen“: Klick (Leertaste) zeigt sie oben im Hero, Doppelklick oder Enter öffnet sie.
 * Status-Chip oben links, beim Überfahren oder Fokus ein kleiner Spielen-Knopf oben rechts (wie Poster). Rechtsklick: Instanz-Menü.
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
        variant="mini"
        look={look}
        title={instance.name}
        sub={`${loaderLine(instance)} · ${relativeTime(instance.lastPlayedAt)}`}
        current={current}
        status={<StatusChip instance={instance} small loudOnly />}
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

/** Größe der Kacheln (`SceneCard` mini) und Abstand in der Leiste „Deine Instanzen“; wie in ui/card.css und .rail (styles/pixelkino.css). */
const TILE_W = 184;
const TILE_H = 104;
const TILE_GAP = 12;
const TILE_STEP = TILE_W + TILE_GAP;

/** Leiste „Deine Instanzen“ (Klick wählt die Instanz für den Hero, Doppelklick/Enter öffnet sie): Liste mit Knöpfen, Pfeile nur in Richtungen, in die noch etwas kommt. */
function Rail({ instances, current, onPick }: { instances: Instance[]; current: string; onPick: (id: string) => void }) {
  const { t } = useI18n();
  const rail = useRef<HTMLUListElement>(null);
  const [edge, setEdge] = useState({ l: false, r: false });

  const measure = useCallback(() => {
    const el = rail.current;
    if (!el) return;
    const l = el.scrollLeft > 1;
    const r = el.scrollLeft + el.clientWidth < el.scrollWidth - 1;
    setEdge((e) => (e.l === l && e.r === r ? e : { l, r }));
  }, []);

  useLayoutEffect(() => {
    measure();
    const el = rail.current;
    if (!el) return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [measure, instances.length]);

  // Ausgewählte Miniatur sichtbar halten (nicht beim ersten Anzeigen: die zuletzt gespielte steht ohnehin vorn).
  const first = useRef(true);
  useEffect(() => {
    if (first.current) return void (first.current = false);
    // Nur die Leiste waagerecht scrollen: scrollIntoView würde bei Zoom auch die Seite verschieben.
    const el = rail.current;
    const card = el?.querySelector<HTMLElement>(`[data-id="${CSS.escape(current)}"]`);
    if (!el || !card) return;
    const left = card.getBoundingClientRect().left - el.getBoundingClientRect().left + el.scrollLeft, right = left + card.offsetWidth;
    const to = left < el.scrollLeft ? left : right > el.scrollLeft + el.clientWidth ? right - el.clientWidth : null;
    if (to !== null) el.scrollTo({ left: to, behavior: motionOff() ? "auto" : "smooth" });
  }, [current]);

  // Blättert um ganze Kacheln, mindestens eine.
  function page(dir: 1 | -1) {
    const el = rail.current;
    if (!el) return;
    const step = Math.max(1, Math.floor(el.clientWidth / TILE_STEP) - 1) * TILE_STEP;
    el.scrollBy({ left: dir * step, behavior: motionOff() ? "auto" : "smooth" });
  }

  return (
    <div className="railwrap" data-l={edge.l || undefined} data-r={edge.r || undefined}>
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
      {/* Nur für die Maus: per Tastatur scrollt die Leiste mit dem Fokus mit. „absolute“ schlägt die Kit-Position (.rarr legt die Lage fest). */}
      <IconButton onScene icon="back" label={t("pages.home.scrollBack")} tip={false} className="rarr l absolute" tabIndex={-1} aria-hidden onClick={() => page(-1)} />
      <IconButton onScene icon="chev" label={t("pages.home.scrollForward")} tip={false} className="rarr r absolute" tabIndex={-1} aria-hidden onClick={() => page(1)} />
    </div>
  );
}

function HomeSkeleton() {
  const { t } = useI18n();
  return (
    <section className="home" aria-busy aria-label={t("components.common.loadingAria")}>
      <div className="hero">
        <div className="hero-k">
          <div className="titlebox"><Skel h={72} w="min(520px, 80%)" /></div>
          <div className="hmeta"><Skel h={16} w={320} /></div>
        </div>
        <div className="acts"><Skel h={56} w={272} /><Skel h={56} w={56} /></div>
        <div className="pstat" />
      </div>
      <div className="cont">
        <div className="library-heading"><Skel h={22} w={150} /></div>
        <div className="railwrap"><div className="rail"><SkelList n={4} w={TILE_W} h={TILE_H} className="flex-none" /></div></div>
      </div>
    </section>
  );
}

export function HomePage() {
  const { t } = useI18n();
  const { data: instances, isLoading, error, refetch } = useInstances();
  const [selected, setSelected] = useState<string | null>(null);
  // „Spielen“ überfahren oder fokussiert: weckt das Maskottchen
  const [awake, setAwake] = useState(false);
  const current = instances?.find((i) => i.id === selected) ?? pickRecentInstance(instances);
  const look = useLook(current?.id);

  if (isLoading) return <HomeSkeleton />;
  if (error)
    return (
      <section className="page">
        <ErrorBox title={t("pages.home.loadErrorTitle")} error={error} onRetry={() => void refetch()} />
      </section>
    );
  if (!instances?.length || !current) return <Onboarding />;

  const sorted = [...instances].sort(byRecent);

  return (
    <section className="home">
      <PixelScene bio={look.bio} seed={look.seed} mode="hero" className="scene" />
      <div className="shade-home" />
      <div className="hero">
        <HeroInfo key={`info-${current.id}`} instance={current} />
        <div
          className="acts"
          onPointerOver={(e) => setAwake(!!(e.target as Element).closest(".play"))}
          onPointerLeave={() => setAwake(false)}
          onFocus={(e) => setAwake(!!(e.target as Element).closest(".play"))}
          onBlur={() => setAwake(false)}
        >
          <PlayButton key={current.id} instance={current} />
          <InstanceMenuButton instance={current} onScene large open />
          <HomeBuddy key={`buddy-${current.id}`} instanceId={current.id} awake={awake} />
        </div>
        <PlayStatus key={`stat-${current.id}`} instance={current} showLast={false} onScene />
      </div>
      <div className="cont">
        <div className="library-heading">
          <SectionHeader
            title={t("components.detail.yourInstances")}
            id="cont-h"
            actions={
              <>
                <NewInstanceDialog>
                  <Button variant="ghost" size="s" icon="plus">{t("components.newInstance.title")}</Button>
                </NewInstanceDialog>
                <ButtonLink to="/instances" variant="ghost" size="s" iconEnd="chev" bleed="end">{t("pages.home.allInLibrary")}</ButtonLink>
              </>
            }
          />
        </div>
        <Rail instances={sorted} current={current.id} onPick={setSelected} />
      </div>
    </section>
  );
}
