/**
 * Überlagerungen des Kits: Tooltip, abgeschnittener Text, Menü, Kontextmenü, Popover, Dialog, Rückfrage, Seitenpanel.
 * Verhalten aus Radix; Fokus-Rückgabe, Menü-Auslöser, Akzent-Weitergabe und Autofokus-Priorität wie im alten Pixel-Bestand.
 * Aussehen: ui/overlay.css (vx-*). Innerhalb von Overlays gilt der hellere Hover-Kontext (data-ctx="overlay", tokens.css).
 */
import { cloneElement, isValidElement, useEffect, useId, useLayoutEffect, useRef, useState, type ComponentProps, type CSSProperties, type FocusEvent, type KeyboardEvent, type ReactNode } from "react";
import { ContextMenu as CM, Dialog as D, DropdownMenu as DM, Popover as P, Tooltip as T } from "radix-ui";
import { cn } from "@/lib/utils";
import { Icon } from "./Icon";
import { Button, IconButton } from "./Button";
import type { IconName } from "./types";

// ---------- Tooltip ----------

/**
 * Item-Tooltip (dunkel, Verlaufsrahmen), 450 ms Verzögerung.
 * `describe`: Der Text trägt Information (nicht nur die Beschriftung wiederholt) → zusätzlich als verstecktes
 * `.sr`-Span direkt hinter dem Auslöser und per aria-describedby. Für Tastatur und Screenreader auch auf
 * nicht fokussierbaren Auslösern (Chip, Statuszeile), die den Tooltip sonst nur mit der Maus zeigen.
 */
export function Tip({ label, children, side = "bottom", show = true, describe }: { label: ReactNode; children: ReactNode; side?: "top" | "bottom" | "left" | "right"; show?: boolean; describe?: boolean }) {
  const id = useId();
  if (!show || label == null || label === "") return <>{children}</>;
  // Eigene Props des Kinds schlagen die des Triggers (Slot), deshalb die Beschreibung direkt ans Kind.
  const trigger = describe && isValidElement<{ "aria-describedby"?: string }>(children)
    ? cloneElement(children, { "aria-describedby": cn(children.props["aria-describedby"], id) })
    : children;
  return (
    <>
      <T.Root delayDuration={450}>
        <T.Trigger asChild>{trigger}</T.Trigger>
        <T.Portal>
          <T.Content className="vx-tip" side={side} sideOffset={8} collisionPadding={8}>
            {label}
          </T.Content>
        </T.Portal>
      </T.Root>
      {describe && <span id={id} className="sr">{label}</span>}
    </>
  );
}

export const TipProvider = T.Provider;

type TruncTag = "span" | "b" | "strong" | "p" | "div" | "h1" | "h2" | "h3";

/**
 * Text mit Auslassung („…“), der bei Überlauf den vollen Text als Tooltip zeigt: bei Hover über den Wirt
 * (450 ms) und sofort bei Tastaturfokus des Wirts. Ohne Überlauf kein Tooltip.
 * Wirt: `host` (Selektor, gesucht im nächsten Vorfahren, der ihn enthält, z. B. ".hit" im Poster), sonst der nächste
 * fokussierbare Vorfahr (Link in der Listenzeile), sonst das Elternelement.
 * Der Screenreader-Name gehört an den Wirt (aria-label/Linktext); der Tooltip ist nur die sichtbare Ergänzung.
 * Beispiele: `<Trunc as="b" text={name} host=".hit" />` · `<Link …><Trunc text={name} /></Link>`
 */
export function Trunc({ text, as: Tag = "span", host, side = "top", className, style }: { text: string; as?: TruncTag; host?: string; side?: "top" | "bottom"; className?: string; style?: CSSProperties }) {
  const ref = useRef<HTMLElement>(null);
  const [over, setOver] = useState(false);
  const [open, setOpen] = useState(false);

  // Überlauf messen (Größe und Text ändern sich)
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => setOver(el.scrollWidth > el.clientWidth + 1 || el.scrollHeight > el.clientHeight + 1);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [text]);

  useEffect(() => {
    const el = ref.current;
    if (!el || !over) return setOpen(false);
    let w: Element | null = null;
    if (host) for (let p = el.parentElement; p && !w; p = p.parentElement) w = p.matches(host) ? p : p.querySelector(host);
    const hostEl = (w ?? el.parentElement?.closest(FOCUSABLE) ?? el.parentElement) as HTMLElement | null;
    if (!hostEl) return;
    let t = 0;
    const show = () => void (t = window.setTimeout(() => setOpen(true), 450));
    const hide = () => {
      clearTimeout(t);
      setOpen(false);
    };
    const onFocus = () => hostEl.matches(":focus-visible") && (clearTimeout(t), setOpen(true));
    const onKey = (e: globalThis.KeyboardEvent) => e.key === "Escape" && hide();
    hostEl.addEventListener("pointerenter", show);
    hostEl.addEventListener("pointerleave", hide);
    hostEl.addEventListener("pointerdown", hide);
    hostEl.addEventListener("focusin", onFocus);
    hostEl.addEventListener("focusout", hide);
    hostEl.addEventListener("keydown", onKey);
    hostEl.addEventListener("wheel", hide, { passive: true });
    return () => {
      hide();
      hostEl.removeEventListener("pointerenter", show);
      hostEl.removeEventListener("pointerleave", hide);
      hostEl.removeEventListener("pointerdown", hide);
      hostEl.removeEventListener("focusin", onFocus);
      hostEl.removeEventListener("focusout", hide);
      hostEl.removeEventListener("keydown", onKey);
      hostEl.removeEventListener("wheel", hide);
    };
  }, [over, host]);

  const El = Tag as "span";
  return (
    <T.Root open={open} onOpenChange={(o) => !o && setOpen(false)}>
      {/* Der Text selbst ist nur Anker: kein eigener Hover/Fokus, das regelt der Wirt */}
      <T.Trigger asChild onPointerMove={(e) => e.preventDefault()} onPointerLeave={(e) => e.preventDefault()} onFocus={(e) => e.preventDefault()}>
        <El ref={ref as never} className={cn("vx-trunc", className)} style={style}>{text}</El>
      </T.Trigger>
      <T.Portal>
        <T.Content className="vx-tip" data-pass="" side={side} sideOffset={8} collisionPadding={8} aria-hidden>
          {text}
        </T.Content>
      </T.Portal>
    </T.Root>
  );
}

// ---------- Menüs (Dropdown und Kontextmenü mit gleichen Einträgen) ----------

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

function entries(list: MenuEntry[], M: MenuKit): ReactNode[] {
  return list.map((e, i) => {
    if (e === "-") return <M.Separator key={`s${i}`} className="vx-msep" />;
    if ("label" in e) return <M.Label key={`l${i}`} className="vx-mlabel">{e.label}</M.Label>;
    if ("items" in e)
      return (
        <M.Sub key={e.id}>
          <M.SubTrigger className="vx-mi" disabled={e.disabled}>
            {e.icon && <Icon name={e.icon} size="s" />}
            <span className="vx-trunc">{e.text}</span>
            <Icon name="chev" size="s" className="vx-mi-sub" />
          </M.SubTrigger>
          <M.Portal>
            <M.SubContent className="vx-pop" data-ctx="overlay" sideOffset={4} collisionPadding={8}>
              {entries(e.items, M)}
            </M.SubContent>
          </M.Portal>
        </M.Sub>
      );
    const tall = !!(e.sub || e.lead);
    return (
      <M.Item
        key={e.id}
        className="vx-mi"
        data-tone={e.bad ? "bad" : undefined}
        data-tall={tall ? "" : undefined}
        disabled={e.disabled}
        onSelect={e.onSelect}
      >
        {e.lead ?? (e.icon ? <Icon name={e.icon} size="s" /> : null)}
        {e.sub ? (
          <span className="vx-mi-t2"><b className="vx-trunc">{e.text}</b><span className="vx-trunc">{e.sub}</span></span>
        ) : (
          <span className="vx-trunc">{e.text}</span>
        )}
        {e.checked && <Icon name="check" size="s" className="vx-mi-ck" />}
      </M.Item>
    );
  });
}

/**
 * Auslöser des zuletzt geöffneten Menüs. Öffnet ein Eintrag einen Dialog, ist der Eintrag beim Öffnen schon
 * aus dem DOM; der Dialog gibt den Fokus dann hierhin zurück (siehe useReturnFocus).
 */
const menuOrigin = { el: null as HTMLElement | null, open: false, closedAt: 0 };
const FOCUSABLE = "a[href], button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex='-1'])";

function menuOpened(el: HTMLElement | null) {
  menuOrigin.el = el;
  menuOrigin.open = true;
}
function menuClosed() {
  menuOrigin.open = false;
  menuOrigin.closedAt = performance.now();
}
/** Auslöser, solange das Menü offen ist oder gerade erst (durch die Auswahl) geschlossen wurde. */
function recentMenuOrigin() {
  const { el, open, closedAt } = menuOrigin;
  return el?.isConnected && (open || performance.now() - closedAt < 1000) ? el : null;
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
        if (o) menuOpened(ref.current ?? (document.activeElement as HTMLElement | null));
        else menuClosed();
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
export function ContextMenu({ items, children }: { items: MenuEntry[]; children: ReactNode }) {
  return (
    <CM.Root modal={false} onOpenChange={(o) => !o && menuClosed()}>
      <CM.Trigger
        asChild
        onContextMenu={(e) => {
          // Zurück zum angeklickten Bedienelement, sonst zum ersten im Auslöser (Poster: der Link)
          const root = e.currentTarget as HTMLElement;
          const hit = (e.target as Element).closest?.<HTMLElement>(FOCUSABLE);
          menuOpened(hit && root.contains(hit) ? hit : root.matches(FOCUSABLE) ? root : root.querySelector<HTMLElement>(FOCUSABLE));
        }}
      >
        {children}
      </CM.Trigger>
      <CM.Portal>
        <CM.Content className="vx-pop" data-ctx="overlay" collisionPadding={8} onFocus={keepFocusWhenClosed}>
          {entries(items, CM)}
        </CM.Content>
      </CM.Portal>
    </CM.Root>
  );
}

/**
 * Freier Menüeintrag (als Kind von Menu): `tall` = 52 px (zwei Zeilen/Vorschaubild), `bad` = Gefahr.
 * Mit `sub` wie ein Eintrag aus `items`: `children` fett, `sub` als zweite Zeile, `lead` (Bild) davor, 52 px.
 */
export function MenuItem({ className, tall, bad, lead, sub, children, ...props }: { tall?: boolean; bad?: boolean; lead?: ReactNode; sub?: ReactNode } & ComponentProps<typeof DM.Item>) {
  const two = sub != null && sub !== "";
  return (
    <DM.Item className={cn("vx-mi", className)} data-tall={tall || two || lead ? "" : undefined} data-tone={bad ? "bad" : undefined} {...props}>
      {lead}
      {two ? <span className="vx-mi-t2"><b className="vx-trunc">{children}</b><span className="vx-trunc">{sub}</span></span> : children}
    </DM.Item>
  );
}
/** Scrollbereich für lange Eintragslisten; Kopf (MenuLabel) und Fuß des Menüs bleiben stehen. */
export function MenuScroll({ className, ...props }: ComponentProps<typeof DM.Group>) {
  return <DM.Group className={cn("vx-mscroll", className)} {...props} />;
}
/** Leiser Hinweis im Menü (kein Eintrag, nicht per Pfeiltaste erreichbar), z. B. „Noch keine Instanz.“ */
export function MenuNote({ className, ...props }: ComponentProps<typeof DM.Label>) {
  return <DM.Label className={cn("vx-mnote", className)} {...props} />;
}
export function MenuSep({ className, ...props }: ComponentProps<typeof DM.Separator>) {
  return <DM.Separator className={cn("vx-msep", className)} {...props} />;
}
export function MenuLabel({ className, ...props }: ComponentProps<typeof DM.Label>) {
  return <DM.Label className={cn("vx-mlabel", className)} {...props} />;
}

// ---------- Popover ----------

/**
 * Freie Platte an einem Auslöser (z. B. Aufgaben in der Fensterleiste): nicht modal, Esc/Klick daneben schließt,
 * Fokus geht an den Auslöser zurück. `label` ist der zugängliche Name der Fläche, `tip` optional der Tooltip des Auslösers.
 */
export function Popover({ trigger, label, width = 400, align = "end", side = "bottom", tip, open, onOpenChange, className, children }: {
  trigger: ReactNode; label: string; width?: number; align?: "start" | "center" | "end"; side?: "bottom" | "right"; tip?: string;
  open?: boolean; onOpenChange?: (o: boolean) => void; className?: string; children: ReactNode;
}) {
  const t = <P.Trigger asChild>{trigger}</P.Trigger>;
  return (
    <P.Root open={open} onOpenChange={onOpenChange}>
      {tip ? <Tip label={tip} side={side}>{t}</Tip> : t}
      <P.Portal>
        <P.Content className={cn("vx-pop", className)} data-ctx="overlay" data-pad="l" style={{ width }} side={side} align={align} sideOffset={side === "right" ? 14 : 6} collisionPadding={8} aria-label={label}>
          {children}
        </P.Content>
      </P.Portal>
    </P.Root>
  );
}

// ---------- Dialog und Seitenpanel ----------

/**
 * Fokus zurück an den Auslöser. Dialoge öffnen meist kontrolliert ohne D.Trigger; Radix fiele dann auf body zurück.
 * `remember` beim Öffnen (Fokus liegt noch am Auslöser), `restore` in onCloseAutoFocus.
 * Kommt der Dialog aus einem Menüeintrag, zählt der Auslöser des Menüs.
 */
function useReturnFocus(open?: boolean) {
  const back = useRef<HTMLElement | null>(null);
  const [acc, setAcc] = useState<string>();
  const pick = () => {
    const a = document.activeElement;
    back.current = a instanceof HTMLElement && a !== document.body && !a.closest("[role=menu]") ? a : recentMenuOrigin();
    setAcc(accentOf(back.current));
  };
  // Kontrolliert geöffnet: schon beim Öffnen merken, bevor der Inhalt (Portal, eine Runde später) per autoFocus
  // ein Feld fokussiert. onOpenAutoFocus käme dafür zu spät.
  useLayoutEffect(() => {
    if (open) pick();
  }, [open]);
  return {
    /** Instanz-Akzent des Auslösers (das Portal erbt --acc nicht); undefined = Kupfer von :root. */
    acc,
    /** Für unkontrollierte Dialoge (D.Trigger); kontrollierte merken im Effekt oben. */
    remember() {
      if (open === undefined) pick();
    },
    restore(e: Event) {
      e.preventDefault();
      const root = e.currentTarget as HTMLElement | null;
      const a = document.activeElement;
      // Hat der Nutzer den Fokus schon woanders hingesetzt (nicht modales Panel), dort lassen.
      if (a && a !== document.body && !root?.contains(a)) return;
      const el = back.current?.isConnected ? back.current : document.querySelector<HTMLElement>("main");
      back.current = null;
      el?.focus({ preventScroll: true });
    },
  };
}

/**
 * --acc am Auslöser (berechnet, also auch geerbt). Ein Gefahrknopf (data-variant="danger") überschreibt
 * --acc nur für sich, dann zählt sein Umfeld. Nur wenn es vom globalen Kupfer abweicht; die Ableitungen
 * (--acc-hi/-mid/-lo) rechnet pixelkino.css über [style*="--acc:"].
 */
function accentOf(el: HTMLElement | null) {
  if (!el?.isConnected) return undefined;
  const src = el.closest(".vx-btn[data-variant='danger']")?.parentElement ?? el;
  const v = getComputedStyle(src).getPropertyValue("--acc").trim();
  return v && v !== getComputedStyle(document.documentElement).getPropertyValue("--acc").trim() ? v : undefined;
}

/**
 * Erstes Ziel nach Priorität, nicht in Dokument-Reihenfolge: markiert → Eingabe → Hauptknopf → erstes Bedienbare.
 * Hauptknopf: Kit-Primärknopf im Fuß.
 */
const AUTOFOCUS = [
  "[data-autofocus], [autofocus]",
  ".vx-dlg-b input:not([type=checkbox]):not([type=radio]):not([type=file]):not(:disabled), .vx-dlg-b textarea:not(:disabled)",
  ".vx-dlg-f .vx-btn[data-variant='primary']:not(:disabled)",
  "button:not(:disabled), [href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]",
];

function autoFocusTarget(root: HTMLElement) {
  for (const sel of AUTOFOCUS) {
    // Sichtbar, per Tab erreichbar und nicht im Kopf (das Schließen-Kreuz bekommt nie den Startfokus)
    const el = [...root.querySelectorAll<HTMLElement>(sel)].find((n) => n.tabIndex >= 0 && n.getClientRects().length > 0 && !n.closest(".vx-dlg-h"));
    if (el) return el;
  }
  return null;
}

/** Pfeiltasten in einer Reihe (Tabs): Fokus wandert, Auswahl folgt. Gibt das neue Element zurück (false = nicht verbraucht). */
function rove(e: KeyboardEvent<HTMLElement>, items: HTMLElement[], axis: "x" | "y") {
  const keys = ["Home", "End", ...(axis === "x" ? ["ArrowLeft", "ArrowRight"] : ["ArrowUp", "ArrowDown"])];
  if (!keys.includes(e.key) || e.altKey || e.ctrlKey || e.metaKey || !items.length) return false;
  const i = items.indexOf(document.activeElement as HTMLElement);
  if (i < 0) return false;
  e.preventDefault();
  const n = items.length;
  const j = e.key === "Home" ? 0 : e.key === "End" ? n - 1 : (i + (e.key === "ArrowRight" || e.key === "ArrowDown" ? 1 : -1) + n) % n;
  items[j].focus();
  return items[j] !== items[i] ? items[j] : false;
}

/** Tab-Leisten, die ihre Tastatur selbst regeln (alter Seg, Kit-Tabs). */
const OWN_ROVING = ".seg, .vx-tabs";

/**
 * Tab-Leisten im Dialog, die nicht aus Seg/Tabs stammen (z. B. „Weg“ in „Neue Instanz“): Pfeile/Pos1/Ende und ein Tab-Stopp.
 * Seg/Tabs regeln das selbst und setzen defaultPrevented. Senkrechte Leisten (aria-orientation="vertical") nutzen ↑/↓.
 */
function tablistKeys(e: KeyboardEvent<HTMLElement>) {
  if (e.defaultPrevented) return;
  const list = (e.target as HTMLElement).closest?.("[role=tablist]");
  if (!list || list.matches(OWN_ROVING)) return;
  const axis = list.getAttribute("aria-orientation") === "vertical" ? "y" : "x";
  const next = rove(e, [...list.querySelectorAll<HTMLElement>("[role=tab]:not(:disabled)")], axis);
  if (!next) return;
  next.click();
  // Ein Autofokus im neuen Tab-Inhalt (Suchfeld) darf den Fokus nicht aus der Tab-Leiste ziehen.
  requestAnimationFrame(() => next.isConnected && document.activeElement !== next && next.focus({ preventScroll: true }));
}

/** Nur der gewählte Tab ist per Tab erreichbar (React verwaltet tabIndex dort nicht). Nach Klick/Taste im nächsten Frame. */
function syncTabStops(root: Element | null) {
  requestAnimationFrame(() => root?.querySelectorAll("[role=tablist]").forEach((list) => {
    if (list.matches(OWN_ROVING)) return;
    const tabs = [...list.querySelectorAll<HTMLElement>("[role=tab]")];
    const sel = tabs.find((t) => t.getAttribute("aria-selected") === "true") ?? tabs[0];
    tabs.forEach((t) => (t.tabIndex = t === sel ? 0 : -1));
  }));
}

/**
 * Dialog mit fester Höhe (kein Nachrutschen, wenn sich der Inhalt ändert): Kopf (Titel 26 px, Schließen = IconButton m),
 * scrollender Körper, Fuß. `height` fest in px; ohne passt er sich an. Fuß: `footer` (meist <DialogActions>) und `footLeft`.
 * Startfokus: [data-autofocus] → erstes Eingabefeld im Körper → Primärknopf im Fuß → erstes Bedienbare; nie das Kreuz.
 * `busy`: die Aktion läuft und ließe sich nicht mehr aufhalten; Kreuz, Esc und Klick daneben schließen dann nicht.
 */
export function Dialog({ open, onOpenChange, trigger, title, sub, width = 560, height, footer, footLeft, children, onOpenAutoFocus, role = "dialog", describedBy, busy }: {
  open?: boolean; onOpenChange?: (o: boolean) => void; trigger?: ReactNode; title: ReactNode; sub?: ReactNode; width?: number; height?: number;
  footer?: ReactNode; footLeft?: ReactNode; children: ReactNode; onOpenAutoFocus?: (e: Event) => void;
  /** alertdialog für Rückfragen, die eine Entscheidung verlangen. */
  role?: "dialog" | "alertdialog";
  /** id des Texts, der den Dialog beschreibt (wird beim Öffnen vorgelesen). */
  describedBy?: string;
  busy?: boolean;
}) {
  const ret = useReturnFocus(open);
  return (
    <D.Root open={open} onOpenChange={(o) => !busy && onOpenChange?.(o)}>
      {trigger && <D.Trigger asChild>{trigger}</D.Trigger>}
      <D.Portal>
        <D.Overlay className="vx-scrim" />
        <D.Content
          className="vx-dlg"
          data-ctx="overlay"
          role={role}
          aria-describedby={describedBy}
          onOpenAutoFocus={(e) => {
            ret.remember();
            const root = e.currentTarget as HTMLElement;
            syncTabStops(root);
            onOpenAutoFocus?.(e);
            if (e.defaultPrevented) return;
            // Wie im Mockup: erstes Eingabefeld im Körper, sonst der Hauptknopf im Fuß – nie das Schließen-Kreuz.
            const target = autoFocusTarget(root);
            if (target) {
              e.preventDefault();
              target.focus({ preventScroll: true });
            }
          }}
          onCloseAutoFocus={ret.restore}
          onKeyDown={(e) => {
            tablistKeys(e);
            syncTabStops(e.currentTarget);
          }}
          onClick={(e) => syncTabStops(e.currentTarget)}
          style={{ ["--dw" as string]: `${width}px`, ...(ret.acc && { ["--acc" as string]: ret.acc }), height: height ? `min(${height}px, calc(100vh - 64px))` : undefined }}
        >
          <div>
            <div className="vx-dlg-h">
              <div className="vx-dlg-ht">
                <D.Title asChild><h2>{title}</h2></D.Title>
                {sub && <p className="vx-dlg-sub">{sub}</p>}
              </div>
              <D.Close asChild>
                <IconButton icon="x" label="Schließen" tip={false} disabled={busy} />
              </D.Close>
            </div>
            <div className="vx-dlg-b">{children}</div>
            {(footer || footLeft) && (
              <div className="vx-dlg-f">
                {footLeft && <span className="vx-dlg-left">{footLeft}</span>}
                {footer}
              </div>
            )}
          </div>
        </D.Content>
      </D.Portal>
    </D.Root>
  );
}

export const DialogClose = D.Close;

type ConfirmSpec = {
  label: ReactNode;
  /** Feste Breite (px), damit „Speichern“ ↔ „Einen Moment“ nichts verschiebt. */
  width?: number;
  variant?: "primary" | "danger";
  icon?: IconName;
  disabled?: boolean;
  /** id eines <form>: Knopf ist dann dessen Absenden (type=submit). */
  form?: string;
  onClick?: () => void;
};
type CancelSpec = { label: ReactNode; width?: number; autoFocus?: boolean; disabled?: boolean };
const isCancelSpec = (c: unknown): c is CancelSpec => !!c && typeof c === "object" && !isValidElement(c) && "label" in c;

/**
 * Fuß eines Dialogs: links ein Hinweis (`left`), rechts „Abbrechen“ (schließt) und die Hauptaktion.
 * `cancel` als Text oder mit `autoFocus` (Gefahr: Enter löst nichts Unumkehrbares aus).
 */
export function DialogActions({ cancel, confirm, left }: { cancel?: ReactNode | CancelSpec; confirm?: ConfirmSpec; left?: ReactNode }) {
  const c: CancelSpec | null = isCancelSpec(cancel) ? cancel : cancel != null && cancel !== false && cancel !== "" ? { label: cancel } : null;
  return (
    <>
      {left && <span className="vx-dlg-left">{left}</span>}
      {c && (
        <D.Close asChild>
          <Button width={c.width} disabled={c.disabled} data-autofocus={c.autoFocus || undefined}>{c.label}</Button>
        </D.Close>
      )}
      {confirm && (
        <Button
          variant={confirm.variant ?? "primary"}
          width={confirm.width}
          icon={confirm.icon}
          disabled={confirm.disabled}
          type={confirm.form ? "submit" : "button"}
          form={confirm.form}
          onClick={confirm.onClick}
        >
          {confirm.label}
        </Button>
      )}
    </>
  );
}

/**
 * Rückfrage vor einer Aktion, z. B. Löschen oder „Minecraft beenden?“.
 * `danger` (Standard): roter Hauptknopf, Startfokus auf „Abbrechen“ (Enter löst nichts Unumkehrbares aus), role=alertdialog.
 * Ohne `danger`: Akzentknopf mit Startfokus. `text` beschreibt den Dialog (aria-describedby).
 * Während `pending` ist alles gesperrt: die Aktion läuft schon, „Abbrechen“ hielte sie nicht mehr auf.
 */
export function ConfirmDialog({ open, onOpenChange, title, text, confirmLabel = "Löschen", cancelLabel = "Abbrechen", pendingLabel = "Einen Moment", pending, danger = true, onConfirm }: {
  open: boolean; onOpenChange: (o: boolean) => void; title: string; text?: ReactNode; confirmLabel?: string; cancelLabel?: string; pendingLabel?: string;
  pending?: boolean; danger?: boolean; onConfirm: () => void;
}) {
  const textId = useId();
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={title}
      width={460}
      role={danger ? "alertdialog" : "dialog"}
      describedBy={text ? textId : undefined}
      busy={pending}
      footer={
        <DialogActions
          cancel={{ label: cancelLabel, autoFocus: danger, disabled: pending }}
          confirm={{ label: pending ? pendingLabel : confirmLabel, variant: danger ? "danger" : "primary", width: 130, disabled: pending, onClick: onConfirm }}
        />
      }
    >
      {text && <p id={textId}>{text}</p>}
    </Dialog>
  );
}

/** Seitenpanel rechts (Katalog im Kontext einer Instanz). Nicht modal: die Liste daneben bleibt bedienbar. */
export function Sheet({ open, onOpenChange, title, sub, acc, children, tools }: { open: boolean; onOpenChange: (o: boolean) => void; title: ReactNode; sub?: ReactNode; acc?: string; children: ReactNode; tools?: ReactNode }) {
  const ret = useReturnFocus(open);
  return (
    <D.Root open={open} onOpenChange={onOpenChange} modal={false}>
      <D.Portal>
        <D.Content
          className="vx-sheet"
          data-ctx="overlay"
          aria-describedby={undefined}
          style={acc || ret.acc ? ({ "--acc": acc ?? ret.acc } as CSSProperties) : undefined}
          onInteractOutside={(e) => e.preventDefault()}
          onOpenAutoFocus={ret.remember}
          onCloseAutoFocus={ret.restore}
        >
          <div>
            <div className="vx-sheet-h">
              <div className="vx-sheet-ht">
                <D.Title asChild><h2>{title}</h2></D.Title>
                {sub && <p>{sub}</p>}
              </div>
              <D.Close asChild>
                <IconButton icon="x" label="Panel schließen" tip={false} />
              </D.Close>
            </div>
            {tools && <div className="vx-sheet-t">{tools}</div>}
            <div className="vx-sheet-b">{children}</div>
          </div>
        </D.Content>
      </D.Portal>
    </D.Root>
  );
}
