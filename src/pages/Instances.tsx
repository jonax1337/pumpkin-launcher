import { useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { useSearchParams } from "react-router";
import { currentLanguage, useI18n } from "@/i18n";
import { NewInstanceDialog } from "@/components/NewInstanceDialog";
import { SkelList } from "@/components/SkelList";
import { useAnnouncement } from "@/hooks/useAnnouncement";
import { useBackgroundUpdates } from "@/hooks/useContent";
import { byRecent, groupsOf, useInstances } from "@/hooks/useInstances";
import { focusSoon } from "@/pages/detail/content/focus";
import { newInstanceParams } from "@/lib/routes";
import { LOADER_LABELS, type Instance } from "@/lib/types";
import { useLookStore } from "@/store/look";
import { Button, ButtonLink, CardGrid, ContextMenu, Empty, ErrorBox, Glyph, PageHeader, WorkspaceContent, type MenuEntry } from "@/ui";
import { GroupedView } from "./instances/GroupedView";
import { InstanceView, LibraryRoving } from "./instances/InstanceView";
import { LibraryToolbar, NewInstanceButton } from "./instances/LibraryToolbar";
import {
  hasFilters, matchesFilters, NO_FILTERS, orderedGroups, sectionsOf, versionsOf, type LibraryFilters, type Section, type Sort,
} from "./instances/libraryModel";
import { LibrarySelectionProvider, useSelectionState } from "./instances/librarySelection";
import { SelectionBar } from "./instances/SelectionBar";
import { useLibraryView } from "./instances/useLibraryView";

const SORTS: Record<Sort, (a: Instance, b: Instance) => number> = {
  recent: byRecent,
  name: (a, b) => a.name.localeCompare(b.name, currentLanguage()),
  created: (a, b) => b.createdAt - a.createdAt,
  playtime: (a, b) => b.playtimeSecs - a.playtimeSecs,
};

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
  const { query, loader, version } = filters;
  const active = [query.trim(), loader === "all" ? "" : LOADER_LABELS[loader], version === "all" ? "" : version];
  return (
    <Empty
      size="page"
      title={t("pages.instances.noResultsTitle")}
      actions={<Button onClick={onReset}>{t("pages.instances.resetSearch")}</Button>}
    >
      {t("pages.instances.noResultsQuery", { filter: active.filter(Boolean).join(" · ") })}
    </Empty>
  );
}

/** Je nach Stand: Fehler, Laden, leere Bibliothek, keine Treffer oder die Instanzen (`children`). */
function LibraryBody({ library, matches, filters, onResetFilters, children }: {
  library: ReturnType<typeof useInstances>; matches: number; filters: LibraryFilters; onResetFilters: () => void; children: ReactNode;
}) {
  const { t } = useI18n();
  const { data: instances, isLoading, error, refetch } = library;
  if (error) return <ErrorBox title={t("pages.instances.loadErrorTitle")} error={error} onRetry={() => void refetch()} />;
  if (isLoading) return <LoadingGrid />;
  if (!instances?.length) return <EmptyLibrary />;
  if (!matches) return <NoResults filters={filters} onReset={onResetFilters} />;
  return children;
}

/** Instanzen in Anzeigereihenfolge, die man sieht: Mitglieder zugeklappter Gruppen zählen nicht. */
function visibleIdsOf(shown: Instance[], sections: Section[] | null, collapsed: string[]): string[] {
  const visible = sections ? sections.filter(([group]) => !collapsed.includes(group ?? "")).flatMap(([, members]) => members) : shown;
  return visible.map((instance) => instance.id);
}

export function InstancesPage() {
  const { t } = useI18n();
  const [, setParams] = useSearchParams();
  const library = useInstances();
  const { data: instances, isLoading, error } = library;
  const view = useLibraryView();
  const [filters, setFilters] = useState<LibraryFilters>(NO_FILTERS);
  const groupOrder = useLookStore((s) => s.groupOrder);
  const collapsed = useLookStore((s) => s.collapsed);
  const pickRef = useRef<HTMLButtonElement>(null);

  const all = instances ?? [];
  const shown = all.filter((instance) => matchesFilters(instance, filters)).sort(SORTS[view.sort]);
  const groups = orderedGroups(groupsOf(all), groupOrder);
  const sections = shown.some((instance) => instance.group) ? sectionsOf(shown, groups) : null;

  // Updates für Poster und Liste: sparsam im Hintergrund, zuletzt gespielte zuerst.
  useBackgroundUpdates(all.filter((i) => i.mods.length > 0).sort(SORTS.recent).map((i) => i.id));

  // Ergebnis von Suche, Filter und Sortierung ansagen (nur Screenreader, beim Tippen nach kurzer Pause).
  const total = all.length;
  const [said, say] = useAnnouncement(
    `${filters.query.trim().toLowerCase()}|${filters.loader}|${filters.version}|${view.sort}`,
    t(total === 1 ? "pages.instances.resultCount.one" : "pages.instances.resultCount.other", { shown: shown.length, total }),
  );

  const visibleIds = visibleIdsOf(shown, sections, collapsed);
  const selection = useSelectionState(visibleIds, say);
  const pickedInstances = shown.filter((instance) => selection.picked.includes(instance.id));

  function leavePicking() {
    selection.stopPicking();
    focusSoon(() => pickRef.current);
  }

  // Esc verlässt den Auswahlmodus, außer in einem Textfeld (dort gehört Esc dem Feld) und in Menüs und Dialogen (außerhalb der Seite).
  function onKeyDown(event: KeyboardEvent<HTMLElement>) {
    const target = event.target as HTMLElement;
    const inTextField = target instanceof HTMLInputElement && target.type !== "checkbox";
    if (event.key === "Escape" && selection.picking && !inTextField && event.currentTarget.contains(target)) leavePicking();
  }

  // Leere Bibliothek: keine Werkzeugleiste, der Leerzustand trägt „Neue Instanz“.
  const empty = !error && !isLoading && !all.length;

  const listing = sections ? (
    <GroupedView sections={sections} groups={groups} mode={view.mode} reorderable={!hasFilters(filters)} />
  ) : (
    <InstanceView instances={shown} mode={view.mode} />
  );

  const menuItems: MenuEntry[] = [
    { id: "new-instance", text: t("components.newInstance.title"), icon: "plus", onSelect: () => setParams(newInstanceParams(), { replace: true }) },
    { id: "reset-filters", text: t("pages.instances.resetSearch"), icon: "x", disabled: !hasFilters(filters), onSelect: () => setFilters(NO_FILTERS) },
    "-",
    { label: t("pages.instances.viewLabel") },
    { id: "poster-view", text: t("pages.instances.viewPoster"), icon: "grid", checked: view.mode === "poster", onSelect: () => view.setMode("poster") },
    { id: "list-view", text: t("pages.instances.viewList"), icon: "list", checked: view.mode === "list", onSelect: () => view.setMode("list") },
    "-",
    { id: "pick", text: t("pages.instances.pick"), icon: "check", disabled: !visibleIds.length || selection.picking, onSelect: selection.startPicking },
    { id: "select-all", text: t("pages.instances.selectAll"), icon: "check", disabled: !visibleIds.length || selection.picked.length === visibleIds.length, onSelect: selection.selectAll },
    ...(selection.picking ? [{ id: "done-picking", text: t("common.done"), icon: "x" as const, onSelect: leavePicking }] : []),
  ];

  return (
    <LibrarySelectionProvider value={selection}>
      <ContextMenu items={menuItems}>
      <section className="page lib" data-picking={selection.picking || undefined} onKeyDown={onKeyDown}>
        <PageHeader title={t("ui.nav.library")}>
          <NewInstanceButton />
        </PageHeader>
        {/* An fester Stelle für beide Knöpfe: füllt der erste Import die leere Bibliothek, bleibt der Dialog mit den übrigen offen */}
        <NewInstanceDialog primary />
        <div className="sr" role="status" aria-live="polite" aria-atomic="true">{said}</div>
        {!empty && (
          <LibraryToolbar
            filters={filters}
            onFilters={(patch) => setFilters((f) => ({ ...f, ...patch }))}
            versions={versionsOf(all)}
            view={view}
            onPick={selection.startPicking}
            pickRef={pickRef}
          />
        )}
        <WorkspaceContent className="mt-4">
          <LibraryBody library={library} matches={shown.length} filters={filters} onResetFilters={() => setFilters(NO_FILTERS)}>
            <LibraryRoving>{listing}</LibraryRoving>
          </LibraryBody>
        </WorkspaceContent>
        {selection.picking && (
          <SelectionBar picked={pickedInstances} groups={groups} onSelectAll={selection.selectAll} onDone={leavePicking} />
        )}
      </section>
      </ContextMenu>
    </LibrarySelectionProvider>
  );
}
