import { useState, type CSSProperties } from "react";
import { Link } from "react-router";
import { Btn, BtnLink, ContextMenu, Empty, ErrorBox, SearchField, Seg, Select, Skel } from "@/components/px";
import { PlayButton, StatusChip } from "@/components/game";
import { InstanceMenuButton, useInstanceMenu } from "@/components/instance";
import { loaderLine } from "@/components/common";
import { NewInstanceDialog } from "@/components/NewInstanceDialog";
import { useInstances } from "@/hooks/useInstances";
import { formatDate, relativeTime } from "@/lib/format";
import { ALL_LOADERS, LOADER_LABELS, type Instance, type ModLoader } from "@/lib/types";
import { Glyph, Icon } from "@/pixel/icons";
import { PixelScene } from "@/pixel/PixelScene";
import { lookOf, useLookStore } from "@/store/look";
import "@/styles/library.css";

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
  recent: (a, b) => (b.lastPlayedAt ?? 0) - (a.lastPlayedAt ?? 0) || b.createdAt - a.createdAt,
  name: (a, b) => a.name.localeCompare(b.name, "de"),
  created: (a, b) => b.createdAt - a.createdAt,
};

type Looks = ReturnType<typeof useLookStore.getState>["looks"];

/** Poster 4:5: Szene, Status oben links, Spielen und Menü beim Überfahren, Name unten. Rechtsklick öffnet das Menü. */
function PosterCard({ inst, index, looks }: { inst: Instance; index: number; looks: Looks }) {
  const items = useInstanceMenu(inst);
  const look = lookOf(looks, inst.id);
  return (
    <ContextMenu items={items}>
      <div className="poster rise" style={{ "--i": Math.min(index, 12), "--acc": look.acc } as CSSProperties}>
        <PixelScene bio={look.bio} seed={look.seed} />
        <Link to={`/instances/${inst.id}`} className="hit fx" aria-label={`${inst.name} öffnen`} />
        <span className="frame" />
        <span className="st"><StatusChip instance={inst} small /></span>
        <div className="pact">
          <PlayButton instance={inst} size="i" />
          <InstanceMenuButton instance={inst} small />
        </div>
        <div className="cap">
          <b title={inst.name}>{inst.name}</b>
          <span>{loaderLine(inst)} · {relativeTime(inst.lastPlayedAt)}</span>
        </div>
      </div>
    </ContextMenu>
  );
}

/** Listenzeile, 56 px, feste Spalten. */
function ListRow({ inst, index, looks }: { inst: Instance; index: number; looks: Looks }) {
  const items = useInstanceMenu(inst);
  const look = lookOf(looks, inst.id);
  return (
    <ContextMenu items={items}>
      <div className="lrow rise" style={{ "--i": Math.min(index, 12), "--acc": look.acc } as CSSProperties}>
        <div className="thumb"><PixelScene bio={look.bio} seed={look.seed} /></div>
        <div className="nm">
          <Link to={`/instances/${inst.id}`} className="fx" title={inst.name}>{inst.name}</Link>
          <span>erstellt {formatDate(inst.createdAt)}</span>
        </div>
        <span className="c">{loaderLine(inst)}</span>
        <span className="c c-cnt"><span className="num">{inst.mods.length}</span></span>
        <span className="c c-last">{relativeTime(inst.lastPlayedAt)}</span>
        <span className="c"><StatusChip instance={inst} small /></span>
        <PlayButton instance={inst} size="i" />
        <InstanceMenuButton instance={inst} variant="g" small />
      </div>
    </ContextMenu>
  );
}

export function InstancesPage() {
  const { data: instances, isLoading, error, refetch } = useInstances();
  const looks = useLookStore((s) => s.looks);
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

  const newButton = (
    <Btn variant="p" icon="plus">Neue Instanz</Btn>
  );

  let body;
  if (error) {
    body = <ErrorBox title="Die Bibliothek konnte nicht geladen werden" error={error} onRetry={() => void refetch()} />;
  } else if (isLoading) {
    body = (
      <div className="posters" aria-busy aria-label="Wird geladen">
        {[0, 1, 2, 3].map((k) => <Skel key={k} />)}
      </div>
    );
  } else if (!instances?.length) {
    body = (
      <Empty
        ill={<Glyph name="chest" pal="copper" big />}
        title="Deine Bibliothek ist leer"
        actions={
          <>
            <NewInstanceDialog>{newButton}</NewInstanceDialog>
            <BtnLink to="/discover">Modpacks entdecken</BtnLink>
          </>
        }
      >
        Leg eine Instanz an, zieh eine .mrpack-Datei ins Fenster oder such dir ein Modpack aus.
      </Empty>
    );
  } else if (!shown.length) {
    body = (
      <Empty
        ill={<Icon name="search" />}
        title="Keine Treffer"
        actions={<Btn onClick={() => { setQuery(""); setLoader("all"); }}>Suche und Filter zurücksetzen</Btn>}
      >
        Keine Instanz passt zu „{query.trim() || LOADER_LABELS[loader as ModLoader]}“{q && loader !== "all" ? ` mit ${LOADER_LABELS[loader]}` : ""}.
      </Empty>
    );
  } else if (mode === "poster") {
    body = (
      <div className="posters">
        {shown.map((inst, k) => <PosterCard key={inst.id} inst={inst} index={k} looks={looks} />)}
      </div>
    );
  } else {
    body = (
      <>
        <div className="lhead">
          <span />
          <span>Name</span>
          <span>Version</span>
          <span className="c-cnt">Inhalte</span>
          <span className="c-last">Zuletzt gespielt</span>
          <span>Status</span>
          <span />
          <span />
        </div>
        <div className="lrows">
          {shown.map((inst, k) => <ListRow key={inst.id} inst={inst} index={k} looks={looks} />)}
        </div>
      </>
    );
  }

  return (
    <section className="page lib">
      <div className="page-h">
        <h1 className="h-page">Bibliothek</h1>
        <span className="cnt">{instances?.length ?? 0}</span>
        <span className="sp" />
      </div>
      <div className="tools">
        <SearchField value={query} onChange={setQuery} placeholder="Instanz suchen" />
        <Select
          label="Loader"
          value={loader}
          onChange={(v) => setLoader(v as ModLoader | "all")}
          options={[{ value: "all", label: "Alle" }, ...ALL_LOADERS.map((l) => ({ value: l, label: LOADER_LABELS[l] }))]}
        />
        <Select
          label="Sortieren"
          className="hide-m"
          value={sort}
          onChange={(v) => setSort(v as Sort)}
          options={[{ value: "recent", label: "Zuletzt gespielt" }, { value: "name", label: "Name" }, { value: "created", label: "Erstellt" }]}
        />
        <Seg
          icons
          label="Ansicht"
          value={mode}
          onChange={setMode}
          options={[{ value: "poster", label: "Poster", icon: "grid", tip: "Poster" }, { value: "list", label: "Liste", icon: "list", tip: "Liste" }]}
        />
        <span className="grow" />
        <NewInstanceDialog primary>
          <Btn variant="p" icon="plus" aria-keyshortcuts="Control+N">Neue Instanz</Btn>
        </NewInstanceDialog>
      </div>
      {body}
    </section>
  );
}
