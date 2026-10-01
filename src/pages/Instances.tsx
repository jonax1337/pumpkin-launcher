import { useState } from "react";
import { currentLanguage, useI18n } from "@/i18n";
import { NewInstanceDialog } from "@/components/NewInstanceDialog";
import { SkelList } from "@/components/SkelList";
import { useAnnouncement } from "@/hooks/useAnnouncement";
import { useBackgroundUpdates } from "@/hooks/useContent";
import { byRecent, groupsOf, ungrouped, useInstances } from "@/hooks/useInstances";
import { usePersistedState } from "@/hooks/usePersistedState";
import { LOADER_LABELS, type Instance } from "@/lib/types";
import { useLookStore } from "@/store/look";
import { Button, ButtonLink, CardGrid, Count, Disclosure, Empty, ErrorBox, Glyph, PageHeader } from "@/ui";
import { InstanceView, type LibraryMode } from "./instances/InstanceView";
import { LibraryToolbar, NewInstanceButton, type LibraryFilters, type Sort } from "./instances/LibraryToolbar";

/** Schlüssel der gemerkten Ansicht (Poster oder Liste). */
const MODE_STORAGE_KEY = "vx-libmode";
const MODES: readonly [LibraryMode, ...LibraryMode[]] = ["poster", "list"];

const SORTS: Record<Sort, (a: Instance, b: Instance) => number> = {
  recent: byRecent,
  name: (a, b) => a.name.localeCompare(b.name, currentLanguage()),
  created: (a, b) => b.createdAt - a.createdAt,
};

const NO_FILTERS: LibraryFilters = { query: "", loader: "all", sort: "recent" };

/** Instanzen, die Suche (Name oder Minecraft-Version) und Loader erfüllen, in der gewählten Sortierung. */
function applyFilters(instances: Instance[], { query, loader, sort }: LibraryFilters) {
  const needle = query.trim().toLowerCase();
  return instances
    .filter((i) => {
      const matchesText = !needle || i.name.toLowerCase().includes(needle) || i.minecraftVersion.includes(needle);
      return matchesText && (loader === "all" || i.loader === loader);
    })
    .sort(SORTS[sort]);
}

/** Abschnitte je Gruppe (alphabetisch), Instanzen ohne Gruppe (`null`) zuletzt; leere Abschnitte entfallen. */
function sectionsOf(instances: Instance[]): [group: string | null, members: Instance[]][] {
  const groups = groupsOf(instances).map((group): [string | null, Instance[]] => [group, instances.filter((i) => i.group === group)]);
  const withoutGroup = instances.filter((i) => !i.group);
  return withoutGroup.length ? [...groups, [null, withoutGroup]] : groups;
}

function LoadingGrid() {
  const { t } = useI18n();
  return (
    <CardGrid aria-busy aria-label={t("components.common.loadingAria")}>
      <SkelList n={4} className="aspect-[4/5]" />
    </CardGrid>
  );
}

function EmptyLibrary() {
  const { t } = useI18n();
  return (
    <Empty
      size="page"
      ill={<Glyph name="chest" pal="copper" box={64} />}
      title={t("pages.instances.emptyTitle")}
      actions={
        <>
          <NewInstanceButton />
          <ButtonLink to="/discover">{t("pages.instances.discoverModpacks")}</ButtonLink>
        </>
      }
    >
      {t("pages.instances.emptyBody")}
    </Empty>
  );
}

/** Suche und Filter haben nichts übrig gelassen. */
function NoResults({ filters, onReset }: { filters: LibraryFilters; onReset: () => void }) {
  const { t } = useI18n();
  const { query, loader } = filters;
  const loaderLabel = loader === "all" ? "" : LOADER_LABELS[loader];
  const filter = query.trim() || loaderLabel;
  return (
    <Empty
      size="page"
      title={t("pages.instances.noResultsTitle")}
      actions={<Button onClick={onReset}>{t("pages.instances.resetSearch")}</Button>}
    >
      {query.trim() && loader !== "all"
        ? t("pages.instances.noResultsQueryWithLoader", { filter, loader: loaderLabel })
        : t("pages.instances.noResultsQuery", { filter })}
    </Empty>
  );
}

/** Gruppen als aufklappbare Abschnitte; zugeklappte merkt sich der Look-Store über den Neustart hinaus. */
function GroupedView({ instances, mode }: { instances: Instance[]; mode: LibraryMode }) {
  const collapsed = useLookStore((s) => s.collapsed);
  const setCollapsed = useLookStore((s) => s.setCollapsed);
  return sectionsOf(instances).map(([group, members]) => {
    // Schlüssel ist die Gruppe selbst ("" = ohne Gruppe): eine Gruppe darf auch „Ohne Gruppe“ heißen.
    const key = group ?? "";
    return (
      <Disclosure
        key={key}
        open={!collapsed.includes(key)}
        onToggle={(open) => setCollapsed(key, !open)}
        className="mb-4"
        summary={<>{group ?? ungrouped()} <Count value={members.length} muted /></>}
      >
        <InstanceView instances={members} mode={mode} />
      </Disclosure>
    );
  });
}

/** Je nach Stand: Fehler, Laden, leere Bibliothek, keine Treffer, nach Gruppen oder einfach die Instanzen. */
function LibraryBody({ library, shown, filters, mode, onResetFilters }: {
  library: ReturnType<typeof useInstances>; shown: Instance[]; filters: LibraryFilters; mode: LibraryMode; onResetFilters: () => void;
}) {
  const { t } = useI18n();
  const { data: instances, isLoading, error, refetch } = library;
  if (error) return <ErrorBox title={t("pages.instances.loadErrorTitle")} error={error} onRetry={() => void refetch()} />;
  if (isLoading) return <LoadingGrid />;
  if (!instances?.length) return <EmptyLibrary />;
  if (!shown.length) return <NoResults filters={filters} onReset={onResetFilters} />;
  if (shown.some((i) => i.group)) return <GroupedView instances={shown} mode={mode} />;
  return <InstanceView instances={shown} mode={mode} />;
}

export function InstancesPage() {
  const { t } = useI18n();
  const library = useInstances();
  const { data: instances, isLoading, error } = library;
  const [filters, setFilters] = useState<LibraryFilters>(NO_FILTERS);
  const [mode, setMode] = usePersistedState(MODE_STORAGE_KEY, MODES);
  const shown = applyFilters(instances ?? [], filters);

  // Updates für Poster und Liste: sparsam im Hintergrund, zuletzt gespielte zuerst.
  useBackgroundUpdates((instances ?? []).filter((i) => i.mods.length > 0).sort(SORTS.recent).map((i) => i.id));

  // Ergebnis von Suche, Filter und Sortierung ansagen (nur Screenreader, beim Tippen nach kurzer Pause).
  const total = instances?.length ?? 0;
  const [said] = useAnnouncement(
    `${filters.query.trim().toLowerCase()}|${filters.loader}|${filters.sort}`,
    t(total === 1 ? "pages.instances.resultCount.one" : "pages.instances.resultCount.other", { shown: shown.length, total }),
  );

  // Leere Bibliothek: keine Werkzeugleiste, der Leerzustand trägt „Neue Instanz“.
  const empty = !error && !isLoading && !instances?.length;

  return (
    <section className="page lib">
      <PageHeader title={t("ui.nav.library")} count={total} />
      {/* An fester Stelle für beide Knöpfe: füllt der erste Import die leere Bibliothek, bleibt der Dialog mit den übrigen offen */}
      <NewInstanceDialog primary />
      <div className="sr" role="status" aria-live="polite" aria-atomic="true">{said}</div>
      {!empty && (
        <LibraryToolbar filters={filters} onFilters={(patch) => setFilters((f) => ({ ...f, ...patch }))} mode={mode} onMode={setMode} />
      )}
      <LibraryBody
        library={library}
        shown={shown}
        filters={filters}
        mode={mode}
        onResetFilters={() => setFilters((f) => ({ ...f, query: "", loader: "all" }))}
      />
    </section>
  );
}
