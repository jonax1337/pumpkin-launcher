import { infiniteQueryOptions } from "@tanstack/react-query";
import { catalogKeys } from "@/hooks/queryKeys";
import { SEARCH_STALE_MS } from "@/hooks/staleTimes";
import type { SearchOptions } from "./backend";
import { catalogApi } from "./catalogApi";
import {
  ALL_SOURCES, defaultSort, SOURCES, sourcesFor, type CatalogHit, type SearchOffsets, type SearchPage, type Source, type SourceChoice,
} from "./content-types";

type SearchRequest = Omit<SearchOptions, "offset">;

/** Filter, die eine Quelle nicht kennt, fallen für sie weg (Technic: weder Version noch Loader noch Sortierung). */
function requestFor(source: Source, { mc, loader, index, ...rest }: SearchRequest): SearchRequest {
  const { versions, filters } = SOURCES[source];
  return { ...rest, mc: versions ? mc : null, loader: filters ? loader : null, index: filters ? index : defaultSort(rest.query) };
}

const rankInterleaved = <T>(lists: T[][]): T[] => {
  const longest = Math.max(...lists.map((list) => list.length));
  return Array.from({ length: longest }, (_, i) => lists.flatMap((list) => (i < list.length ? [list[i]] : []))).flat();
};

/** Nach Downloads ist die Reihenfolge über Quellen vergleichbar, sonst nur der Rang je Quelle: dann abwechselnd. */
const mergeHits = (lists: CatalogHit[][], index: SearchRequest["index"]) =>
  index === "downloads" ? lists.flat().sort((a, b) => b.downloads - a.downloads) : rankInterleaved(lists);

/** Eine Seite von jeder Quelle, die noch Treffer hat; eine ausgefallene Quelle fehlt nur, solange andere antworten. */
async function searchPage(offsets: SearchOffsets, request: SearchRequest): Promise<SearchPage> {
  const sources = Object.keys(offsets) as Source[];
  const settled = await Promise.allSettled(
    sources.map((source) => catalogApi(source).search({ ...requestFor(source, request), offset: offsets[source] ?? 0 })),
  );
  const answered = sources.flatMap((source, i) => {
    const result = settled[i];
    return result.status === "fulfilled" ? [{ source, ...result.value }] : [];
  });
  if (answered.length === 0) throw (settled[0] as PromiseRejectedResult).reason;

  const next: SearchOffsets = {};
  for (const { source, offset, hits, total_hits, limit } of answered) {
    if (offset + hits.length < total_hits) next[source] = offset + limit;
  }
  return {
    hits: mergeHits(answered.map(({ source, hits }) => hits.map((hit) => ({ ...hit, source }))), request.index),
    total: answered.reduce((sum, { total_hits }) => sum + total_hits, 0),
    next: Object.keys(next).length > 0 ? next : null,
    failed: sources.filter((source) => !answered.some((a) => a.source === source)),
  };
}

/**
 * Trefferseiten der Suche in einer Quelle oder in allen, die den Typ führen. Weitere Seiten laden ab dem Versatz,
 * bei dem jede Quelle aufgehört hat.
 */
export function catalogSearchQuery(choice: SourceChoice, request: SearchRequest) {
  const sources = choice === ALL_SOURCES ? sourcesFor(request.type) : [choice];
  return infiniteQueryOptions({
    queryKey: catalogKeys.search(choice, request.type, request.query, request.mc, request.loader, request.index),
    queryFn: ({ pageParam }) => searchPage(pageParam, request),
    initialPageParam: Object.fromEntries(sources.map((source) => [source, 0])) as SearchOffsets,
    getNextPageParam: (last) => last.next ?? undefined,
    staleTime: SEARCH_STALE_MS,
    retry: false,
  });
}
