import { useEffect, useRef, useState, type CSSProperties } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router";
import { useView } from "@/app/Layout";
import { BackLink, Btn, Chip, ErrorBox, Skel, Tip } from "@/components/px";
import { loaderLine } from "@/components/common";
import { LogConsole, PlayButton, PlayStatus, StatusChip } from "@/components/game";
import { InstanceMenuButton } from "@/components/instance";
import { AddContentSheet, IRIS_PROJECT_ID } from "@/components/ContentBrowser";
import { useModUpdates } from "@/hooks/useContent";
import { useInstance, useUpdateMods } from "@/hooks/useInstances";
import { projectOf } from "@/lib/modrinth";
import type { Instance } from "@/lib/types";
import { cn } from "@/lib/utils";
import { Icon } from "@/pixel/icons";
import { PixelScene } from "@/pixel/PixelScene";
import { useLook } from "@/store/look";
import { ContentTab, useWarnings } from "./detail/ContentTab";
import { SettingsTab } from "./detail/SettingsTab";
import "@/styles/detail.css";

type Tab = "content" | "console" | "settings";
const TABS: Tab[] = ["content", "console", "settings"];

export function InstanceDetailPage() {
  const { id = "" } = useParams();
  // Inhalt einer anderen Instanz wird neu gemountet, nicht umgeschrieben.
  return <InstanceDetail key={id} id={id} />;
}

/** Kopf wird beim Scrollen kompakt (nur Klasse wechseln; der Platz bleibt reserviert). */
function useCompactHead(ready: boolean) {
  const view = useView();
  const head = useRef<HTMLElement>(null);
  const [compact, setCompact] = useState(false);
  useEffect(() => {
    const el = view.current;
    if (!el || !ready) return;
    let raf = 0;
    const check = () => {
      raf = 0;
      const h = head.current;
      if (h) setCompact(el.scrollTop > h.offsetHeight - 64 - 28);
    };
    const onScroll = () => { if (!raf) raf = requestAnimationFrame(check); };
    el.addEventListener("scroll", onScroll, { passive: true });
    check();
    return () => {
      el.removeEventListener("scroll", onScroll);
      cancelAnimationFrame(raf);
    };
  }, [view, ready]);
  return { head, compact };
}

function InstanceDetail({ id }: { id: string }) {
  const { data: instance, error, refetch } = useInstance(id);
  const look = useLook(id);
  const [params, setParams] = useSearchParams();
  const tab = TABS.find((t) => t === params.get("tab")) ?? "content";
  const setTab = (t: Tab) => setParams({ tab: t }, { replace: true });
  const { head, compact } = useCompactHead(!!instance);
  const style = { "--acc": look.acc } as CSSProperties;

  if (error)
    return (
      <section className="page">
        <BackLink to="/instances">Bibliothek</BackLink>
        <ErrorBox className="mt-4" title="Diese Instanz konnte nicht geladen werden" error={error} onRetry={() => void refetch()} />
      </section>
    );

  if (!instance)
    return (
      <section className="detail" style={style} aria-busy aria-label="Wird geladen">
        <header className="dhead">
          <PixelScene bio={look.bio} seed={look.seed} mode="live" className="scene" />
          <div className="shade-head" />
          <div className="dh-full">
            <div className="dh-info">
              <BackLink to="/instances">Bibliothek</BackLink>
              <Skel style={{ height: 48, width: "min(460px, 60%)" }} />
              <Skel style={{ height: 28, width: 280 }} />
            </div>
          </div>
        </header>
        <nav className="dtabs" />
      </section>
    );

  return <Loaded instance={instance} tab={tab} setTab={setTab} head={head} compact={compact} style={style} />;
}

function Loaded({ instance, tab, setTab, head, compact, style }: {
  instance: Instance; tab: Tab; setTab: (t: Tab) => void; head: React.RefObject<HTMLElement | null>; compact: boolean; style: CSSProperties;
}) {
  const navigate = useNavigate();
  const look = useLook(instance.id);
  const [adding, setAdding] = useState(false);
  const mods = useUpdateMods(instance.id);
  const updates = useModUpdates(instance.id, instance.mods.length > 0);
  // Nur Updates, deren Stand noch stimmt: direkt nach dem Aktualisieren läuft der Check erst neu.
  const updateFor = new Map(
    (updates.data ?? []).filter((u) => instance.mods.some((m) => m.id === u.modId && m.version === u.currentVersion)).map((u) => [u.modId, u]),
  );
  const { warnsOf, total: warnTotal } = useWarnings(
    instance,
    () => setAdding(true),
    () => mods.mutate({ ...instance, mods: instance.mods.map((m) => (projectOf(m) === IRIS_PROJECT_ID ? { ...m, enabled: true } : m)) }),
  );
  const nUpd = updateFor.size;
  const toLog = () => setTab("console");

  const tabs: { id: Tab; label: string; count?: number }[] = [
    { id: "content", label: "Inhalte", count: instance.mods.length },
    { id: "console", label: "Protokoll" },
    { id: "settings", label: "Einstellungen" },
  ];

  return (
    <section className="detail" style={style}>
      <header ref={head} className={cn("dhead", compact && "compact")}>
        <PixelScene bio={look.bio} seed={look.seed} mode="live" className="scene" />
        <div className="shade-head" />
        <div className="dh-full" aria-hidden={compact || undefined}>
          <div className="dh-info">
            <BackLink to="/instances">Bibliothek</BackLink>
            <h1 title={instance.name}>{instance.name}</h1>
            <div className="chips">
              <Chip tone="acc">{loaderLine(instance)}</Chip>
              {instance.loaderVersion && <Chip className="hide-m">Loader {instance.loaderVersion}</Chip>}
              <StatusChip instance={instance} fixed />
              {nUpd > 0 && <Chip tone="warn"><b>{nUpd}</b>{nUpd === 1 ? "Update" : "Updates"}</Chip>}
            </div>
          </div>
          <div className="dh-act">
            <div className="row">
              <PlayButton instance={instance} onLaunched={toLog} tabIndex={compact ? -1 : undefined} />
              <InstanceMenuButton instance={instance} open={false} />
            </div>
            <PlayStatus instance={instance} style={{ justifyContent: "flex-end" }} />
          </div>
        </div>
        <div className="dh-compact" aria-hidden={!compact}>
          <Btn size="s" iconOnly icon="back" aria-label="Zur Bibliothek" tabIndex={compact ? 0 : -1} onClick={() => navigate("/instances")} />
          <h2 title={instance.name}>{instance.name}</h2>
          <Chip small tone="acc" className="hide-m">{loaderLine(instance)}</Chip>
          <PlayButton instance={instance} size="m" onLaunched={toLog} tabIndex={compact ? 0 : -1} />
        </div>
      </header>

      <nav className="dtabs" role="tablist" aria-label="Bereiche der Instanz">
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            id={`dt-${t.id}`}
            className="ptab fx"
            aria-selected={tab === t.id}
            aria-controls="dbody"
            onClick={() => setTab(t.id)}
          >
            {t.label}
            {t.count != null && <span className="num">{t.count}</span>}
            {t.id === "content" && (
              <Tip label={warnTotal ? `${warnTotal} ${warnTotal === 1 ? "Hinweis" : "Hinweise"}` : ""}>
                <span className="wdot inline-grid" style={{ visibility: warnTotal ? "visible" : "hidden" }}>
                  <Icon name="warn5" small />
                </span>
              </Tip>
            )}
            <i className="tick" />
          </button>
        ))}
      </nav>

      <div className="dbody" id="dbody" role="tabpanel" aria-labelledby={`dt-${tab}`}>
        {/* Bleibt gemountet: Auswahl und Platzhalter entfernter Inhalte überleben den Tabwechsel. */}
        <div hidden={tab !== "content"} className="flow-root">
          <ContentTab instance={instance} updateFor={updateFor} warnsOf={warnsOf} onAdd={() => setAdding(true)} />
        </div>
        {tab === "console" && <LogConsole instance={instance} />}
        {tab === "settings" && <SettingsTab instance={instance} />}
      </div>

      <AddContentSheet instance={instance} open={adding} onOpenChange={setAdding} />
    </section>
  );
}
