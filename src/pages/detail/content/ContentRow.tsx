import { Fragment } from "react";
import { useI18n } from "@/i18n";
import { Button, Cell, Checkbox, Chip, GhostRow, ListRow, ProjectIcon, RowTitle, Tip, TipLine, TipTitle, TileRow, type IconName } from "@/ui";
import { TYPE_ONE_KEYS } from "@/lib/catalog";
import { formatDate, formatSize } from "@/lib/format";
import { SourceTag } from "@/components/catalog/SourceTag";
import type { Mod } from "@/lib/types";
import { KindTile } from "../KindTile";
import { useContentModel } from "./ContentModel";
import { EnabledCell, MoreMenu, UpdateCell } from "./RowCells";
import type { Ghost, Row, Warn } from "./types";

/**
 * Unter 720 px zweizeilig: oben der Name über die ganze Breite, darunter Hinweis, Update, Schalter und Menü; Auswahl und Bild
 * stehen links über beide Zeilen. Die Spalten setzt ContentList an der Liste, die Zeile legt hier ihr eigenes Raster darüber.
 */
const NARROW = {
  row: "le-720:grid-cols-[28px_40px_minmax(0,1fr)_auto_auto_36px] le-720:gap-y-0.5 le-720:py-1.5",
  pick: "le-720:row-[1/3]",
  title: "le-720:[grid-area:1/3/2/-1]",
  warn: "le-720:[grid-area:2/3]",
  update: "le-720:[grid-area:2/-4]",
  enabled: "le-720:[grid-area:2/-3]",
  more: "le-720:[grid-area:2/-2]",
} as const;
/** Abhängiger Inhalt: Name eingerückt, Winkel zur Zeile darüber. */
const DEP_TITLE = "relative pl-[22px] before:absolute before:-top-1.5 before:left-1.5 before:h-[18px] before:w-2.5 before:content-[''] before:[box-shadow:inset_var(--px)_calc(var(--px)*-1)_0_var(--line-2)]";

/** Symbol je Art, solange das Projekt kein eigenes Bild hat. */
const KIND_ICONS = { mod: "mod", resourcepack: "resourcepack", shader: "shader" } as const satisfies Record<Mod["kind"], IconName>;

function ContentIcon({ mod, url, box, className }: { mod: Mod; url: string | null | undefined; box?: 40 | 52; className?: string }) {
  return <KindTile url={url} seed={mod.id} icon={KIND_ICONS[mod.kind]} box={box} className={className} />;
}

/** Tooltip der Zeile: Name, Art und Version, wer den Inhalt braucht, Update, Hinweise, Beschreibung. */
function RowTip({ row, warns }: { row: Row; warns: Warn[] }) {
  const { t } = useI18n();
  const model = useContentModel();
  const { mod } = row;
  const update = model.updateFor.get(mod.id);
  const description = model.descriptionOf(mod);
  return (
    <>
      <TipTitle>{model.titleOf(mod)}</TipTitle>
      <TipLine>
        {t(TYPE_ONE_KEYS[mod.kind])} · {t("common.version")} {mod.version}
        {mod.enabled ? "" : ` · ${t("detail.content.turnedOffInline")}`}
      </TipLine>
      {row.owners.length > 0 && <TipLine>{t("detail.content.requiredBy", { names: row.owners.join(", ") })}</TipLine>}
      {mod.packManaged && <TipLine>{t("detail.content.packManagedTip")}</TipLine>}
      {update && <TipLine tone="update">{t("detail.content.updateAvailable", { version: update.versionNumber })}</TipLine>}
      {warns.map((w) => <TipLine key={w.text} tone="bad">{w.detail ?? w.text}</TipLine>)}
      {description && <TipLine tone="desc">{description}</TipLine>}
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
 * Der Chip kürzt sich bei Platzmangel; `hideChip` blendet ihn unter 1040 px aus (die Handlung nennt den Hinweis mit).
 */
function WarnCell({ warns, hideChip }: { warns: Warn[]; hideChip?: boolean }) {
  if (!warns.length) return null;
  const [first, ...more] = warns;
  return (
    <Fragment>
      <Tip label={first.detail ?? first.text}>
        <Chip size="s" tone="warn" className={hideChip ? "le-1040:hidden" : undefined}><span className="dc-warn-text">{first.text}</span></Chip>
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
  const dep = model.grouped && row.owners.length > 0;
  return (
    <ListRow selected={picked} off={!mod.enabled} lazy className={NARROW.row}>
      <Checkbox
        className={NARROW.pick}
        checked={picked}
        onChange={(on) => model.togglePick(mod.id, on)}
        label={t("detail.content.selectItem", { name: model.titleOf(mod) })}
      />
      <ContentIcon className={NARROW.pick} mod={mod} url={model.iconOf(mod)} />
      <Tip label={<RowTip row={row} warns={warns} />}>
        <div className={NARROW.title}>
          <RowTitle title={model.titleOf(mod)} className={dep ? DEP_TITLE : undefined} meta={<><ModSourceTag mod={mod} /><span className="dc-sub">{subline}</span></>} trunc={false}><ReaderDescription row={row} text={description} /></RowTitle>
        </div>
      </Tip>
      {model.hasWarnings && <Cell flex className={NARROW.warn}><WarnCell warns={warns} hideChip /></Cell>}
      <Cell flex align="end" className={NARROW.update}><UpdateCell mod={mod} layout="list" /></Cell>
      <Cell flex align="end" className={NARROW.enabled}><EnabledCell mod={mod} layout="list" /></Cell>
      <MoreMenu className={NARROW.more} mod={mod} describedBy={description ? model.descriptionId(mod) : undefined} />
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
    <TileRow
      selected={picked}
      off={!mod.enabled}
      lazy
      media={<ContentIcon mod={mod} url={model.iconOf(mod)} box={52} />}
      check={
        <Checkbox
          checked={picked}
          onChange={(on) => model.togglePick(mod.id, on)}
          label={t("detail.content.selectItem", { name: model.titleOf(mod) })}
        />
      }
      title={
        <Tip label={<RowTip row={row} warns={warns} />}>
          <div><RowTitle title={model.titleOf(mod)} trunc={false}><ReaderDescription row={row} text={description} /></RowTitle></div>
        </Tip>
      }
      actions={
        <>
          <EnabledCell mod={mod} layout="tile" />
          <MoreMenu mod={mod} describedBy={description ? model.descriptionId(mod) : undefined} />
        </>
      }
      meta={
        warns.length
          ? <WarnCell warns={warns} />
          : about ? <span className="ell" aria-hidden>{about}</span> : <span className="ell">{subline}</span>
      }
      footer={<UpdateCell mod={mod} layout="tile" hideNoSource={warns.length > 0} />}
    />
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
      lazy
      text={ghost.by && !tile
        ? t("detail.content.removedGhostWith", { name: ghost.title, by: ghost.by })
        : t("detail.content.removedGhost", { name: ghost.title })}
      media={tile ? undefined : <ProjectIcon url={model.iconOf(ghost.mod)} seed={ghost.mod.id} />}
      undoId={ghost.main ? ghost.group : undefined}
      onUndo={ghost.main ? () => model.undo(ghost.group) : undefined}
    />
  );
}
