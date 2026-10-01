import { Fragment, useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  Button, Cell, Checkbox, Chip, Count, Empty, GhostRow, Glyph, Hint, IconButton, JobProgress, List, ListRow, Menu, ProjectIcon, RowTitle,
  SearchField, Segmented, Spacer, Switch, Tip, Toolbar, type MenuEntry,
} from "@/ui";
import { IRIS_PROJECT_ID } from "@/components/ContentBrowser";
import { useContentInstall, useContentState, useProjects, withTarget } from "@/hooks/useContent";
import { instanceKeys, useUpdateMods } from "@/hooks/useInstances";
import { api } from "@/lib/api";
import { openPage } from "@/lib/links";
import { ownerKey, projectOf, removeWithDependencies, undoRemove, type ModUpdate } from "@/lib/modrinth";
import { useI18n } from "@/i18n";
import type { Instance, Mod, ModKind } from "@/lib/types";
import { cn } from "@/lib/utils";
import { useLocalFiles } from "./LocalFiles";

/** Art eines Inhalts im Singular bzw. Plural – Schlüssel statt Texte, übersetzt erst bei der Ausgabe. */
const KIND1_KEYS: Record<ModKind, string> = {
  mod: "components.catalog.one.mod",
  shader: "components.catalog.one.shader",
  resourcepack: "components.catalog.one.resourcepack",
};
const KINDS_KEYS: Record<ModKind, string> = {
  mod: "components.catalog.kind.mod",
  shader: "components.catalog.kind.shader",
  resourcepack: "components.catalog.kind.resourcepack",
};
/** Hinweis auf das Umschalten von Ressourcenpaketen im Spiel. */
const RP_HINT_KEY = "detail.content.resourcePackHint";

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

/** Hinweise je Inhalt und ihre Anzahl (für den Warnpunkt am Tab). */
export function useWarnings(instance: Instance, onAddIris: () => void, turnOnIris: () => void) {
  const { t } = useI18n();
  const iris = instance.mods.find((m) => projectOf(m) === IRIS_PROJECT_ID);
  const warnsOf = (m: Mod): Warn[] => {
    if (m.kind !== "shader" || (iris && iris.enabled)) return [];
    return [
      iris
        ? { t: t("detail.content.shaderNeedsIris"), lab: t("detail.content.turnIrisOn"), fix: turnOnIris }
        : { t: t("detail.content.shaderNeedsIris"), lab: t("detail.content.addIris"), fix: onAddIris },
    ];
  };
  const total = instance.mods.reduce((n, m) => n + warnsOf(m).length, 0);
  return { warnsOf, total };
}

/** Inhalte einer Instanz: Liste oder Raster, Mehrfachauswahl, Hinweise, Entfernen mit Platzhalter. */
export function ContentTab({ instance, shown, updateFor, onAdd, warnsOf, showUpdates = 0 }: {
  instance: Instance; updateFor: Map<string, ModUpdate>; onAdd: () => void; warnsOf: (m: Mod) => Warn[];
  /** Nur der sichtbare Tab nimmt aufs Fenster gezogene Dateien an. */
  shown: boolean;
  /** Zählt hoch, wenn der Kopf „Updates“ angeklickt wurde. */
  showUpdates?: number;
}) {
  const { t } = useI18n();
  const qc = useQueryClient();
  const update = useUpdateMods(instance.id);
  const install = useContentInstall();
  const local = useLocalFiles(instance, shown);
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
      if (b && b.checkVisibility({ visibilityProperty: true } as CheckVisibilityOptions)) {
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
  const byProject = new Map(instance.mods.flatMap((m) => { const p = ownerKey(m); return p ? [[p, m] as const] : []; }));
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
    setSaid(nPicked ? t("detail.content.selectedCount", { n: nPicked }) : t("detail.content.selectionCleared"));
  }, [nPicked]);

  // Trefferzahl nach dem Filtern, beim Tippen erst nach einer kurzen Pause.
  const nVisible = visibleLive.length;
  const nAll = instance.mods.length;
  const filterKey = `${kind}|${needle}`;
  const lastFilter = useRef(filterKey);
  useEffect(() => {
    if (filterKey === lastFilter.current) return;
    const timer = setTimeout(() => {
      lastFilter.current = filterKey;
      setSaid(t(nAll === 1 ? "detail.content.visibleCount.one" : "detail.content.visibleCount.other", { visible: nVisible, total: nAll }));
    }, 500);
    return () => clearTimeout(timer);
  }, [filterKey, nVisible, nAll]);

  /** Nach Bulk-Aktionen, die die Leiste schließen: Kopf-Checkbox (Liste) oder Suchfeld (Raster). */
  const focusHead = () =>
    focusSoon(() => rootRef.current?.querySelector<HTMLElement>(".vx-lhead input[type=checkbox]") ?? rootRef.current?.querySelector<HTMLElement>(".vx-tb-main input[type=search]"));
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
      withTarget(
        one ? one.id : "updates",
        (op) => api.modrinthUpdateMods(instance.id, modIds, op),
        name ? t("detail.content.updateOneLabel", { name }) : t("detail.content.updateManyLabel", { n: modIds.length }),
        { doneLabel: name ? t("detail.content.updateOneDone", { name }) : t("detail.content.updateManyDone", { n: modIds.length }) },
      ),
      { onSuccess: (result) => { if (result) toast.success(name ? t("detail.content.oneUpToDate", { name }) : t("detail.content.manyUpdated", { n: modIds.length })); } },
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
      setSaid(t("detail.content.restoredAnnouncement", { name: main.title }));
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
    const things = main.length === 1 ? title(main[0]) : t(main.length === 1 ? "detail.content.itemsCount.one" : "detail.content.itemsCount.other", { n: main.length });
    toast(
      extra
        ? t("detail.content.removedToastWithDeps", {
            things,
            deps: t(extra === 1 ? "detail.content.dependencies.one" : "detail.content.dependencies.other", { n: extra }),
          })
        : t("detail.content.removedToast", { things }),
      {
        duration: 6500,
        action: { label: t("ui.list.undo"), onClick: () => undo(group) },
      },
    );
  }

  if (instance.mods.length === 0 && shownGhosts.length === 0) {
    return (
      <div className="relative">
        {local.overlay}
        <Empty
          ill={<Glyph name="cube" pal="steel" box={64} />}
          title={t("detail.content.emptyTitle")}
          actions={
            <>
              <Button icon="plus" onClick={onAdd}>{t("common.add")}</Button>
              {local.pick && <Button icon="ul" disabled={!!active} onClick={local.pick}>{t("detail.content.addFile")}</Button>}
            </>
          }
        >
          {instance.loader === "vanilla"
            ? t("detail.content.emptyVanilla")
            : t("detail.content.emptyHint")}
        </Empty>
      </div>
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
    const own = m.source.type === "local";
    return [
      ...(up ? [{ id: "up", text: t("detail.content.updateVersionTo", { version: up.versionNumber }), icon: "up" as const, disabled: !!active, onSelect: () => runUpdates([m.id]) }] : []),
      ...(own ? [{ id: "identify", text: t("detail.content.matchOnModrinth"), icon: "search" as const, disabled: !!active, onSelect: () => local.identify(m) }] : []),
      ...(pid ? [{ id: "web", text: t("detail.content.viewOnModrinth"), icon: "ext" as const, onSelect: () => openPage(`https://modrinth.com/project/${pid}`) }] : []),
      ...(m.source.type === "curseforge" ? [{ id: "web", text: t("detail.content.viewOnCurseForge"), icon: "ext" as const, onSelect: () => openPage(`https://www.curseforge.com/projects/${(m.source as { projectId: number }).projectId}`) }] : []),
      ...(up || own || pid || m.source.type === "curseforge" ? ["-" as const] : []),
      { id: "rm", text: t("common.remove"), icon: "trash", bad: true, onSelect: () => remove([m.id]) },
    ];
  };

  const tipFor = (r: Row, warns: Warn[]): ReactNode => {
    const m = r.mod, up = updateFor.get(m.id), desc = project(m)?.description;
    return (
      <>
        <div className="tn">{title(m)}</div>
        <div className="tv">
          {t(KIND1_KEYS[m.kind])} · {t("common.version")} {m.version}
          {m.enabled ? "" : ` · ${t("detail.content.turnedOffInline")}`}
        </div>
        {r.owners.length > 0 && <div className="tr">{t("detail.content.requiredBy", { names: r.owners.join(", ") })}</div>}
        {up && <div className="tu">{t("detail.content.updateAvailable", { version: up.versionNumber })}</div>}
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
      !m.enabled && t("detail.content.offState"),
      up && t("detail.content.updateAvailable", { version: up.versionNumber }),
      ...warns.map((w) => w.t),
      desc,
    ].filter(Boolean).join(". ");
  };
  const srDesc = (m: Mod, text: string) => text && <span id={descId(m)} className="sr">{text}</span>;

  const subOf = (r: Row) =>
    r.owners.length ? `${t("detail.content.requiredBy", { names: r.owners.join(", ") })} · ${r.mod.version}` : `${t(KIND1_KEYS[r.mod.kind])} · ${r.mod.version}`;

  /** Update je Inhalt: Fortschritt beim Aktualisieren, sonst Knopf mit fester Breite (Version mit Auslassung, voller Text im Tooltip). */
  const updCell = (m: Mod, tile = false) => {
    if (busyFor(m)) return <JobProgress label={t("detail.content.updating")} p={pct} width={tile ? 112 : undefined} className={tile ? undefined : "w-full"} />;
    const up = updateFor.get(m.id);
    if (!up) return null;
    return (
      <Tip label={t("detail.content.updateFromTo", { name: title(m), from: m.version, to: up.versionNumber })}>
        <Button size="s" icon="up" width={96} disabled={!!active} aria-label={t("detail.content.updateTo", { name: title(m), version: up.versionNumber })} onClick={() => runUpdates([m.id])}>
          <span className="truncate">{up.versionNumber}</span>
        </Button>
      </Tip>
    );
  };

  /** An/Aus: Schalter mit sichtbarem „Aus“; Ressourcenpakete haben keinen (das Spiel schaltet sie ein). */
  const onCell = (m: Mod, tile = false) =>
    m.kind === "resourcepack" ? (
      <Tip label={t(RP_HINT_KEY)}>
        <span>{t("detail.content.inGame")}<span className="sr"> {t("detail.content.turnOnSr")}</span></span>
      </Tip>
    ) : (
      // Kachel: „Aus“ nur im ausgeschalteten Zustand (spart dem Namen Platz); Zeile: Platz bleibt reserviert.
      <Switch checked={m.enabled} onChange={(v) => setEnabled([m.id], v)} label={t("detail.content.enabledLabel", { name: title(m) })} stateText={tile && m.enabled ? undefined : ["", t("ui.switch.off")]} />
    );

  const moreBtn = (m: Mod, described = false) => (
    <Menu
      items={menuFor(m)}
      trigger={<IconButton size="s" icon="more" tip={false} data-more={m.id} label={t("detail.content.moreAbout", { name: title(m) })} aria-describedby={described ? descId(m) : undefined} />}
    />
  );

  const ghostRow = (g: Ghost) => (
    <GhostRow
      key={`g-${g.mod.id}`}
      variant={mode === "grid" ? "tile" : "content"}
      text={g.by && mode !== "grid"
        ? t("detail.content.removedGhostWith", { name: g.title, by: g.by })
        : t("detail.content.removedGhost", { name: g.title })}
      media={mode === "grid" ? undefined : <ProjectIcon url={project(g.mod)?.icon_url} seed={g.mod.id} />}
      undoId={g.main ? g.group : undefined}
      onUndo={g.main ? () => undo(g.group) : undefined}
    />
  );

  const listRow = (r: Row) => {
    const m = r.mod, warns = warnsOf(m), on = picked.has(m.id), desc = descOf(r, warns);
    return (
      <ListRow key={m.id} selected={on} off={!m.enabled} dep={r.owners.length > 0}>
        <Checkbox checked={on} onChange={(v) => togglePick(m.id, v)} label={t("detail.content.selectItem", { name: title(m) })} />
        <ProjectIcon url={project(m)?.icon_url} seed={m.id} />
        <Tip label={tipFor(r, warns)}>
          <div><RowTitle title={title(m)} sub={subOf(r)} trunc={false}>{srDesc(m, desc)}</RowTitle></div>
        </Tip>
        {hasWarns && (
          <Cell flex>
            {warns.map((w) => (
              <Fragment key={w.t}>
                <Chip size="s" dot tone="warn" data-hide="1040">{w.t}</Chip>
                <Button variant="ghost" size="s" tone="warn" onClick={w.fix}>{w.lab}</Button>
              </Fragment>
            ))}
          </Cell>
        )}
        <Cell flex align="end">{updCell(m)}</Cell>
        <Cell flex align="end">{onCell(m)}</Cell>
        {moreBtn(m, !!desc)}
      </ListRow>
    );
  };

  /** Kachel, 88 px: Icon (Auswahlfeld darüber) · Name · rechts oben Schalter und Menü · eine Zeile Beschreibung bzw. Hinweis · rechts unten Update. */
  const tile = (r: Row) => {
    const m = r.mod, warns = warnsOf(m), on = picked.has(m.id), desc = descOf(r, warns);
    // Beschreibung steht schon im Screenreader-Text (srDesc); Art/Version nur hier.
    const about = r.owners.length ? "" : project(m)?.description ?? "";
    return (
      <ListRow key={m.id} selected={on} off={!m.enabled}>
        <span>
          <ProjectIcon url={project(m)?.icon_url} seed={m.id} box={52} />
          <Checkbox checked={on} onChange={(v) => togglePick(m.id, v)} label={t("detail.content.selectItem", { name: title(m) })} />
        </span>
        <Tip label={tipFor(r, warns)}>
          <div><RowTitle title={title(m)} trunc={false}>{srDesc(m, desc)}</RowTitle></div>
        </Tip>
        <span>
          {onCell(m, true)}
          {moreBtn(m, !!desc)}
        </span>
        <span>
          {warns.length
            ? warns.map((w) => <Chip key={w.t} size="s" dot tone="warn">{w.t}</Chip>)
            : about ? <span className="truncate" aria-hidden>{about}</span> : <span className="truncate">{subOf(r)}</span>}
        </span>
        <span>{updCell(m, true)}</span>
      </ListRow>
    );
  };

  // Leere Filter gedämpft, aber lesbar (--fg-3, ≥ 4,5:1).
  const kindLabel = (text: string, n: number) => (n ? text : <span className="text-fg-3">{text}</span>);
  const pickedSwitchable = pickedLive.filter(switchable);
  const upShown = nUpd > 0 || updatingAll;

  const bulk = (
    <>
      <span><Count value={pickedLive.length} minDigits={2} /> {t("detail.content.selectedCount", { n: pickedLive.length })}</span>
      <Button size="s" disabled={!pickedSwitchable.length} onClick={() => setEnabled(pickedSwitchable, false)}>{t("detail.content.switchOff")}</Button>
      <Button size="s" disabled={!pickedSwitchable.length} onClick={() => setEnabled(pickedSwitchable, true)}>{t("detail.content.switchOn")}</Button>
      <Button size="s" icon="up" disabled={!!active || !pickedLive.some((id) => updateFor.has(id))} onClick={() => runUpdates(pickedLive.filter((id) => updateFor.has(id)))}>{t("detail.content.updateAction")}</Button>
      <Button size="s" icon="trash" onClick={() => remove(pickedLive)}>{t("common.remove")}</Button>
      <Spacer />
      <Button variant="ghost" size="s" onClick={clearPicked}>{t("detail.content.clearSelection")}</Button>
    </>
  );

  return (
    <div className="relative max-w-[var(--page-max)]" ref={rootRef}>
      {local.overlay}
      <div className="sr" role="status" aria-live="polite" aria-atomic="true">{said}</div>
      <Toolbar height={56} search="s" wrapBelow={800} alt={bulk} altActive={pickedLive.length > 0}>
        <SearchField size="s" value={search} onChange={setSearch} placeholder={t("detail.content.searchPlaceholder")} />
        <Segmented
          size="s"
          label={t("components.sheet.kindLabel")}
          value={kind}
          onChange={setKind}
          items={[
            { value: "all", label: t("common.all"), count: counts.all },
            { value: "mod", label: kindLabel(t("components.catalog.kind.mod"), counts.mod), count: counts.mod },
            { value: "shader", label: kindLabel(t("components.catalog.kind.shader"), counts.shader), count: counts.shader },
            { value: "resourcepack", label: kindLabel(t("components.catalog.kind.resourcepack"), counts.resourcepack), count: counts.resourcepack },
          ]}
        />
        <Spacer />
        <Segmented
          size="s"
          iconsOnly
          className="max-[900px]:hidden"
          label={t("detail.content.viewLabel")}
          value={mode}
          onChange={setMode}
          items={[{ value: "list", label: t("pages.instances.viewList"), icon: "list" }, { value: "grid", label: t("detail.content.viewGrid"), icon: "grid" }]}
        />
        {/* Knopf und „Alles aktuell“ liegen übereinander: die Breite bleibt, ob Updates da sind oder nicht (kein toter Knopf). */}
        <span className="grid items-center justify-items-end *:col-start-1 *:row-start-1">
          <Button
            ref={updRef}
            size="s"
            icon="up"
            count={nUpd}
            compactBelow={1096}
            className={cn(!upShown && "invisible")}
            aria-label={updatingAll ? t("detail.content.updating") : undefined}
            disabled={!!active || !upShown}
            onClick={() => runUpdates([...updateFor.keys()])}
          >
            {t("detail.content.updateAll")}
          </Button>
          {!upShown && <Hint tone="ok" className="max-[1096px]:invisible">{t("detail.content.allUpToDate")}</Hint>}
        </span>
        {/* Sekundär: auf dieser Seite ist nur Spielen Akzent-Primär. */}
        <Button size="s" icon="plus" onClick={onAdd}>{t("common.add")}</Button>
        {local.pick && <Button size="s" icon="ul" compactBelow={1096} disabled={!!active} onClick={local.pick}>{t("detail.content.addFile")}</Button>}
      </Toolbar>

      {visible.length === 0 ? (
        <Empty
          ill="search"
          title={t("components.search.nothingFound")}
          actions={
            <>
              <Button onClick={() => { setSearch(""); setKind("all"); }}>{t("components.search.resetFilters")}</Button>
              <Button onClick={onAdd}>{t("components.sheet.searchPlaceholder")}</Button>
            </>
          }
        >
          {t("detail.content.noMatch", { filter: search.trim() || (kind !== "all" ? t(KINDS_KEYS[kind]) : "") })}
        </Empty>
      ) : mode === "grid" ? (
        <List variant="tiles">{visible.map((e) => (e.type === "row" ? tile(e) : ghostRow(e)))}</List>
      ) : (
        <List
          variant="content"
          noWarnCol={!hasWarns}
          divided
          head={
            <>
              <span>
                <Checkbox
                  label={t("detail.content.selectAll")}
                  checked={pickedVisible > 0 && pickedVisible === visibleLive.length}
                  indeterminate={pickedVisible > 0 && pickedVisible < visibleLive.length}
                  onChange={(v) => setPicked((p) => { const n = new Set(p); visibleLive.forEach((r) => (v ? n.add(r.mod.id) : n.delete(r.mod.id))); return n; })}
                />
              </span>
              <span />
              <Cell>{t("common.name")}</Cell>
              {hasWarns && <Cell>{t("detail.content.warningsColumn")}</Cell>}
              <Cell align="end">{t("common.update")}</Cell>
              <Cell align="end">{t("ui.switch.on")}</Cell>
              <span />
            </>
          }
        >
          {visible.map((e) => (e.type === "row" ? listRow(e) : ghostRow(e)))}
        </List>
      )}

      {instance.mods.some((m) => m.kind === "resourcepack") && <Hint icon="info" className="mt-2">{t(RP_HINT_KEY)}</Hint>}
    </div>
  );
}
