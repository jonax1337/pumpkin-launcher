import { useEffect, useId, useMemo, useRef, useState } from "react";
import { Button, Empty, Glyph, Hint, SearchField, Segmented, Spacer, Toolbar } from "@/ui";
import { useAnnouncement } from "@/hooks/useAnnouncement";
import { useProjects } from "@/hooks/useContent";
import { useContentState } from "@/store/contentState";
import { WIDTH } from "@/lib/breakpoints";
import { KIND_LABEL_KEYS } from "@/lib/catalog";
import type { ModUpdate } from "@/lib/content-types";
import { projectOf } from "@/lib/mods";
import { progressShare } from "@/lib/progress";
import { useI18n } from "@/i18n";
import type { Instance, Mod } from "@/lib/types";
import { BulkBar } from "./content/BulkBar";
import { ContentList } from "./content/ContentList";
import { ContentModelProvider, type ContentModel } from "./content/ContentModel";
import { contentMenuEntries } from "./content/contentMenu";
import { RP_HINT_KEY } from "./content/constants";
import { focusSoon, retryPerFrame, revealAndFocus, UPDATE_FOCUS_RETRY_FRAMES } from "./content/focus";
import { insertGhosts } from "./content/ghosts";
import { countByKind, KindFilter } from "./content/KindFilter";
import { orderByDependency } from "./content/orderByDependency";
import { showRemovedToast } from "./content/removedToast";
import { UpdateAllButton } from "./content/UpdateAllButton";
import { useContentActions } from "./content/useContentActions";
import { useContentSelection } from "./content/useContentSelection";
import { useRemovedGhosts } from "./content/useRemovedGhosts";
import type { Entry, KindFilter as KindFilterValue, Row, Warn } from "./content/types";
import { LocalFilesDropzone } from "./LocalFilesDropzone";
import { useLocalFiles } from "./LocalFiles";

type ViewMode = "list" | "grid";

/** Inhalte einer Instanz: Liste oder Raster, Mehrfachauswahl, Hinweise, Entfernen mit Platzhalter. */
export function ContentTab({ instance, shown, updateFor, onAdd, warnsOf, showUpdates = 0 }: {
  instance: Instance; updateFor: Map<string, ModUpdate>; onAdd: () => void; warnsOf: (m: Mod) => Warn[];
  /** Nur der sichtbare Tab nimmt aufs Fenster gezogene Dateien an. */
  shown: boolean;
  /** Zählt hoch, wenn der Kopf „Updates“ angeklickt wurde. */
  showUpdates?: number;
}) {
  const { t } = useI18n();
  const local = useLocalFiles(instance, shown);
  const { active, target, progress } = useContentState();
  const [search, setSearch] = useState("");
  const [kind, setKind] = useState<KindFilterValue>("all");
  const [mode, setMode] = useState<ViewMode>("list");
  const updateAllRef = useRef<HTMLButtonElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const descriptionIdBase = useId();

  const projects = useProjects(instance.mods.flatMap((m) => projectOf(m) ?? []));
  const projectOfMod = (m: Mod) => projects.data?.get(projectOf(m) ?? "");
  const titleOf = (m: Mod) => projectOfMod(m)?.title ?? m.name;

  const { ghosts, remove: removeMods, undo: undoRemoval } = useRemovedGhosts(instance);
  const rows: Row[] = orderByDependency(instance.mods).map(({ mod, owners }) => ({ type: "row", mod, owners: owners.map(titleOf) }));
  const entries = insertGhosts(rows, ghosts);
  const needle = search.trim().toLowerCase();
  const matches = (e: Entry) =>
    (kind === "all" || e.mod.kind === kind) && (!needle || (e.type === "row" ? titleOf(e.mod) : e.title).toLowerCase().includes(needle));
  const visible = entries.filter(matches);
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
  const { setEnabled, runUpdates, isSwitchable } = useContentActions(instance, titleOf);

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
        rootRef.current?.querySelector<HTMLElement>(".vx-lhead input[type=checkbox]") ??
        rootRef.current?.querySelector<HTMLElement>(".vx-tb-main input[type=search]"),
    );

  function remove(ids: string[]) {
    const position = new Map(entries.map((e, i) => [e.mod.id, i]));
    const result = removeMods(ids, { titleOf, indexOf: (m) => position.get(m.id) ?? entries.length });
    if (!result) return;
    selection.dropRemoved(result.removed);
    // Fokus nicht auf body fallen lassen: einzeln → „Rückgängig“ im Platzhalter, mehrere (Leiste schließt) → Kopf.
    if (ids.length === 1) focusSoon(() => rootRef.current?.querySelector<HTMLElement>(`[data-undo="${result.group}"]`));
    else focusHead();
    showRemovedToast({ removed: result.removed, requestedIds: ids, titleOf, onUndo: () => undo(result.group) });
  }

  function undo(group: string) {
    const restored = undoRemoval(group);
    if (!restored) return;
    say(t("detail.content.restoredAnnouncement", { name: restored.title }));
    // Der Platzhalter verschwindet: Fokus auf das Menü der wiederhergestellten Zeile statt auf body.
    if (rootRef.current?.contains(document.activeElement)) {
      focusSoon(() => rootRef.current?.querySelector<HTMLElement>(`[data-more="${CSS.escape(restored.mod.id)}"]`));
    }
  }

  const updatingAll = !!active && target === "updates";
  const model: ContentModel = {
    mode,
    titleOf,
    iconOf: (m) => projectOfMod(m)?.icon_url,
    descriptionOf: (m) => projectOfMod(m)?.description,
    warnsOf,
    // Spalte „Hinweise“ nur, wenn überhaupt ein Inhalt einen hat (unabhängig vom Filter, damit sie beim Filtern nicht springt).
    hasWarnings: instance.mods.some((m) => warnsOf(m).length > 0),
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
    remove,
    menuFor: (m) =>
      contentMenuEntries(m, {
        update: updateFor.get(m.id),
        locked: !!active,
        onUpdate: () => runUpdates([m.id]),
        onIdentify: () => local.identify(m),
        onRemove: () => remove([m.id]),
      }),
    undo,
    descriptionId: (m) => `${descriptionIdBase}-d-${m.id}`,
  };

  if (instance.mods.length === 0 && ghosts.length === 0) return <EmptyContent instance={instance} local={local} onAdd={onAdd} />;

  return (
    <ContentModelProvider value={model}>
      <div className="relative max-w-[var(--page-max)]" ref={rootRef}>
        <LocalFilesDropzone {...local.dropzone} />
        <div className="sr" role="status" aria-live="polite" aria-atomic="true">{said}</div>
        <Toolbar height={56} search="s" wrapBelow={WIDTH.xs} alt={<BulkBar />} altActive={selection.pickedLive.length > 0}>
          <SearchField size="s" value={search} onChange={setSearch} placeholder={t("detail.content.searchPlaceholder")} />
          <KindFilter value={kind} onChange={setKind} counts={counts} />
          <Spacer />
          <Segmented
            size="s"
            iconsOnly
            className="max-[900px]:hidden"
            label={t("detail.content.viewLabel")}
            value={mode}
            onChange={setMode}
            items={[
              { value: "list", label: t("pages.instances.viewList"), icon: "list" },
              { value: "grid", label: t("detail.content.viewGrid"), icon: "grid" },
            ]}
          />
          <UpdateAllButton buttonRef={updateAllRef} />
          {/* Sekundär: auf dieser Seite ist nur Spielen Akzent-Primär. */}
          <Button size="s" icon="plus" onClick={onAdd}>{t("common.add")}</Button>
          {local.pick && (
            <Button size="s" icon="ul" compactBelow={WIDTH.lg} disabled={!!active} onClick={local.pick}>
              {t("detail.content.addFile")}
            </Button>
          )}
        </Toolbar>

        {visible.length === 0 ? (
          <Empty
            title={t("components.search.nothingFound")}
            actions={
              <>
                <Button onClick={() => { setSearch(""); setKind("all"); }}>{t("components.search.resetFilters")}</Button>
                <Button onClick={onAdd}>{t("components.sheet.searchPlaceholder")}</Button>
              </>
            }
          >
            {t("detail.content.noMatch", { filter: search.trim() || (kind !== "all" ? t(KIND_LABEL_KEYS[kind]) : "") })}
          </Empty>
        ) : (
          <ContentList entries={visible} />
        )}

        {instance.mods.some((m) => m.kind === "resourcepack") && <Hint icon="info" className="mt-2">{t(RP_HINT_KEY)}</Hint>}
      </div>
    </ContentModelProvider>
  );
}

/** Noch nichts in der Instanz: „Hinzufügen“ und, in der App, eigene Dateien. */
function EmptyContent({ instance, local, onAdd }: { instance: Instance; local: ReturnType<typeof useLocalFiles>; onAdd: () => void }) {
  const { t } = useI18n();
  const busy = useContentState((s) => !!s.active);
  return (
    <div className="relative">
      <LocalFilesDropzone {...local.dropzone} />
      <Empty
        ill={<Glyph name="cube" pal="steel" box={64} />}
        title={t("detail.content.emptyTitle")}
        actions={
          <>
            <Button icon="plus" onClick={onAdd}>{t("common.add")}</Button>
            {local.pick && <Button icon="ul" disabled={busy} onClick={local.pick}>{t("detail.content.addFile")}</Button>}
          </>
        }
      >
        {instance.loader === "vanilla" ? t("detail.content.emptyVanilla") : t("detail.content.emptyHint")}
      </Empty>
    </div>
  );
}
