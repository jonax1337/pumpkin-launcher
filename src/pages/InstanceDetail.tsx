import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router";
import { useView } from "@/app/Layout";
import { useI18n } from "@/i18n";
import { Actions, BackLink, Button, Count, ErrorBox, Icon, IconButton, Meta, Skel, TabPanel, Tabs, type TabItem } from "@/ui";
import { LogConsole, PlayButton, PlayStatus, StatusChip, usePhase } from "@/components/game";
import { playtimeLine } from "@/components/common";
import { InstanceMenuButton } from "@/components/instance";
import { AddContentSheet, IRIS_PROJECT_ID } from "@/components/ContentBrowser";
import { useModUpdates } from "@/hooks/useContent";
import { useInstance, useUpdateMods } from "@/hooks/useInstances";
import { projectOf } from "@/lib/modrinth";
import { LOADER_LABELS, type Instance } from "@/lib/types";
import { cn } from "@/lib/utils";
import { PixelScene } from "@/pixel/PixelScene";
import { useLook } from "@/store/look";
import { ContentTab, useWarnings } from "./detail/ContentTab";
import { ScreenshotsTab } from "./detail/ScreenshotsTab";
import { SettingsTab } from "./detail/SettingsTab";
import { WorldsTab } from "./detail/WorldsTab";

type Tab = "content" | "worlds" | "screenshots" | "console" | "settings";
const TABS: Tab[] = ["content", "worlds", "screenshots", "console", "settings"];

/** Schmales Fenster (bis 900 px): Loader-Version und Kurzinfo im kompakten Kopf entfallen. */
const NARROW = "(max-width: 900px)";
const subscribeNarrow = (cb: () => void) => {
  const mq = matchMedia(NARROW);
  mq.addEventListener("change", cb);
  return () => mq.removeEventListener("change", cb);
};
const useNarrow = () => useSyncExternalStore(subscribeNarrow, () => matchMedia(NARROW).matches);

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
  const { t } = useI18n();
  const { data: instance, error, refetch } = useInstance(id);
  const look = useLook(id);
  const [params, setParams] = useSearchParams();
  const tab = TABS.find((tb) => tb === params.get("tab")) ?? "content";
  const setTab = (next: Tab) => setParams({ tab: next }, { replace: true });
  const { head, compact } = useCompactHead(!!instance);

  if (error)
    return (
      <section className="page">
        <BackLink to="/instances">{t("ui.nav.library")}</BackLink>
        <ErrorBox className="mt-4" title={t("pages.detail.loadErrorTitle")} error={error} onRetry={() => void refetch()} />
      </section>
    );

  if (!instance)
    return (
      <section className="detail" aria-busy aria-label={t("components.common.loadingAria")}>
        <header className="dhead">
          <PixelScene bio={look.bio} seed={look.seed} mode="live" className="scene" />
          <div className="shade-head" />
          <div className="dh-full">
            <div className="dh-info">
              <div className="flex"><BackLink to="/instances" onScene>{t("ui.nav.library")}</BackLink></div>
              <Skel h={48} w="min(460px, 60%)" />
              <Skel h={28} w={280} />
            </div>
          </div>
        </header>
        <div className="dtabs" />
      </section>
    );

  return <Loaded instance={instance} tab={tab} setTab={setTab} head={head} compact={compact} />;
}

function Loaded({ instance, tab, setTab, head, compact }: {
  instance: Instance; tab: Tab; setTab: (t: Tab) => void; head: React.RefObject<HTMLElement | null>; compact: boolean;
}) {
  const navigate = useNavigate();
  const { t } = useI18n();
  const narrow = useNarrow();
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
  // Anzahl der Hinweise als Text (für Vorleser und Tooltip), mit Einzahl/Mehrzahl.
  const warnText = warnTotal ? t(warnTotal === 1 ? "pages.detail.warningCount.one" : "pages.detail.warningCount.other", { n: warnTotal }) : "";
  // Der Spielen-Knopf zeigt den Zustand; in der Infozeile bleibt nur ein Absturz als Hinweis.
  const crashed = usePhase(instance.id) === "crashed";
  const toLog = () => setTab("console");
  // Klick auf „Updates“ im Kopf: Inhalte zeigen und „Alle aktualisieren“ in den Blick holen.
  const [updCall, setUpdCall] = useState(0);
  const showUpdates = () => { setTab("content"); setUpdCall((n) => n + 1); };

  const version = <>{LOADER_LABELS[instance.loader]} <Count value={instance.minecraftVersion} size={20} /></>;
  const tabs: TabItem<Tab>[] = [
    {
      value: "content",
      label: t("pages.detail.tabContent"),
      count: instance.mods.length,
      // Warnsymbol: Platz bleibt reserviert (kein Springen); die Anzahl auch für Screenreader, nicht nur im Tooltip.
      badge: (
        <>
          <Icon name="warn" size="s" tone="warn" className={cn(!warnTotal && "invisible")} />
          {warnTotal > 0 && <span className="sr">, {warnText}</span>}
        </>
      ),
      tip: warnText || undefined,
    },
    { value: "worlds", label: t("common.worlds") },
    { value: "screenshots", label: t("components.export.entry.screenshots") },
    { value: "console", label: t("components.log.ariaLabel") },
    { value: "settings", label: t("common.settings") },
  ];

  return (
    <section className="detail">
      <header ref={head} className={cn("dhead", compact && "compact")}>
        <PixelScene bio={look.bio} seed={look.seed} mode="live" className="scene" />
        <div className="shade-head" />
        <div className="dh-full" aria-hidden={compact || undefined}>
          <div className="dh-info">
            <div className="flex"><BackLink to="/instances" onScene>{t("ui.nav.library")}</BackLink></div>
            <h1 title={instance.name}>{instance.name}</h1>
            {/* Infos als ruhiger Text, Absturz als Chip, Updates als Knopf: was klickbar ist, sieht so aus. */}
            <div className="dh-meta">
              <Meta
                size="l"
                onScene
                className="overflow-hidden"
                items={[version, !narrow && instance.loaderVersion && <>{t("components.common.loader")} <Count value={instance.loaderVersion} size={20} /></>, !narrow && playtimeLine(instance)]}
              />
              {crashed && <StatusChip instance={instance} />}
              {nUpd > 0 && (
                <Button size="s" icon="up" count={nUpd} onScene onClick={showUpdates} tabIndex={compact ? -1 : undefined}>
                  {nUpd === 1 ? t("common.update") : t("common.updates")}
                </Button>
              )}
            </div>
          </div>
          <div className="dh-act">
            <Actions>
              <PlayButton instance={instance} onLaunched={toLog} tabIndex={compact ? -1 : undefined} />
              <InstanceMenuButton instance={instance} open={false} />
            </Actions>
            <PlayStatus instance={instance} />
          </div>
        </div>
        <div className="dh-compact" aria-hidden={!compact}>
          <IconButton size="s" icon="back" label={t("pages.detail.toLibraryLabel")} onScene tabIndex={compact ? 0 : -1} onClick={() => navigate("/instances")} />
          <h2 title={instance.name}>{instance.name}</h2>
          {!narrow && <Meta onScene className="flex-none" items={[version]} />}
          <PlayButton instance={instance} size="m" onLaunched={toLog} tabIndex={compact ? 0 : -1} />
        </div>
      </header>

      {/* Leiste klebt unter dem kompakten Kopf; .dtabs gibt nur den Seitenrand (Seitengerüst). */}
      <Tabs idBase="dt" sticky="var(--dc)" className="dtabs" label={t("pages.detail.tabsLabel")} items={tabs} value={tab} onChange={setTab} />

      <TabPanel idBase="dt" value={tab} className="dbody">
        {/* Bleibt gemountet: Auswahl und Platzhalter entfernter Inhalte überleben den Tabwechsel. */}
        <div hidden={tab !== "content"} className="flow-root">
          <ContentTab instance={instance} shown={tab === "content"} updateFor={updateFor} warnsOf={warnsOf} onAdd={() => setAdding(true)} showUpdates={updCall} />
        </div>
        {tab === "worlds" && <WorldsTab instance={instance} onLaunched={toLog} />}
        {tab === "screenshots" && <ScreenshotsTab instance={instance} />}
        {tab === "console" && <LogConsole instance={instance} />}
        {tab === "settings" && <SettingsTab instance={instance} />}
      </TabPanel>

      <AddContentSheet instance={instance} open={adding} onOpenChange={setAdding} />
    </section>
  );
}
