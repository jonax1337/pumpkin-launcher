import { createContext, useContext, useId, type ComponentProps, type ReactNode } from "react";
import { ContextMenu, type MenuEntry } from "./Menu";
import { Trunc } from "./Tip";
import { useI18n } from "@/i18n";
import { cn } from "@/lib/utils";
import { Button } from "./Button";
import { HitEl, type Hit } from "./Hit";
import { Skel } from "./Feedback";
import { cssVars, flag } from "./util";
import type { Breakpoint } from "./types";

/**
 * Spaltenraster je Liste (list.css, inkl. Media Queries):
 * instances 56 px · content 48 px (noWarnCol: ohne Spalte „Hinweise“) · catalog 84 px (feature 132) · catalog-compact 76 px ·
 * versions ≥ 44 px (Trennlinie unten) · tasks 64 px · tiles: Raster aus 88-px-Kacheln · accounts: 60-px-Platten ·
 * worlds 56 px (Welten und Server: Bild, Name, Aktion, Menü).
 */
export type ListVariant = "instances" | "content" | "catalog" | "catalog-compact" | "versions" | "tasks" | "tiles" | "accounts" | "worlds";

/** Was die Zeile ihrem Inhalt verrät: ob sie als Ganzes trifft (Tooltip-Wirt) und ob sie die Katalogkarte ist (Titelgröße). */
const RowCtx = createContext({ hit: false, feature: false });

/**
 * Liste mit festen Spalten. `head`: Kopfzellen (gleiches Raster wie die Zeilen). `divided`: dezente Trenner zwischen Zeilen
 * (nicht an Platzhaltern). Zellen, die schmal verschwinden, tragen `data-hide="1180|1040|900"`.
 */
export function List({ variant, head, divided, noWarnCol, className, children, "aria-label": label, ...props }: {
  variant: ListVariant;
  head?: ReactNode;
  divided?: boolean;
  noWarnCol?: boolean;
} & ComponentProps<"div">) {
  return (
    <div className={cn("vx-list", className)} data-variant={variant} data-divided={flag(divided)} data-nw={flag(noWarnCol)} {...props}>
      {head != null && <div className="vx-lhead">{head}</div>}
      <div className="vx-rows" role="list" aria-label={label}>{children}</div>
    </div>
  );
}

export type ListRowProps = {
  /** Ganze Zeile öffnet (Stretched-Link/-Knopf mit Klasse `hit`); Bedienelemente in den Zellen liegen darüber. */
  hit?: Hit;
  /** Name der Trefferfläche, falls `hit.label` fehlt. */
  hitLabel?: string;
  /** gewählt: Kupferrahmen 1 Einheit + 10 % Tönung */
  selected?: boolean;
  /** ausgeschaltet: Bild gedämpft, Name --fg-2 */
  off?: boolean;
  /** Katalog: erster Treffer als Karte (132 px, Platte) */
  feature?: boolean;
  /** Abhängigkeit: Name eingerückt mit Winkel zur Zeile darüber */
  dep?: boolean;
  /** Position für die Einblend-Staffel (40 ms je Zeile). */
  index?: number;
  /** Kontextmenü (Rechtsklick). */
  menu?: MenuEntry[];
} & ComponentProps<"div">;

/** Zeile einer List. Hover = Platte --hv-row, Name wird #fff (kein Unterstrich); Druck auf die Trefferfläche dunkler. */
export function ListRow({ hit, hitLabel, selected, off, feature, dep, index, menu, className, style, children, ...props }: ListRowProps) {
  const row = (
    <div
      role="listitem"
      className={cn("vx-row", className)}
      data-hit={flag(hit)}
      data-selected={flag(selected)}
      data-off={flag(off)}
      data-feature={flag(feature)}
      data-dep={flag(dep)}
      data-rise={flag(index != null)}
      style={index != null ? { ...style, ...cssVars({ "--i": index }) } : style}
      {...props}
    >
      {hit && <HitEl hit={hit} fallbackLabel={hitLabel ?? ""} />}
      <RowCtx.Provider value={{ hit: !!hit, feature: !!feature }}>{children}</RowCtx.Provider>
    </div>
  );
  return menu ? <ContextMenu items={menu}>{row}</ContextMenu> : row;
}

/**
 * Name (+ Unterzeile) einer Zeile. Abgeschnittener Name zeigt den vollen Text als Tooltip (Wirt: Trefferfläche der Zeile).
 * m: 14/600 + 12 (Bibliothek, Inhalte, Aufgaben) · l: 15/700, `aside` daneben, Beschreibung, `meta`-Zeile (Katalog);
 * in einer `feature`-Zeile Display 28, Beschreibung zweizeilig. `children`: z. B. Text nur für Vorleser.
 */
export function RowTitle({ title, sub, aside, meta, size = "m", trunc = true, id, children }: {
  title: string;
  sub?: ReactNode;
  aside?: ReactNode;
  meta?: ReactNode;
  size?: "m" | "l";
  /** false: kein eigener Tooltip (die Zeile zeigt schon einen). */
  trunc?: boolean;
  id?: string;
  children?: ReactNode;
}) {
  const { hit, feature } = useContext(RowCtx);
  const look = feature ? "feature" : size;
  return (
    <div className="vx-rt" data-size={look}>
      <div className="vx-rt-1">
        {trunc ? <Trunc as="b" text={title} host={hit ? ".hit" : undefined} className="vx-rt-n" /> : <b className="vx-rt-n ell" id={id}>{title}</b>}
        {aside != null && <span className="vx-rt-a">{aside}</span>}
      </div>
      {sub != null && (look === "m" ? <span className="vx-rt-s">{sub}</span> : <p className="vx-rt-s">{sub}</p>)}
      {meta != null && <div className="vx-rt-m">{meta}</div>}
      {children}
    </div>
  );
}

/**
 * Zelle einer Zeile oder des Kopfs: Text 13 px --fg-2 mit Auslassung. `flex`: Inhalt als Reihe (Chips, Knöpfe, feste Höhe 32).
 * `align="end"`: rechtsbündig. `hide`: unter dieser Fensterbreite ausgeblendet (Raster hat dann eine Spalte weniger).
 */
export function Cell({ hide, align, flex, className, children, ...props }: { hide?: Extract<Breakpoint, 900 | 1040 | 1180>; align?: "start" | "end"; flex?: boolean } & ComponentProps<"span">) {
  return (
    <span className={cn("vx-cell", className)} data-hide={hide} data-align={align} data-flex={flag(flex)} {...props}>
      {children}
    </span>
  );
}

/**
 * Platzhalter für Entferntes: gleiche Höhe wie die Zeile/Kachel, gestrichelte Linie, „Rückgängig“ (data-undo = Gruppe).
 * Ohne `onUndo` (Teil einer Gruppe, deren Knopf an der Hauptzeile steht) nur der Text.
 */
export function GhostRow({ variant, text, media, undoId, onUndo }: { variant: "content" | "tile"; text: string; media?: ReactNode; undoId?: string; onUndo?: () => void }) {
  const { t } = useI18n();
  const tid = useId();
  return (
    <div role="listitem" className="vx-row" data-ghost={variant}>
      {variant === "content" && <span />}
      {variant === "content" && <span className="vx-ghost-m">{media}</span>}
      <b className="vx-ghost-t ell" id={tid}>{text}</b>
      {onUndo ? (
        <Button size="s" icon="redo" data-undo={undoId} aria-describedby={tid} onClick={onUndo}>{t("ui.list.undo")}</Button>
      ) : (
        <span />
      )}
    </div>
  );
}

/**
 * Platzhalterzeile beim Laden (Katalog): gleiche Höhe und Spalten wie die echte Zeile (`feature` = Karte 132 px),
 * Bild · drei Textzeilen · Aktion. Maße aus list.css je Variante; kein Hover.
 */
export function SkelRow({ feature }: { feature?: boolean }) {
  return (
    <div role="listitem" className="vx-row" data-skel="" data-feature={flag(feature)}>
      <Skel className="vx-skel-m" />
      <span className="vx-skel-t"><Skel /><Skel /><Skel /></span>
      <Skel className="vx-skel-a" />
    </div>
  );
}
