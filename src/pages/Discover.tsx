import { useLayoutEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router";
import { useView } from "@/app/Layout";
import { PageHeader, SearchField, Select, Spacer, TabPanel, Tabs, Toolbar } from "@/ui";
import {
  AddToInstanceMenu, AddToWorldMenu, ContentDetail, ContentResults, PackActions, PackInstallButton, SEARCH_PLACEHOLDER, TYPE_LABELS,
} from "@/components/ContentBrowser";
import { useVersions } from "@/hooks/useInstances";
import { SOURCES, type CatalogType, type ContentHit, type SearchIndex, type Source } from "@/lib/modrinth";
import { ALL_LOADERS, LOADER_LABELS } from "@/lib/types";

const TABS: CatalogType[] = ["modpack", "mod", "shader", "resourcepack", "datapack"];
const SOURCE_KEYS = Object.keys(SOURCES) as Source[];
const LOADERS = [{ value: "all", label: "Alle" }, ...ALL_LOADERS.filter((l) => l !== "vanilla").map((l) => ({ value: l, label: LOADER_LABELS[l] }))];
const SORTS: { value: SearchIndex; label: string }[] = [
  { value: "relevance", label: "Relevanz" },
  { value: "downloads", label: "Downloads" },
  { value: "follows", label: "Follower" },
  { value: "newest", label: "Neueste" },
  { value: "updated", label: "Zuletzt aktualisiert" },
];

/** Stöbern ohne Instanz: Modpacks werden zu neuen Instanzen, Datenpakete landen in einer Welt, alles andere in einer bestehenden Instanz. */
export function DiscoverPage() {
  const [params, setParams] = useSearchParams();
  // ?quelle= wählt Modrinth (Standard) oder einen Anbieter ohne Schlüssel.
  const source = SOURCE_KEYS.find((s) => s === params.get("quelle")) ?? "modrinth";
  const info = SOURCES[source];
  const tabs = TABS.filter((t) => info.types.includes(t));
  const type = tabs.find((t) => t === params.get("tab")) ?? tabs[0];
  // ?projekt= öffnet direkt die Details (z. B. aus dem Dialog „Neue Instanz“).
  const projectId = params.get("projekt");
  const [hit, setHit] = useState<ContentHit | null>(null);
  const [query, setQuery] = useState("");
  const [ver, setVer] = useState("all");
  const [loader, setLoader] = useState("all");
  // null = automatisch: Downloads ohne Suchbegriff, sonst Relevanz.
  const [sort, setSort] = useState<SearchIndex | null>(null);
  const versions = useVersions();
  const releases = versions.data?.filter((v) => v.type === "release").slice(0, 12) ?? [];
  const withLoader = info.filters && (type === "mod" || type === "modpack");
  /** Adressparameter: die Quelle bleibt in der URL, solange es nicht Modrinth ist. */
  const link = (tab: CatalogType, extra: Record<string, string> = {}) => ({ tab, ...(source === "modrinth" ? {} : { quelle: source }), ...extra });
  const view = useView();
  const listScroll = useRef(0);

  // Details beginnen oben; zurück in der Liste steht man wieder, wo man war.
  useLayoutEffect(() => {
    const el = view.current;
    if (el) el.scrollTop = projectId ? 0 : listScroll.current;
  }, [projectId, view]);

  const reset = () => {
    setQuery("");
    setVer("all");
    setLoader("all");
    setSort(null);
  };
  const open = (id: string, h?: ContentHit) => {
    listScroll.current = view.current?.scrollTop ?? 0;
    setHit(h ?? null);
    setParams(link(type, { projekt: id }));
  };

  return (
    <>
      {projectId && (
        <div className="page disc-proj">
          <ContentDetail
            key={`${source}-${projectId}`}
            source={source}
            projectId={projectId}
            type={type}
            hit={hit?.project_id === projectId ? hit : null}
            backLabel={TYPE_LABELS[type]}
            onBack={() => setParams(link(type))}
            action={(p) =>
              type === "modpack" ? (
                <PackActions projectId={p.id} title={p.title} source={source} />
              ) : type === "datapack" ? (
                <AddToWorldMenu projectId={p.id} title={p.title} large />
              ) : (
                <AddToInstanceMenu projectId={p.id} title={p.title} type={type} large source={source} />
              )
            }
          />
        </div>
      )}
      {/* Bleibt beim Öffnen von Details erhalten, damit Suche und geladene Seiten nicht verloren gehen. */}
      <section className="page disc" hidden={!!projectId}>
        <PageHeader title="Entdecken">
          {tabs.length > 1 && (
            <Tabs
              variant="segment"
              role="tablist"
              idBase="disc"
              label="Kategorie"
              value={type}
              onChange={(t) => {
                if (t !== "mod" && t !== "modpack") setLoader("all");
                setParams(link(t), { replace: true });
              }}
              items={tabs.map((t) => ({ value: t, label: TYPE_LABELS[t] }))}
            />
          )}
        </PageHeader>
        {/* Suchfeld bewusst breiter als in der Bibliothek; unter 1096 px bricht die Leiste um */}
        <Toolbar search="l" wrapBelow={1096} label="Suche und Filter" className="mt-4 mb-3.5">
          <SearchField value={query} onChange={setQuery} placeholder={SEARCH_PLACEHOLDER[type]} autoFocus />
          <Select
            label="Quelle"
            value={source}
            onChange={(s) => {
              reset();
              setParams(s === "modrinth" ? {} : { quelle: s }, { replace: true });
            }}
            options={SOURCE_KEYS.map((s) => ({ value: s, label: SOURCES[s].label }))}
          />
          {info.versions && <Select label="Version" value={ver} onChange={setVer} options={[{ value: "all", label: "Alle" }, ...releases.map((v) => ({ value: v.id, label: v.id }))]} />}
          {withLoader && <Select label="Loader" value={loader} onChange={setLoader} options={LOADERS} />}
          <Spacer />
          {info.filters && <Select label="Sortieren" value={sort ?? (query.trim() ? "relevance" : "downloads")} onChange={(v) => setSort(v as SearchIndex)} options={SORTS} />}
        </Toolbar>
        <TabPanel idBase="disc" value={type}>
          <ContentResults
            key={`${source}-${type}`}
            source={source}
            type={type}
            query={query}
            mc={info.versions && ver !== "all" ? ver : null}
            loader={withLoader && loader !== "all" ? loader : null}
            sort={info.filters ? sort : null}
            feature
            onReset={reset}
            onOpen={open}
            action={
              info.install
                ? (h) =>
                    type === "modpack" ? (
                      <PackInstallButton projectId={h.project_id} title={h.title} source={source} />
                    ) : type === "datapack" ? (
                      <AddToWorldMenu projectId={h.project_id} title={h.title} />
                    ) : (
                      <AddToInstanceMenu projectId={h.project_id} title={h.title} type={type} source={source} />
                    )
                : undefined
            }
          />
        </TabPanel>
      </section>
    </>
  );
}
