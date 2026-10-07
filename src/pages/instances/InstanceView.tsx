import type { CSSProperties, MouseEvent, ReactNode } from "react";
import { useI18n } from "@/i18n";
import { Cell, Checkbox, Chip, Count, List, ListHeader, ListRow, RowTitle, SceneThumb } from "@/ui";
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

/** Status nur als Ausnahme: installiert gerade, startet, läuft, abgestürzt, frisch importiert oder mit Updates. Der Normalfall bleibt leer. */
function LibStatus({ instance }: { instance: Instance }) {
  const phase = usePhase(instance.id);
  const updateCount = useCurrentUpdates(instance, false).size;
  const freshImport = useIsFreshImport(instance.id);
  if (LOUD_PHASES.includes(phase)) return <StatusChip instance={instance} small />;
  if (freshImport) return <FreshImportChip instanceId={instance.id} />;
  if (updateCount > 0)
    return (
      <Chip icon="up">
        <Count value={updateCount} /> {updatesLabel(updateCount)}
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
      <Checkbox label={t("pages.instances.selectInstance", { name: instance.name })} checked={picked} onChange={() => selection.toggle(instance.id)} />
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
      selected={pick.picked}
      menu={items}
      index={Math.min(index, MAX_STAGGERED_ROWS)}
      style={{ "--acc": look.acc } as CSSProperties}
    >
      <span className="lib-pick">
        <SceneThumb bio={look.bio} seed={look.seed} art={<InstanceIcon instance={instance} bio={look.bio} />} />
        {pick.checkbox}
      </span>
      <RowTitle title={instance.name} sub={t("pages.instances.createdOn", { date: formatDate(instance.createdAt) })} />
      <Cell className="lib-version" title={versionLabel}>{versionLabel}</Cell>
      <Cell hide={WIDTH.md}><Count value={instance.mods.length} /></Cell>
      <Cell hide={WIDTH.md}>{relativeTime(instance.lastPlayedAt)}</Cell>
      <Cell hide={WIDTH.xl}>{instance.playtimeSecs > 0 ? formatPlaytime(instance.playtimeSecs) : "–"}</Cell>
      <Cell className="lib-status" flex><LibStatus instance={instance} /></Cell>
      <PlayButton instance={instance} size="i" />
      <InstanceMenuButton instance={instance} size="s" variant="ghost" showOpen={false} />
    </ListRow>
  );
}

/** Spaltenköpfe der Listenansicht; bei Gruppen steht er einmal über allen. */
export function InstanceListHeader() {
  const { t } = useI18n();
  return (
    <ListHeader variant="instances">
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
  const roving = useRovingItems<HTMLDivElement>({ item: ".vx-row" });
  return <div {...roving}>{children}</div>;
}

/** Instanzen als Zeilen unter dem Kopf `InstanceListHeader`. */
export function InstanceItems({ instances, label }: { instances: Instance[]; label?: string }) {
  const { t } = useI18n();
  return (
    <List variant="instances" divided aria-label={label ?? t("common.instances")}>
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
