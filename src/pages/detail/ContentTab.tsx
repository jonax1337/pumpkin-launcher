import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";
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

/** Fokus setzen, sobald das Ziel sichtbar ist (Platzhalter erscheinen erst nach dem optimistischen Update, Menüs geben den Fokus einen Takt später ab). */
function focusSoon(find: () => HTMLElement | null | undefined) {
  let n = 0;
  const go = () => {
    const el = find();
    if (el?.isConnected && el.checkVisibility()) el.focus({ focusVisible: true } as FocusOptions);
    else if (++n < 60) requestAnimationFrame(go);
  };
  setTimeout(go, 0);
}

const RP_HINT = "Ressourcenpakete schaltest du im Spiel unter Optionen › Ressourcenpakete ein.";

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
export function ContentTab({ instance, updateFor, onAdd, warnsOf, showUpdates = 0 }: {
  instance: Instance; updateFor: Map<string, ModUpdate>; onAdd: () => void; warnsOf: (m: Mod) => Warn[];
  /** Zählt hoch, wenn der Kopf „Updates“ angeklickt wurde. */
  showUpdates?: number;
}) {
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
  const updRef = useRef<HTMLButtonElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const uid = useId();
  // Eigene Statusregion (nur für Screenreader): Auswahl, Treffer, Wiederherstellen. Die Leisten selbst sind nicht live.
  const [said, setSaid] = useState("");
  const quietPick = useRef(false);

  // Vom Kopf „Updates“: Filter lösen und „Alle aktualisieren“ in den Blick holen und fokussieren.
  useEffect(() => {
    if (!showUpdates) return;
    setSearch("");
    setKind("all");
    setPicked(new Set());
    // Der Tabwechsel läuft als Navigation und kann ein paar Frames später sichtbar werden: so lange warten.
    let raf = 0, tries = 0;
    const go = () => {
      const b = updRef.current;
      if (b && b.checkVisibility()) {
        b.scrollIntoView({ block: "nearest" });
        b.focus({ preventScroll: true, focusVisible: true } as FocusOptions);
      } else if (++tries < 30) raf = requestAnimationFrame(go);
    };
    raf = requestAnimationFrame(go);
    return () => cancelAnimationFrame(raf);
  }, [showUpdates]);
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

  // Auswahl ansagen (Entfernen sagt der Toast selbst an).
  const nPicked = pickedLive.length;
  const lastPicked = useRef(nPicked);
  useEffect(() => {
    if (nPicked === lastPicked.current) return;
    lastPicked.current = nPicked;
    if (quietPick.current) return void (quietPick.current = false);
    setSaid(nPicked ? `${nPicked} ausgewählt` : "Auswahl aufgehoben");
  }, [nPicked]);

  // Trefferzahl nach dem Filtern, beim Tippen erst nach einer kurzen Pause.
  const nVisible = visibleLive.length;
  const nAll = instance.mods.length;
  const filterKey = `${kind}|${needle}`;
  const lastFilter = useRef(filterKey);
  useEffect(() => {
    if (filterKey === lastFilter.current) return;
    const t = setTimeout(() => {
      lastFilter.current = filterKey;
      setSaid(`${nVisible} von ${nAll} ${nAll === 1 ? "Inhalt" : "Inhalten"}`);
    }, 500);
    return () => clearTimeout(t);
  }, [filterKey, nVisible, nAll]);

  /** Nach Bulk-Aktionen, die die Leiste schließen: Kopf-Checkbox (Liste) oder Suchfeld (Raster). */
  const focusHead = () =>
    focusSoon(() => rootRef.current?.querySelector<HTMLElement>(".chead input[type=checkbox]") ?? rootRef.current?.querySelector<HTMLElement>(".ctool .main input[type=search]"));
  const clearPicked = () => {
    setPicked(new Set());
    focusHead();
  };

  const togglePick = (id: string, on: boolean) => setPicked((p) => { const n = new Set(p); if (on) n.add(id); else n.delete(id); return n; });

  // Ressourcenpakete schaltet das Spiel selbst ein; hier gibt es für sie keinen Schalter.
  const switchable = (id: string) => instance.mods.some((m) => m.id === id && m.kind !== "resourcepack");
  function setEnabled(ids: string[], enabled: boolean) {
    const on = new Set(ids.filter(switchable));
    update.mutate({ ...instance, mods: instance.mods.map((m) => (on.has(m.id) ? { ...m, enabled } : m)) });
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
    const back = ghosts.filter((x) => x.group === group);
    setGhosts((gs) => gs.filter((x) => x.group !== group));
    // Aktuellen Stand nehmen: in der Zwischenzeit können weitere Änderungen passiert sein.
    const current = qc.getQueryData<Instance>(instanceKeys.detail(instance.id));
    if (!current || g.removed.some((m) => current.mods.some((c) => c.id === m.id))) return;
    update.mutate({ ...current, mods: undoRemove(current.mods, g.before, g.removed) });
    // Der Platzhalter verschwindet: Fokus auf das Menü der wiederhergestellten Zeile statt auf body.
    const main = back.find((x) => x.main) ?? back[0];
    if (main) {
      setSaid(`${main.title} wiederhergestellt`);
      if (rootRef.current?.contains(document.activeElement)) focusSoon(() => rootRef.current?.querySelector<HTMLElement>(`[data-more="${CSS.escape(main.mod.id)}"]`));
    }
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
    quietPick.current = picked.size > 0 && removed.some((m) => picked.has(m.id));
    setPicked((p) => new Set([...p].filter((id) => !removed.some((m) => m.id === id))));
    update.mutate({ ...instance, mods });
    // Fokus nicht auf body fallen lassen: einzeln → „Rückgängig“ im Platzhalter, mehrere (Leiste schließt) → Kopf.
    if (ids.length === 1) focusSoon(() => rootRef.current?.querySelector<HTMLElement>(`[data-undo="${group}"]`));
    else focusHead();
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
        actions={<Btn icon="plus" onClick={onAdd}>Hinzufügen</Btn>}
      >
        {instance.loader === "vanilla"
          ? "Diese Instanz ist Minecraft pur. Ressourcenpakete gehen trotzdem, Mods brauchen einen Loader wie Fabric."
          : "Füge Mods, Shader oder Ressourcenpakete hinzu. Voxlet wählt passende Versionen aus."}
      </Empty>
    );
  }

  const nUpd = updateFor.size;
  // Spalte „Hinweise“ nur, wenn überhaupt ein Inhalt einen hat (unabhängig vom Filter, damit sie beim Filtern nicht springt).
  const hasWarns = instance.mods.some((m) => warnsOf(m).length > 0);
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

  /** Was sonst nur im Tooltip steht, als Text für Screenreader (per aria-describedby am Menüknopf der Zeile). */
  const descId = (m: Mod) => `${uid}-d-${m.id}`;
  const descOf = (r: Row, warns: Warn[]) => {
    const m = r.mod, up = updateFor.get(m.id), desc = project(m)?.description;
    return [
      !m.enabled && "Ausgeschaltet",
      up && `Update auf ${up.versionNumber} verfügbar`,
      ...warns.map((w) => w.t),
      desc,
    ].filter(Boolean).join(". ");
  };
  const srDesc = (m: Mod, text: string) => text && <span id={descId(m)} className="sr">{text}</span>;

  const subOf = (r: Row) =>
    r.owners.length ? `Benötigt von ${r.owners.join(", ")} · ${r.mod.version}` : `${KIND1[r.mod.kind]} · ${r.mod.version}`;

  const updCell = (m: Mod) => {
    if (busyFor(m))
      return (
        <div style={{ width: "100%", display: "flex", flexDirection: "column", gap: 4, alignItems: "flex-end" }}>
          <span className="faint" style={{ fontSize: 11.5 }}>Wird aktualisiert</span>
          <Progress thin p={pct} style={{ width: "100%" }} label={`${title(m)} wird aktualisiert`} />
        </div>
      );
    const up = updateFor.get(m.id);
    if (!up) return null;
    // Feste Breite: linke Kanten stehen untereinander, lange Versionen enden mit Auslassung (voller Text im Tooltip).
    return (
      <Tip label={`${title(m)} von ${m.version} auf ${up.versionNumber} aktualisieren`}>
        <Btn size="s" icon="up" full className="updbtn" disabled={!!active} aria-label={`${title(m)} auf ${up.versionNumber} aktualisieren`} onClick={() => runUpdates([m.id])}>
          <span className="ell">{up.versionNumber}</span>
        </Btn>
      </Tip>
    );
  };

  /** An/Aus: Schalter mit sichtbarem „Aus“; Ressourcenpakete haben keinen (das Spiel schaltet sie ein). */
  const onCell = (m: Mod) =>
    m.kind === "resourcepack" ? (
      <Tip label={RP_HINT}>
        <span className="ingame">Im Spiel<span className="sr"> einschalten</span></span>
      </Tip>
    ) : (
      <>
        <span className="offl" aria-hidden>Aus</span>
        <Switch checked={m.enabled} onChange={(v) => setEnabled([m.id], v)} label={`${title(m)} eingeschaltet`} />
      </>
    );

  const moreBtn = (m: Mod, described = false) => (
    <Menu
      items={menuFor(m)}
      trigger={<Btn variant="g" size="s" iconOnly icon="more" data-more={m.id} aria-label={`Mehr zu ${title(m)}`} aria-describedby={described ? descId(m) : undefined} />}
    />
  );

  const ghostRow = (g: Ghost) =>
    mode === "grid" ? (
      <div key={`g-${g.mod.id}`} className="ctile gone">
        <b className="ell" id={`${uid}-g-${g.mod.id}`}>{g.title} entfernt</b>
        {g.main && <Btn size="s" data-undo={g.group} aria-describedby={`${uid}-g-${g.mod.id}`} onClick={() => undo(g.group)}>Rückgängig</Btn>}
      </div>
    ) : (
      <div key={`g-${g.mod.id}`} className="crow gone" role="listitem">
        <span />
        <ProjectIcon url={project(g.mod)?.icon_url} seed={g.mod.id} />
        <div className="cn"><b id={`${uid}-g-${g.mod.id}`}>{g.title} entfernt{g.by ? ` (mit ${g.by})` : ""}</b></div>
        {g.main ? <Btn size="s" icon="redo" data-undo={g.group} aria-describedby={`${uid}-g-${g.mod.id}`} onClick={() => undo(g.group)}>Rückgängig</Btn> : <span />}
      </div>
    );

  const listRow = (r: Row) => {
    const m = r.mod, warns = warnsOf(m), on = picked.has(m.id), desc = descOf(r, warns);
    return (
      <div key={m.id} className={cn("crow", !m.enabled && "off", r.owners.length > 0 && "dep", on && "picked")} role="listitem">
        <Checkbox checked={on} onChange={(v) => togglePick(m.id, v)} label={`${title(m)} auswählen`} />
        <ProjectIcon url={project(m)?.icon_url} seed={m.id} />
        <Tip label={tipFor(r, warns)}>
          <div className="cn"><b>{title(m)}</b><span>{subOf(r)}</span>{srDesc(m, desc)}</div>
        </Tip>
        {hasWarns && (
          <div className="warns">
            {warns.map((w) => (
              <span key={w.t} className="contents">
                <Chip small dot tone="warn" title={w.t}>{w.t}</Chip>
                <Btn variant="g" size="s" tone="warn" onClick={w.fix}>{w.lab}</Btn>
              </span>
            ))}
          </div>
        )}
        <div className="upd">{updCell(m)}</div>
        <div className="onc">{onCell(m)}</div>
        {moreBtn(m, !!desc)}
      </div>
    );
  };

  /** Kachel, 88 px: Icon (Auswahlfeld darüber) · Name mit Schalter und Menü · eine Zeile Beschreibung bzw. Hinweis, rechts Update. */
  const tile = (r: Row) => {
    const m = r.mod, warns = warnsOf(m), on = picked.has(m.id), desc = descOf(r, warns);
    // Beschreibung steht schon im Screenreader-Text (srDesc); Art/Version nur hier.
    const about = r.owners.length ? "" : project(m)?.description ?? "";
    return (
      <div key={m.id} className={cn("ctile", !m.enabled && "off", on && "picked")}>
        <div className="tic">
          <ProjectIcon url={project(m)?.icon_url} seed={m.id} />
          <Checkbox checked={on} onChange={(v) => togglePick(m.id, v)} label={`${title(m)} auswählen`} />
        </div>
        <Tip label={tipFor(r, warns)}>
          <div className="cn"><b>{title(m)}</b>{srDesc(m, desc)}</div>
        </Tip>
        <div className="tr1">
          <div className="onc">{onCell(m)}</div>
          {moreBtn(m, !!desc)}
        </div>
        <div className="tl">
          {warns.length ? warns.map((w) => <Chip key={w.t} small dot tone="warn" title={w.t}>{w.t}</Chip>) : about ? <span aria-hidden>{about}</span> : <span>{subOf(r)}</span>}
        </div>
        <div className="upd">{updCell(m)}</div>
      </div>
    );
  };

  // Leere Filter gedämpft (Seg kennt nur den Text; die Klasse hängt am Label).
  const kindLabel = (text: string, n: number) => (n ? text : <span className="zero">{text}</span>);
  const pickedSwitchable = pickedLive.filter(switchable);

  return (
    <div className="ctab" ref={rootRef}>
      <div className="sr" role="status" aria-live="polite" aria-atomic="true">{said}</div>
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
              { value: "mod", label: kindLabel("Mods", counts.mod), count: counts.mod },
              { value: "shader", label: kindLabel("Shader", counts.shader), count: counts.shader },
              { value: "resourcepack", label: kindLabel("Ressourcenpakete", counts.resourcepack), count: counts.resourcepack },
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
          {/* Feste Breite in beiden Fällen: ohne Updates steht an derselben Stelle ruhiger Text statt eines toten Knopfs. */}
          {nUpd > 0 || updatingAll ? (
            <Btn
              ref={updRef}
              size="s"
              icon="up"
              className="upall"
              aria-label={updatingAll ? "Wird aktualisiert" : `Alle aktualisieren (${nUpd})`}
              disabled={!!active}
              onClick={() => runUpdates([...updateFor.keys()])}
            >
              <span className="updt" data-n={nUpd || ""}>{updatingAll ? "Wird aktualisiert" : `Alle aktualisieren (${nUpd})`}</span>
            </Btn>
          ) : (
            <span className="upall upnone">Alles aktuell</span>
          )}
          {/* Sekundär: auf dieser Seite ist nur Spielen Akzent-Primär. */}
          <Btn size="s" icon="plus" onClick={onAdd}>Hinzufügen</Btn>
        </div>
        <div className="bulk" aria-hidden={pickedLive.length === 0 || undefined}>
          <span className="bl"><b className="num">{pickedLive.length}</b> ausgewählt</span>
          <Btn size="s" disabled={!pickedSwitchable.length} onClick={() => setEnabled(pickedSwitchable, false)}>Ausschalten</Btn>
          <Btn size="s" disabled={!pickedSwitchable.length} onClick={() => setEnabled(pickedSwitchable, true)}>Einschalten</Btn>
          <Btn size="s" icon="up" disabled={!!active || !pickedLive.some((id) => updateFor.has(id))} onClick={() => runUpdates(pickedLive.filter((id) => updateFor.has(id)))}>Aktualisieren</Btn>
          <Btn size="s" icon="trash" onClick={() => remove(pickedLive)}>Entfernen</Btn>
          <span className="sp" />
          <Btn variant="g" size="s" onClick={clearPicked}>Auswahl aufheben</Btn>
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
        <div className={cn("cgrid", pickedLive.length > 0 && "picking")}>{visible.map((e) => (e.type === "row" ? tile(e) : ghostRow(e)))}</div>
      ) : (
        <div className={cn("ctable", !hasWarns && "nw")}>
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
            {hasWarns && <span>Hinweise</span>}
            <span className="updh">Update</span>
            <span className="onh">An</span>
            <span />
          </div>
          <div className="clist" role="list">{visible.map((e) => (e.type === "row" ? listRow(e) : ghostRow(e)))}</div>
        </div>
      )}

      {instance.mods.some((m) => m.kind === "resourcepack") && (
        <p className="hintline" style={{ marginTop: 8 }}>
          <Icon name="info" />
          {RP_HINT}
        </p>
      )}
    </div>
  );
}
