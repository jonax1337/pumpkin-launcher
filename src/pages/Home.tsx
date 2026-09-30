import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { Buddy } from "@/branding/Brand";
import { useNavigate } from "react-router";
import { PlayButton, PlayStatus, StatusChip, usePhase } from "@/components/game";
import { InstanceMenuButton, useInstanceMenu } from "@/components/instance";
import { loaderLine } from "@/components/common";
import { NewInstanceDialog } from "@/components/NewInstanceDialog";
import { Onboarding } from "@/components/Onboarding";
import { useModUpdates } from "@/hooks/useContent";
import { pickRecentInstance, useInstances } from "@/hooks/useInstances";
import { relativeTime } from "@/lib/format";
import type { Instance } from "@/lib/types";
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

/** Titel und Metazeile der ausgewählten Instanz (Infos als Text; nur „Updates“ ist ein Knopf). */
function HeroInfo({ instance }: { instance: Instance }) {
  // Update-Abfrage nur für die Hero-Instanz und nur mit Inhalten; 10 Minuten gecacht (wie im Detail).
  const updates = useModUpdates(instance.id, instance.mods.length > 0);
  const phase = usePhase(instance.id);
  const n = instance.mods.length;
  const u = updates.data?.length ?? 0;
  // Während des Spiels sagt der Knopf „Läuft seit …“; „Zuletzt gespielt in dieser Minute“ wäre doppelt.
  const playing = phase === "starting" || phase === "running";
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
            <><Count value={n} /> {n === 1 ? "Inhalt" : "Inhalte"}</>,
            !playing && (instance.lastPlayedAt != null ? `Zuletzt gespielt ${relativeTime(instance.lastPlayedAt)}` : "Noch nie gespielt"),
          ]}
        />
        {u > 0 && (
          <ButtonLink to={`/instances/${instance.id}?tab=content`} size="s" icon="up" count={u} onScene>
            {u === 1 ? "Update" : "Updates"}
          </ButtonLink>
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
  const look = useLook(instance.id);
  const items = useInstanceMenu(instance);
  const navigate = useNavigate();
  const open = () => navigate(`/instances/${instance.id}`);
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
        tip="Klick zeigt sie oben, Doppelklick oder Enter öffnet sie."
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

/** Leiste „Deine Instanzen“ (Klick wählt die Instanz für den Hero, Doppelklick/Enter öffnet sie): Liste mit Knöpfen, Pfeile nur in Richtungen, in die noch etwas kommt. */
function Rail({ instances, current, onPick }: { instances: Instance[]; current: string; onPick: (id: string) => void }) {
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

  // Blättert um ganze Kacheln (184 + 12 Lücke), mindestens eine.
  function page(dir: 1 | -1) {
    const el = rail.current;
    if (!el) return;
    const step = Math.max(1, Math.floor(el.clientWidth / 196) - 1) * 196;
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
            <AddCard label="Neue Instanz" />
          </NewInstanceDialog>
        </li>
      </ul>
      <span id="rail-hint" className="sr">Auswählen zeigt die Instanz oben. Enter oder Doppelklick öffnet sie.</span>
      {/* Nur für die Maus: per Tastatur scrollt die Leiste mit dem Fokus mit. „absolute“ schlägt die Kit-Position (.rarr legt die Lage fest). */}
      <IconButton onScene icon="back" label="Zurückblättern" tip={false} className="rarr l absolute" tabIndex={-1} aria-hidden onClick={() => page(-1)} />
      <IconButton onScene icon="chev" label="Weiterblättern" tip={false} className="rarr r absolute" tabIndex={-1} aria-hidden onClick={() => page(1)} />
    </div>
  );
}

function HomeSkeleton() {
  return (
    <section className="home" aria-busy aria-label="Wird geladen">
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
        <div className="railwrap"><div className="rail">{[0, 1, 2, 3].map((k) => <Skel key={k} w={184} h={104} className="flex-none" />)}</div></div>
      </div>
    </section>
  );
}

export function HomePage() {
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
        <ErrorBox title="Deine Instanzen konnten nicht geladen werden" error={error} onRetry={() => void refetch()} />
      </section>
    );
  if (!instances?.length || !current) return <Onboarding />;

  // Gespielte zuerst (zuletzt gespielt vorn), nie gespielte dahinter (neueste zuerst)
  const sorted = [...instances].sort((a, b) =>
    (a.lastPlayedAt == null ? 1 : 0) - (b.lastPlayedAt == null ? 1 : 0) || (b.lastPlayedAt ?? 0) - (a.lastPlayedAt ?? 0) || b.createdAt - a.createdAt);

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
            title="Deine Instanzen"
            id="cont-h"
            actions={
              <>
                <NewInstanceDialog>
                  <Button variant="ghost" size="s" icon="plus">Neue Instanz</Button>
                </NewInstanceDialog>
                <ButtonLink to="/instances" variant="ghost" size="s" iconEnd="chev" bleed="end">Alle in der Bibliothek</ButtonLink>
              </>
            }
          />
        </div>
        <Rail instances={sorted} current={current.id} onPick={setSelected} />
      </div>
    </section>
  );
}
