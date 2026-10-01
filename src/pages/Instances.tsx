import { useState, type CSSProperties } from "react";
import { useSearchParams } from "react-router";
import { currentLanguage, useI18n } from "@/i18n";
import { LOUD_PHASES, PlayButton, StatusChip, usePhase } from "@/components/game";
import { InstanceMenuButton, useInstanceMenu } from "@/components/instance";
import { loaderLine, playtimeLine } from "@/components/common";
import { NewInstanceDialog } from "@/components/NewInstanceDialog";
import { SkelList } from "@/components/SkelList";
import { useAnnouncement } from "@/hooks/useAnnouncement";
import { useBackgroundUpdates, useCurrentUpdates } from "@/hooks/useContent";
import { byRecent, groupsOf, ungrouped, useInstances } from "@/hooks/useInstances";
import { WIDTH } from "@/lib/breakpoints";
import { formatDate, formatPlaytime, relativeTime, updatesLabel } from "@/lib/format";
import { instanceUrl, newInstanceParams } from "@/lib/routes";
import { ALL_LOADERS, LOADER_LABELS, type Instance, type ModLoader } from "@/lib/types";
import { lookOf, useLookStore } from "@/store/look";
import {
  Button, ButtonLink, CardGrid, Cell, Chip, Count, Disclosure, Empty, ErrorBox, Glyph, List, ListRow, PageHeader, RowTitle, SceneCard, SceneThumb,
  SearchField, Segmented, Select, Spacer, Toolbar,
} from "@/ui";

type Mode = "poster" | "list";
type Sort = "recent" | "name" | "created";

const MODE_KEY = "vx-libmode";
function readMode(): Mode {
  try {
    return localStorage.getItem(MODE_KEY) === "list" ? "list" : "poster";
  } catch {
    return "poster";
  }
}
function saveMode(mode: Mode) {
  try {
    localStorage.setItem(MODE_KEY, mode);
  } catch {
    // Ohne Speicher bleibt die Wahl nur bis zum Neustart.
  }
}

const SORTS: Record<Sort, (a: Instance, b: Instance) => number> = {
  recent: byRecent,
  name: (a, b) => a.name.localeCompare(b.name, currentLanguage()),
  created: (a, b) => b.createdAt - a.createdAt,
};

type Looks = ReturnType<typeof useLookStore.getState>["looks"];

/** Abschnitte je Gruppe (alphabetisch), Instanzen ohne Gruppe (`null`) zuletzt; leere Abschnitte entfallen. */
function sectionsOf(instances: Instance[]): [group: string | null, members: Instance[]][] {
  const groups = groupsOf(instances).map((group): [string | null, Instance[]] => [group, instances.filter((i) => i.group === group)]);
  const withoutGroup = instances.filter((i) => !i.group);
  return withoutGroup.length ? [...groups, [null, withoutGroup]] : groups;
}

/** Status nur als Ausnahme: installiert gerade, startet, läuft, abgestürzt oder mit Updates. Der Normalfall bleibt leer. */
function LibStatus({ instance }: { instance: Instance }) {
  const phase = usePhase(instance.id);
  const nUpd = useCurrentUpdates(instance, false).size;
  if (LOUD_PHASES.includes(phase)) return <StatusChip instance={instance} small />;
  if (nUpd > 0)
    return (
      <Chip icon="up">
        <Count value={nUpd} /> {updatesLabel(nUpd)}
      </Chip>
    );
  return null;
}

/**
 * Poster 4:5: Szene, Ausnahme-Status oben links, beim Überfahren oder Fokus großer Spielen-Knopf mittig und Menü oben rechts, Name unten.
 * Rechtsklick öffnet das Menü. Unter dem Namen ist nur Platz für eine Angabe neben der Version: Spielzeit, sonst „zuletzt gespielt“.
 */
function PosterCard({ instance, index, looks }: { instance: Instance; index: number; looks: Looks }) {
  const { t } = useI18n();
  const items = useInstanceMenu(instance);
  return (
    <SceneCard
      variant="poster"
      look={lookOf(looks, instance.id)}
      title={instance.name}
      sub={`${loaderLine(instance)} · ${playtimeLine(instance) || relativeTime(instance.lastPlayedAt)}`}
      status={<LibStatus instance={instance} />}
      primary={<PlayButton instance={instance} size="m" />}
      actions={<InstanceMenuButton instance={instance} small variant="g" onScene />}
      hit={{ to: instanceUrl(instance.id), label: t("pages.instances.openInstance", { name: instance.name }) }}
      menu={items}
      index={index}
    />
  );
}

/** Listenzeile, 56 px, feste Spalten. Die ganze Zeile öffnet die Instanz; Spielen und Menü liegen darüber. */
function InstanceRow({ instance, index, looks }: { instance: Instance; index: number; looks: Looks }) {
  const { t } = useI18n();
  const items = useInstanceMenu(instance);
  const look = lookOf(looks, instance.id);
  return (
    <ListRow hit={{ to: instanceUrl(instance.id), label: t("pages.instances.openInstance", { name: instance.name }) }} menu={items} index={Math.min(index, 12)} style={{ "--acc": look.acc } as CSSProperties}>
      <SceneThumb bio={look.bio} seed={look.seed} />
      <RowTitle title={instance.name} sub={t("pages.instances.createdOn", { date: formatDate(instance.createdAt) })} />
      <Cell title={loaderLine(instance)}>{loaderLine(instance)}</Cell>
      <Cell hide={WIDTH.md}><Count value={instance.mods.length} /></Cell>
      <Cell hide={WIDTH.md}>{relativeTime(instance.lastPlayedAt)}</Cell>
      <Cell hide={WIDTH.xl}>{instance.playtimeSecs > 0 ? formatPlaytime(instance.playtimeSecs) : "–"}</Cell>
      <Cell flex><LibStatus instance={instance} /></Cell>
      <PlayButton instance={instance} size="i" />
      <InstanceMenuButton instance={instance} variant="g" small />
    </ListRow>
  );
}

/** Instanzen als Poster oder Liste. */
function InstanceView({ instances, mode, looks }: { instances: Instance[]; mode: Mode; looks: Looks }) {
  const { t } = useI18n();
  if (mode === "poster")
    return (
      <CardGrid>
        {instances.map((instance, k) => <PosterCard key={instance.id} instance={instance} index={k} looks={looks} />)}
      </CardGrid>
    );
  return (
    <List
      variant="instances"
      divided
      aria-label={t("common.instances")}
      head={
        <>
          <span />
          <Cell>{t("common.name")}</Cell>
          <Cell>{t("common.version")}</Cell>
          <Cell hide={WIDTH.md}>{t("pages.instances.colContents")}</Cell>
          <Cell hide={WIDTH.md}>{t("pages.instances.colLastPlayed")}</Cell>
          <Cell hide={WIDTH.xl}>{t("pages.instances.colPlaytime")}</Cell>
          <Cell>{t("common.status")}</Cell>
          <span />
          <span />
        </>
      }
    >
      {instances.map((instance, k) => <InstanceRow key={instance.id} instance={instance} index={k} looks={looks} />)}
    </List>
  );
}

export function InstancesPage() {
  const { t } = useI18n();
  const { data: instances, isLoading, error, refetch } = useInstances();
  const looks = useLookStore((s) => s.looks);
  const collapsed = useLookStore((s) => s.collapsed);
  const setCollapsed = useLookStore((s) => s.setCollapsed);
  const [, setParams] = useSearchParams();
  const [query, setQuery] = useState("");
  const [loader, setLoader] = useState<ModLoader | "all">("all");
  const [sort, setSort] = useState<Sort>("recent");
  const [mode, setModeState] = useState<Mode>(readMode);
  const setMode = (m: Mode) => {
    setModeState(m);
    saveMode(m);
  };

  const q = query.trim().toLowerCase();
  const shown = (instances ?? [])
    .filter((i) => (loader === "all" || i.loader === loader) && (!q || i.name.toLowerCase().includes(q) || i.minecraftVersion.includes(q)))
    .sort(SORTS[sort]);

  // Updates für Poster und Liste: sparsam im Hintergrund, zuletzt gespielte zuerst.
  useBackgroundUpdates((instances ?? []).filter((i) => i.mods.length > 0).sort(SORTS.recent).map((i) => i.id));

  // Ergebnis von Suche, Filter und Sortierung ansagen (nur Screenreader, beim Tippen nach kurzer Pause).
  const total = instances?.length ?? 0;
  const [said] = useAnnouncement(`${q}|${loader}|${sort}`, t(total === 1 ? "pages.instances.resultCount.one" : "pages.instances.resultCount.other", { shown: shown.length, total }));

  // Leere Bibliothek: keine Werkzeugleiste, der Leerzustand trägt „Neue Instanz“.
  const empty = !error && !isLoading && !instances?.length;
  const newInstance = (
    <Button variant="primary" icon="plus" aria-keyshortcuts="Control+N" onClick={() => setParams(newInstanceParams(), { replace: true })}>{t("components.newInstance.title")}</Button>
  );

  let body;
  if (error) {
    body = <ErrorBox title={t("pages.instances.loadErrorTitle")} error={error} onRetry={() => void refetch()} />;
  } else if (isLoading) {
    body = (
      <CardGrid aria-busy aria-label={t("components.common.loadingAria")}>
        <SkelList n={4} className="aspect-[4/5]" />
      </CardGrid>
    );
  } else if (!instances?.length) {
    body = (
      <Empty
        size="page"
        ill={<Glyph name="chest" pal="copper" box={64} />}
        title={t("pages.instances.emptyTitle")}
        actions={
          <>
            {newInstance}
            <ButtonLink to="/discover">{t("pages.instances.discoverModpacks")}</ButtonLink>
          </>
        }
      >
        {t("pages.instances.emptyBody")}
      </Empty>
    );
  } else if (!shown.length) {
    body = (
      <Empty
        size="page"
        title={t("pages.instances.noResultsTitle")}
        actions={<Button onClick={() => { setQuery(""); setLoader("all"); }}>{t("pages.instances.resetSearch")}</Button>}
      >
        {q && loader !== "all"
          ? t("pages.instances.noResultsQueryWithLoader", { filter: query.trim() || LOADER_LABELS[loader as ModLoader], loader: LOADER_LABELS[loader] })
          : t("pages.instances.noResultsQuery", { filter: query.trim() || LOADER_LABELS[loader as ModLoader] })}
      </Empty>
    );
  } else if (shown.some((i) => i.group)) {
    // Gruppen als aufklappbare Abschnitte; zugeklappte merkt sich der Look-Store über den Neustart hinaus.
    // Schlüssel ist die Gruppe selbst ("" = ohne Gruppe): eine Gruppe darf auch „Ohne Gruppe“ heißen.
    body = sectionsOf(shown).map(([group, members]) => {
      const key = group ?? "";
      return (
        <Disclosure
          key={key}
          open={!collapsed.includes(key)}
          onToggle={(open) => setCollapsed(key, !open)}
          className="mb-4"
          summary={<>{group ?? ungrouped()} <Count value={members.length} muted /></>}
        >
          <InstanceView instances={members} mode={mode} looks={looks} />
        </Disclosure>
      );
    });
  } else {
    body = <InstanceView instances={shown} mode={mode} looks={looks} />;
  }

  return (
    <section className="page lib">
      <PageHeader title={t("ui.nav.library")} count={instances?.length ?? 0} />
      {/* An fester Stelle für beide Knöpfe: füllt der erste Import die leere Bibliothek, bleibt der Dialog mit den übrigen offen */}
      <NewInstanceDialog primary />
      <div className="sr" role="status" aria-live="polite" aria-atomic="true">{said}</div>
      {/* Abstände: 16 über, 18 unter der Werkzeugleiste */}
      {!empty && (
        <Toolbar search="m" className="mt-4 mb-4.5">
          <SearchField value={query} onChange={setQuery} placeholder={t("pages.instances.searchPlaceholder")} />
          <Select
            label={t("components.common.loader")}
            value={loader}
            onChange={(v) => setLoader(v as ModLoader | "all")}
            options={[{ value: "all", label: t("common.all") }, ...ALL_LOADERS.map((l) => ({ value: l, label: LOADER_LABELS[l] }))]}
          />
          <Select
            label={t("pages.instances.sortLabel")}
            className="max-[900px]:hidden"
            value={sort}
            onChange={(v) => setSort(v as Sort)}
            options={[
              { value: "recent", label: t("pages.instances.colLastPlayed") },
              { value: "name", label: t("common.name") },
              { value: "created", label: t("pages.instances.sortCreated") },
            ]}
          />
          <Segmented
            iconsOnly
            label={t("pages.instances.viewLabel")}
            value={mode}
            onChange={setMode}
            items={[
              { value: "poster", label: t("pages.instances.viewPoster"), icon: "grid" },
              { value: "list", label: t("pages.instances.viewList"), icon: "list" },
            ]}
          />
          <Spacer />
          {newInstance}
        </Toolbar>
      )}
      {body}
    </section>
  );
}
