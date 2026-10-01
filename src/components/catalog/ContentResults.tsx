import type { ReactNode } from "react";
import { useInfiniteQuery } from "@tanstack/react-query";
import { useI18n } from "@/i18n";
import { Button, ButtonLink, Cell, Chip, Count, Empty, ErrorBox, Hint, Icon, List, ListRow, ProjectIcon, RowTitle, SectionHeader, SkelRow, type GlyphBox, type ListVariant } from "@/ui";
import { useDebounced } from "@/hooks/useDebounced";
import { WIDTH } from "@/lib/breakpoints";
import { catalogApi } from "@/lib/catalogApi";
import {
  defaultSort, installedKey, SOURCES, type CatalogType, type ContentHit, type SearchIndex, type Source,
} from "@/lib/content-types";
import { formatCount, formatDownloads } from "@/lib/format";
import type { Instance, World } from "@/lib/types";
import { AddRowButton } from "./AddButtons";
import { ContentAction } from "./ContentAction";
import { fitFilter, fitsLabel } from "./fit";
import { InstalledChipRow, useInstalledIn } from "./InstalledIn";
import { categoryNames, sortHeading, typeLabel } from "./labels";

/** Platzhalter, solange die erste Seite der Treffer lädt. */
const SKELETON_ROWS = 6;

/** Treffer je Seite; die Einblendung der Zeilen beginnt mit jeder Seite neu. */
const PAGE_SIZE = 20;

const FEATURE_ICON_BOX: GlyphBox = 104;

/** Was die Suche eingrenzt. `sort` fehlt = Downloads ohne Suchbegriff, sonst Relevanz. */
interface SearchFilter {
  query: string;
  mc: string | null;
  loader: string | null;
  sort: SearchIndex | null;
}

/** Wie die Trefferliste aussieht: als Seite in „Entdecken“ oder schmal im Seitenpanel einer Instanz. */
interface ResultsLayout {
  list: ListVariant;
  heading: { as: "h2" | "h3"; size: "section" | "card" };
  emptySize: "section" | "pane";
  offlineSize: "page" | "pane";
  /** Offline führt die Seite zur Bibliothek; das Seitenpanel bleibt, wo es ist. */
  offlineLibraryLink: boolean;
  iconBox: GlyphBox;
  /** So viele Kategorien stehen in der Metazeile. */
  categories: number;
  showAuthor: boolean;
}

const PAGE_LAYOUT: ResultsLayout = {
  list: "catalog", heading: { as: "h2", size: "section" }, emptySize: "section", offlineSize: "page", offlineLibraryLink: true,
  iconBox: 72, categories: 2, showAuthor: true,
};

const SIDE_LAYOUT: ResultsLayout = {
  list: "catalog-compact", heading: { as: "h3", size: "card" }, emptySize: "pane", offlineSize: "pane", offlineLibraryLink: false,
  iconBox: 40, categories: 0, showAuthor: false,
};

/** Was rechts in der Zeile steht, und was die Metazeile über die Standardangaben hinaus zeigt. */
interface RowParts {
  action: ReactNode;
  meta?: ReactNode;
}

/** Die Suche mit Tippause; weitere Seiten lädt `fetchNextPage`. */
function useCatalogSearch(source: Source, type: CatalogType, filter: SearchFilter) {
  const query = useDebounced(filter.query.trim());
  const index = filter.sort ?? defaultSort(query);
  const results = useInfiniteQuery(catalogApi(source).searchQuery({ query, type, mc: filter.mc, loader: filter.loader, index }));
  const hits = results.data?.pages.flatMap((p) => p.hits) ?? [];
  const total = results.data?.pages[0]?.total_hits ?? 0;
  return { results, query, index, hits, total };
}

type CatalogSearch = ReturnType<typeof useCatalogSearch>;

/** Keine Verbindung: Katalog braucht Internet. */
function Offline({ onRetry, layout }: { onRetry: () => void; layout: ResultsLayout }) {
  const { t } = useI18n();
  return (
    <Empty
      title={t("components.offline.title")}
      size={layout.offlineSize}
      actions={
        <>
          <Button icon="redo" onClick={onRetry}>{t("common.retry")}</Button>
          {layout.offlineLibraryLink && <ButtonLink variant="ghost" to="/instances">{t("components.offline.toLibrary")}</ButtonLink>}
        </>
      }
    >
      {t("components.offline.text")}
    </Empty>
  );
}

function ResultRow({ hit, index, feature, layout, parts, onOpen }: {
  hit: ContentHit; index: number; feature: boolean; layout: ResultsLayout; parts: RowParts; onOpen: (projectId: string, hit: ContentHit) => void;
}) {
  const { t } = useI18n();
  return (
    <ListRow feature={feature} index={index % PAGE_SIZE} hit={{ onClick: () => onOpen(hit.project_id, hit), label: t("components.search.viewProject", { name: hit.title }) }}>
      <ProjectIcon url={hit.icon_url} seed={hit.project_id} box={feature ? FEATURE_ICON_BOX : layout.iconBox} />
      <RowTitle
        size="l"
        title={hit.title}
        aside={layout.showAuthor ? t("components.search.byAuthor", { author: hit.author }) : undefined}
        sub={hit.description}
        meta={
          <>
            <span><Count value={formatDownloads(hit.downloads)} /> {t("components.stats.downloads")}</span>
            {categoryNames(hit.categories, layout.categories).map((c) => <Chip key={c} size="s" data-hide={WIDTH.sm}>{c}</Chip>)}
            {parts.meta}
          </>
        }
      />
      <Cell flex align="end">{parts.action}</Cell>
    </ListRow>
  );
}

/** Überschrift, Zustände (Fehler, lädt, leer) und Trefferzeilen samt „Mehr laden“. */
function ResultsList({ search, source, type, layout, featured, emptyText, onReset, onOpen, rowParts }: {
  search: CatalogSearch; source: Source; type: CatalogType; layout: ResultsLayout; featured: boolean;
  emptyText: string; onReset?: () => void; onOpen: (projectId: string, hit: ContentHit) => void; rowParts: (hit: ContentHit) => RowParts;
}) {
  const { t } = useI18n();
  const { results, hits, total, query, index } = search;
  return (
    <div>
      {/* Ohne Suchbegriff die Sortierung als Abschnittsüberschrift (wie auf Start), mit Suchbegriff die Trefferzahl; gleiche Höhe */}
      {!results.error && (
        <div aria-live="polite" className="mb-2.5">
          <SectionHeader
            as={layout.heading.as}
            size={layout.heading.size}
            title={!query ? sortHeading(index) : results.data ? <><Count value={formatCount(total)} /> {t("components.search.hits")}</> : t("components.search.searching")}
          />
        </div>
      )}

      {results.error ? (
        navigator.onLine === false ? (
          <Offline layout={layout} onRetry={() => void results.refetch()} />
        ) : (
          <ErrorBox title={t("components.source.unreachable", { source: SOURCES[source].label })} error={results.error} onRetry={() => void results.refetch()} />
        )
      ) : results.isPending ? (
        <List variant={layout.list} aria-busy aria-label={t("components.common.loadingAria")}>
          {Array.from({ length: SKELETON_ROWS }, (_, i) => <SkelRow key={i} feature={featured && i === 0} />)}
        </List>
      ) : hits.length === 0 ? (
        <Empty
          title={t("components.search.nothingFound")}
          size={layout.emptySize}
          actions={onReset ? <Button onClick={onReset}>{t("components.search.resetFilters")}</Button> : undefined}
        >
          {emptyText}
        </Empty>
      ) : (
        <>
          <List variant={layout.list} aria-label={typeLabel(type)}>
            {hits.map((hit, k) => (
              <ResultRow key={hit.project_id} hit={hit} index={k} feature={featured && k === 0} layout={layout} parts={rowParts(hit)} onOpen={onOpen} />
            ))}
          </List>
          <div className="morebar">
            {results.hasNextPage ? (
              <Button disabled={results.isFetchingNextPage} onClick={() => void results.fetchNextPage()}>
                {results.isFetchingNextPage ? t("components.search.loadingMore") : t("components.search.loadMore")}
              </Button>
            ) : (
              <Hint className="self-center">{hits.length === 1 ? t("components.search.oneResult") : t("components.search.allLoaded", { n: hits.length })}</Hint>
            )}
          </div>
        </>
      )}
    </div>
  );
}

/**
 * Suche in „Entdecken“ mit „Beliebt“ als Startzustand und je Zeile der Aktion für das Projekt. Ohne Suchbegriff hebt sie
 * den meistgeladenen bzw. meistgefolgten Treffer als Karte hervor. Anbieter ohne Schlüssel liefern nur Modpacks
 * (CurseForge: Nachschlagen per Link).
 */
export function ContentResults({ source, type, filter, onReset, onOpen }: {
  source: Source; type: CatalogType; filter: SearchFilter; onReset: () => void; onOpen: (projectId: string, hit: ContentHit) => void;
}) {
  const { t } = useI18n();
  const search = useCatalogSearch(source, type, filter);
  const installedIn = useInstalledIn();
  // Nur eine echte Spitze hervorheben (Downloads, Follower), nicht den zufällig neuesten Upload.
  const featured = !search.query && (search.index === "downloads" || search.index === "follows");
  const hasFilter = !!(search.query || filter.mc || filter.loader);
  return (
    <ResultsList
      search={search}
      source={source}
      type={type}
      layout={PAGE_LAYOUT}
      featured={featured}
      emptyText={t("components.search.noneMatch", { kind: typeLabel(type) })}
      onReset={hasFilter ? onReset : undefined}
      onOpen={onOpen}
      rowParts={(hit) => ({
        meta: <InstalledChipRow instances={installedIn.get(installedKey(source, hit.project_id))} />,
        action: SOURCES[source].install ? (
          <ContentAction type={type} project={{ id: hit.project_id, title: hit.title }} source={source} />
        ) : (
          <Icon name="chev" size="s" tone="muted" />
        ),
      })}
    />
  );
}

/**
 * Suche im Seitenpanel einer Instanz: schmale Zeilen mit „Hinzufügen“ für die Instanz (Datenpakete: für die Welt darin).
 * Mit `fit` nur Passendes zeigen (Version und Loader der Instanz).
 */
export function CompactContentResults({ source, type, instance, world, query, fit, onReset, onOpen }: {
  source: Source; type: CatalogType; instance: Instance; world?: World; query: string; fit: boolean;
  onReset: () => void; onOpen: (projectId: string, hit: ContentHit) => void;
}) {
  const { t } = useI18n();
  const search = useCatalogSearch(source, type, { query, ...(fit ? fitFilter(instance, type) : { mc: null, loader: null }), sort: null });
  return (
    <ResultsList
      search={search}
      source={source}
      type={type}
      layout={SIDE_LAYOUT}
      featured={false}
      emptyText={fit ? t("components.search.nothingFits", { fits: fitsLabel(instance, type) }) : t("components.search.noneMatch", { kind: typeLabel(type) })}
      onReset={search.query ? onReset : undefined}
      onOpen={onOpen}
      rowParts={(hit) => ({
        action: <AddRowButton instance={instance} world={world} project={{ id: hit.project_id, title: hit.title }} type={type} source={source} />,
      })}
    />
  );
}
