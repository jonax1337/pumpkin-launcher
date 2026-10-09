import { memo, type ComponentType } from "react";
import { useI18n } from "@/i18n";
import { Cell, Checkbox, List, type ListLayout } from "@/ui";
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
const ROVING = { item: "[data-kit-item=row]:has(input[type=checkbox])", primary: "input[type=checkbox]" };

/**
 * Inhaltsliste: Auswahl, Bild, Name, Hinweise, Update, An, Menü. Ohne Hinweise entfällt die Spalte „Hinweise“; unter 1040 px und 900 px wird
 * sie schmaler. Unter 720 px stehen die Zeilen zweizeilig (`NARROW` in ContentRow), der Kopf zeigt nur noch Auswahl und „Name“.
 */
const LIST: ListLayout = { gap: 10, density: "compact", rowHeight: { base: 48, 720: 84 }, headHeight: 36 };
const COLS_WARN: ListLayout["cols"] = {
  base: "28px 40px minmax(0,1fr) 300px 136px 100px 36px",
  1040: "28px 40px minmax(0,1fr) 190px 132px 100px 36px",
  900: "28px 40px minmax(0,1fr) 130px 132px 100px 36px",
};
const COLS_NO_WARN: ListLayout["cols"] = {
  base: "28px 40px minmax(0,1fr) 136px 100px 36px",
  1040: "28px 40px minmax(0,1fr) 132px 100px 36px",
};
/** Unter 720 px zeigt der Kopf nur noch Auswahl und „Name“. */
const NARROW_HIDE = "le-720:hidden";

/** Zeilen oder Kacheln samt Platzhaltern; in der Liste mit Kopf (Alle wählen, Spaltennamen). Ein Tab-Stopp für alle Einträge. */
export function ContentList({ entries }: { entries: Entry[] }) {
  const { t } = useI18n();
  const model = useContentModel();
  const roving = useRovingItems<HTMLDivElement>(ROVING);
  if (model.mode === "grid") return <List tiles {...roving}>{renderEntries(entries, model, ContentTile)}</List>;

  const liveIds = entries.filter(isRow).map((row) => row.mod.id);
  const pickedCount = liveIds.filter((id) => model.picked.has(id)).length;
  return (
    <List
      framed
      divided
      {...LIST}
      cols={model.hasWarnings ? COLS_WARN : COLS_NO_WARN}
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
          {model.hasWarnings && <Cell className={NARROW_HIDE}>{t("detail.content.warningsColumn")}</Cell>}
          <Cell align="end" className={NARROW_HIDE}>{t("common.update")}</Cell>
          <Cell align="switch" className={NARROW_HIDE}>{t("ui.switch.on")}</Cell>
          <span className={NARROW_HIDE} />
        </>
      }
    >
      {renderEntries(entries, model, ContentRow)}
    </List>
  );
}
