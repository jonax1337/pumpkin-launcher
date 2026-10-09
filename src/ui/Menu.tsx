/**
 * Menüs des Kits: Dropdown und Kontextmenü mit gleichen Einträgen, freie Menübausteine. Verhalten (Radix, Fokus-Rückgabe,
 * Textmenü, Menü-Herkunft) kommt aus menuBase.tsx (`MenuBase`, `ContextMenuBase`, `KitItem`); Aussehen aus look/overlay.css (lk-*),
 * Maße und Anordnung als Tailwind-Utilities hier. Innerhalb gilt der hellere Hover-Kontext (data-ctx="overlay", tokens.css).
 */
import type { ComponentProps, ReactNode } from "react";
import { DropdownMenu as DM } from "radix-ui";
import { cn } from "@/lib/utils";
import { ContextMenuBase, KitItem, MenuBase, type ItemLook, type MenuEntry, type MenuProps, type MenuSkin } from "./menuBase";

export type { MenuEntry };

/**
 * Fläche von Menü, Popover und Auswahlliste ohne Innenabstand: so viel Platz wie Radix (Popper) nach Kollision und collisionPadding
 * übrig lässt, darüber scrollt die Fläche (Gutter stabil, nichts springt). Breite nach Inhalt, mindestens 240.
 */
export const POP_BOX = "lk-pop relative z-70 min-w-60 max-w-[calc(var(--vw1,1vw)*100_-_16px)] max-h-[var(--radix-popper-available-height,calc(var(--vh1,1vh)*100_-_16px))] overflow-y-auto [scrollbar-gutter:stable] outline-none";
const POP = `${POP_BOX} p-u2`;

/** Eintrag 36 px (tall 52), Symbol s, Schrift 15. */
const ITEM = "lk-mi relative flex h-9 w-full items-center gap-2.5 px-3 text-[length:calc(15px*var(--tz))] whitespace-nowrap";
const SEP = "lk-msep my-u1 h-u1";
const LABEL = "lk-mlabel px-3 pt-2 pb-1 text-ctl-s";

const SKIN: MenuSkin = {
  pop: POP,
  trunc: "min-w-0 truncate",
  item: ITEM,
  tall: "h-13",
  t2: "lk-mi-t2 flex min-w-0 flex-col leading-tight [&>span]:text-ctl-s",
  ck: "lk-mi-ck ml-auto",
  sub: "ml-auto",
  sep: SEP,
  label: LABEL,
};

/**
 * Dropdown-Menü an einem Auslöser. Einträge über `items` oder frei als `children` (MenuItem, MenuSep, MenuLabel).
 * `wide`: feste Breite 320 (Kontomenü, Auswahl mit Zweitzeile); die Breite ersetzt der Aufrufer per `className` (`w-96`).
 */
export function Menu({ wide, className, ...props }: MenuProps) {
  return <MenuBase skin={SKIN} className={cn(wide && "w-80", className)} {...props} />;
}

/** Kontextmenü (Rechtsklick) mit denselben Einträgen. */
export function ContextMenu(props: { items: MenuEntry[]; children: ReactNode; includePortals?: boolean }) {
  return <ContextMenuBase skin={SKIN} {...props} />;
}

/**
 * Freier Menüeintrag (als Kind von Menu): `tall` = 52 px (zwei Zeilen/Vorschaubild), `bad` = Gefahr.
 * Mit `sub` wie ein Eintrag aus `items`: `children` fett, `sub` als zweite Zeile, `lead` (Bild) davor, 52 px.
 */
export function MenuItem(props: ItemLook & ComponentProps<typeof DM.Item>) {
  return <KitItem kit={DM} skin={SKIN} {...props} />;
}

/** Scrollbereich für lange Eintragslisten; Kopf (MenuLabel) und Fuß des Menüs bleiben stehen. Höchstens 320 px bzw. was unter dem Auslöser Platz hat, abzüglich Kopf und Fuß. */
export function MenuScroll({ className, ...props }: ComponentProps<typeof DM.Group>) {
  return <DM.Group className={cn("max-h-[min(320px,calc(var(--radix-dropdown-menu-content-available-height,400px)_-_80px))] overflow-y-auto [scrollbar-gutter:stable]", className)} {...props} />;
}

/** Leiser Hinweis im Menü (kein Eintrag, nicht per Pfeiltaste erreichbar), z. B. „Noch keine Instanz.“ */
export function MenuNote({ className, ...props }: ComponentProps<typeof DM.Label>) {
  return <DM.Label className={cn("lk-mnote px-3 py-1.5 text-ctl-s", className)} {...props} />;
}

/** Trenner und Gruppentitel sind kontextfrei und gelten in beiden Menüarten. */
export function MenuSep({ className, ...props }: ComponentProps<typeof DM.Separator>) {
  return <DM.Separator className={cn(SEP, className)} {...props} />;
}

export function MenuLabel({ className, ...props }: ComponentProps<typeof DM.Label>) {
  return <DM.Label className={cn(LABEL, className)} {...props} />;
}

/** Kopfzeile eines Menüs (Item-Tooltip-Titel): Bild/Symbol `lead`, Name, Zusatz; kein Eintrag, z. B. Konto im Kontomenü. */
export function MenuHead({ lead, title, sub, className }: { lead?: ReactNode; title: ReactNode; sub?: ReactNode; className?: string }) {
  return (
    <DM.Label className={cn("flex items-center gap-3 px-3 py-2", className)}>
      {lead}
      <span className="grid min-w-0 gap-0.5">
        <b className="lk-mhead-n text-ctl-l leading-[1.2]">{title}</b>
        {sub && <small className="lk-mhead-s text-ctl-s">{sub}</small>}
      </span>
    </DM.Label>
  );
}
