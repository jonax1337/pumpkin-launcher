/**
 * Weitere Zeilenarten für die `List`: `TileRow` (Kachel mit benannten Plätzen), `GhostRow` (Entferntes, mit „Rückgängig“) und
 * `SkelRow` (lädt). Sie nutzen das Raster der Liste (`cols` der `List`, `GRID`) und den Zeilenlook `lk-row`; die festen Maße der
 * Varianten stehen als Tailwind-Klassen an der Zeile und sind per `className` überschreibbar.
 */
import { useId, type ReactNode } from "react";
import { useI18n } from "@/i18n";
import { cn } from "@/lib/utils";
import { flag, hasContent } from "./util";
import { Button } from "./Button";
import { Skel } from "./Feedback";
import { GRID, LAZY, ListRow, type ListRowProps } from "./List";

const ROW = "lk-row min-h-(--l-h,56px) min-w-0";

/** Plätze der Kachel (Raster 52 · 1fr · auto, zwei Zeilen): Bild links über beide Zeilen, rechts oben Aktionen, unten Meta und Fuß. */
const TILE_ROW = [
  "grid-cols-[52px_minmax(0,1fr)_auto] grid-rows-[minmax(32px,auto)_minmax(32px,auto)] py-3 pr-2 pl-3 [--l-h:88px]",
  "[&:not(:has(>[data-slot=footer]>*))>[data-slot=meta]]:col-[2/4]",
].join(" ");
/** Auswahlfeld auf der Bild-Ecke: sichtbar bei Hover/Fokus, gewählt oder sobald in der Liste etwas gewählt ist (kein Springen) und ohne Zeiger. */
const TILE_CHECK = "absolute -top-1.5 -left-1.5 grid opacity-0 [transition:opacity_var(--st)] group-hover/row:opacity-100 group-focus-within/row:opacity-100 group-data-[selected]/row:opacity-100 [[role=list]:has(>[data-selected])_&]:opacity-100 [@media(hover:none)]:opacity-100";
/** Hinweiszeile der Kachel: Chips und Knöpfe behalten ihre Größe, nur der erste Chip kürzt sich. */
const TILE_META = "col-2 row-2 flex min-w-0 gap-1 overflow-hidden text-[length:calc(13px*var(--tz))] text-(color:--fg-3) [&>.lk-chip]:min-w-0 [&>.lk-chip]:shrink [&>:is(.lk-btn,.lk-chip:not(:first-child))]:shrink-0";

/**
 * Kachel für `List tiles` (Platte, 88 px hoch) mit benannten Plätzen statt Kinderstellen:
 * `media` Bild (links, beide Zeilen) · `check` Auswahlfeld auf der Bild-Ecke · `title` Name (oben) · `actions` Schalter/Menü (rechts oben) ·
 * `meta` Hinweiszeile (unten) · `footer` Aktion unten rechts; ohne Inhalt im `footer` nimmt `meta` die Breite. Alle `ListRow`-Eigenschaften
 * (`selected`, `off`, `menu` …) gelten; `lazy` rendert Kacheln außerhalb des Fensters nicht.
 */
export function TileRow({ media, check, title, actions, meta, footer, className, ...props }: {
  media?: ReactNode; check?: ReactNode; title?: ReactNode; actions?: ReactNode; meta?: ReactNode; footer?: ReactNode;
} & Omit<ListRowProps, "children" | "plate" | "feature" | "tone" | "bar" | "title">) {
  return (
    <ListRow plate className={cn(TILE_ROW, className)} {...props}>
      <span className="relative row-[1/3] grid">
        {media}
        {hasContent(check) && <span className={TILE_CHECK}>{check}</span>}
      </span>
      {hasContent(title) && <div className="col-2 row-1 min-w-0">{title}</div>}
      {hasContent(actions) && <span className="col-3 row-1 flex items-center gap-0.5">{actions}</span>}
      {hasContent(meta) && <span data-slot="meta" className={TILE_META}>{meta}</span>}
      {hasContent(footer) && <span data-slot="footer" className="col-3 row-2 flex justify-end pr-0.5">{footer}</span>}
    </ListRow>
  );
}

/** Inhaltszeile: Platz · Bild · Text · Aktion. Kachelzeile: Text links, Aktion rechts, Kachelhöhe 88. */
const GHOST_LAYOUT = {
  content: "grid-cols-[28px_40px_minmax(0,1fr)_auto]",
  tile: "flex items-center justify-between gap-3 py-3 pr-2 pl-3 [--l-h:88px]",
} as const;

/**
 * Platzhalter für Entferntes: gleiche Höhe wie die Zeile/Kachel, gestrichelte Linie, „Rückgängig“ (data-undo = Gruppe).
 * Ohne `onUndo` (Teil einer Gruppe, deren Knopf an der Hauptzeile steht) nur der Text.
 */
export function GhostRow({ variant, text, media, undoId, onUndo, lazy, className }: {
  variant: "content" | "tile"; text: string; media?: ReactNode; undoId?: string; onUndo?: () => void;
  /** Außerhalb des Fensters nicht rendern; die Höhe bleibt reserviert (wie `ListRow lazy`). */
  lazy?: boolean; className?: string;
}) {
  const { t } = useI18n();
  const tid = useId();
  return (
    <div role="listitem" className={cn(ROW, GRID, GHOST_LAYOUT[variant], lazy && LAZY, className)} data-ghost={variant}>
      {variant === "content" && <span />}
      {variant === "content" && <span className="lk-ghost-m grid place-items-center">{media}</span>}
      <b className="lk-ghost-t min-w-0 truncate text-[calc(14px*var(--tz))]" id={tid}>{text}</b>
      {onUndo ? (
        <Button size="s" icon="undo" data-undo={undoId} aria-describedby={tid} onClick={onUndo}>{t("ui.list.undo")}</Button>
      ) : (
        <span />
      )}
    </div>
  );
}

/**
 * Platzhalterzeile beim Laden (Katalog): Bild · drei Textzeilen · Aktion, ohne Hover. Spalten kommen von `cols` der Liste.
 * Bild 64 (`compact` 40, `feature` 104 in einer Karte von 132), Textzeilen 12 px, Aktion 32 px hoch (`compact` 100 breit).
 */
export function SkelRow({ feature, compact, className }: { feature?: boolean; compact?: boolean; className?: string }) {
  return (
    <div role="listitem" className={cn(ROW, GRID, feature && "min-h-33", className)} data-skel="" data-feature={flag(feature)}>
      <Skel className={cn("justify-self-center", feature ? "size-26" : compact ? "size-10" : "size-16")} />
      <span className="flex min-w-0 flex-col gap-2">
        <Skel className="h-3 w-[38%]" />
        <Skel className="h-3 w-[72%]" />
        <Skel className="h-3 w-[24%]" />
      </span>
      <Skel className={cn("h-8 justify-self-end", compact ? "w-25" : "w-30")} />
    </div>
  );
}
