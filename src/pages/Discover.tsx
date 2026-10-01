import { useLayoutEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router";
import { useView } from "@/app/Layout";
import { useI18n } from "@/i18n";
import { PageHeader, SearchField, Select, Spacer, TabPanel, Tabs, Toolbar } from "@/ui";
import { ContentDetail } from "@/components/catalog/ContentDetail";
import { ContentResults } from "@/components/catalog/ContentResults";
import { searchPlaceholder, sourceChoiceLabel, typeLabel } from "@/components/catalog/labels";
import { useVersions } from "@/hooks/useInstances";
import {
  ALL_SOURCES, choiceInfo, defaultSort, SOURCE_KEYS, type CatalogHit, type CatalogType, type SearchIndex, type SourceChoice,
} from "@/lib/content-types";
import { WIDTH } from "@/lib/breakpoints";
import { discoverParams, readDiscoverParams } from "@/lib/routes";
import { ALL_LOADERS, LOADER_LABELS } from "@/lib/types";

const TABS: CatalogType[] = ["modpack", "mod", "shader", "resourcepack", "datapack"];
const SOURCE_CHOICES: SourceChoice[] = [ALL_SOURCES, ...SOURCE_KEYS];

const ALL = "all";

/** Die Auswahl der Werkzeugleiste. `sort` = null: automatisch (Downloads ohne Suchbegriff, sonst Relevanz). */
interface Filters {
  query: string;
  version: string;
  loader: string;
  sort: SearchIndex | null;
}

const NO_FILTERS: Filters = { query: "", version: ALL, loader: ALL, sort: null };

/** Stöbern ohne Instanz: Modpacks werden zu neuen Instanzen, Datenpakete landen in einer Welt, alles andere in einer bestehenden Instanz. */
export function DiscoverPage() {
  const { t } = useI18n();
  const [params, setParams] = useSearchParams();
  const requested = readDiscoverParams(params);
  // Die Liste zeigt eine einzelne Quelle oder, ohne Angabe, alle.
  const source: SourceChoice = SOURCE_KEYS.find((s) => s === requested.source) ?? ALL_SOURCES;
  const info = choiceInfo(source);
  const tabs = TABS.filter((tab) => info.types.includes(tab));
  const type = tabs.find((tab) => tab === requested.tab) ?? tabs[0];
  // Ein Projekt in der Adresse öffnet direkt die Details (z. B. aus dem Dialog „Neue Instanz“); ohne Anbieter ist es von Modrinth.
  const projectId = requested.project;
  const projectSource = SOURCE_KEYS.find((s) => s === requested.projectSource) ?? (source === ALL_SOURCES ? "modrinth" : source);
  const [hit, setHit] = useState<CatalogHit | null>(null);
  const [filters, setFilters] = useState(NO_FILTERS);
  const versions = useVersions();
  const releases = versions.data?.filter((v) => v.type === "release").slice(0, 12) ?? [];
  const withLoader = info.filters && (type === "mod" || type === "modpack");
  const view = useView();
  const listScroll = useRef(0);

  const change = (patch: Partial<Filters>) => setFilters((current) => ({ ...current, ...patch }));
  const reset = () => setFilters(NO_FILTERS);

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

  return (
    <>
      {projectId && (
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
      )}
      {/* Bleibt beim Öffnen von Details erhalten, damit Suche und geladene Seiten nicht verloren gehen. */}
      <section className="page disc" hidden={!!projectId}>
        <PageHeader title={t("ui.nav.discover")}>
          {tabs.length > 1 && (
            <Tabs
              variant="segment"
              idBase="disc"
              label={t("pages.discover.categoryLabel")}
              value={type}
              onChange={(next) => {
                if (next !== "mod" && next !== "modpack") change({ loader: ALL });
                setParams(discoverParams({ tab: next, source }), { replace: true });
              }}
              items={tabs.map((tab) => ({ value: tab, label: typeLabel(tab) }))}
            />
          )}
        </PageHeader>
        {/* Suchfeld bewusst breiter als in der Bibliothek; unter 1096 px bricht die Leiste um */}
        <Toolbar search="l" wrapBelow={WIDTH.lg} label={t("pages.discover.searchFilterLabel")} className="mt-4 mb-3.5">
          <SearchField value={filters.query} onChange={(query) => change({ query })} placeholder={searchPlaceholder(type)} autoFocus />
          <Select
            label={t("components.sheet.sourceLabel")}
            value={source}
            onChange={(next) => {
              reset();
              setParams(discoverParams({ source: next as SourceChoice }), { replace: true });
            }}
            options={SOURCE_CHOICES.map((s) => ({ value: s, label: sourceChoiceLabel(s) }))}
          />
          {info.versions && (
            <Select
              label={t("common.version")}
              value={filters.version}
              onChange={(version) => change({ version })}
              options={[{ value: ALL, label: t("common.all") }, ...releases.map((v) => ({ value: v.id, label: v.id }))]}
            />
          )}
          {withLoader && (
            <Select
              label={t("components.common.loader")}
              value={filters.loader}
              onChange={(loader) => change({ loader })}
              options={[{ value: ALL, label: t("common.all") }, ...ALL_LOADERS.filter((l) => l !== "vanilla").map((l) => ({ value: l, label: LOADER_LABELS[l] }))]}
            />
          )}
          <Spacer />
          {info.filters && (
            <Select
              label={t("pages.instances.sortLabel")}
              value={filters.sort ?? defaultSort(filters.query.trim())}
              onChange={(sort) => change({ sort: sort as SearchIndex })}
              options={[
                { value: "relevance", label: t("pages.discover.sortRelevance") },
                { value: "downloads", label: t("pages.discover.sortDownloads") },
                { value: "follows", label: t("pages.discover.sortFollows") },
                { value: "newest", label: t("pages.discover.sortNewest") },
                { value: "updated", label: t("components.sort.updated") },
              ]}
            />
          )}
        </Toolbar>
        <TabPanel idBase="disc" value={type}>
          <ContentResults
            key={`${source}-${type}`}
            source={source}
            type={type}
            filter={{
              query: filters.query,
              mc: filters.version === ALL ? null : filters.version,
              loader: withLoader && filters.loader !== ALL ? filters.loader : null,
              sort: filters.sort,
            }}
            onReset={reset}
            onOpen={open}
          />
        </TabPanel>
      </section>
    </>
  );
}
