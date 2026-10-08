import { memo, type ComponentType } from "react";
import { useI18n } from "@/i18n";
import { Cell, Checkbox, List } from "@/ui";
import { useRovingItems } from "@/hooks/useRovingItems";
import { ContentModelProvider, useContentModel, type ContentModel } from "./ContentModel";
import { ContentRow, ContentTile, GhostEntry } from "./ContentRow";
import { entrySignature, sameSignature } from "./entrySignature";
import type { Entry, Row } from "./types";

const isRow = (entry: Entry): entry is Row => entry.type === "row";

type ItemComponent = ComponentType<{ row: Row }>;

/**
 * Ein Eintrag mit dem Modell als eigenem Kontext: er rendert nur neu, wenn sich seine `signature` ändert (siehe
 * `entrySignature`), nicht bei jeder Änderung des Tabs.
 */
const EntryItem = memo(
  function EntryItem({ model, entry, Item }: { model: ContentModel; entry: Entry; Item: ItemComponent; signature: unknown[] }) {
    return (
      <ContentModelProvider value={model}>
        {isRow(entry) ? <Item row={entry} /> : <GhostEntry ghost={entry} />}
      </ContentModelProvider>
    );
  },
  (prev, next) => prev.Item === next.Item && sameSignature(prev.signature, next.signature),
);

/** Jeder Eintrag als `Item` (Zeile oder Kachel), entfernte als Platzhalter. */
const renderEntries = (entries: Entry[], model: ContentModel, Item: ItemComponent) =>
  entries.map((entry) => (
    <EntryItem key={isRow(entry) ? entry.mod.id : `g-${entry.mod.id}`} model={model} entry={entry} Item={Item} signature={entrySignature(model, entry)} />
  ));

/** Pfeiltasten wandern zwischen den Einträgen; Träger ist ihr Auswahlfeld (Platzhalter haben keins und zählen nicht). */
const ROVING = { item: ".vx-row:has(input[type=checkbox])", primary: "input[type=checkbox]" };

/** Zeilen oder Kacheln samt Platzhaltern; in der Liste mit Kopf (Alle wählen, Spaltennamen). Ein Tab-Stopp für alle Einträge. */
export function ContentList({ entries }: { entries: Entry[] }) {
  const { t } = useI18n();
  const model = useContentModel();
  const roving = useRovingItems<HTMLDivElement>(ROVING);
  if (model.mode === "grid") return <List variant="tiles" {...roving}>{renderEntries(entries, model, ContentTile)}</List>;

  const liveIds = entries.filter(isRow).map((row) => row.mod.id);
  const pickedCount = liveIds.filter((id) => model.picked.has(id)).length;
  return (
    <List
      variant="content"
      className="dc-table vx-pit"
      noWarnCol={!model.hasWarnings}
      divided
      {...roving}
      head={
        <>
          <span>
            <Checkbox
              label={t("detail.content.selectAll")}
              checked={pickedCount > 0 && pickedCount === liveIds.length}
              indeterminate={pickedCount > 0 && pickedCount < liveIds.length}
              onChange={(on) => model.pickMany(liveIds, on)}
            />
          </span>
          <span />
          <Cell>{t("common.name")}</Cell>
          {model.hasWarnings && <Cell>{t("detail.content.warningsColumn")}</Cell>}
          <Cell align="end">{t("common.update")}</Cell>
          <Cell align="end">{t("ui.switch.on")}</Cell>
          <span />
        </>
      }
    >
      {renderEntries(entries, model, ContentRow)}
    </List>
  );
}
