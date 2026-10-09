import { useState, type RefObject } from "react";
import { useParams, useSearchParams } from "react-router";
import { useI18n } from "@/i18n";
import { ErrorBox } from "@/components/ErrorBox";
import { BackLink, ContextMenu, HeroShade, Icon, Page, Skel, TabPanel, Tabs, TabsSkel, type MenuEntry, type TabItem } from "@/ui";
import { LogConsole } from "@/components/log/LogConsole";
import { AddContentSheet } from "@/components/catalog/AddContentSheet";
import { useInstanceMenu } from "@/components/instance";
import { useContentAnalysis } from "@/hooks/useContentAnalysis";
import { useCurrentUpdates } from "@/hooks/useContent";
import { useInstance } from "@/hooks/useInstances";
import { instanceTabParams, readInstanceTab, type InstanceTab } from "@/lib/routes";
import { updatesLabel } from "@/lib/format";
import type { Instance } from "@/lib/types";
import { PixelScene } from "@/pixel/PixelScene";
import { useLook } from "@/store/look";
import { ContentTab } from "./detail/ContentTab";
import { useWarnings } from "./detail/content/useWarnings";
import { DetailHead } from "./detail/DetailHead";
import { ScreenshotsTab } from "./detail/ScreenshotsTab";
import { SettingsTab } from "./detail/SettingsTab";
import { useCompactHead } from "./detail/useCompactHead";
import { WorldsTab } from "./detail/WorldsTab";

export function InstanceDetailPage() {
  const { id = "" } = useParams();
  // Inhalt einer anderen Instanz wird neu gemountet, nicht umgeschrieben.
  return <InstanceDetail key={id} id={id} />;
}

function InstanceDetail({ id }: { id: string }) {
  const { t } = useI18n();
  const { data: instance, error, refetch } = useInstance(id);
  const [params, setParams] = useSearchParams();
  const tab = readInstanceTab(params);
  const setTab = (next: InstanceTab) => setParams(instanceTabParams(next), { replace: true });
  const { head, compact } = useCompactHead(!!instance);

  if (error)
    return (
      <Page>
        <BackLink to="/instances">{t("ui.nav.library")}</BackLink>
        <ErrorBox title={t("pages.detail.loadErrorTitle")} error={error} onRetry={() => void refetch()} />
      </Page>
    );
  if (!instance) return <DetailSkeleton id={id} />;
  return <Loaded instance={instance} tab={tab} setTab={setTab} head={head} compact={compact} />;
}

function DetailSkeleton({ id }: { id: string }) {
  const { t } = useI18n();
  const look = useLook(id);
  return (
    <section className="detail" aria-busy aria-label={t("components.common.loadingAria")}>
      <header className="dhead">
        <PixelScene bio={look.bio} seed={look.seed} mode="live" className="scene" />
        <HeroShade />
        <div className="dh-full">
          <div className="dh-info">
            <div className="dh-back"><BackLink to="/instances" onScene>{t("ui.nav.library")}</BackLink></div>
            <Skel className="h-[52px] w-[min(460px,60%)]" />
            <Skel className="h-7 w-[280px]" />
          </div>
        </div>
      </header>
      <TabsSkel />
      <div className="dbody"><Skel className="h-8 w-full" /></div>
    </section>
  );
}

/** Reiter der Instanzseite; „Inhalte“ trägt die Anzahl und, wenn es Hinweise gibt, das Warnsymbol. */
function useDetailTabs(modCount: number, warnTotal: number): TabItem<InstanceTab>[] {
  const { t } = useI18n();
  // Anzahl der Hinweise als Text (für Vorleser und Tooltip), mit Einzahl/Mehrzahl.
  const warnText = warnTotal
    ? t(warnTotal === 1 ? "pages.detail.warningCount.one" : "pages.detail.warningCount.other", { n: warnTotal })
    : "";
  return [
    {
      value: "content",
      label: t("pages.detail.tabContent"),
      count: modCount,
      // Warnsymbol nur mit Hinweisen (sonst bliebe eine Lücke hinter der Zahl); die Anzahl auch für Screenreader, nicht nur im Tooltip.
      badge: warnText ? (
        <>
          <Icon name="warn" size="s" tone="warn" />
          <span className="sr">, {warnText}</span>
        </>
      ) : undefined,
      tip: warnText || undefined,
    },
    { value: "worlds", label: t("common.worlds") },
    { value: "screenshots", label: t("components.export.entry.screenshots") },
    { value: "console", label: t("components.log.ariaLabel") },
    { value: "settings", label: t("common.settings") },
  ];
}

function Loaded({ instance, tab, setTab, head, compact }: {
  instance: Instance; tab: InstanceTab; setTab: (tab: InstanceTab) => void; head: RefObject<HTMLElement | null>; compact: boolean;
}) {
  const { t } = useI18n();
  const [adding, setAdding] = useState(false);
  // Absturzassistent: „Mod suchen“ öffnet das Hinzufügen mit vorbelegter Suche; `seed` baut den Dialog dafür neu auf.
  const [search, setSearch] = useState({ query: "", seed: 0 });
  const addContentFor = (query: string) => {
    setSearch(({ seed }) => ({ query, seed: seed + 1 }));
    setAdding(true);
  };
  const updateFor = useCurrentUpdates(instance, instance.mods.length > 0);
  const analysis = useContentAnalysis(instance).data;
  const { findingsOf, total: warnTotal } = useWarnings(instance, analysis?.issues ?? []);
  const tabs = useDetailTabs(instance.mods.length, warnTotal);
  const instanceItems = useInstanceMenu(instance, { showOpen: false });
  const toLog = () => setTab("console");
  // Klick auf „Updates“ im Kopf: Inhalte zeigen und „Alle aktualisieren“ in den Blick holen.
  const [updateClicks, setUpdateClicks] = useState(0);
  const showUpdates = () => {
    setTab("content");
    setUpdateClicks((n) => n + 1);
  };

  // Klick auf „Pack-Update“ im Kopf: Einstellungen zeigen und den Modpack-Abschnitt in den Blick holen.
  const [packRequested, setPackRequested] = useState(false);
  const showPack = () => {
    setTab("settings");
    setPackRequested(true);
  };

  const menuItems: MenuEntry[] = [
    { label: instance.name },
    ...instanceItems.filter((item) => item === "-" || !("id" in item) || (item.id !== "settings" && item.id !== "log")),
    "-",
    { id: "content", text: t("pages.detail.tabContent"), icon: "mod", checked: tab === "content", onSelect: () => setTab("content") },
    { id: "add-content", text: t("common.add"), icon: "plus", onSelect: () => setAdding(true) },
    { id: "updates", text: updatesLabel(updateFor.size), icon: "update", disabled: !updateFor.size, onSelect: showUpdates },
    { id: "worlds", text: t("common.worlds"), icon: "world", checked: tab === "worlds", onSelect: () => setTab("worlds") },
    { id: "screenshots", text: t("components.export.entry.screenshots"), icon: "screenshot", checked: tab === "screenshots", onSelect: () => setTab("screenshots") },
    { id: "console", text: t("components.log.ariaLabel"), icon: "terminal", checked: tab === "console", onSelect: toLog },
    { id: "settings", text: t("common.settings"), icon: "settings", checked: tab === "settings", onSelect: () => setTab("settings") },
  ];

  return (
    <ContextMenu items={menuItems}>
    <section className="detail">
      <DetailHead
        instance={instance}
        headRef={head}
        compact={compact}
        updateCount={updateFor.size}
        onShowUpdates={showUpdates}
        onShowPack={showPack}
        onLaunched={toLog}
      />

      {/* Leiste klebt unter dem kompakten Kopf; Seitenrand wie der Seitenkopf (Seitengerüst). */}
      <Tabs
        idBase="dt"
        sticky="var(--dc)"
        gutter
        label={t("pages.detail.tabsLabel")}
        items={tabs}
        value={tab}
        onChange={setTab}
      />

      <TabPanel idBase="dt" value={tab} className="dbody">
        {/* Bleibt gemountet: Auswahl und Platzhalter entfernter Inhalte überleben den Tabwechsel. */}
        <div hidden={tab !== "content"} className="flow-root">
          <ContentTab
            instance={instance}
            shown={tab === "content"}
            updateFor={updateFor}
            analysis={analysis}
            findingsOf={findingsOf}
            onAdd={() => setAdding(true)}
            showUpdates={updateClicks}
          />
        </div>
        {tab === "worlds" && <WorldsTab instance={instance} onLaunched={toLog} />}
        {tab === "screenshots" && <ScreenshotsTab instance={instance} />}
        {tab === "console" && <LogConsole instance={instance} onAddContent={addContentFor} />}
        {tab === "settings" && <SettingsTab instance={instance} packRequested={packRequested} onPackShown={() => setPackRequested(false)} />}
      </TabPanel>

      <AddContentSheet key={search.seed} instance={instance} open={adding} onOpenChange={setAdding} initialQuery={search.query} />
    </section>
    </ContextMenu>
  );
}
