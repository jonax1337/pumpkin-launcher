import { useEffect, useRef, useState, type CSSProperties } from "react";
import { BtnLink, Btn, Chip, ContextMenu, ErrorBox, Skel } from "@/components/px";
import { PlayButton, PlayStatus, usePhase } from "@/components/game";
import { InstanceMenuButton, useInstanceMenu } from "@/components/instance";
import { loaderLine } from "@/components/common";
import { NewInstanceDialog } from "@/components/NewInstanceDialog";
import { Onboarding } from "@/components/Onboarding";
import { openAccounts } from "@/components/PlayerNames";
import { useModUpdates } from "@/hooks/useContent";
import { pickRecentInstance, useInstances } from "@/hooks/useInstances";
import { relativeTime } from "@/lib/format";
import type { Instance } from "@/lib/types";
import { cn } from "@/lib/utils";
import { Icon } from "@/pixel/icons";
import { PixelScene } from "@/pixel/PixelScene";
import { motionOff } from "@/pixel/scene";
import { useLook } from "@/store/look";
import { useSettings } from "@/store/settings";

/** Titel und Chips der ausgewählten Instanz. */
function HeroInfo({ instance }: { instance: Instance }) {
  const updates = useModUpdates(instance.id, false);
  const n = instance.mods.length;
  const u = updates.data?.length ?? 0;
  return (
    <div className="hero-k rise">
      <div className="titlebox">
        <h1 title={instance.name}>{instance.name}</h1>
      </div>
      <div className="chips">
        <Chip tone="acc">{loaderLine(instance)}</Chip>
        <Chip><b>{n}</b>{n === 1 ? "Inhalt" : "Inhalte"}</Chip>
        <Chip>
          Arbeitsspeicher{" "}
          {instance.memoryMb == null ? "automatisch" : <><b>{Math.round(instance.memoryMb / 1024)}</b>GB</>}
        </Chip>
        {u > 0 && <Chip tone="warn"><b>{u}</b>{u === 1 ? "Update" : "Updates"}</Chip>}
      </div>
    </div>
  );
}

/** Miniatur in der Weiterspielen-Reihe; Rechtsklick öffnet das Instanz-Menü. */
function MiniCard({ instance, current, onPick }: { instance: Instance; current: boolean; onPick: () => void }) {
  const { bio, seed, acc } = useLook(instance.id);
  const running = usePhase(instance.id) === "running";
  const items = useInstanceMenu(instance);
  return (
    <ContextMenu items={items}>
      <button
        type="button"
        role="option"
        data-id={instance.id}
        className={cn("mini fx", running && "running")}
        aria-current={current}
        aria-selected={current}
        style={{ "--acc-sel": acc } as CSSProperties}
        onClick={onPick}
      >
        <PixelScene bio={bio} seed={seed} />
        <span className="frame" />
        <span className="cap">
          <b>{instance.name}</b>
          <span>{loaderLine(instance)} · {relativeTime(instance.lastPlayedAt)}</span>
        </span>
        <Chip small dot tone="run" className="runmark">Läuft</Chip>
      </button>
    </ContextMenu>
  );
}

function Notes() {
  const hasAccount = useSettings((s) => !!s.active);
  if (hasAccount) return null;
  return (
    <div className="notes" aria-label="Hinweise">
      <div className="note">
        <Icon name="user" />
        <div className="nt">
          <b>Kein Spielername</b>
          <span>Nötig zum Spielen</span>
        </div>
        <Btn size="s" onClick={openAccounts}>Festlegen</Btn>
      </div>
    </div>
  );
}

function HomeSkeleton() {
  return (
    <section className="home" aria-busy aria-label="Wird geladen">
      <div className="hero">
        <div className="hero-k">
          <div className="titlebox"><Skel style={{ height: 72, width: "min(520px, 80%)" }} /></div>
          <div className="chips"><Skel style={{ height: 28, width: 120 }} /><Skel style={{ height: 28, width: 96 }} /><Skel style={{ height: 28, width: 180 }} /></div>
        </div>
        <div className="acts"><Skel style={{ height: 56, width: 272 }} /><Skel style={{ height: 40, width: 150 }} /></div>
        <div className="pstat" />
      </div>
      <div className="cont">
        <div className="cont-h" />
        <div className="rail">{[0, 1, 2, 3].map((k) => <Skel key={k} className="mini" />)}</div>
      </div>
    </section>
  );
}

export function HomePage() {
  const { data: instances, isLoading, error, refetch } = useInstances();
  const [selected, setSelected] = useState<string | null>(null);
  const rail = useRef<HTMLDivElement>(null);
  const current = instances?.find((i) => i.id === selected) ?? pickRecentInstance(instances);
  const look = useLook(current?.id);

  // Ausgewählte Miniatur sichtbar halten.
  useEffect(() => {
    if (!selected) return;
    rail.current?.querySelector<HTMLElement>(`[data-id="${CSS.escape(selected)}"]`)?.scrollIntoView({ block: "nearest", inline: "nearest", behavior: motionOff() ? "auto" : "smooth" });
  }, [selected]);

  if (isLoading) return <HomeSkeleton />;
  if (error)
    return (
      <section className="page">
        <ErrorBox title="Deine Instanzen konnten nicht geladen werden" error={error} onRetry={() => void refetch()} />
      </section>
    );
  if (!instances?.length || !current) return <Onboarding />;

  const sorted = [...instances].sort((a, b) => (b.lastPlayedAt ?? b.createdAt) - (a.lastPlayedAt ?? a.createdAt));

  return (
    <section className="home" style={{ "--acc": look.acc } as CSSProperties}>
      <PixelScene bio={look.bio} seed={look.seed} mode="hero" className="scene" />
      <div className="shade-home" />
      <Notes />
      <div className="hero">
        <HeroInfo key={`info-${current.id}`} instance={current} />
        <div className="acts">
          <PlayButton key={current.id} instance={current} />
          <BtnLink to={`/instances/${current.id}`}>Instanz öffnen</BtnLink>
          <InstanceMenuButton instance={current} open={false} />
        </div>
        <PlayStatus key={`stat-${current.id}`} instance={current} />
      </div>
      <div className="cont">
        <div className="cont-h">
          <h2 id="cont-h">Weiterspielen</h2>
          <BtnLink to="/instances" variant="g" size="s">Alle in der Bibliothek</BtnLink>
        </div>
        <div className="rail" role="listbox" aria-labelledby="cont-h" ref={rail}>
          {sorted.map((i) => (
            <MiniCard key={i.id} instance={i} current={i.id === current.id} onPick={() => setSelected(i.id)} />
          ))}
          <NewInstanceDialog>
            <button type="button" className="mini newtile fx">
              <span className="in"><Icon name="plus" />Neue Instanz</span>
            </button>
          </NewInstanceDialog>
        </div>
      </div>
    </section>
  );
}
