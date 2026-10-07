import { useLayoutEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router";
import { useView } from "@/app/Layout";
import { useI18n } from "@/i18n";
import { ChipButton, ContextMenu, PageHeader, SearchField, Select, TabPanel, Tabs, Toolbar, type MenuEntry } from "@/ui";
import { ContentDetail } from "@/components/catalog/ContentDetail";
import { DiscoverIntro } from "@/components/catalog/DiscoverIntro";
import { ContentResults } from "@/components/catalog/ContentResults";
import { searchPlaceholder, typeLabel } from "@/components/catalog/labels";
import { OtherTypeHits } from "@/components/catalog/OtherTypeHits";
import { SourceSelect } from "@/components/catalog/SourceSelect";
import { StarterResults } from "@/components/catalog/StarterResults";
import { useDebounced } from "@/hooks/useDebounced";
import { useVersions } from "@/hooks/useInstances";
import { usePersistedState } from "@/hooks/usePersistedState";
import {
  ALL_SOURCES, choiceInfo, defaultSort, SOURCE_KEYS, type CatalogHit, type CatalogType, type SearchIndex, type SourceChoice,
} from "@/lib/content-types";
import type { SearchRequest } from "@/lib/catalogSearch";
import { discoverParams, readDiscoverParams } from "@/lib/routes";
import { hasStarter } from "@/lib/starter";
import { ALL_LOADERS, LOADER_LABELS, type VersionEntry } from "@/lib/types";

const TABS = ["modpack", "mod", "shader", "resourcepack", "datapack"] as const satisfies readonly CatalogType[];

const ALL = "all";

/** Sortierung, die den Neustart überlebt; „auto“ = Downloads ohne Suchbegriff, sonst Relevanz. */
const SORT_CHOICES = ["auto", "relevance", "downloads", "follows", "newest", "updated"] as const;

/** Die jüngsten Releases stehen oben, alle älteren darunter unter „Ältere Versionen“. */
const RECENT_RELEASES = 12;
const OLDER_VERSIONS = "older";

/** Die Auswahl der Werkzeugleiste (ohne Sortierung, die als Vorliebe gemerkt wird). */
interface Filters {
  query: string;
  version: string;
  loader: string;
  /** Kategorie des Anbieters, auf die die Treffer eingegrenzt sind. */
  category: string | null;
  /** „Zum Einstieg“: statt der Suche die feste Auswahl der Art. */
  starter: boolean;
}

const NO_FILTERS: Filters = { query: "", version: ALL, loader: ALL, category: null, starter: false };

/** Alle Release-Versionen, die jüngsten zuerst; „Ältere Versionen“ ist ein Trenner, nur wenn es ältere gibt. */
function versionOptions(versions: VersionEntry[], allLabel: string, olderLabel: string) {
  const releases = versions.filter((v) => v.type === "release");
  const option = (v: VersionEntry) => ({ value: v.id, label: v.id });
  const older = releases.slice(RECENT_RELEASES);
  return [
    { value: ALL, label: allLabel },
    ...releases.slice(0, RECENT_RELEASES).map(option),
    ...(older.length > 0 ? [{ value: OLDER_VERSIONS, label: olderLabel, disabled: true }, ...older.map(option)] : []),
  ];
}

/** Der gewählte Reiter: laut Adresse, sonst der zuletzt benutzte, sonst der erste, den die Quelle führt. */
function useDiscoverTab(requested: string | null, tabs: CatalogType[]) {
  const [last, remember] = usePersistedState("discover.tab", TABS);
  const type = tabs.find((tab) => tab === requested) ?? tabs.find((tab) => tab === last) ?? tabs[0];
  return { type, remember };
}

/** Stöbern ohne Instanz: Modpacks werden zu neuen Instanzen, Datenpakete landen in einer Welt, alles andere in einer bestehenden Instanz. */
export function DiscoverPage() {
  const { t } = useI18n();
  const [params, setParams] = useSearchParams();
  const requested = readDiscoverParams(params);
  // Die Liste zeigt eine einzelne Quelle oder, ohne Angabe, alle.
  const source: SourceChoice = SOURCE_KEYS.find((s) => s === requested.source) ?? ALL_SOURCES;
  const info = choiceInfo(source);
  const tabs = TABS.filter((tab) => info.types.includes(tab));
  const { type, remember: rememberTab } = useDiscoverTab(requested.tab, tabs);
  // Ein Projekt in der Adresse öffnet direkt die Details (z. B. aus dem Dialog „Neue Instanz“); ohne Anbieter ist es von Modrinth.
  const projectId = requested.project;
  const projectSource = SOURCE_KEYS.find((s) => s === requested.projectSource) ?? (source === ALL_SOURCES ? "modrinth" : source);
  const [hit, setHit] = useState<CatalogHit | null>(null);
  const [filters, setFilters] = useState(NO_FILTERS);
  const [sortChoice, setSortChoice] = usePersistedState("discover.sort", SORT_CHOICES);
  const sort = sortChoice === "auto" ? null : sortChoice;
  const query = filters.query.trim();
  const settledQuery = useDebounced(query);
  const versions = useVersions();
  const hasLoaderFilter = (tab: CatalogType) => info.filters && (tab === "mod" || tab === "modpack");
  const starterAvailable = hasStarter(type) && (source === ALL_SOURCES || source === "modrinth");
  const showStarter = filters.starter && starterAvailable && !query;
  const view = useView();
  const listScroll = useRef(0);

  const change = (patch: Partial<Filters>) => setFilters((current) => ({ ...current, ...patch }));
  const reset = () => setFilters(NO_FILTERS);

  const mc = filters.version === ALL ? null : filters.version;
  const loaderFor = (tab: CatalogType) => (hasLoaderFilter(tab) && filters.loader !== ALL ? filters.loader : null);
  // Dieselbe Suche für einen anderen Reiter; Filter, die dort nicht gelten, fallen weg.
  const requestFor = (tab: CatalogType): SearchRequest => ({
    query: settledQuery, type: tab, mc, loader: loaderFor(tab), category: null, index: sort ?? defaultSort(settledQuery),
  });

  // Details beginnen oben; zurück in der Liste steht man wieder, wo man war.
  useLayoutEffect(() => {
    const el = view.current;
    if (el) el.scrollTop = projectId ? 0 : listScroll.current;
  }, [projectId, view]);

  const open = (id: string, h: CatalogHit) => {
    listScroll.current = view.current?.scrollTop ?? 0;
    setHit(h);
    setParams(discoverParams({ tab: type, source, project: id, projectSource: h.source }));
  };

  const openTab = (tab: CatalogType) => {
    change({ loader: hasLoaderFilter(tab) ? filters.loader : ALL, category: null, starter: false });
    rememberTab(tab);
    setParams(discoverParams({ tab, source }), { replace: true });
  };

  const tabMenu: MenuEntry[] = tabs.map((tab) => ({
    id: tab, text: typeLabel(tab), checked: tab === type, onSelect: () => openTab(tab),
  }));
  const listMenu: MenuEntry[] = [
    { id: "reset", text: t("components.search.resetFilters"), onSelect: reset },
    "-",
    ...tabMenu,
  ];

  return (
    <>
      {projectId && (
        <ContextMenu items={[{
          id: "back", text: t("common.back"), icon: "back",
          onSelect: () => setParams(discoverParams({ tab: type, source })),
        }, "-", ...tabMenu]}>
        <div className="page disc-proj">
          <ContentDetail
            key={`${projectSource}-${projectId}`}
            source={projectSource}
            projectId={projectId}
            type={type}
            hit={hit?.project_id === projectId && hit.source === projectSource ? hit : null}
            backLabel={typeLabel(type)}
            onBack={() => setParams(discoverParams({ tab: type, source }))}
          />
        </div>
        </ContextMenu>
      )}
      {/* Bleibt beim Öffnen von Details erhalten, damit Suche und geladene Seiten nicht verloren gehen. */}
      <ContextMenu items={listMenu}>
      <section className="page disc" hidden={!!projectId}>
        <PageHeader title={t("ui.nav.discover")}>
          {tabs.length > 1 && (
            <Tabs
              variant="segment"
              idBase="disc"
              label={t("pages.discover.categoryLabel")}
              value={type}
              onChange={openTab}
              items={tabs.map((tab) => ({ value: tab, label: typeLabel(tab) }))}
            />
          )}
        </PageHeader>
        {/* Suchfeld bewusst breiter als in der Bibliothek */}
        <Toolbar search="l" label={t("pages.discover.searchFilterLabel")} className="mt-4 mb-3.5">
          <SearchField
            value={filters.query}
            onChange={(next) => change({ query: next, ...(next.trim() && { starter: false }) })}
            placeholder={searchPlaceholder(type)}
          />
          <SourceSelect
            value={source}
            onChange={(next) => {
              reset();
              setParams(discoverParams({ source: next }), { replace: true });
            }}
          />
          {info.versions && (
            <Select
              label={t("common.version")}
              value={filters.version}
              disabled={showStarter}
              onChange={(version) => change({ version })}
              options={versionOptions(versions.data ?? [], t("common.all"), t("pages.discover.olderVersions"))}
            />
          )}
          {hasLoaderFilter(type) && (
            <Select
              label={t("components.common.loader")}
              value={filters.loader}
              disabled={showStarter}
              onChange={(loader) => change({ loader })}
              options={[{ value: ALL, label: t("common.all") }, ...ALL_LOADERS.filter((l) => l !== "vanilla").map((l) => ({ value: l, label: LOADER_LABELS[l] }))]}
            />
          )}
        </Toolbar>
        <DiscoverIntro key={type} type={type} />
        <TabPanel idBase="disc" value={type}>
          <div className="mb-2 flex flex-wrap items-center gap-x-3 empty:hidden">
            {starterAvailable && (
              <ChipButton pressed={showStarter} onClick={() => change({ starter: !showStarter })}>{t("pages.discover.starter")}</ChipButton>
            )}
            {!showStarter && <OtherTypeHits source={source} types={tabs.filter((tab) => tab !== type)} requestFor={requestFor} onPick={openTab} />}
          </div>
          {showStarter ? (
            <StarterResults type={type} onOpen={open} />
          ) : (
            <ContentResults
              key={`${source}-${type}`}
              source={source}
              type={type}
              filter={{ query: filters.query, mc, loader: loaderFor(type), category: filters.category, sort }}
              onReset={reset}
              onOpen={open}
              onCategory={(category) => change({ category })}
              sortSelect={
                info.filters && (
                  <Select
                    size="s"
                    label={t("pages.instances.sortLabel")}
                    value={sort ?? defaultSort(query)}
                    onChange={(next) => setSortChoice(next as SearchIndex)}
                    options={[
                      { value: "relevance", label: t("pages.discover.sortRelevance") },
                      { value: "downloads", label: t("pages.discover.sortDownloads") },
                      { value: "follows", label: t("pages.discover.sortFollows") },
                      { value: "newest", label: t("pages.discover.sortNewest") },
                      { value: "updated", label: t("components.sort.updated") },
                    ]}
                  />
                )
              }
            />
          )}
        </TabPanel>
      </section>
      </ContextMenu>
    </>
  );
}
