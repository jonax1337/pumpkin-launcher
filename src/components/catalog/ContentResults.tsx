import type { ReactNode } from "react";
import { useInfiniteQuery } from "@tanstack/react-query";
import { useI18n } from "@/i18n";
import { Button, ButtonLink, Cell, Chip, ChipButton, Count, Empty, ErrorBox, Hint, Icon, IconButton, List, ListRow, ProjectIcon, RowTitle, SectionHeader, SkelRow, StatusPanel, Tip, type GlyphBox, type ListVariant } from "@/ui";
import { useDebounced } from "@/hooks/useDebounced";
import { WIDTH } from "@/lib/breakpoints";
import { catalogSearchQuery } from "@/lib/catalogSearch";
import {
  ALL_SOURCES, defaultSort, installedKey, SOURCES, type CatalogHit, type CatalogType, type SearchIndex, type Source, type SourceChoice,
} from "@/lib/content-types";
import { formatCount, formatDownloads } from "@/lib/format";
import type { Instance, World } from "@/lib/types";
import { AddRowButton } from "./AddButtons";
import { ContentAction } from "./ContentAction";
import { fitFilter, fitsLabel } from "./fit";
import { InstalledChipRow, useInstalledIn } from "./InstalledIn";
import { categoryList, categoryName, sortHeading, sortHint, sourceChoiceLabel, typeLabel } from "./labels";
import { SourceTag } from "./SourceTag";

/** Platzhalter, solange die erste Seite der Treffer lädt. */
const SKELETON_ROWS = 6;

/** Treffer je Seite; die Einblendung der Zeilen beginnt mit jeder Seite neu. */
const PAGE_SIZE = 20;

const FEATURE_ICON_BOX: GlyphBox = 104;

/** Was die Suche eingrenzt. `sort` fehlt = Downloads ohne Suchbegriff, sonst Relevanz. */
export interface SearchFilter {
  query: string;
  mc: string | null;
  loader: string | null;
  category: string | null;
  sort: SearchIndex | null;
}

/** Wie die Trefferliste aussieht: als Seite in „Entdecken“ oder schmal im Seitenpanel einer Instanz. */
export interface ResultsLayout {
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

export const PAGE_LAYOUT: ResultsLayout = {
  list: "catalog", heading: { as: "h2", size: "section" }, emptySize: "section", offlineSize: "page", offlineLibraryLink: true,
  iconBox: 72, categories: 2, showAuthor: true,
};

const SIDE_LAYOUT: ResultsLayout = {
  list: "catalog-compact", heading: { as: "h3", size: "card" }, emptySize: "pane", offlineSize: "pane", offlineLibraryLink: false,
  iconBox: 40, categories: 0, showAuthor: false,
};

/** Was rechts in der Zeile steht, und was die Metazeile über die Standardangaben hinaus zeigt. */
export interface RowParts {
  action: ReactNode;
  meta?: ReactNode;
}

/** Die Suche mit Tippause; weitere Seiten lädt `fetchNextPage`. */
export function useCatalogSearch(source: SourceChoice, type: CatalogType, filter: SearchFilter) {
  const query = useDebounced(filter.query.trim());
  const index = filter.sort ?? defaultSort(query);
  const results = useInfiniteQuery(catalogSearchQuery(source, { query, type, mc: filter.mc, loader: filter.loader, category: filter.category, index }));
  const hits = results.data?.pages.flatMap((p) => p.hits) ?? [];
  const total = results.data?.pages[0]?.total ?? 0;
  const failed = [...new Set(results.data?.pages.flatMap((p) => p.failed))];
  return { results, query, index, hits, total, failed };
}

export type CatalogSearch = ReturnType<typeof useCatalogSearch>;

/** Keine Verbindung: Katalog braucht Internet. */
function Offline({ onRetry, layout }: { onRetry: () => void; layout: ResultsLayout }) {
  const { t } = useI18n();
  return (
    <Empty
      title={t("components.offline.title")}
      size={layout.offlineSize}
      actions={
        <>
          <Button icon="refresh" onClick={onRetry}>{t("common.retry")}</Button>
          {layout.offlineLibraryLink && <ButtonLink variant="ghost" to="/instances">{t("components.offline.toLibrary")}</ButtonLink>}
        </>
      }
    >
      {t("components.offline.text")}
    </Empty>
  );
}

/** Eine Trefferzeile; `onCategory` macht die Kategorien zu Filtern, wo der Anbieter sie kennt. */
export function ResultRow({ hit, index, feature, layout, showSource, parts, onOpen, onCategory }: {
  hit: CatalogHit; index: number; feature: boolean; layout: ResultsLayout; showSource: boolean; parts: RowParts;
  onOpen: (projectId: string, hit: CatalogHit) => void; onCategory?: (category: string) => void;
}) {
  const { t } = useI18n();
  return (
    <ListRow feature={feature} index={index % PAGE_SIZE} hit={{ onClick: () => onOpen(hit.project_id, hit), label: t("components.search.viewProject", { name: hit.title }) }}>
      <ProjectIcon url={hit.icon_url} seed={hit.project_id} box={feature ? FEATURE_ICON_BOX : layout.iconBox} />
      <RowTitle
        size="l"
        title={hit.title}
        aside={layout.showAuthor && hit.author ? t("components.search.byAuthor", { author: hit.author }) : undefined}
        sub={hit.description}
        meta={
          <>
            {showSource && <SourceTag source={hit.source} />}
            <span><Count value={formatDownloads(hit.downloads)} /> {t("components.stats.downloads")}</span>
            {categoryList(hit.categories, layout.categories).map(({ slug, name }) =>
              onCategory && SOURCES[hit.source].categories ? (
                <ChipButton key={slug} size="s" data-hide={WIDTH.sm} aria-label={t("pages.discover.filterByCategory", { name })} onClick={() => onCategory(slug)}>{name}</ChipButton>
              ) : (
                <Chip key={slug} size="s" data-hide={WIDTH.sm}>{name}</Chip>
              ),
            )}
            {parts.meta}
          </>
        }
      />
      <Cell flex align="end">{parts.action}</Cell>
    </ListRow>
  );
}

/** Eine Karte bekommt nur, wer genau so heißt wie die Suche: Dann ist klar, warum sie vorn steht. */
const matchesExactly = (hit: CatalogHit | undefined, query: string) => !!hit && !!query && hit.title.trim().toLowerCase() === query.toLowerCase();

/** Überschrift, Zustände (Fehler, lädt, leer) und Trefferzeilen samt „Mehr laden“. */
function ResultsList({ search, source, type, layout, emptyText, headerEnd, activeFilters, onReset, onOpen, onCategory, rowParts }: {
  search: CatalogSearch; source: SourceChoice; type: CatalogType; layout: ResultsLayout;
  emptyText: string; headerEnd?: ReactNode; activeFilters?: ReactNode; onReset?: () => void; onOpen: (projectId: string, hit: CatalogHit) => void;
  onCategory?: (category: string) => void; rowParts: (hit: CatalogHit) => RowParts;
}) {
  const { t } = useI18n();
  const { results, hits, total, query, index, failed } = search;
  const hint = !query ? sortHint(index) : undefined;
  const featureFirst = layout.list === "catalog" && matchesExactly(hits[0], query);
  // Ohne Treffer sagt die Leerseite alles: keine zweite Überschrift „0 Treffer“
  const showHeading = !results.error && !(results.data && hits.length === 0);
  return (
    <div>
      {/* Ohne Suchbegriff die Sortierung als Abschnittsüberschrift (wie auf Start), mit Suchbegriff die Trefferzahl; gleiche Höhe */}
      {showHeading && (
        <div aria-live="polite" className="cat-head">
          <SectionHeader
            as={layout.heading.as}
            size={layout.heading.size}
            title={!query ? sortHeading(index) : results.data ? <>{formatCount(total)} {t("components.search.hits")}</> : t("components.search.searching")}
            info={hint && <Tip label={hint} describe><IconButton icon="info" size="s" label={t("components.sort.infoLabel")} tip={false} /></Tip>}
            actions={headerEnd}
          />
        </div>
      )}
      {activeFilters}

      {results.error ? (
        navigator.onLine === false ? (
          <Offline layout={layout} onRetry={() => void results.refetch()} />
        ) : (
          <ErrorBox title={t("components.source.unreachable", { source: sourceChoiceLabel(source) })} error={results.error} onRetry={() => void results.refetch()} />
        )
      ) : results.isPending ? (
        <List variant={layout.list} aria-busy aria-label={t("components.common.loadingAria")}>
          {Array.from({ length: SKELETON_ROWS }, (_, i) => <SkelRow key={i} />)}
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
          {failed.length > 0 && <StatusPanel tone="warn" className="cat-note">{t("components.source.partial", { sources: failed.map((s) => SOURCES[s].label).join(", ") })}</StatusPanel>}
          <List variant={layout.list} divided aria-label={typeLabel(type)}>
            {hits.map((hit, k) => (
              <ResultRow
                key={`${hit.source}-${hit.project_id}`}
                hit={hit}
                index={k}
                feature={featureFirst && k === 0}
                layout={layout}
                showSource={source === ALL_SOURCES}
                parts={rowParts(hit)}
                onOpen={onOpen}
                onCategory={onCategory}
              />
            ))}
          </List>
          <div className="morebar">
            {results.hasNextPage ? (
              <Button disabled={results.isFetchingNextPage} onClick={() => void results.fetchNextPage()}>
                {results.isFetchingNextPage ? t("components.search.loadingMore") : t("components.search.loadMore")}
              </Button>
            ) : (
              <Hint>{hits.length === 1 ? t("components.search.oneResult") : t("components.search.allLoaded", { n: hits.length })}</Hint>
            )}
          </div>
        </>
      )}
    </div>
  );
}

/** Rechts die Aktion für das Projekt, in der Metazeile die Instanzen, die es schon haben; für Zeilen in „Entdecken“ und im Dialog „Neue Instanz“. */
export function usePageRowParts(type: CatalogType) {
  const installedIn = useInstalledIn();
  return (hit: CatalogHit): RowParts => ({
    meta: <InstalledChipRow instances={installedIn.get(installedKey(hit.source, hit.project_id))} />,
    action: SOURCES[hit.source].install ? (
      <ContentAction type={type} project={{ id: hit.project_id, title: hit.title }} source={hit.source} />
    ) : (
      <Icon name="chev-right" size="s" tone="muted" />
    ),
  });
}

/** Der gewählte Kategorie-Filter als Chip, der ihn mit einem Klick wieder entfernt; bei „Alle Quellen“ mit dem Hinweis, dass nur Modrinth Kategorien kennt. */
function CategoryFilter({ category, source, onClear }: { category: string; source: SourceChoice; onClear: () => void }) {
  const { t } = useI18n();
  const name = categoryName(category);
  return (
    <div className="cat-filter">
      <ChipButton pressed icon="close" aria-label={t("pages.discover.clearCategory", { name })} onClick={onClear}>
        {t("pages.discover.categoryChip", { name })}
      </ChipButton>
      {source === ALL_SOURCES && <Hint>{t("pages.discover.categoryOnlyModrinth")}</Hint>}
    </div>
  );
}

/**
 * Suche in „Entdecken“ mit „Meistgeladen“ als Startzustand und je Zeile der Aktion für das Projekt. Eine Karte bekommt
 * nur der Treffer, dessen Titel genau der Suche entspricht. `onCategory` macht die Kategorien der Zeilen zu Filtern;
 * `null` entfernt den gewählten. Anbieter ohne Schlüssel liefern nur Modpacks (CurseForge: Nachschlagen per Link).
 */
export function ContentResults({ source, type, filter, sortSelect, onReset, onOpen, onCategory }: {
  source: SourceChoice; type: CatalogType; filter: SearchFilter; onReset: () => void; onOpen: (projectId: string, hit: CatalogHit) => void;
  onCategory: (category: string | null) => void;
  /** Die Auswahl der Sortierung; sie steht rechts in der Überschrift der Liste. */
  sortSelect?: ReactNode;
}) {
  const { t } = useI18n();
  const search = useCatalogSearch(source, type, filter);
  const rowParts = usePageRowParts(type);
  const hasFilter = !!(search.query || filter.mc || filter.loader || filter.category);
  return (
    <ResultsList
      search={search}
      source={source}
      type={type}
      layout={PAGE_LAYOUT}
      emptyText={t("components.search.noneMatch", { kind: typeLabel(type) })}
      headerEnd={sortSelect}
      activeFilters={filter.category && <CategoryFilter category={filter.category} source={source} onClear={() => onCategory(null)} />}
      onReset={hasFilter ? onReset : undefined}
      onOpen={onOpen}
      onCategory={onCategory}
      rowParts={rowParts}
    />
  );
}

/**
 * Suche im Seitenpanel einer Instanz: schmale Zeilen mit „Hinzufügen“ für die Instanz (Datenpakete: für die Welt darin).
 * Mit `fit` nur Passendes zeigen (Version und Loader der Instanz).
 */
export function CompactContentResults({ source, type, instance, world, query, fit, onReset, onOpen }: {
  source: Source; type: CatalogType; instance: Instance; world?: World; query: string; fit: boolean;
  onReset: () => void; onOpen: (projectId: string, hit: CatalogHit) => void;
}) {
  const { t } = useI18n();
  const search = useCatalogSearch(source, type, { query, ...(fit ? fitFilter(instance, type) : { mc: null, loader: null }), category: null, sort: null });
  return (
    <ResultsList
      search={search}
      source={source}
      type={type}
      layout={SIDE_LAYOUT}
      emptyText={fit ? t("components.search.nothingFits", { fits: fitsLabel(instance, type) }) : t("components.search.noneMatch", { kind: typeLabel(type) })}
      onReset={search.query ? onReset : undefined}
      onOpen={onOpen}
      rowParts={(hit) => ({
        action: <AddRowButton instance={instance} world={world} project={{ id: hit.project_id, title: hit.title }} type={type} source={source} />,
      })}
    />
  );
}
