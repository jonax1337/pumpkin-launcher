import type { ComponentType } from "react";
import { useI18n } from "@/i18n";
import { Cell, Checkbox, List } from "@/ui";
import { useContentModel } from "./ContentModel";
import { ContentRow, ContentTile, GhostEntry } from "./ContentRow";
import type { Entry, Row } from "./types";

const isRow = (entry: Entry): entry is Row => entry.type === "row";

/** Jeder Eintrag als `Item` (Zeile oder Kachel), entfernte als Platzhalter. */
const renderEntries = (entries: Entry[], Item: ComponentType<{ row: Row }>) =>
  entries.map((entry) => (isRow(entry) ? <Item key={entry.mod.id} row={entry} /> : <GhostEntry key={`g-${entry.mod.id}`} ghost={entry} />));

/** Zeilen oder Kacheln samt Platzhaltern; in der Liste mit Kopf (Alle wählen, Spaltennamen). */
export function ContentList({ entries }: { entries: Entry[] }) {
  const { t } = useI18n();
  const model = useContentModel();
  if (model.mode === "grid") return <List variant="tiles">{renderEntries(entries, ContentTile)}</List>;

  const liveIds = entries.filter(isRow).map((row) => row.mod.id);
  const pickedCount = liveIds.filter((id) => model.picked.has(id)).length;
  return (
    <List
      variant="content"
      noWarnCol={!model.hasWarnings}
      divided
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
      {renderEntries(entries, ContentRow)}
    </List>
  );
}
