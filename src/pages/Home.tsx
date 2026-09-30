import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { Tooltip as T } from "radix-ui";
import { useNavigate } from "react-router";
import { BtnLink, Btn, ContextMenu, ErrorBox, Skel } from "@/components/px";
import { PlayButton, PlayStatus, StatusChip, usePhase } from "@/components/game";
import { InstanceMenuButton, useInstanceMenu } from "@/components/instance";
import { loaderLine } from "@/components/common";
import { NewInstanceDialog } from "@/components/NewInstanceDialog";
import { Onboarding } from "@/components/Onboarding";
import { useModUpdates } from "@/hooks/useContent";
import { pickRecentInstance, useInstances } from "@/hooks/useInstances";
import { relativeTime } from "@/lib/format";
import type { Instance } from "@/lib/types";
import { cn } from "@/lib/utils";
import { Icon } from "@/pixel/icons";
import { PixelScene } from "@/pixel/PixelScene";
import { motionOff } from "@/pixel/scene";
import { useLook } from "@/store/look";

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
        <div className="meta">
          <span>{loaderLine(instance)}</span>
          <span><b className="n">{n}</b> {n === 1 ? "Inhalt" : "Inhalte"}</span>
          {!playing && <span>{instance.lastPlayedAt != null ? `Zuletzt gespielt ${relativeTime(instance.lastPlayedAt)}` : "Noch nie gespielt"}</span>}
        </div>
        {u > 0 && (
          <BtnLink to={`/instances/${instance.id}?tab=content`} size="s" icon="up">
            {u} {u === 1 ? "Update" : "Updates"}
          </BtnLink>
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
  const { bio, seed, acc } = useLook(instance.id);
  const items = useInstanceMenu(instance);
  const navigate = useNavigate();
  const title = useRef<HTMLElement>(null);
  const [tip, setTip] = useState<"" | "name" | "hint">("");
  // Voller Name nur, wenn er gerade wirklich abgeschnitten ist; der Bedienhinweis immer
  const onTip = (o: boolean) => setTip(!o ? "" : title.current && title.current.scrollWidth > title.current.clientWidth ? "name" : "hint");
  const open = () => navigate(`/instances/${instance.id}`);
  return (
    <li>
      <ContextMenu items={items}>
        <div className="mini" data-id={instance.id} data-cur={current || undefined} style={{ "--acc": acc } as CSSProperties}>
          <T.Root open={!!tip} onOpenChange={onTip}>
            <T.Trigger asChild>
              <button
                type="button"
                className="hit fx"
                aria-current={current || undefined}
                aria-describedby={hintId}
                onClick={onPick}
                onDoubleClick={open}
                onKeyDown={(e) => {
                  // Enter öffnet, Leertaste wählt (Standard-Klick)
                  if (e.key !== "Enter" || e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
                  e.preventDefault();
                  open();
                }}
              >
                <PixelScene bio={bio} seed={seed} />
                <span className="frame" />
                <span className="cap">
                  <b ref={title}>{instance.name}</b>
                  <span>{loaderLine(instance)} · {relativeTime(instance.lastPlayedAt)}</span>
                </span>
                <span className="st"><StatusChip instance={instance} small loudOnly /></span>
              </button>
            </T.Trigger>
            <T.Portal>
              <T.Content className="rtip" side="top" sideOffset={8} collisionPadding={8}>
                {tip === "name" && <span className="tn block">{instance.name}</span>}
                <span className={cn("block", tip === "name" && "td")}>Klick zeigt sie oben, Doppelklick oder Enter öffnet sie.</span>
              </T.Content>
            </T.Portal>
          </T.Root>
          <div className="mplay"><PlayButton instance={instance} size="i" /></div>
        </div>
      </ContextMenu>
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
            <button type="button" className="mini newtile fx">
              <span className="in"><Icon name="plus" />Neue Instanz</span>
            </button>
          </NewInstanceDialog>
        </li>
      </ul>
      <span id="rail-hint" className="sr">Auswählen zeigt die Instanz oben. Enter oder Doppelklick öffnet sie.</span>
      {/* Nur für die Maus: per Tastatur scrollt die Leiste mit dem Fokus mit */}
      <Btn iconOnly icon="back" className="rarr l" tabIndex={-1} aria-hidden onClick={() => page(-1)} />
      <Btn iconOnly icon="chev" className="rarr r" tabIndex={-1} aria-hidden onClick={() => page(1)} />
    </div>
  );
}

function HomeSkeleton() {
  return (
    <section className="home" aria-busy aria-label="Wird geladen">
      <div className="hero">
        <div className="hero-k">
          <div className="titlebox"><Skel style={{ height: 72, width: "min(520px, 80%)" }} /></div>
          <div className="hmeta"><Skel style={{ height: 16, width: 320 }} /></div>
        </div>
        <div className="acts"><Skel style={{ height: 56, width: 272 }} /><Skel style={{ height: 40, width: 150 }} /></div>
        <div className="pstat" />
      </div>
      <div className="cont">
        <div className="cont-h" />
        <div className="railwrap"><div className="rail">{[0, 1, 2, 3].map((k) => <Skel key={k} className="mini" />)}</div></div>
      </div>
    </section>
  );
}

export function HomePage() {
  const { data: instances, isLoading, error, refetch } = useInstances();
  const [selected, setSelected] = useState<string | null>(null);
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
    <section className="home" style={{ "--acc": look.acc } as CSSProperties}>
      <PixelScene bio={look.bio} seed={look.seed} mode="hero" className="scene" />
      <div className="shade-home" />
      <div className="hero">
        <HeroInfo key={`info-${current.id}`} instance={current} />
        <div className="acts">
          <PlayButton key={current.id} instance={current} />
          <BtnLink to={`/instances/${current.id}`}>Instanz öffnen</BtnLink>
          <InstanceMenuButton instance={current} open={false} />
        </div>
        <PlayStatus key={`stat-${current.id}`} instance={current} showLast={false} />
      </div>
      <div className="cont">
        <div className="cont-h">
          <h2 id="cont-h">Deine Instanzen</h2>
          <div className="cont-a">
            <NewInstanceDialog>
              <Btn variant="g" size="s" icon="plus">Neue Instanz</Btn>
            </NewInstanceDialog>
            <BtnLink to="/instances" variant="g" size="s">Alle in der Bibliothek<Icon name="chevr" small /></BtnLink>
          </div>
        </div>
        <Rail instances={sorted} current={current.id} onPick={setSelected} />
      </div>
    </section>
  );
}
