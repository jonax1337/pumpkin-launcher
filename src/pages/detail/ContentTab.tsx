import { useDeferredValue, useEffect, useId, useMemo, useRef, useState } from "react";
import { Actions, Button, Glyph, Hint, SearchField, SectionHeader, Segmented, Select, Spacer, Toolbar } from "@/ui";
import { EmptyState } from "@/components/EmptyState";
import { useAnnouncement } from "@/hooks/useAnnouncement";
import { useProjects } from "@/hooks/useContent";
import { useStableFn } from "@/hooks/useStableFn";
import { useContentState } from "@/store/contentState";
import { api } from "@/lib/api";
import { KIND_LABEL_KEYS } from "@/lib/catalog";
import { IRIS_PROJECT_ID } from "@/components/catalog/iris";
import { CONTENT_SORTS, type ContentSort } from "@/lib/contentSort";
import type { ModUpdate } from "@/lib/content-types";
import { revealLocalPath } from "@/lib/links";
import { projectOf } from "@/lib/mods";
import { progressShare } from "@/lib/progress";
import { toastError } from "@/lib/toast";
import { useI18n } from "@/i18n";
import type { ContentAnalysis, Instance, Mod } from "@/lib/types";
import { BulkBar } from "./content/BulkBar";
import { ContentList } from "./content/ContentList";
import { ContentModelProvider, type ContentModel } from "./content/ContentModel";
import { contentMenuEntries } from "./content/contentMenu";
import { RP_HINT_KEY } from "./content/constants";
import { focusSoon, retryPerFrame, revealAndFocus, UPDATE_FOCUS_RETRY_FRAMES } from "./content/focus";
import { countByKind, KindFilter } from "./content/KindFilter";
import { ResourcePackPanel, ShaderPanel } from "./content/PackPanel";
import { ProfileBar } from "./content/ProfileBar";
import { showRemovedToast } from "./content/removedToast";
import { UndoBar } from "./content/UndoBar";
import { UpdateAllButton } from "./content/UpdateAllButton";
import { UpdateConfirmDialog } from "./content/UpdateConfirmDialog";
import { useContentActions } from "./content/useContentActions";
import { useContentEntries } from "./content/useContentEntries";
import { useContentSelection } from "./content/useContentSelection";
import { usePackControls } from "./content/usePackControls";
import { useRemovedGhosts } from "./content/useRemovedGhosts";
import { useUpdateRollback } from "./content/useUpdateRollback";
import { VersionDialog } from "./content/VersionDialog";
import type { Finding } from "./content/useWarnings";
import { warnAction } from "./content/warnAction";
import type { KindFilter as KindFilterValue, Row, Warn } from "./content/types";
import { useInstanceBusyReason } from "./guards";
import { LocalFilesDropzone } from "./LocalFilesDropzone";
import { useLocalFiles } from "./LocalFiles";

type ViewMode = "list" | "grid";

/** Pfad der Datei im Spielordner: der Ordner der Art, darin der Dateiname. */
const FOLDER_OF = { mod: "mods", resourcepack: "resourcepacks", shader: "shaderpacks" } as const;

/** Die Datei eines Inhalts im Dateimanager zeigen; ist er ausgeschaltet, liegt sie nicht dort, dann der Ordner. */
async function revealContent(instanceId: string, mod: Mod) {
  const game = await api.instanceDir(instanceId);
  const separator = game.includes("\\") ? "\\" : "/";
  const folder = [game, FOLDER_OF[mod.kind]].join(separator);
  revealLocalPath(mod.enabled ? [folder, mod.fileName].join(separator) : folder);
}

/** Inhalte einer Instanz: Liste oder Raster, Sortierung, Mehrfachauswahl, Hinweise, Updates mit Rückfrage, Entfernen mit Platzhalter. */
export function ContentTab({ instance, shown, updateFor, analysis, findingsOf, onAdd, showUpdates = 0 }: {
  instance: Instance; updateFor: Map<string, ModUpdate>; onAdd: () => void;
  /** Dateiangaben und Hinweise aus den Mod-Dateien; fehlt, solange sie gelesen werden. */
  analysis: ContentAnalysis | undefined;
  findingsOf: (m: Mod) => Finding[];
  /** Nur der sichtbare Tab nimmt aufs Fenster gezogene Dateien an. */
  shown: boolean;
  /** Zählt hoch, wenn der Kopf „Updates“ angeklickt wurde. */
  showUpdates?: number;
}) {
  const { t } = useI18n();
  const local = useLocalFiles(instance, shown);
  const { active, target, progress } = useContentState();
  const busy = useInstanceBusyReason(instance.id);
  const [search, setSearch] = useState("");
  const [kind, setKind] = useState<KindFilterValue>("all");
  const [mode, setMode] = useState<ViewMode>("list");
  const [sort, setSort] = useState<ContentSort>("default");
  const [confirming, setConfirming] = useState<string[] | null>(null);
  const [pickingVersion, setPickingVersion] = useState<Mod | null>(null);
  const updateAllRef = useRef<HTMLButtonElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const descriptionIdBase = useId();

  const projects = useProjects(instance.mods.flatMap((m) => projectOf(m) ?? []));
  const projectOfMod = (m: Mod) => projects.data?.get(projectOf(m) ?? "");
  const titleOf = (m: Mod) => projectOfMod(m)?.title ?? m.name;
  const iconOf = (m: Mod) => projectOfMod(m)?.icon_url;

  const { ghosts, remove: removeMods, undo: undoRemoval } = useRemovedGhosts(instance);
  const rollback = useUpdateRollback(instance);
  const actions = useContentActions(instance, titleOf, rollback.record);
  const { switchVersion, isSwitchable } = actions;
  // Zeilen rendern nur bei geänderten Daten neu (siehe entrySignature): was sie aufrufen, muss immer den aktuellen Stand sehen.
  const setEnabled = useStableFn(actions.setEnabled);
  const setPinned = useStableFn(actions.setPinned);
  const runUpdates = useStableFn(actions.runUpdates);
  const identify = useStableFn(local.identify);
  const packs = usePackControls(instance, busy);

  const iris = instance.mods.find((m) => projectOf(m) === IRIS_PROJECT_ID);
  const warnsOf = (mod: Mod): Warn[] =>
    findingsOf(mod).map((finding) => ({
      text: finding.text,
      detail: finding.detail,
      ...warnAction(finding, mod, {
        addContent: onAdd,
        turnOnIris: () => iris && setEnabled([iris.id], true),
        switchOff: () => setEnabled([mod.id], false),
        pickVersion: () => setPickingVersion(mod),
      }),
    }));

  const facts = useMemo(() => new Map(analysis?.files.map((f) => [f.modId, f])), [analysis]);
  const statusRank = (m: Mod) => (findingsOf(m).length ? 0 : updateFor.has(m.id) ? 1 : m.enabled ? 2 : 3);
  // Tippen soll nicht jede Zeile bei jedem Zeichen neu bauen: der Filter folgt, sobald Zeit ist.
  const needle = useDeferredValue(search.trim().toLowerCase());
  const { entries, visible } = useContentEntries({
    mods: instance.mods, ghosts, titleOf, titles: projects.data, facts, statusRank, sort, kind, needle,
  });
  const visibleLive = visible.filter((e): e is Row => e.type === "row");
  const counts = useMemo(() => countByKind(instance.mods), [instance.mods]);

  // Eigene Statusregion (nur für Screenreader): Auswahl, Treffer, Wiederherstellen. Die Leisten selbst sind nicht live.
  // Die Trefferzahl nach dem Filtern kommt beim Tippen erst nach einer kurzen Pause.
  const total = instance.mods.length;
  const [said, say] = useAnnouncement(
    `${kind}|${needle}`,
    t(total === 1 ? "detail.content.visibleCount.one" : "detail.content.visibleCount.other", { visible: visibleLive.length, total }),
  );
  const selection = useContentSelection(new Set(instance.mods.map((m) => m.id)), say);

  // Vom Kopf „Updates“: Filter lösen und „Alle aktualisieren“ in den Blick holen und fokussieren.
  useEffect(() => {
    if (!showUpdates) return;
    setSearch("");
    setKind("all");
    selection.clear();
    return retryPerFrame(() => revealAndFocus(updateAllRef.current), UPDATE_FOCUS_RETRY_FRAMES);
  }, [showUpdates]);

  // Nach Bulk-Aktionen, die die Leiste schließen: Kopf-Checkbox (Liste) oder Suchfeld (Raster).
  const focusHead = () =>
    focusSoon(
      () =>
        rootRef.current?.querySelector<HTMLElement>("[data-kit-item=head] input[type=checkbox]") ??
        rootRef.current?.querySelector<HTMLElement>("input[type=search]"),
    );

  const remove = useStableFn((ids: string[]) => {
    const position = new Map(entries.map((e, i) => [e.mod.id, i]));
    const result = removeMods(ids, { titleOf, indexOf: (m) => position.get(m.id) ?? entries.length });
    if (!result) return;
    selection.dropRemoved(result.removed);
    // Fokus nicht auf body fallen lassen: einzeln → „Rückgängig“ im Platzhalter, mehrere (Leiste schließt) → Kopf.
    if (ids.length === 1) focusSoon(() => rootRef.current?.querySelector<HTMLElement>(`[data-undo="${result.group}"]`));
    else focusHead();
    showRemovedToast({ removed: result.removed, requestedIds: ids, titleOf, onUndo: () => undo(result.group) });
  });

  const undo = useStableFn((group: string) => {
    const restored = undoRemoval(group);
    if (!restored) return;
    say(t("detail.content.restoredAnnouncement", { name: restored.title }));
    // Der Platzhalter verschwindet: Fokus auf das Menü der wiederhergestellten Zeile statt auf body.
    if (rootRef.current?.contains(document.activeElement)) {
      focusSoon(() => rootRef.current?.querySelector<HTMLElement>(`[data-more="${CSS.escape(restored.mod.id)}"]`));
    }
  });

  /** Ein einzelnes Update startet gleich, mehrere erst nach der Rückfrage mit alt und neu. */
  function askUpdates(ids: string[]) {
    if (ids.length > 1) setConfirming(ids);
    else runUpdates(ids);
  }

  const togglePin = useStableFn((mod: Mod) => {
    setPinned([mod.id], !mod.pinned);
    say(t(mod.pinned ? "detail.content.unpinnedAnnouncement" : "detail.content.pinnedAnnouncement", { name: titleOf(mod) }));
  });

  const updatingAll = !!active && target === "updates";
  const model: ContentModel = {
    mode,
    grouped: sort === "default",
    sort,
    factsOf: (m) => facts.get(m.id),
    packs: packs.controls,
    titleOf,
    iconOf,
    descriptionOf: (m) => projectOfMod(m)?.description,
    warnsOf,
    // Spalte „Hinweise“ nur, wenn überhaupt ein Inhalt einen hat (unabhängig vom Filter, damit sie beim Filtern nicht springt).
    hasWarnings: instance.mods.some((m) => findingsOf(m).length > 0),
    updateFor,
    locked: !!active,
    isUpdating: (m) => !!active && (target === m.id || (target === "updates" && updateFor.has(m.id))),
    updatingAll,
    updateShare: progressShare(progress),
    picked: selection.picked,
    pickedLive: selection.pickedLive,
    togglePick: selection.toggle,
    pickMany: selection.setMany,
    clearPicked: () => {
      selection.clear();
      focusHead();
    },
    isSwitchable,
    setEnabled,
    runUpdates,
    askUpdates,
    remove,
    menuFor: (m) =>
      contentMenuEntries(m, {
        update: updateFor.get(m.id),
        locked: !!active,
        onUpdate: () => runUpdates([m.id]),
        onPickVersion: () => setPickingVersion(m),
        onTogglePin: () => togglePin(m),
        onReveal: api.capabilities.revealPath ? () => void revealContent(instance.id, m).catch(toastError) : undefined,
        onIdentify: () => identify(m),
        onRemove: () => remove([m.id]),
      }),
    undo,
    descriptionId: (m) => `${descriptionIdBase}-d-${m.id}`,
  };

  if (instance.mods.length === 0 && ghosts.length === 0) return <EmptyContent instance={instance} local={local} onAdd={onAdd} />;

  const confirmItems = (confirming ?? []).flatMap((id) => {
    const mod = instance.mods.find((m) => m.id === id);
    const update = updateFor.get(id);
    return mod && update ? [{ mod, update }] : [];
  });
  const sortOptions = CONTENT_SORTS.map((value) => ({ value, label: t(`detail.content.sort.${value}`) }));

  return (
    <ContentModelProvider value={model}>
      <div className="dc-root" ref={rootRef}>
        <LocalFilesDropzone {...local.dropzone} />
        <div className="sr" role="status" aria-live="polite" aria-atomic="true">{said}</div>
        <SectionHeader
          title={t("pages.detail.tabContent")}
          actions={
            <Actions>
              <UpdateAllButton buttonRef={updateAllRef} />
              {/* Sekundär: auf dieser Seite ist nur Spielen Akzent-Primär. */}
              <Button size="s" icon="plus" onClick={onAdd}>{t("common.add")}</Button>
              {local.pick && (
                <Button size="s" icon="upload" disabled={!!active} onClick={local.pick}>
                  {t("detail.content.addFile")}
                </Button>
              )}
            </Actions>
          }
        />
        <Toolbar height={32} search="m" alt={<BulkBar />} altActive={selection.pickedLive.length > 0}>
          <SearchField size="s" value={search} onChange={setSearch} placeholder={t("detail.content.searchPlaceholder")} label={t("detail.content.searchLabel")} />
          <KindFilter value={kind} onChange={setKind} counts={counts} />
          <Select
            size="s"
            labelClassName="le-1280:hidden"
            label={t("detail.content.sortLabel")}
            value={sort}
            onChange={(next) => setSort(next as ContentSort)}
            options={sortOptions}
          />
          <ProfileBar instance={instance} busy={busy} />
          <Spacer />
          <Segmented
            size="s"
            iconsOnly
            label={t("detail.content.viewLabel")}
            value={mode}
            onChange={setMode}
            items={[
              { value: "list", label: t("pages.instances.viewList"), icon: "list" },
              { value: "grid", label: t("detail.content.viewGrid"), icon: "grid" },
            ]}
          />
        </Toolbar>

        {rollback.applied && <UndoBar change={rollback.applied} locked={!!active} onUndo={rollback.undo} onDismiss={rollback.dismiss} />}
        {kind === "resourcepack" && packs.controls.available && <ResourcePackPanel packs={packs} say={say} />}
        {kind === "shader" && <ShaderPanel packs={packs} shaders={instance.mods.filter((m) => m.kind === "shader")} hasIris={!!iris?.enabled} loader={instance.loader} />}

        {visible.length === 0 ? (
          <EmptyState
            title={t("components.search.nothingFound")}
            actions={
              <>
                <Button onClick={() => { setSearch(""); setKind("all"); }}>{t("components.search.resetFilters")}</Button>
                <Button onClick={onAdd}>{t("components.sheet.searchPlaceholder")}</Button>
              </>
            }
          >
            {t("detail.content.noMatch", { filter: search.trim() || (kind !== "all" ? t(KIND_LABEL_KEYS[kind]) : "") })}
          </EmptyState>
        ) : (
          <ContentList entries={visible} />
        )}

        {packs.failed && instance.mods.some((m) => m.kind === "resourcepack") && <Hint icon="info">{t(RP_HINT_KEY)}</Hint>}
      </div>

      {confirming && (
        <UpdateConfirmDialog
          instance={instance}
          items={confirmItems}
          titleOf={titleOf}
          iconOf={iconOf}
          onClose={() => setConfirming(null)}
          onConfirm={() => {
            runUpdates(confirmItems.map(({ mod }) => mod.id));
            setConfirming(null);
          }}
        />
      )}
      {pickingVersion && (
        <VersionDialog
          instance={instance}
          mod={pickingVersion}
          title={titleOf(pickingVersion)}
          locked={!!active}
          onClose={() => setPickingVersion(null)}
          onPick={(version) => {
            switchVersion(pickingVersion, version);
            setPickingVersion(null);
          }}
        />
      )}
    </ContentModelProvider>
  );
}

/** Noch nichts in der Instanz: „Hinzufügen“ und, in der App, eigene Dateien. */
function EmptyContent({ instance, local, onAdd }: { instance: Instance; local: ReturnType<typeof useLocalFiles>; onAdd: () => void }) {
  const { t } = useI18n();
  const busy = useContentState((s) => !!s.active);
  return (
    <div className="dc-root">
      <LocalFilesDropzone {...local.dropzone} />
      <EmptyState
        ill={<Glyph name="cube" pal="steel" box={64} />}
        title={t("detail.content.emptyTitle")}
        actions={
          <>
            <Button icon="plus" onClick={onAdd}>{t("common.add")}</Button>
            {local.pick && <Button icon="upload" disabled={busy} onClick={local.pick}>{t("detail.content.addFile")}</Button>}
          </>
        }
      >
        {instance.loader === "vanilla" ? t("detail.content.emptyVanilla") : t("detail.content.emptyHint")}
      </EmptyState>
    </div>
  );
}
