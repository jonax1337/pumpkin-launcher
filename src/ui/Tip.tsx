/**
 * Tooltips des Kits: Item-Tooltip und abgeschnittener Text mit Volltext. Verhalten aus Radix, Aussehen: ui/overlay.css (vx-tip).
 */
import { cloneElement, isValidElement, useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode, type RefObject } from "react";
import { Tooltip as T } from "radix-ui";
import { cn } from "@/lib/utils";
import { FOCUSABLE, hasContent, isOverflowing } from "./util";

/** Verzögerung, bis ein Tooltip bei Hover erscheint. */
export const TIP_DELAY_MS = 450;

/**
 * Item-Tooltip (dunkel, Verlaufsrahmen).
 * `describe`: Der Text trägt Information (nicht nur die Beschriftung wiederholt) → zusätzlich als verstecktes
 * `.sr`-Span direkt hinter dem Auslöser und per aria-describedby. Für Tastatur und Screenreader auch auf
 * nicht fokussierbaren Auslösern (Chip, Statuszeile), die den Tooltip sonst nur mit der Maus zeigen.
 */
export function Tip({ label, children, side = "bottom", describe }: { label: ReactNode; children: ReactNode; side?: "top" | "bottom" | "left" | "right"; describe?: boolean }) {
  const id = useId();
  if (!hasContent(label)) return <>{children}</>;
  // Eigene Props des Kinds schlagen die des Triggers (Slot), deshalb die Beschreibung direkt ans Kind.
  const trigger = describe && isValidElement<{ "aria-describedby"?: string }>(children)
    ? cloneElement(children, { "aria-describedby": cn(children.props["aria-describedby"], id) })
    : children;
  return (
    <>
      <T.Root delayDuration={TIP_DELAY_MS}>
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
 * (TIP_DELAY_MS) und sofort bei Tastaturfokus des Wirts. Ohne Überlauf kein Tooltip.
 * Wirt: `host` (Selektor, gesucht im nächsten Vorfahren, der ihn enthält, z. B. ".hit" im Poster), sonst der nächste
 * fokussierbare Vorfahr (Link in der Listenzeile), sonst das Elternelement.
 * Der Screenreader-Name gehört an den Wirt (aria-label/Linktext); der Tooltip ist nur die sichtbare Ergänzung.
 * Beispiele: `<Trunc as="b" text={name} host=".hit" />` · `<Link …><Trunc text={name} /></Link>`
 */
export function Trunc({ text, as: Tag = "span", host, side = "top", className, style }: { text: string; as?: TruncTag; host?: string; side?: "top" | "bottom"; className?: string; style?: CSSProperties }) {
  const ref = useRef<HTMLElement>(null);
  const overflowing = useOverflow(ref, text);
  const [open, setOpen] = useHostTooltip(ref, overflowing, host);
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

/** Überlauf messen (Größe und Text ändern sich). */
function useOverflow(ref: RefObject<HTMLElement | null>, text: string) {
  const [overflowing, setOverflowing] = useState(false);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => setOverflowing(isOverflowing(el));
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [ref, text]);
  return overflowing;
}

/** Erst `host` (im nächsten Vorfahren, der ihn enthält), sonst der nächste fokussierbare Vorfahr, sonst das Elternelement. */
function findHost(el: HTMLElement, selector?: string): HTMLElement | null {
  let found: Element | null = null;
  if (selector) for (let p = el.parentElement; p && !found; p = p.parentElement) found = p.matches(selector) ? p : p.querySelector(selector);
  return (found ?? el.parentElement?.closest(FOCUSABLE) ?? el.parentElement) as HTMLElement | null;
}

/** Steuert den Tooltip des überlaufenden Texts über Hover und Fokus seines Wirts statt über den Text selbst. */
function useHostTooltip(ref: RefObject<HTMLElement | null>, overflowing: boolean, hostSelector?: string) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el || !overflowing) return setOpen(false);
    const host = findHost(el, hostSelector);
    if (!host) return;
    let timer = 0;
    const showSoon = () => void (timer = window.setTimeout(() => setOpen(true), TIP_DELAY_MS));
    const hide = () => {
      clearTimeout(timer);
      setOpen(false);
    };
    const showOnKeyboardFocus = () => host.matches(":focus-visible") && (clearTimeout(timer), setOpen(true));
    const hideOnEscape = (e: Event) => (e as KeyboardEvent).key === "Escape" && hide();
    const listeners: [string, EventListener, AddEventListenerOptions?][] = [
      ["pointerenter", showSoon],
      ["pointerleave", hide],
      ["pointerdown", hide],
      ["focusin", showOnKeyboardFocus],
      ["focusout", hide],
      ["keydown", hideOnEscape],
      ["wheel", hide, { passive: true }],
    ];
    for (const [type, handler, options] of listeners) host.addEventListener(type, handler, options);
    return () => {
      hide();
      for (const [type, handler] of listeners) host.removeEventListener(type, handler);
    };
  }, [ref, overflowing, hostSelector]);
  return [open, setOpen] as const;
}
