import { useLayoutEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router";
import { useView } from "@/app/Layout";
import { PageHeader, SearchField, Select, Spacer, TabPanel, Tabs, Toolbar } from "@/ui";
import { AddToInstanceMenu, ContentDetail, ContentResults, KIND_LABELS, PackActions, PackInstallButton } from "@/components/ContentBrowser";
import { useVersions } from "@/hooks/useInstances";
import type { CatalogType, ContentHit, SearchIndex } from "@/lib/modrinth";
import { ALL_LOADERS, LOADER_LABELS } from "@/lib/types";

const TABS: CatalogType[] = ["modpack", "mod", "shader", "resourcepack"];
const LABELS: Record<CatalogType, string> = { modpack: "Modpacks", ...KIND_LABELS };
const IN_LABEL: Record<CatalogType, string> = { modpack: "In Modpacks suchen", mod: "In Mods suchen", shader: "In Shadern suchen", resourcepack: "In Ressourcenpaketen suchen" };
const LOADERS = [{ value: "all", label: "Alle" }, ...ALL_LOADERS.filter((l) => l !== "vanilla").map((l) => ({ value: l, label: LOADER_LABELS[l] }))];
const SORTS: { value: SearchIndex; label: string }[] = [
  { value: "relevance", label: "Relevanz" },
  { value: "downloads", label: "Downloads" },
  { value: "follows", label: "Follower" },
  { value: "newest", label: "Neueste" },
  { value: "updated", label: "Zuletzt aktualisiert" },
];

/** Stöbern ohne Instanz: Modpacks werden zu neuen Instanzen, alles andere landet in einer bestehenden. */
export function DiscoverPage() {
  const [params, setParams] = useSearchParams();
  const type = TABS.find((t) => t === params.get("tab")) ?? "modpack";
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
  const withLoader = type === "mod" || type === "modpack";
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
    setParams({ tab: type, projekt: id });
  };

  return (
    <>
      {projectId && (
        <div className="page disc-proj">
          <ContentDetail
            key={projectId}
            projectId={projectId}
            type={type}
            hit={hit?.project_id === projectId ? hit : null}
            backLabel={LABELS[type]}
            onBack={() => setParams({ tab: type })}
            action={(p) =>
              type === "modpack" ? <PackActions projectId={p.id} title={p.title} /> : <AddToInstanceMenu projectId={p.id} title={p.title} type={type} large />
            }
          />
        </div>
      )}
      {/* Bleibt beim Öffnen von Details erhalten, damit Suche und geladene Seiten nicht verloren gehen. */}
      <section className="page disc" hidden={!!projectId}>
        <PageHeader title="Entdecken">
          <Tabs
            variant="segment"
            role="tablist"
            idBase="disc"
            label="Kategorie"
            value={type}
            onChange={(t) => {
              if (t !== "mod" && t !== "modpack") setLoader("all");
              setParams({ tab: t }, { replace: true });
            }}
            items={TABS.map((t) => ({ value: t, label: LABELS[t] }))}
          />
        </PageHeader>
        {/* Suchfeld bewusst breiter als in der Bibliothek; unter 1096 px bricht die Leiste um */}
        <Toolbar search="l" wrapBelow={1096} label="Suche und Filter" className="mt-4 mb-3.5">
          <SearchField value={query} onChange={setQuery} placeholder={IN_LABEL[type]} autoFocus />
          <Select label="Version" value={ver} onChange={setVer} options={[{ value: "all", label: "Alle" }, ...releases.map((v) => ({ value: v.id, label: v.id }))]} />
          {withLoader && <Select label="Loader" value={loader} onChange={setLoader} options={LOADERS} />}
          <Spacer />
          <Select label="Sortieren" value={sort ?? (query.trim() ? "relevance" : "downloads")} onChange={(v) => setSort(v as SearchIndex)} options={SORTS} />
        </Toolbar>
        <TabPanel idBase="disc" value={type}>
          <ContentResults
            key={type}
            type={type}
            query={query}
            mc={ver === "all" ? null : ver}
            loader={withLoader && loader !== "all" ? loader : null}
            sort={sort}
            feature
            onReset={reset}
            onOpen={open}
            action={(h) =>
              type === "modpack" ? <PackInstallButton projectId={h.project_id} title={h.title} /> : <AddToInstanceMenu projectId={h.project_id} title={h.title} type={type} />
            }
          />
        </TabPanel>
      </section>
    </>
  );
}
