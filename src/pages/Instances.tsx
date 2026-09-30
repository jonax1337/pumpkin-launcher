import { useEffect, useRef, useState, type CSSProperties } from "react";
import { LOUD_PHASES, PlayButton, StatusChip, usePhase } from "@/components/game";
import { InstanceMenuButton, useInstanceMenu } from "@/components/instance";
import { loaderLine } from "@/components/common";
import { NewInstanceDialog } from "@/components/NewInstanceDialog";
import { useBackgroundUpdates, useModUpdates } from "@/hooks/useContent";
import { useInstances } from "@/hooks/useInstances";
import { formatDate, relativeTime } from "@/lib/format";
import { ALL_LOADERS, LOADER_LABELS, type Instance, type ModLoader } from "@/lib/types";
import { lookOf, useLookStore } from "@/store/look";
import {
  Button, ButtonLink, CardGrid, Cell, Chip, Count, Empty, ErrorBox, Glyph, List, ListRow, PageHeader, RowTitle, SceneCard, SceneThumb,
  SearchField, Segmented, Select, Skel, Spacer, Toolbar,
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
  recent: (a, b) => (b.lastPlayedAt ?? 0) - (a.lastPlayedAt ?? 0) || b.createdAt - a.createdAt,
  name: (a, b) => a.name.localeCompare(b.name, "de"),
  created: (a, b) => b.createdAt - a.createdAt,
};

type Looks = ReturnType<typeof useLookStore.getState>["looks"];

/** Anzahl bekannter Updates aus dem Cache (gefüllt vom Detail oder von `useBackgroundUpdates`). */
function useCachedUpdates(inst: Instance) {
  const { data } = useModUpdates(inst.id, false);
  return (data ?? []).filter((u) => inst.mods.some((m) => m.id === u.modId && m.version === u.currentVersion)).length;
}

/** Status nur als Ausnahme: installiert gerade, startet, läuft, abgestürzt oder mit Updates. Der Normalfall bleibt leer. */
function LibStatus({ inst }: { inst: Instance }) {
  const phase = usePhase(inst.id);
  const nUpd = useCachedUpdates(inst);
  if (LOUD_PHASES.includes(phase)) return <StatusChip instance={inst} small />;
  if (nUpd > 0)
    return (
      <Chip icon="up">
        <Count value={nUpd} /> {nUpd === 1 ? "Update" : "Updates"}
      </Chip>
    );
  return null;
}

/** Poster 4:5: Szene, Ausnahme-Status oben links, beim Überfahren oder Fokus großer Spielen-Knopf mittig und Menü oben rechts, Name unten. Rechtsklick öffnet das Menü. */
function PosterCard({ inst, index, looks }: { inst: Instance; index: number; looks: Looks }) {
  const items = useInstanceMenu(inst);
  return (
    <SceneCard
      variant="poster"
      look={lookOf(looks, inst.id)}
      title={inst.name}
      sub={`${loaderLine(inst)} · ${relativeTime(inst.lastPlayedAt)}`}
      status={<LibStatus inst={inst} />}
      primary={<PlayButton instance={inst} size="m" />}
      actions={<InstanceMenuButton instance={inst} small variant="g" onScene />}
      hit={{ to: `/instances/${inst.id}`, label: `${inst.name} öffnen` }}
      menu={items}
      index={index}
    />
  );
}

/** Listenzeile, 56 px, feste Spalten. Die ganze Zeile öffnet die Instanz; Spielen und Menü liegen darüber. */
function InstanceRow({ inst, index, looks }: { inst: Instance; index: number; looks: Looks }) {
  const items = useInstanceMenu(inst);
  const look = lookOf(looks, inst.id);
  return (
    <ListRow hit={{ to: `/instances/${inst.id}`, label: `${inst.name} öffnen` }} menu={items} index={Math.min(index, 12)} style={{ "--acc": look.acc } as CSSProperties}>
      <SceneThumb bio={look.bio} seed={look.seed} />
      <RowTitle title={inst.name} sub={`erstellt ${formatDate(inst.createdAt)}`} />
      <Cell title={loaderLine(inst)}>{loaderLine(inst)}</Cell>
      <Cell hide={1040}><Count value={inst.mods.length} /></Cell>
      <Cell hide={1040}>{relativeTime(inst.lastPlayedAt)}</Cell>
      <Cell flex><LibStatus inst={inst} /></Cell>
      <PlayButton instance={inst} size="i" />
      <InstanceMenuButton instance={inst} variant="g" small />
    </ListRow>
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

  // Updates für Poster und Liste: sparsam im Hintergrund, zuletzt gespielte zuerst.
  useBackgroundUpdates((instances ?? []).filter((i) => i.mods.length > 0).sort(SORTS.recent).map((i) => i.id));

  // Ergebnis von Suche, Filter und Sortierung ansagen (nur Screenreader, beim Tippen nach kurzer Pause).
  const total = instances?.length ?? 0;
  const [said, setSaid] = useState("");
  const viewKey = `${q}|${loader}|${sort}`;
  const lastView = useRef(viewKey);
  useEffect(() => {
    if (viewKey === lastView.current) return;
    const t = setTimeout(() => {
      lastView.current = viewKey;
      setSaid(`${shown.length} von ${total} ${total === 1 ? "Instanz" : "Instanzen"}`);
    }, 500);
    return () => clearTimeout(t);
  }, [viewKey, shown.length, total]);

  // Leere Bibliothek: keine Werkzeugleiste, der Leerzustand trägt die einzige „Neue Instanz“ (mit Strg+N und Dateiablage).
  const empty = !error && !isLoading && !instances?.length;

  let body;
  if (error) {
    body = <ErrorBox title="Die Bibliothek konnte nicht geladen werden" error={error} onRetry={() => void refetch()} />;
  } else if (isLoading) {
    body = (
      <CardGrid aria-busy aria-label="Wird geladen">
        {[0, 1, 2, 3].map((k) => <Skel key={k} className="aspect-[4/5]" />)}
      </CardGrid>
    );
  } else if (!instances?.length) {
    body = (
      <Empty
        size="page"
        ill={<Glyph name="chest" pal="copper" box={64} />}
        title="Deine Bibliothek ist leer"
        actions={
          <>
            <NewInstanceDialog primary>
              <Button variant="primary" icon="plus" aria-keyshortcuts="Control+N">Neue Instanz</Button>
            </NewInstanceDialog>
            <ButtonLink to="/discover">Modpacks entdecken</ButtonLink>
          </>
        }
      >
        Leg eine Instanz an, zieh eine .mrpack-Datei ins Fenster oder such dir ein Modpack aus.
      </Empty>
    );
  } else if (!shown.length) {
    body = (
      <Empty
        size="page"
        ill="search"
        title="Keine Treffer"
        actions={<Button onClick={() => { setQuery(""); setLoader("all"); }}>Suche und Filter zurücksetzen</Button>}
      >
        Keine Instanz passt zu „{query.trim() || LOADER_LABELS[loader as ModLoader]}“{q && loader !== "all" ? ` mit ${LOADER_LABELS[loader]}` : ""}.
      </Empty>
    );
  } else if (mode === "poster") {
    body = (
      <CardGrid>
        {shown.map((inst, k) => <PosterCard key={inst.id} inst={inst} index={k} looks={looks} />)}
      </CardGrid>
    );
  } else {
    body = (
      <List
        variant="instances"
        divided
        aria-label="Instanzen"
        head={
          <>
            <span />
            <Cell>Name</Cell>
            <Cell>Version</Cell>
            <Cell hide={1040}>Inhalte</Cell>
            <Cell hide={1040}>Zuletzt gespielt</Cell>
            <Cell>Status</Cell>
            <span />
            <span />
          </>
        }
      >
        {shown.map((inst, k) => <InstanceRow key={inst.id} inst={inst} index={k} looks={looks} />)}
      </List>
    );
  }

  return (
    <section className="page lib">
      <PageHeader title="Bibliothek" count={instances?.length ?? 0} />
      <div className="sr" role="status" aria-live="polite" aria-atomic="true">{said}</div>
      {/* Abstände wie bisher: 16 über, 18 unter der Werkzeugleiste */}
      {!empty && (
        <Toolbar search="m" className="mt-4 mb-4.5">
          <SearchField value={query} onChange={setQuery} placeholder="Instanz suchen" />
          <Select
            label="Loader"
            value={loader}
            onChange={(v) => setLoader(v as ModLoader | "all")}
            options={[{ value: "all", label: "Alle" }, ...ALL_LOADERS.map((l) => ({ value: l, label: LOADER_LABELS[l] }))]}
          />
          <Select
            label="Sortieren"
            className="max-[900px]:hidden"
            value={sort}
            onChange={(v) => setSort(v as Sort)}
            options={[{ value: "recent", label: "Zuletzt gespielt" }, { value: "name", label: "Name" }, { value: "created", label: "Erstellt" }]}
          />
          <Segmented
            iconsOnly
            label="Ansicht"
            value={mode}
            onChange={setMode}
            items={[{ value: "poster", label: "Poster", icon: "grid" }, { value: "list", label: "Liste", icon: "list" }]}
          />
          <Spacer />
          <NewInstanceDialog primary>
            <Button variant="primary" icon="plus" aria-keyshortcuts="Control+N">Neue Instanz</Button>
          </NewInstanceDialog>
        </Toolbar>
      )}
      {body}
    </section>
  );
}
