import { useMemo, useRef, useState, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Btn, Checkbox, Chip, Empty, Menu, Progress, ProjectIcon, SearchField, Seg, Switch, Tip, type MenuEntry } from "@/components/px";
import { IRIS_PROJECT_ID } from "@/components/ContentBrowser";
import { useContentInstall, useContentState, useProjects, withTarget } from "@/hooks/useContent";
import { instanceKeys, useUpdateMods } from "@/hooks/useInstances";
import { api } from "@/lib/api";
import { projectOf, removeWithDependencies, undoRemove, type ModUpdate } from "@/lib/modrinth";
import type { Instance, Mod, ModKind } from "@/lib/types";
import { cn } from "@/lib/utils";
import { Glyph, Icon } from "@/pixel/icons";

const KIND1: Record<ModKind, string> = { mod: "Mod", shader: "Shader", resourcepack: "Ressourcenpaket" };
const KINDS: Record<ModKind, string> = { mod: "Mods", shader: "Shader", resourcepack: "Ressourcenpakete" };

type KindFilter = "all" | ModKind;
type Warn = { t: string; lab: string; fix: () => void };
type Row = { type: "row"; mod: Mod; owners: string[] };
type Ghost = { type: "ghost"; mod: Mod; title: string; at: number; group: string; main: boolean; by?: string };
type Entry = Row | Ghost;

/** Hinweise je Inhalt und ihre Anzahl (für den Warnpunkt am Tab). */
export function useWarnings(instance: Instance, onAddIris: () => void, turnOnIris: () => void) {
  const iris = instance.mods.find((m) => projectOf(m) === IRIS_PROJECT_ID);
  const warnsOf = (m: Mod): Warn[] => {
    if (m.kind !== "shader" || (iris && iris.enabled)) return [];
    return [iris ? { t: "Shader brauchen Iris", lab: "Iris einschalten", fix: turnOnIris } : { t: "Shader brauchen Iris", lab: "Iris hinzufügen", fix: onAddIris }];
  };
  const total = instance.mods.reduce((n, m) => n + warnsOf(m).length, 0);
  return { warnsOf, total };
}

/** Inhalte einer Instanz: Liste oder Raster, Mehrfachauswahl, Hinweise, Entfernen mit Platzhalter. */
export function ContentTab({ instance, updateFor, onAdd, warnsOf }: { instance: Instance; updateFor: Map<string, ModUpdate>; onAdd: () => void; warnsOf: (m: Mod) => Warn[] }) {
  const qc = useQueryClient();
  const update = useUpdateMods(instance.id);
  const install = useContentInstall();
  const { active, target, progress } = useContentState();
  const [search, setSearch] = useState("");
  const [kind, setKind] = useState<KindFilter>("all");
  const [mode, setMode] = useState<"list" | "grid">("list");
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [ghosts, setGhosts] = useState<Ghost[]>([]);
  const groups = useRef(new Map<string, { before: Mod[]; removed: Mod[] }>());
  const projects = useProjects(instance.mods.flatMap((m) => projectOf(m) ?? []));
  const project = (m: Mod) => projects.data?.get(projectOf(m) ?? "");
  const title = (m: Mod) => project(m)?.title ?? m.name;

  // Direkt Hinzugefügtes zuerst, jede Abhängigkeit eingerückt unter ihrem ersten vorhandenen Nutzer.
  const byProject = new Map(instance.mods.flatMap((m) => { const p = projectOf(m); return p ? [[p, m] as const] : []; }));
  const ownersOf = (m: Mod) => m.requiredBy.flatMap((p) => byProject.get(p) ?? []);
  const rows: Row[] = [];
  const placed = new Set<Mod>();
  const add = (mod: Mod) => { rows.push({ type: "row", mod, owners: ownersOf(mod).map(title) }); placed.add(mod); };
  for (const m of instance.mods.filter((m) => ownersOf(m).length === 0)) {
    add(m);
    instance.mods.filter((d) => ownersOf(d)[0] === m).forEach(add);
  }
  instance.mods.filter((m) => !placed.has(m)).forEach(add);

  // Platzhalter an ihrer alten Stelle einsetzen (aufsteigend, damit die Stellen stimmen).
  const liveIds = new Set(instance.mods.map((m) => m.id));
  const shownGhosts = ghosts.filter((g) => !liveIds.has(g.mod.id));
  const display: Entry[] = [...rows];
  [...shownGhosts].sort((a, b) => a.at - b.at).forEach((g) => display.splice(Math.min(g.at, display.length), 0, g));

  const needle = search.trim().toLowerCase();
  const matches = (e: Entry) => (kind === "all" || e.mod.kind === kind) && (!needle || (e.type === "row" ? title(e.mod) : e.title).toLowerCase().includes(needle));
  const visible = display.filter(matches);
  const visibleLive = visible.filter((e): e is Row => e.type === "row");
  const pickedLive = [...picked].filter((id) => liveIds.has(id));
  const pickedVisible = visibleLive.filter((r) => picked.has(r.mod.id)).length;

  const counts = useMemo(() => {
    const c = { all: instance.mods.length, mod: 0, shader: 0, resourcepack: 0 };
    for (const m of instance.mods) c[m.kind]++;
    return c;
  }, [instance.mods]);

  const togglePick = (id: string, on: boolean) => setPicked((p) => { const n = new Set(p); if (on) n.add(id); else n.delete(id); return n; });

  function setEnabled(ids: string[], enabled: boolean) {
    update.mutate({ ...instance, mods: instance.mods.map((m) => (ids.includes(m.id) ? { ...m, enabled } : m)) });
  }

  function runUpdates(modIds: string[]) {
    if (!modIds.length) return;
    const one = modIds.length === 1 ? instance.mods.find((m) => m.id === modIds[0]) : undefined;
    const name = one ? title(one) : "";
    install.mutate(
      withTarget(one ? one.id : "updates", (op) => api.modrinthUpdateMods(instance.id, modIds, op), name ? `${name} aktualisieren` : `${modIds.length} Inhalte aktualisieren`),
      { onSuccess: (result) => { if (result) toast.success(name ? `${name} ist aktuell` : `${modIds.length} Inhalte aktualisiert`); } },
    );
  }

  function undo(group: string) {
    const g = groups.current.get(group);
    if (!g) return;
    groups.current.delete(group);
    setGhosts((gs) => gs.filter((x) => x.group !== group));
    // Aktuellen Stand nehmen: in der Zwischenzeit können weitere Änderungen passiert sein.
    const current = qc.getQueryData<Instance>(instanceKeys.detail(instance.id));
    if (!current || g.removed.some((m) => current.mods.some((c) => c.id === m.id))) return;
    update.mutate({ ...current, mods: undoRemove(current.mods, g.before, g.removed) });
  }

  function remove(ids: string[]) {
    const before = instance.mods;
    let mods = before;
    const removed: Mod[] = [];
    const by = new Map<string, string>();
    for (const id of ids) {
      if (!mods.some((m) => m.id === id)) continue;
      const r = removeWithDependencies(mods, id);
      mods = r.mods;
      removed.push(...r.removed);
      r.removed.slice(1).forEach((d) => by.set(d.id, title(r.removed[0])));
    }
    if (!removed.length) return;
    const group = `g${Date.now()}`;
    groups.current.set(group, { before, removed });
    const at = new Map(display.map((e, i) => [e.mod.id, i]));
    setGhosts((gs) => [...gs, ...removed.map((m) => ({ type: "ghost" as const, mod: m, title: title(m), at: at.get(m.id) ?? display.length, group, main: ids.includes(m.id), by: by.get(m.id) }))]);
    setPicked((p) => new Set([...p].filter((id) => !removed.some((m) => m.id === id))));
    update.mutate({ ...instance, mods });
    const main = removed.filter((m) => ids.includes(m.id));
    const extra = removed.length - main.length;
    toast(`${main.length === 1 ? title(main[0]) : `${main.length} Inhalte`}${extra ? ` und ${extra} ${extra === 1 ? "Abhängigkeit" : "Abhängigkeiten"}` : ""} entfernt`, {
      duration: 6500,
      action: { label: "Rückgängig", onClick: () => undo(group) },
    });
  }

  if (instance.mods.length === 0 && shownGhosts.length === 0) {
    return (
      <Empty
        ill={<Glyph name="cube" pal="steel" big />}
        title="Noch keine Inhalte"
        actions={<Btn variant="p" icon="plus" onClick={onAdd}>Hinzufügen</Btn>}
      >
        {instance.loader === "vanilla"
          ? "Diese Instanz ist Minecraft pur. Ressourcenpakete gehen trotzdem, Mods brauchen einen Loader wie Fabric."
          : "Füge Mods, Shader oder Ressourcenpakete hinzu. Voxlet wählt passende Versionen aus."}
      </Empty>
    );
  }

  const nUpd = updateFor.size;
  const updatingAll = !!active && target === "updates";
  const busyFor = (m: Mod) => !!active && (target === m.id || (target === "updates" && updateFor.has(m.id)));
  const pct = progress?.phase === "download" && progress.total ? progress.done / progress.total : null;

  const menuFor = (m: Mod): MenuEntry[] => {
    const up = updateFor.get(m.id);
    const pid = projectOf(m);
    return [
      ...(up ? [{ id: "up", text: `Auf ${up.versionNumber} aktualisieren`, icon: "up" as const, disabled: !!active, onSelect: () => runUpdates([m.id]) }] : []),
      ...(pid ? [{ id: "web", text: "Auf Modrinth ansehen", icon: "ext" as const, onSelect: () => void api.openExternal(`https://modrinth.com/project/${pid}`) }] : []),
      ...(up || pid ? ["-" as const] : []),
      { id: "rm", text: "Entfernen", icon: "trash", bad: true, onSelect: () => remove([m.id]) },
    ];
  };

  const tipFor = (r: Row, warns: Warn[]): ReactNode => {
    const m = r.mod, up = updateFor.get(m.id), desc = project(m)?.description;
    return (
      <>
        <div className="tn">{title(m)}</div>
        <div className="tv">{KIND1[m.kind]} · Version {m.version}{m.enabled ? "" : " · ausgeschaltet"}</div>
        {r.owners.length > 0 && <div className="tr">Benötigt von {r.owners.join(", ")}</div>}
        {up && <div className="tu">Update auf {up.versionNumber} verfügbar</div>}
        {warns.map((w) => <div key={w.t} className="tw">{w.t}</div>)}
        {desc && <div className="td">{desc}</div>}
      </>
    );
  };

  const subOf = (r: Row) =>
    r.owners.length ? `Benötigt von ${r.owners.join(", ")} · ${r.mod.version}` : `${KIND1[r.mod.kind]} · ${r.mod.version}${r.mod.enabled ? "" : " · aus"}`;

  const updCell = (m: Mod) => {
    if (busyFor(m))
      return (
        <div style={{ width: "100%", display: "flex", flexDirection: "column", gap: 4, alignItems: "flex-end" }}>
          <span className="faint" style={{ fontSize: 11.5 }}>Wird aktualisiert</span>
          <Progress thin p={pct} style={{ width: "100%" }} />
        </div>
      );
    const up = updateFor.get(m.id);
    if (!up) return null;
    return (
      <Tip label={`Von ${m.version} auf ${up.versionNumber}`}>
        <Btn size="s" icon="up" disabled={!!active} onClick={() => runUpdates([m.id])}><span className="ell" style={{ maxWidth: 84 }}>{up.versionNumber}</span></Btn>
      </Tip>
    );
  };

  const moreBtn = (m: Mod) => (
    <Menu items={menuFor(m)} trigger={<Btn variant="g" size="s" iconOnly icon="more" aria-label={`Mehr zu ${title(m)}`} />} />
  );

  const ghostRow = (g: Ghost) =>
    mode === "grid" ? (
      <div key={`g-${g.mod.id}`} className="ctile gone">
        <b className="ell">{g.title} entfernt</b>
        {g.main && <Btn size="s" onClick={() => undo(g.group)}>Rückgängig</Btn>}
      </div>
    ) : (
      <div key={`g-${g.mod.id}`} className="crow gone" role="listitem">
        <span />
        <ProjectIcon url={project(g.mod)?.icon_url} seed={g.mod.id} />
        <div className="cn"><b>{g.title} entfernt{g.by ? ` (mit ${g.by})` : ""}</b></div>
        {g.main ? <Btn size="s" icon="redo" onClick={() => undo(g.group)}>Rückgängig</Btn> : <span />}
      </div>
    );

  const listRow = (r: Row) => {
    const m = r.mod, warns = warnsOf(m), on = picked.has(m.id);
    return (
      <div key={m.id} className={cn("crow", !m.enabled && "off", r.owners.length > 0 && "dep", on && "picked")} role="listitem">
        <Checkbox checked={on} onChange={(v) => togglePick(m.id, v)} label={`${title(m)} auswählen`} />
        <ProjectIcon url={project(m)?.icon_url} seed={m.id} />
        <Tip label={tipFor(r, warns)}>
          <div className="cn"><b>{title(m)}</b><span>{subOf(r)}</span></div>
        </Tip>
        <div className="warns">
          {warns.map((w) => (
            <span key={w.t} className="contents">
              <Chip small dot tone="warn" title={w.t}>{w.t}</Chip>
              <Btn variant="g" size="s" tone="warn" onClick={w.fix}>{w.lab}</Btn>
            </span>
          ))}
        </div>
        <div className="upd">{updCell(m)}</div>
        <Switch checked={m.enabled} onChange={(v) => setEnabled([m.id], v)} label={`${title(m)} eingeschaltet`} />
        {moreBtn(m)}
      </div>
    );
  };

  const tile = (r: Row) => {
    const m = r.mod, warns = warnsOf(m), on = picked.has(m.id);
    return (
      <div key={m.id} className={cn("ctile", !m.enabled && "off", on && "picked")}>
        <ProjectIcon url={project(m)?.icon_url} seed={m.id} />
        <Tip label={tipFor(r, warns)}>
          <div className="cn"><b>{title(m)}</b><span>{r.owners.length ? `Benötigt von ${r.owners.join(", ")}` : KIND1[m.kind]} · {m.version}</span></div>
        </Tip>
        <div className="tw">{warns.map((w) => <Chip key={w.t} small dot tone="warn">{w.t}</Chip>)}</div>
        <div className="tb">
          <Checkbox checked={on} onChange={(v) => togglePick(m.id, v)} label={`${title(m)} auswählen`} />
          <span className="grow" />
          <div className="upd">{updCell(m)}</div>
          <Switch checked={m.enabled} onChange={(v) => setEnabled([m.id], v)} label={`${title(m)} eingeschaltet`} />
          {moreBtn(m)}
        </div>
      </div>
    );
  };

  return (
    <>
      <div className={cn("ctool", pickedLive.length > 0 && "picking")}>
        <div className="main" aria-hidden={pickedLive.length > 0 || undefined}>
          <SearchField small value={search} onChange={setSearch} placeholder="Inhalte suchen" />
          <Seg
            small
            label="Art"
            value={kind}
            onChange={setKind}
            options={[
              { value: "all", label: "Alle", count: counts.all },
              { value: "mod", label: "Mods", count: counts.mod },
              { value: "shader", label: "Shader", count: counts.shader },
              { value: "resourcepack", label: "Pakete", count: counts.resourcepack },
            ]}
          />
          <span className="sp" />
          <Seg
            small
            icons
            className="hide-m"
            label="Darstellung"
            value={mode}
            onChange={setMode}
            options={[{ value: "list", label: "Liste", icon: "list", tip: "Liste" }, { value: "grid", label: "Raster", icon: "grid", tip: "Raster" }]}
          />
          <Btn
            size="s"
            icon="up"
            className="updall"
            style={{ width: 192 }}
            aria-label={nUpd ? `Alle aktualisieren (${nUpd})` : "Alles aktuell"}
            disabled={!nUpd || !!active}
            onClick={() => runUpdates([...updateFor.keys()])}
          >
            <span className="updt" data-n={nUpd || ""}>{updatingAll ? "Wird aktualisiert" : nUpd ? `Alle aktualisieren (${nUpd})` : "Alles aktuell"}</span>
          </Btn>
          <Btn variant="p" size="s" icon="plus" onClick={onAdd}>Hinzufügen</Btn>
        </div>
        <div className="bulk" aria-live="polite">
          <span className="bl"><b className="num">{pickedLive.length}</b> ausgewählt</span>
          <Btn size="s" onClick={() => setEnabled(pickedLive, false)}>Ausschalten</Btn>
          <Btn size="s" onClick={() => setEnabled(pickedLive, true)}>Einschalten</Btn>
          <Btn size="s" icon="up" disabled={!!active || !pickedLive.some((id) => updateFor.has(id))} onClick={() => runUpdates(pickedLive.filter((id) => updateFor.has(id)))}>Aktualisieren</Btn>
          <Btn size="s" icon="trash" onClick={() => remove(pickedLive)}>Entfernen</Btn>
          <span className="sp" />
          <Btn variant="g" size="s" onClick={() => setPicked(new Set())}>Auswahl aufheben</Btn>
        </div>
      </div>

      {visible.length === 0 ? (
        <Empty
          minHeight={240}
          ill={<Icon name="search" />}
          title="Nichts gefunden"
          actions={
            <>
              <Btn onClick={() => { setSearch(""); setKind("all"); }}>Filter zurücksetzen</Btn>
              <Btn onClick={onAdd}>Im Katalog suchen</Btn>
            </>
          }
        >
          Kein Inhalt passt zu „{search.trim() || (kind !== "all" ? KINDS[kind] : "")}“.
        </Empty>
      ) : mode === "grid" ? (
        <div className="cgrid">{visible.map((e) => (e.type === "row" ? tile(e) : ghostRow(e)))}</div>
      ) : (
        <>
          <div className="chead">
            <span>
              <Checkbox
                label="Alle auswählen"
                checked={pickedVisible > 0 && pickedVisible === visibleLive.length}
                indeterminate={pickedVisible > 0 && pickedVisible < visibleLive.length}
                onChange={(v) => setPicked((p) => { const n = new Set(p); visibleLive.forEach((r) => (v ? n.add(r.mod.id) : n.delete(r.mod.id))); return n; })}
              />
            </span>
            <span />
            <span>Name</span>
            <span>Hinweise</span>
            <span style={{ textAlign: "right" }}>Update</span>
            <span>An</span>
            <span />
          </div>
          <div className="clist" role="list">{visible.map((e) => (e.type === "row" ? listRow(e) : ghostRow(e)))}</div>
        </>
      )}

      {instance.mods.some((m) => m.kind === "resourcepack") && (
        <p className="hintline" style={{ marginTop: 8 }}>
          <Icon name="info" />
          Ressourcenpakete schaltest du im Spiel unter Optionen › Ressourcenpakete ein.
        </p>
      )}
    </>
  );
}
