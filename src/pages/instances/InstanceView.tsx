import type { CSSProperties } from "react";
import { useI18n } from "@/i18n";
import { Cell, CardGrid, Chip, Count, List, ListRow, RowTitle, SceneCard, SceneThumb } from "@/ui";
import { loaderLine, playtimeLine } from "@/components/common";
import { InstanceMenuButton, useInstanceMenu } from "@/components/instance";
import { PlayButton } from "@/components/play/PlayButton";
import { LOUD_PHASES, usePhase } from "@/components/play/phase";
import { StatusChip } from "@/components/play/StatusChip";
import { useCurrentUpdates } from "@/hooks/useContent";
import { WIDTH } from "@/lib/breakpoints";
import { formatDate, formatPlaytime, relativeTime, updatesLabel } from "@/lib/format";
import { instanceUrl } from "@/lib/routes";
import type { Instance } from "@/lib/types";
import { useLook } from "@/store/look";

export type LibraryMode = "poster" | "list";

/** Die Liste staffelt ihr Einblenden nur für so viele Zeilen. */
const MAX_STAGGERED_ROWS = 12;

/** Status nur als Ausnahme: installiert gerade, startet, läuft, abgestürzt oder mit Updates. Der Normalfall bleibt leer. */
function LibStatus({ instance }: { instance: Instance }) {
  const phase = usePhase(instance.id);
  const updateCount = useCurrentUpdates(instance, false).size;
  if (LOUD_PHASES.includes(phase)) return <StatusChip instance={instance} small />;
  if (updateCount > 0)
    return (
      <Chip icon="up">
        <Count value={updateCount} /> {updatesLabel(updateCount)}
      </Chip>
    );
  return null;
}

/**
 * Poster 4:5: Szene, Ausnahme-Status oben links, beim Überfahren oder Fokus großer Spielen-Knopf mittig und Menü oben rechts, Name unten.
 * Rechtsklick öffnet das Menü. Unter dem Namen ist nur Platz für eine Angabe neben der Version: Spielzeit, sonst „zuletzt gespielt“.
 */
function PosterCard({ instance, index }: { instance: Instance; index: number }) {
  const { t } = useI18n();
  const look = useLook(instance.id);
  const items = useInstanceMenu(instance);
  return (
    <SceneCard
      variant="poster"
      look={look}
      title={instance.name}
      sub={`${loaderLine(instance)} · ${playtimeLine(instance) || relativeTime(instance.lastPlayedAt)}`}
      status={<LibStatus instance={instance} />}
      primary={<PlayButton instance={instance} size="m" />}
      // Die ganze Karte öffnet die Instanz: „Öffnen“ im Menü wäre doppelt.
      actions={<InstanceMenuButton instance={instance} size="s" variant="ghost" onScene showOpen={false} />}
      hit={{ to: instanceUrl(instance.id), label: t("pages.instances.openInstance", { name: instance.name }) }}
      menu={items}
      index={index}
    />
  );
}

/** Listenzeile, 56 px, feste Spalten. Die ganze Zeile öffnet die Instanz; Spielen und Menü liegen darüber. */
function InstanceRow({ instance, index }: { instance: Instance; index: number }) {
  const { t } = useI18n();
  const look = useLook(instance.id);
  const items = useInstanceMenu(instance);
  return (
    <ListRow
      hit={{ to: instanceUrl(instance.id), label: t("pages.instances.openInstance", { name: instance.name }) }}
      menu={items}
      index={Math.min(index, MAX_STAGGERED_ROWS)}
      style={{ "--acc": look.acc } as CSSProperties}
    >
      <SceneThumb bio={look.bio} seed={look.seed} />
      <RowTitle title={instance.name} sub={t("pages.instances.createdOn", { date: formatDate(instance.createdAt) })} />
      <Cell title={loaderLine(instance)}>{loaderLine(instance)}</Cell>
      <Cell hide={WIDTH.md}><Count value={instance.mods.length} /></Cell>
      <Cell hide={WIDTH.md}>{relativeTime(instance.lastPlayedAt)}</Cell>
      <Cell hide={WIDTH.xl}>{instance.playtimeSecs > 0 ? formatPlaytime(instance.playtimeSecs) : "–"}</Cell>
      <Cell flex><LibStatus instance={instance} /></Cell>
      <PlayButton instance={instance} size="i" />
      <InstanceMenuButton instance={instance} size="s" variant="ghost" showOpen={false} />
    </ListRow>
  );
}

/** Instanzen als Poster oder Liste. */
export function InstanceView({ instances, mode }: { instances: Instance[]; mode: LibraryMode }) {
  const { t } = useI18n();
  if (mode === "poster")
    return (
      <CardGrid>
        {instances.map((instance, index) => <PosterCard key={instance.id} instance={instance} index={index} />)}
      </CardGrid>
    );
  return (
    <List
      variant="instances"
      divided
      aria-label={t("common.instances")}
      head={
        <>
          <span />
          <Cell>{t("common.name")}</Cell>
          <Cell>{t("common.version")}</Cell>
          <Cell hide={WIDTH.md}>{t("pages.instances.colContents")}</Cell>
          <Cell hide={WIDTH.md}>{t("pages.instances.colLastPlayed")}</Cell>
          <Cell hide={WIDTH.xl}>{t("pages.instances.colPlaytime")}</Cell>
          <Cell>{t("common.status")}</Cell>
          <span />
          <span />
        </>
      }
    >
      {instances.map((instance, index) => <InstanceRow key={instance.id} instance={instance} index={index} />)}
    </List>
  );
}
