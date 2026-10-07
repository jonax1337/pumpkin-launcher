import { Fragment } from "react";
import { useI18n } from "@/i18n";
import { Button, Cell, Checkbox, Chip, GhostRow, ListRow, ProjectIcon, RowTitle, Tip } from "@/ui";
import { WIDTH } from "@/lib/breakpoints";
import { TYPE_ONE_KEYS } from "@/lib/catalog";
import { formatDate, formatSize } from "@/lib/format";
import { SourceTag } from "@/components/catalog/SourceTag";
import type { Mod } from "@/lib/types";
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
      {mod.packManaged && <div className="tr">{t("detail.content.packManagedTip")}</div>}
      {update && <div className="tu">{t("detail.content.updateAvailable", { version: update.versionNumber })}</div>}
      {warns.map((w) => <div key={w.text} className="tw">{w.detail ?? w.text}</div>)}
      {description && <div className="td">{description}</div>}
    </>
  );
}

/** Die Sätze als ein Text; ein Satz, der schon auf „.“ endet, bekommt keinen zweiten Punkt. */
const joinSentences = (parts: (string | false | undefined)[]) =>
  parts.filter((part): part is string => !!part).map((sentence) => sentence.replace(/\.+$/, "")).join(". ");

/**
 * Was sonst nur im Tooltip steht, als Text für Screenreader (der Menüknopf der Zeile verweist darauf per aria-describedby).
 * Der lange Pack-Hinweis fehlt hier: er würde in jeder Zeile eines Packs vorgelesen.
 */
function useReaderDescription(row: Row, warns: Warn[]) {
  const { t } = useI18n();
  const model = useContentModel();
  const { mod } = row;
  const update = model.updateFor.get(mod.id);
  return joinSentences([
    !mod.enabled && t("detail.content.offState"),
    update && t("detail.content.updateAvailable", { version: update.versionNumber }),
    mod.pinned && t("detail.content.pinned"),
    mod.packManaged && t("detail.content.packManaged"),
    ...warns.map((w) => w.detail ?? w.text),
    model.descriptionOf(mod),
  ]);
}

/** Unsichtbarer Text für Screenreader; leer, wenn es nichts zu sagen gibt. */
function ReaderDescription({ row, text }: { row: Row; text: string }) {
  const model = useContentModel();
  return text && <span id={model.descriptionId(row.mod)} className="sr">{text}</span>;
}

/** Was die gewählte Sortierung ordnet, als Text zur Zeile (Datum oder Größe der Datei); sonst nichts. */
function useSortDetail(mod: Mod) {
  const { sort, factsOf } = useContentModel();
  const facts = factsOf(mod);
  if (!facts) return "";
  if (sort === "date") return formatDate(facts.modifiedMs);
  return sort === "size" ? formatSize(facts.sizeBytes) : "";
}

/** Zweite Zeile unter dem Namen: wer den Inhalt braucht, sonst seine Art, dazu Version, Herkunft vom Pack und was die Sortierung ordnet. */
function useSubline(row: Row) {
  const { t } = useI18n();
  const { mod, owners } = row;
  const kind = owners.length ? t("detail.content.requiredBy", { names: owners.join(", ") }) : t(TYPE_ONE_KEYS[mod.kind]);
  return [kind, mod.version, mod.packManaged && t("detail.content.packManaged"), useSortDetail(mod)].filter(Boolean).join(" · ");
}

/** Woher der Inhalt kommt: Anbieter, Link oder eigene Datei. */
function ModSourceTag({ mod }: { mod: Mod }) {
  const { t } = useI18n();
  const { source } = mod;
  switch (source.type) {
    case "modrinth":
    case "curseforge":
      return <SourceTag source={source.type} />;
    case "url":
      return <Chip size="s">{t("detail.content.sourceUrl")}</Chip>;
    case "local":
      return <Chip size="s">{t("detail.content.sourceLocal")}</Chip>;
  }
}

/** Handlung eines Hinweises; der Name nennt den Hinweis mit, denn der Chip daneben entfällt in schmalen Fenstern. */
function WarnAction({ warn }: { warn: Warn }) {
  return (
    <Button variant="ghost" size="s" tone="warn" aria-label={`${warn.actionLabel}: ${warn.text}`} onClick={warn.fix}>
      {warn.actionLabel}
    </Button>
  );
}

/**
 * Der erste Hinweis, weitere als Zähler (die Zeile ist fest hoch, ihr Text im Tooltip), dann die Handlung.
 * Der Chip kürzt sich bei Platzmangel; `hideChipBelow` blendet ihn unter dieser Fensterbreite aus (die Handlung nennt den Hinweis mit).
 */
function WarnCell({ warns, hideChipBelow }: { warns: Warn[]; hideChipBelow?: number }) {
  if (!warns.length) return null;
  const [first, ...more] = warns;
  return (
    <Fragment>
      <Tip label={first.detail ?? first.text}>
        <Chip size="s" dot tone="warn" data-hide={hideChipBelow}><span className="truncate min-w-0">{first.text}</span></Chip>
      </Tip>
      {more.length > 0 && (
        <Tip label={more.map((w) => w.detail ?? w.text).join(" ")}>
          <Chip size="s" tone="warn">+{more.length}</Chip>
        </Tip>
      )}
      <WarnAction warn={first} />
    </Fragment>
  );
}

function useRowPresentation(row: Row) {
  const model = useContentModel();
  const { mod } = row;
  const warns = model.warnsOf(mod);
  const picked = model.picked.has(mod.id);
  const description = useReaderDescription(row, warns);
  const subline = useSubline(row);
  return { model, mod, warns, picked, description, subline };
}

/** Inhalt als Listenzeile: Auswahl, Symbol, Name, Herkunft, Hinweise, Update, An/Aus, Menü. */
export function ContentRow({ row }: { row: Row }) {
  const { t } = useI18n();
  const { model, mod, warns, picked, description, subline } = useRowPresentation(row);
  return (
    <ListRow selected={picked} off={!mod.enabled} dep={model.grouped && row.owners.length > 0}>
      <Checkbox
        checked={picked}
        onChange={(on) => model.togglePick(mod.id, on)}
        label={t("detail.content.selectItem", { name: model.titleOf(mod) })}
      />
      <ProjectIcon url={model.iconOf(mod)} seed={mod.id} />
      <Tip label={<RowTip row={row} warns={warns} />}>
        <div>
          <RowTitle title={model.titleOf(mod)} aside={<ModSourceTag mod={mod} />} sub={subline} trunc={false}><ReaderDescription row={row} text={description} /></RowTitle>
        </div>
      </Tip>
      {model.hasWarnings && <Cell flex><WarnCell warns={warns} hideChipBelow={WIDTH.md} /></Cell>}
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
  const { model, mod, warns, picked, description, subline } = useRowPresentation(row);
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
          ? <WarnCell warns={warns} />
          : about ? <span className="truncate" aria-hidden>{about}</span> : <span className="truncate">{subline}</span>}
      </span>
      <span><UpdateCell mod={mod} layout="tile" hideNoSource={warns.length > 0} /></span>
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
