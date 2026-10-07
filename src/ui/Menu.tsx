/**
 * Menüs des Kits: Dropdown und Kontextmenü mit gleichen Einträgen, freie Menübausteine.
 * Verhalten aus Radix; Aussehen: ui/overlay.css (vx-pop, vx-mi). Innerhalb gilt der hellere Hover-Kontext (data-ctx="overlay", tokens.css).
 */
import { useRef, useState, type ComponentProps, type FocusEvent, type ReactNode } from "react";
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
type MenuKit = typeof DM | typeof CM;

function entries(list: MenuEntry[], kit: MenuKit): ReactNode[] {
  return list.map((e, i) => {
    if (e === "-") return <MenuSep key={`s${i}`} />;
    if ("label" in e) return <MenuLabel key={`l${i}`}>{e.label}</MenuLabel>;
    if ("items" in e) return subMenu(e, kit);
    return (
      <KitItem key={e.id} kit={kit} icon={e.icon} bad={e.bad} lead={e.lead} sub={e.sub} checked={e.checked} disabled={e.disabled} onSelect={e.onSelect}>
        {hasContent(e.sub) ? e.text : <span className="vx-trunc">{e.text}</span>}
      </KitItem>
    );
  });
}

function subMenu(e: Extract<MenuEntry, { items: MenuEntry[] }>, M: MenuKit) {
  return (
    <M.Sub key={e.id}>
      <M.SubTrigger className="vx-mi" disabled={e.disabled}>
        {e.icon && <Icon name={e.icon} size="s" />}
        <span className="vx-trunc">{e.text}</span>
        <Icon name="chev" size="s" className="vx-mi-sub" />
      </M.SubTrigger>
      <M.Portal>
        <M.SubContent className="vx-pop" data-ctx="overlay" sideOffset={4} collisionPadding={8} onContextMenu={(event) => { event.preventDefault(); event.stopPropagation(); }}>
          {entries(e.items, M)}
        </M.SubContent>
      </M.Portal>
    </M.Sub>
  );
}

type ItemLook = {
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
function KitItem({ kit: M, className, tall, bad, lead, icon, sub, checked, children, ...props }: ItemLook & { kit: MenuKit } & ComponentProps<typeof DM.Item>) {
  const two = hasContent(sub);
  return (
    <M.Item
      className={cn("vx-mi", className)}
      data-tall={flag(tall || two || lead)}
      data-tone={bad ? "bad" : undefined}
      {...(checked !== undefined && { role: "menuitemcheckbox", "aria-checked": checked })}
      {...props}
    >
      {lead ?? (icon && <Icon name={icon} size="s" />)}
      {two ? <span className="vx-mi-t2"><b className="vx-trunc">{children}</b><span className="vx-trunc">{sub}</span></span> : children}
      {checked && <Icon name="check" size="s" className="vx-mi-ck" />}
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

/** Dropdown-Menü an einem Auslöser. Einträge über `items` oder frei als `children` (MenuItem, MenuSep, MenuLabel). */
export function Menu({ trigger, items, align = "end", width, className, open, onOpenChange, children }: {
  trigger: ReactNode; items?: MenuEntry[]; align?: "start" | "end";
  /** Feste Breite in px (sonst nach Inhalt, mindestens 220). */
  width?: number;
  className?: string; open?: boolean; onOpenChange?: (o: boolean) => void; children?: ReactNode;
}) {
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
        <DM.Content className={cn("vx-pop", className)} data-ctx="overlay" style={width ? { width } : undefined} align={align} sideOffset={6} collisionPadding={8} onFocus={keepFocusWhenClosed}>
          {items && entries(items, DM)}
          {children}
        </DM.Content>
      </DM.Portal>
    </DM.Root>
  );
}

/** Kontextmenü (Rechtsklick) mit denselben Einträgen. */
export function ContextMenu({ items, children, includePortals = false }: { items: MenuEntry[]; children: ReactNode; includePortals?: boolean }) {
  const [textContext, setTextContext] = useState<TextContext>();
  const originRef = useRef<HTMLElement | null>(null);
  const interactedOutsideRef = useRef(false);
  const portalTargetRef = useRef<Element | null>(null);

  function dispatchPortalMenu(root: HTMLElement, target: Element, x: number, y: number) {
    portalTargetRef.current = target;
    try {
      root.dispatchEvent(new MouseEvent("contextmenu", {
        bubbles: true, cancelable: true, clientX: x, clientY: y,
      }));
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
          e.preventDefault();
          e.stopPropagation();
          dispatchPortalMenu(e.currentTarget as HTMLElement, e.target as Element, e.clientX, e.clientY);
        }}
        onKeyDownCapture={(e) => {
          if (e.defaultPrevented || !(e.key === "ContextMenu" || (e.shiftKey && e.key === "F10"))) return;
          if (!isForeignPortal(e.currentTarget as HTMLElement, e.target)) return;
          e.preventDefault();
          e.stopPropagation();
          const target = e.target as Element;
          const rect = target.getBoundingClientRect();
          dispatchPortalMenu(e.currentTarget as HTMLElement, target, rect.left, rect.bottom);
        }}
        onContextMenu={(e) => {
          if (e.defaultPrevented) return;
          const root = e.currentTarget as HTMLElement;
          if (!(e.target instanceof Element)) return;
          if ((!includePortals && !root.contains(e.target)) || e.target.closest('[role="menu"]')) {
            e.preventDefault();
            e.stopPropagation();
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
          if (e.defaultPrevented || !(e.key === "ContextMenu" || (e.shiftKey && e.key === "F10"))) return;
          const root = e.currentTarget as HTMLElement;
          if (!(e.target instanceof Element) || (!includePortals && !root.contains(e.target))) return;
          const rect = e.target.getBoundingClientRect();
          e.target.dispatchEvent(new MouseEvent("contextmenu", {
            bubbles: true, cancelable: true, clientX: rect.left, clientY: rect.bottom,
          }));
          e.preventDefault();
          e.stopPropagation();
        }}
      >
        {children}
      </CM.Trigger>
      <CM.Portal>
        <CM.Content
          className="vx-pop"
          data-ctx="overlay"
          collisionPadding={8}
          onFocus={keepFocusWhenClosed}
          onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); }}
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
          {entries(textContext ? textMenuEntries(textContext) : items, CM)}
        </CM.Content>
      </CM.Portal>
    </CM.Root>
  );
}

/**
 * Freier Menüeintrag (als Kind von Menu): `tall` = 52 px (zwei Zeilen/Vorschaubild), `bad` = Gefahr.
 * Mit `sub` wie ein Eintrag aus `items`: `children` fett, `sub` als zweite Zeile, `lead` (Bild) davor, 52 px.
 */
export function MenuItem(props: ItemLook & ComponentProps<typeof DM.Item>) {
  return <KitItem kit={DM} {...props} />;
}
/** Scrollbereich für lange Eintragslisten; Kopf (MenuLabel) und Fuß des Menüs bleiben stehen. */
export function MenuScroll({ className, ...props }: ComponentProps<typeof DM.Group>) {
  return <DM.Group className={cn("vx-mscroll", className)} {...props} />;
}
/** Leiser Hinweis im Menü (kein Eintrag, nicht per Pfeiltaste erreichbar), z. B. „Noch keine Instanz.“ */
export function MenuNote({ className, ...props }: ComponentProps<typeof DM.Label>) {
  return <DM.Label className={cn("vx-mnote", className)} {...props} />;
}
/** Trenner und Gruppentitel sind kontextfrei und gelten in beiden Menüarten. */
export function MenuSep({ className, ...props }: ComponentProps<typeof DM.Separator>) {
  return <DM.Separator className={cn("vx-msep", className)} {...props} />;
}
export function MenuLabel({ className, ...props }: ComponentProps<typeof DM.Label>) {
  return <DM.Label className={cn("vx-mlabel", className)} {...props} />;
}
