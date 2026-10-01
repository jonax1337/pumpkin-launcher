import { Fragment } from "react";
import { useI18n } from "@/i18n";
import { Button, Cell, Checkbox, Chip, GhostRow, ListRow, ProjectIcon, RowTitle, Tip } from "@/ui";
import { WIDTH } from "@/lib/breakpoints";
import { TYPE_ONE_KEYS } from "@/lib/catalog";
import { useContentModel } from "./ContentModel";
import { EnabledCell, MoreMenu, UpdateCell } from "./RowCells";
import type { Ghost, Row, Warn } from "./types";

/** Tooltip der Zeile: Name, Art und Version, wer den Inhalt braucht, Update, Hinweise, Beschreibung. */
function RowTip({ row, warns }: { row: Row; warns: Warn[] }) {
  const { t } = useI18n();
  const model = useContentModel();
  const { mod } = row;
  const update = model.updateFor.get(mod.id);
  const description = model.descriptionOf(mod);
  return (
    <>
      <div className="tn">{model.titleOf(mod)}</div>
      <div className="tv">
        {t(TYPE_ONE_KEYS[mod.kind])} · {t("common.version")} {mod.version}
        {mod.enabled ? "" : ` · ${t("detail.content.turnedOffInline")}`}
      </div>
      {row.owners.length > 0 && <div className="tr">{t("detail.content.requiredBy", { names: row.owners.join(", ") })}</div>}
      {update && <div className="tu">{t("detail.content.updateAvailable", { version: update.versionNumber })}</div>}
      {warns.map((w) => <div key={w.text} className="tw">{w.text}</div>)}
      {description && <div className="td">{description}</div>}
    </>
  );
}

/** Was sonst nur im Tooltip steht, als Text für Screenreader (der Menüknopf der Zeile verweist darauf per aria-describedby). */
function useReaderDescription(row: Row, warns: Warn[]) {
  const { t } = useI18n();
  const model = useContentModel();
  const { mod } = row;
  const update = model.updateFor.get(mod.id);
  return [
    !mod.enabled && t("detail.content.offState"),
    update && t("detail.content.updateAvailable", { version: update.versionNumber }),
    ...warns.map((w) => w.text),
    model.descriptionOf(mod),
  ].filter(Boolean).join(". ");
}

/** Unsichtbarer Text für Screenreader; leer, wenn es nichts zu sagen gibt. */
function ReaderDescription({ row, text }: { row: Row; text: string }) {
  const model = useContentModel();
  return text && <span id={model.descriptionId(row.mod)} className="sr">{text}</span>;
}

/** Zweite Zeile unter dem Namen: wer den Inhalt braucht, sonst seine Art, dazu die Version. */
function useSubline(row: Row) {
  const { t } = useI18n();
  return row.owners.length
    ? `${t("detail.content.requiredBy", { names: row.owners.join(", ") })} · ${row.mod.version}`
    : `${t(TYPE_ONE_KEYS[row.mod.kind])} · ${row.mod.version}`;
}

/** Inhalt als Listenzeile: Auswahl, Symbol, Name, Hinweise, Update, An/Aus, Menü. */
export function ContentRow({ row }: { row: Row }) {
  const { t } = useI18n();
  const model = useContentModel();
  const { mod } = row;
  const warns = model.warnsOf(mod);
  const picked = model.picked.has(mod.id);
  const description = useReaderDescription(row, warns);
  const subline = useSubline(row);
  return (
    <ListRow selected={picked} off={!mod.enabled} dep={row.owners.length > 0}>
      <Checkbox
        checked={picked}
        onChange={(on) => model.togglePick(mod.id, on)}
        label={t("detail.content.selectItem", { name: model.titleOf(mod) })}
      />
      <ProjectIcon url={model.iconOf(mod)} seed={mod.id} />
      <Tip label={<RowTip row={row} warns={warns} />}>
        <div>
          <RowTitle title={model.titleOf(mod)} sub={subline} trunc={false}><ReaderDescription row={row} text={description} /></RowTitle>
        </div>
      </Tip>
      {model.hasWarnings && (
        <Cell flex>
          {warns.map((w) => (
            <Fragment key={w.text}>
              <Chip size="s" dot tone="warn" data-hide={WIDTH.md}>{w.text}</Chip>
              <Button variant="ghost" size="s" tone="warn" onClick={w.fix}>{w.actionLabel}</Button>
            </Fragment>
          ))}
        </Cell>
      )}
      <Cell flex align="end"><UpdateCell mod={mod} layout="list" /></Cell>
      <Cell flex align="end"><EnabledCell mod={mod} layout="list" /></Cell>
      <MoreMenu mod={mod} describedBy={description ? model.descriptionId(mod) : undefined} />
    </ListRow>
  );
}

/**
 * Kachel, 88 px: Icon (Auswahlfeld darüber) · Name · rechts oben Schalter und Menü · eine Zeile Beschreibung bzw. Hinweis ·
 * rechts unten Update.
 */
export function ContentTile({ row }: { row: Row }) {
  const { t } = useI18n();
  const model = useContentModel();
  const { mod } = row;
  const warns = model.warnsOf(mod);
  const picked = model.picked.has(mod.id);
  const description = useReaderDescription(row, warns);
  const subline = useSubline(row);
  // Beschreibung steht schon im Screenreader-Text (ReaderDescription); Art/Version nur hier.
  const about = row.owners.length ? "" : model.descriptionOf(mod) ?? "";
  return (
    <ListRow selected={picked} off={!mod.enabled}>
      <span>
        <ProjectIcon url={model.iconOf(mod)} seed={mod.id} box={52} />
        <Checkbox
          checked={picked}
          onChange={(on) => model.togglePick(mod.id, on)}
          label={t("detail.content.selectItem", { name: model.titleOf(mod) })}
        />
      </span>
      <Tip label={<RowTip row={row} warns={warns} />}>
        <div><RowTitle title={model.titleOf(mod)} trunc={false}><ReaderDescription row={row} text={description} /></RowTitle></div>
      </Tip>
      <span>
        <EnabledCell mod={mod} layout="tile" />
        <MoreMenu mod={mod} describedBy={description ? model.descriptionId(mod) : undefined} />
      </span>
      <span>
        {warns.length
          ? warns.map((w) => <Chip key={w.text} size="s" dot tone="warn">{w.text}</Chip>)
          : about ? <span className="truncate" aria-hidden>{about}</span> : <span className="truncate">{subline}</span>}
      </span>
      <span><UpdateCell mod={mod} layout="tile" /></span>
    </ListRow>
  );
}

/** Platzhalter für einen entfernten Inhalt; nur die gewählte Hauptzeile bietet „Rückgängig“. */
export function GhostEntry({ ghost }: { ghost: Ghost }) {
  const { t } = useI18n();
  const model = useContentModel();
  const tile = model.mode === "grid";
  return (
    <GhostRow
      variant={tile ? "tile" : "content"}
      text={ghost.by && !tile
        ? t("detail.content.removedGhostWith", { name: ghost.title, by: ghost.by })
        : t("detail.content.removedGhost", { name: ghost.title })}
      media={tile ? undefined : <ProjectIcon url={model.iconOf(ghost.mod)} seed={ghost.mod.id} />}
      undoId={ghost.main ? ghost.group : undefined}
      onUndo={ghost.main ? () => model.undo(ghost.group) : undefined}
    />
  );
}
