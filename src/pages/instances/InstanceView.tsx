import type { MouseEvent, ReactNode } from "react";
import { useI18n } from "@/i18n";
import { Cell, Checkbox, Chip, Count, List, ListHeader, ListRow, RowTitle, SceneThumb, type ListLayout } from "@/ui";
import { cn } from "@/lib/utils";
import { loaderLine } from "@/components/common";
import { FreshImportChip, useIsFreshImport } from "@/components/FreshImportChip";
import { InstanceIcon } from "@/components/InstanceIcon";
import { InstanceMenuButton, useInstanceMenu } from "@/components/instance";
import { PlayButton } from "@/components/play/PlayButton";
import { LOUD_PHASES, usePhase } from "@/components/play/phase";
import { StatusChip } from "@/components/play/StatusChip";
import { useCurrentUpdates } from "@/hooks/useContent";
import { useRovingItems } from "@/hooks/useRovingItems";
import { WIDTH } from "@/lib/breakpoints";
import { formatDate, formatPlaytime, relativeTime, updatesLabel } from "@/lib/format";
import { instanceUrl } from "@/lib/routes";
import type { Instance } from "@/lib/types";
import { useLook } from "@/store/look";
import { useLibrarySelection } from "./librarySelection";


/** Die Liste staffelt ihr Einblenden nur für so viele Zeilen. */
const MAX_STAGGERED_ROWS = 12;

/** Spalten der Bibliothek (Kopf und Zeilen): Bild, Name, Version, Inhalte, Zuletzt gespielt, Spielzeit, Status, Spielen, Menü; unter 1180 px entfällt die Spielzeit, unter 1040 px Inhalte und Zuletzt gespielt.
 *  Links vom Bild reserviert der Zeilen-Innenabstand den Streifen für das Auswahlfeld (`--lib-pick-w`, an der Seite in Instances.tsx gesetzt). */
const LIB_LIST: ListLayout = {
  cols: {
    base: "44px minmax(0,1fr) 150px 84px 150px 96px 150px 40px 40px",
    1180: "44px minmax(0,1fr) 130px 70px 130px 130px 36px 36px",
    1040: "44px minmax(0,1fr) 120px 140px 36px 36px",
  },
  gap: { base: 12, 1180: 10 },
  pad: "0 8px 0 calc(8px + var(--lib-pick-w))",
};

/**
 * Auswahlfeld im Streifen links vom Bild (Breite `--lib-pick-w`, an der Seite gesetzt): sichtbar bei Hover/Fokus, gewählt oder im
 * Auswahlmodus (`data-picking` an der Seite, Gruppe `lib`). Der Streifen ist immer reserviert, der Auswahlmodus ändert kein Maß.
 */
const PICK_CHECK = "absolute top-1/2 -left-(--lib-pick-w) w-(--lib-pick-w) -translate-y-1/2 justify-center opacity-0 [transition:opacity_var(--st)] group-hover/row:opacity-100 group-focus-within/row:opacity-100 group-data-[selected]/row:opacity-100 group-data-[picking]/lib:opacity-100";

/**
 * Wenig Inhaltsbreite (Container „library“, bis 640 px; auch bei Zoom): ohne Kopf, Name über Version, Spielen und Menü, der Status
 * darunter; Auswahl und Bild links über zwei Zeilen. Die Zeile legt Raster, Abstand, Innenabstand und Höhe über die der Liste.
 */
const NARROW = {
  head: "@max-[640px]/library:hidden",
  row: "@max-[640px]/library:grid-cols-[44px_minmax(0,1fr)_32px_32px] @max-[640px]/library:gap-x-2 @max-[640px]/library:gap-y-1.5 @max-[640px]/library:p-[8px_8px_8px_calc(8px_+_var(--lib-pick-w))] @max-[640px]/library:min-h-22",
  pick: "@max-[640px]/library:col-1 @max-[640px]/library:row-[1/3]",
  title: "@max-[640px]/library:col-[2/5] @max-[640px]/library:row-1",
  version: "@max-[640px]/library:col-2 @max-[640px]/library:row-2",
  hide: "@max-[640px]/library:hidden",
  status: "@max-[640px]/library:col-[2/5] @max-[640px]/library:row-3 @max-[640px]/library:empty:hidden",
  play: "@max-[640px]/library:col-3 @max-[640px]/library:row-2",
  menu: "@max-[640px]/library:col-4 @max-[640px]/library:row-2",
} as const;

/** Status nur als Ausnahme: installiert gerade, startet, läuft, abgestürzt, frisch importiert oder mit Updates. Der Normalfall bleibt leer. */
function LibStatus({ instance }: { instance: Instance }) {
  const phase = usePhase(instance.id);
  const updateCount = useCurrentUpdates(instance, false).size;
  const freshImport = useIsFreshImport(instance.id);
  if (LOUD_PHASES.includes(phase)) return <StatusChip instance={instance} small />;
  if (freshImport) return <FreshImportChip instanceId={instance.id} />;
  if (updateCount > 0)
    return (
      <Chip tone="warn" icon="update">
        {updatesLabel(updateCount)}
        <Count value={updateCount} />
      </Chip>
    );
  return null;
}

/** Klick-Verhalten, Auswahlfeld und Zustand einer Listenzeile für die Mehrfachauswahl. */
function useInstancePick(instance: Instance) {
  const { t } = useI18n();
  const selection = useLibrarySelection();
  const picked = selection.isPicked(instance.id);
  return {
    picked,
    hit: {
      to: instanceUrl(instance.id),
      label: t(selection.picking ? "pages.instances.selectInstance" : "pages.instances.openInstance", { name: instance.name }),
      onClick: (event: MouseEvent) => selection.handleClick(instance.id, event),
    },
    checkbox: (
      <Checkbox className={PICK_CHECK} label={t("pages.instances.selectInstance", { name: instance.name })} checked={picked} onChange={() => selection.toggle(instance.id)} />
    ),
  };
}


/** Listenzeile, 56 px, feste Spalten. Die ganze Zeile öffnet die Instanz; Spielen und Menü liegen darüber. */
function InstanceRow({ instance, index }: { instance: Instance; index: number }) {
  const { t } = useI18n();
  const look = useLook(instance.id);
  const items = useInstanceMenu(instance);
  const pick = useInstancePick(instance);
  const versionLabel = loaderLine(instance);
  return (
    <ListRow
      hit={pick.hit}
      selected={pick.picked ? "bar" : false}
      menu={items}
      index={Math.min(index, MAX_STAGGERED_ROWS)}
      className={NARROW.row}
    >
      <span className={cn("relative block size-11", NARROW.pick)}>
        <SceneThumb bio={look.bio} seed={look.seed} art={<InstanceIcon instance={instance} bio={look.bio} />} />
        {pick.checkbox}
      </span>
      <RowTitle className={cn("pr-3", NARROW.title)} title={instance.name} sub={t("pages.instances.createdOn", { date: formatDate(instance.createdAt) })} />
      <Cell className={NARROW.version} title={versionLabel}>{versionLabel}</Cell>
      <Cell className={NARROW.hide} hide={WIDTH.md}><Count value={instance.mods.length} /></Cell>
      <Cell className={NARROW.hide} hide={WIDTH.md}>{relativeTime(instance.lastPlayedAt)}</Cell>
      <Cell className={NARROW.hide} hide={WIDTH.xl}>{instance.playtimeSecs > 0 ? formatPlaytime(instance.playtimeSecs) : "–"}</Cell>
      <Cell className={NARROW.status} flex><LibStatus instance={instance} /></Cell>
      <PlayButton instance={instance} size="i" neutral className={NARROW.play} />
      <InstanceMenuButton instance={instance} size="s" variant="ghost" showOpen={false} className={NARROW.menu} />
    </ListRow>
  );
}

/** Spaltenköpfe der Listenansicht; bei Gruppen steht er einmal über allen. */
export function InstanceListHeader() {
  const { t } = useI18n();
  return (
    <ListHeader bar {...LIB_LIST} className={NARROW.head}>
      <span />
      <Cell>{t("common.name")}</Cell>
      <Cell>{t("common.version")}</Cell>
      <Cell hide={WIDTH.md}>{t("pages.instances.colContents")}</Cell>
      <Cell hide={WIDTH.md}>{t("pages.instances.colLastPlayed")}</Cell>
      <Cell hide={WIDTH.xl}>{t("pages.instances.colPlaytime")}</Cell>
      <Cell>{t("common.status")}</Cell>
      <span />
      <span />
    </ListHeader>
  );
}

/** Ein Tab-Stopp für die ganze Bibliothek, auch über Gruppen hinweg; Pfeiltasten wandern zwischen Zeilen. */
export function LibraryRoving({ children }: { children: ReactNode }) {
  const roving = useRovingItems<HTMLDivElement>({ item: "[data-kit-item=row]" });
  return <div {...roving}>{children}</div>;
}

/** Instanzen als Zeilen unter dem Kopf `InstanceListHeader`. */
export function InstanceItems({ instances, label }: { instances: Instance[]; label?: string }) {
  const { t } = useI18n();
  return (
    <List {...LIB_LIST} divided aria-label={label ?? t("common.instances")}>
      {instances.map((instance, index) => <InstanceRow key={instance.id} instance={instance} index={index} />)}
    </List>
  );
}

/** Instanzenliste mit Spaltenkopf. */
export function InstanceView({ instances }: { instances: Instance[] }) {
  return (
    <>
      <InstanceListHeader />
      <InstanceItems instances={instances} />
    </>
  );
}
