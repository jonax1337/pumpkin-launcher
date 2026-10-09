/**
 * Menü-Mechanik für Dropdown und Kontextmenü mit gleichen Einträgen (Menu.tsx): Radix, Fokus-Rückgabe, Textmenü, Menü-Herkunft.
 * Fläche und Einträge zeichnet die `MenuSkin`, die Menu.tsx übergibt (look/overlay.css, lk-*).
 */
import { useRef, useState, type ComponentProps, type FocusEvent, type KeyboardEvent, type ReactNode, type SyntheticEvent } from "react";
import { ContextMenu as CM, DropdownMenu as DM } from "radix-ui";
import { cn } from "@/lib/utils";
import { Icon } from "./Icon";
import { markMenuClosed, rememberMenuOrigin } from "./menuOrigin";
import { FOCUSABLE, flag, hasContent } from "./util";
import { captureTextContext, restoreTextContext, textMenuEntries, type TextContext } from "./textMenu";
import type { IconName } from "./types";

/**
 * "-" = Trenner, { label } = Gruppentitel, { items } = Untermenü, sonst Eintrag
 * (Icon s; `lead` ersetzt das Icon, z. B. Avatar; `sub` = zweite Zeile, Eintrag 52 px).
 */
export type MenuEntry =
  | "-"
  | { label: string }
  | { id: string; text: ReactNode; icon?: IconName; disabled?: boolean; items: MenuEntry[] }
  | { id: string; text: ReactNode; icon?: IconName; bad?: boolean; disabled?: boolean; onSelect: () => void; sub?: ReactNode; lead?: ReactNode; checked?: boolean };

/** Dropdown- und Kontextmenü von Radix haben dieselben Bausteine. */
export type MenuKit = typeof DM | typeof CM;

/** Klassen, mit denen das Kit Fläche und Einträge zeichnet (Menu.tsx). */
export type MenuSkin = {
  /** Fläche von Menü und Untermenü. */
  pop: string;
  /** Text mit Auslassung „…“. */
  trunc: string;
  /** Eintrag und Untermenü-Auslöser; `tall` kommt bei zwei Zeilen oder Bild dazu. */
  item: string;
  tall: string;
  /** Zweizeiliger Text, Häkchen am Ende, Pfeil des Untermenüs. */
  t2: string;
  ck: string;
  sub: string;
  /** Trenner und Gruppentitel. */
  sep: string;
  label: string;
};
function entries(list: MenuEntry[], kit: MenuKit, skin: MenuSkin): ReactNode[] {
  return list.map((e, i) => {
    if (e === "-") return <DM.Separator key={`s${i}`} className={skin.sep} />;
    if ("label" in e) return <DM.Label key={`l${i}`} className={skin.label}>{e.label}</DM.Label>;
    if ("items" in e) return subMenu(e, kit, skin);
    return (
      <KitItem key={e.id} kit={kit} skin={skin} icon={e.icon} bad={e.bad} lead={e.lead} sub={e.sub} checked={e.checked} disabled={e.disabled} onSelect={e.onSelect}>
        {hasContent(e.sub) ? e.text : <span className={skin.trunc}>{e.text}</span>}
      </KitItem>
    );
  });
}

function subMenu(e: Extract<MenuEntry, { items: MenuEntry[] }>, M: MenuKit, skin: MenuSkin) {
  return (
    <M.Sub key={e.id}>
      <M.SubTrigger className={skin.item} disabled={e.disabled}>
        {e.icon && <Icon name={e.icon} size="s" />}
        <span className={skin.trunc}>{e.text}</span>
        <Icon name="chev-right" size="s" className={skin.sub} />
      </M.SubTrigger>
      <M.Portal>
        <M.SubContent className={skin.pop} data-ctx="overlay" sideOffset={4} collisionPadding={8} onContextMenu={suppressContextMenu}>
          {entries(e.items, M, skin)}
        </M.SubContent>
      </M.Portal>
    </M.Sub>
  );
}

export type ItemLook = {
  /** 52 px (zwei Zeilen/Vorschaubild); mit `sub` oder `lead` automatisch. */
  tall?: boolean;
  bad?: boolean;
  /** Bild vor dem Text, ersetzt `icon`. */
  lead?: ReactNode;
  icon?: IconName;
  /** Zweite Zeile; `children` steht dann fett darüber. */
  sub?: ReactNode;
  checked?: boolean;
};

/** Ein Eintrag für beide Menüarten: Radix-Item mit Look; ohne `sub` steht `children` unverändert da. */
export function KitItem({ kit: M, skin, className, tall, bad, lead, icon, sub, checked, children, ...props }: ItemLook & { kit: MenuKit; skin: MenuSkin } & ComponentProps<typeof DM.Item>) {
  const two = hasContent(sub);
  const isTall = !!(tall || two || lead);
  return (
    <M.Item
      className={cn(skin.item, isTall && skin.tall, className)}
      data-tall={flag(isTall)}
      data-tone={bad ? "bad" : undefined}
      {...(checked !== undefined && { role: "menuitemcheckbox", "aria-checked": checked })}
      {...props}
    >
      {lead ?? (icon && <Icon name={icon} size="s" />)}
      {two ? <span className={skin.t2}><b className={skin.trunc}>{children}</b><span className={skin.trunc}>{sub}</span></span> : children}
      {checked && <Icon name="check" size="s" className={skin.ck} />}
    </M.Item>
  );
}

/**
 * Radix fokussiert die Menüfläche, wenn der Zeiger einen Eintrag verlässt – auch noch während der Ausblend-Animation,
 * wenn der Eintrag gerade einen Dialog geöffnet hat (dessen Scrim schiebt sich unter den Zeiger). Dann geht der Fokus
 * mit der Fläche verloren. Ein geschlossenes Menü gibt den Fokus deshalb sofort zurück.
 */
function keepFocusWhenClosed(e: FocusEvent<HTMLDivElement>) {
  if (e.target !== e.currentTarget || e.currentTarget.dataset.state !== "closed") return;
  const prev = e.relatedTarget;
  if (prev instanceof HTMLElement && prev.isConnected) prev.focus({ preventScroll: true });
}

function suppressContextMenu(event: SyntheticEvent) {
  event.preventDefault();
  event.stopPropagation();
}

function isContextMenuKey(event: KeyboardEvent<HTMLElement>) {
  return event.key === "ContextMenu" || (event.shiftKey && event.key === "F10");
}

function dispatchContextMenu(target: Element, x: number, y: number) {
  target.dispatchEvent(new MouseEvent("contextmenu", {
    bubbles: true, cancelable: true, clientX: x, clientY: y,
  }));
}

export type MenuProps = {
  trigger: ReactNode; items?: MenuEntry[]; align?: "start" | "end";
  /** Feste Breite 320 (Kontomenü, Auswahl mit Zweitzeile), sonst nach Inhalt, mindestens 240. */
  wide?: boolean;
  className?: string; open?: boolean; onOpenChange?: (o: boolean) => void; children?: ReactNode;
};

/** Dropdown-Menü an einem Auslöser, gezeichnet mit `skin`. Einträge über `items` oder frei als `children` (MenuItem, MenuSep, MenuLabel). */
export function MenuBase({ skin, trigger, items, align = "end", wide, className, open, onOpenChange, children }: MenuProps & { skin: MenuSkin }) {
  const ref = useRef<HTMLButtonElement>(null);
  return (
    <DM.Root
      open={open}
      onOpenChange={(o) => {
        if (o) rememberMenuOrigin(ref.current ?? (document.activeElement as HTMLElement | null));
        else markMenuClosed();
        onOpenChange?.(o);
      }}
      modal={false}
    >
      <DM.Trigger asChild ref={ref}>{trigger}</DM.Trigger>
      <DM.Portal>
        <DM.Content className={cn(skin.pop, className)} data-ctx="overlay" data-wide={flag(wide)} align={align} sideOffset={6} collisionPadding={8} onFocus={keepFocusWhenClosed}>
          {items && entries(items, DM, skin)}
          {children}
        </DM.Content>
      </DM.Portal>
    </DM.Root>
  );
}

/** Kontextmenü (Rechtsklick) mit denselben Einträgen, gezeichnet mit `skin`. */
export function ContextMenuBase({ skin, items, children, includePortals = false }: { skin: MenuSkin; items: MenuEntry[]; children: ReactNode; includePortals?: boolean }) {
  const [textContext, setTextContext] = useState<TextContext>();
  const originRef = useRef<HTMLElement | null>(null);
  const interactedOutsideRef = useRef(false);
  const portalTargetRef = useRef<Element | null>(null);

  function dispatchPortalMenu(root: HTMLElement, target: Element, x: number, y: number) {
    portalTargetRef.current = target;
    try {
      dispatchContextMenu(root, x, y);
    } finally {
      portalTargetRef.current = null;
    }
  }

  function isForeignPortal(root: HTMLElement, target: EventTarget) {
    return includePortals && target instanceof Element && !root.contains(target)
      && !target.closest('[data-context-menu-trigger], [role="menu"]');
  }

  function recordTarget(root: HTMLElement, target: Element) {
    const context = captureTextContext(target);
    setTextContext(context);
    const hit = target.closest<HTMLElement>(FOCUSABLE);
    const origin = hit && (includePortals || root.contains(hit)) ? hit
      : root.matches(FOCUSABLE) ? root : root.querySelector<HTMLElement>(FOCUSABLE);
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    originRef.current = context ? context.field ?? (context.editable ? context.target : previousFocus) : origin;
    rememberMenuOrigin(originRef.current);
    interactedOutsideRef.current = false;
  }

  return (
    <CM.Root modal={false} onOpenChange={(o) => !o && markMenuClosed()}>
      <CM.Trigger
        asChild
        data-context-menu-trigger=""
        onContextMenuCapture={(e) => {
          if (e.defaultPrevented || !isForeignPortal(e.currentTarget as HTMLElement, e.target)) return;
          suppressContextMenu(e);
          dispatchPortalMenu(e.currentTarget as HTMLElement, e.target as Element, e.clientX, e.clientY);
        }}
        onKeyDownCapture={(e) => {
          if (e.defaultPrevented || !isContextMenuKey(e)) return;
          if (!isForeignPortal(e.currentTarget as HTMLElement, e.target)) return;
          suppressContextMenu(e);
          const target = e.target as Element;
          const rect = target.getBoundingClientRect();
          dispatchPortalMenu(e.currentTarget as HTMLElement, target, rect.left, rect.bottom);
        }}
        onContextMenu={(e) => {
          if (e.defaultPrevented) return;
          const root = e.currentTarget as HTMLElement;
          if (!(e.target instanceof Element)) return;
          if ((!includePortals && !root.contains(e.target)) || e.target.closest('[role="menu"]')) {
            suppressContextMenu(e);
            return;
          }
          recordTarget(root, portalTargetRef.current ?? e.target);
          e.stopPropagation();
        }}
        onPointerDown={(e) => {
          if (e.defaultPrevented || e.pointerType === "mouse") return;
          const root = e.currentTarget as HTMLElement;
          if (!(e.target instanceof Element) || (!includePortals && !root.contains(e.target))) return;
          recordTarget(root, e.target);
          e.stopPropagation();
        }}
        onKeyDown={(e) => {
          if (e.defaultPrevented || !isContextMenuKey(e)) return;
          const root = e.currentTarget as HTMLElement;
          if (!(e.target instanceof Element) || (!includePortals && !root.contains(e.target))) return;
          const rect = e.target.getBoundingClientRect();
          dispatchContextMenu(e.target, rect.left, rect.bottom);
          suppressContextMenu(e);
        }}
      >
        {children}
      </CM.Trigger>
      <CM.Portal>
        <CM.Content
          className={skin.pop}
          data-ctx="overlay"
          collisionPadding={8}
          onFocus={keepFocusWhenClosed}
          onContextMenu={suppressContextMenu}
          onInteractOutside={() => { interactedOutsideRef.current = true; }}
          onCloseAutoFocus={(e) => {
            if (interactedOutsideRef.current) return;
            e.preventDefault();
            const active = document.activeElement;
            if (active instanceof HTMLElement && active !== document.body && !active.closest('[role="menu"]')) return;
            originRef.current?.isConnected && originRef.current.focus({ preventScroll: true });
            if (textContext) restoreTextContext(textContext);
          }}
        >
          {entries(textContext ? textMenuEntries(textContext) : items, CM, skin)}
        </CM.Content>
      </CM.Portal>
    </CM.Root>
  );
}
