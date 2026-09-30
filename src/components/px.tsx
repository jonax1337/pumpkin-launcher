/**
 * Pixelkino-Bausteine. Aussehen kommt aus styles/pixelkino.css (Klassen wie im Mockup),
 * Verhalten für Menü, Tooltip, Dialog und Seitenpanel aus Radix.
 */
import { cloneElement, isValidElement, useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties, type ComponentProps, type FocusEvent, type KeyboardEvent, type PointerEvent, type ReactNode } from "react";
import { Link, type LinkProps } from "react-router";
import { ContextMenu as CM, Dialog as D, DropdownMenu as DM, Select as S, Tooltip as T } from "radix-ui";
import { Toaster as Sonner } from "sonner";
import { cn } from "@/lib/utils";
import { Glyph, glyphFor, Icon, IconSvg, type IconName } from "@/pixel/icons";

// ---------- Knöpfe ----------

type BtnLook = {
  /** p = primär (Akzentblock), s = sekundär (Platte), g = Geist (nur Text), d = Gefahr */
  variant?: "p" | "s" | "g" | "d";
  size?: "s" | "m" | "l";
  icon?: IconName;
  /** Nur Symbol (quadratisch); Beschriftung dann über aria-label. */
  iconOnly?: boolean;
  /** Farbe für Geist-Knöpfe. */
  tone?: "warn" | "bad" | "acc";
  /** Inhalt über die ganze Breite zentrieren (feste Breite per style). */
  full?: boolean;
};

const btnClass = ({ variant = "s", size = "m", iconOnly, tone, full }: BtnLook, className?: string) =>
  cn(
    "btn fx",
    variant === "p" && "btn-p",
    variant === "d" && "btn-p btn-d",
    variant === "s" && "btn-s",
    variant === "g" && "btn-g",
    size === "s" && "s",
    size === "l" && "l",
    iconOnly && "ib",
    tone,
    full && "bfull",
    className,
  );

function BtnInner({ variant = "s", icon, children }: BtnLook & { children?: ReactNode }) {
  return (
    <>
      {(variant === "p" || variant === "d") && <span className="bf" />}
      <span className="bc">
        {icon && <Icon name={icon} />}
        {children}
      </span>
    </>
  );
}

export function Btn({ variant, size, icon, iconOnly, tone, full, className, children, type = "button", ...props }: BtnLook & ComponentProps<"button">) {
  return (
    <button type={type} className={btnClass({ variant, size, iconOnly, tone, full }, className)} {...props}>
      <BtnInner variant={variant} icon={icon}>{children}</BtnInner>
    </button>
  );
}

export function BtnLink({ variant, size, icon, iconOnly, tone, full, className, children, ...props }: BtnLook & LinkProps) {
  return (
    <Link className={btnClass({ variant, size, iconOnly, tone, full }, className)} {...props}>
      <BtnInner variant={variant} icon={icon}>{children}</BtnInner>
    </Link>
  );
}

/** Zurück-Link über einer Überschrift („‹ Bibliothek“). */
export function BackLink({ to, children, onClick }: { to?: string; children: ReactNode; onClick?: () => void }) {
  const inner = (
    <span className="bc">
      <Icon name="chevr" small className="flipx" />
      {children}
    </span>
  );
  return to ? (
    <Link to={to} className="btn btn-g s back fx">{inner}</Link>
  ) : (
    <button type="button" onClick={onClick} className="btn btn-g s back fx">{inner}</button>
  );
}

// ---------- Chips, Fortschritt ----------

export function Chip({ tone, small, dot, fixed, className, children, ...props }: { tone?: "acc" | "warn" | "bad" | "run"; small?: boolean; dot?: boolean; fixed?: boolean } & ComponentProps<"span">) {
  return (
    <span className={cn("chip", small && "s", fixed && "fixw", tone, className)} {...props}>
      {dot && <i className="sq" />}
      {children}
    </span>
  );
}

/**
 * Segmentierter Fortschritt: Zellen 2 Einheiten, Lücke 1; `p` 0–1, ohne `p` unbestimmt.
 * `label` ist der zugängliche Name (worum es geht, z. B. „Mods herunterladen“); `decorative` blendet ihn für Screenreader aus,
 * wenn derselbe Fortschritt schon anders angesagt wird.
 */
export function Progress({ p, thin, bad, className, style, label = "Fortschritt", decorative }: { p?: number | null; thin?: boolean; bad?: boolean; className?: string; style?: CSSProperties; label?: string; decorative?: boolean }) {
  const ind = p == null;
  if (decorative)
    return <span aria-hidden className={cn("prog", thin && "thin", ind && "ind", bad && "bad", className)} style={{ ...style, ["--p" as string]: ind ? 0 : Math.max(0, Math.min(1, p)) }} />;
  return (
    <span
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={ind ? undefined : Math.round(p * 100)}
      className={cn("prog", thin && "thin", ind && "ind", bad && "bad", className)}
      style={{ ...style, ["--p" as string]: ind ? 0 : Math.max(0, Math.min(1, p)) }}
    />
  );
}

// ---------- Eingaben ----------

/** Suchfeld mit Lupe und Leeren-Knopf. */
export function SearchField({ value, onChange, placeholder, small, className, autoFocus, label }: { value: string; onChange: (v: string) => void; placeholder: string; small?: boolean; className?: string; autoFocus?: boolean; label?: string }) {
  return (
    <label className={cn("field", small && "s", value && "has", className)}>
      <Icon name="search" small />
      <input type="search" value={value} placeholder={placeholder} aria-label={label ?? placeholder} autoComplete="off" spellCheck={false} autoFocus={autoFocus} onChange={(e) => onChange(e.target.value)} onKeyDown={(e) => e.key === "Escape" && value && (e.stopPropagation(), onChange(""))} />
      <button type="button" className="btn btn-g ib s clear" aria-label="Suche leeren" tabIndex={-1} onClick={() => onChange("")}>
        <span className="bc"><Icon name="x5" small /></span>
      </button>
    </label>
  );
}

/** Einfaches Eingabefeld in der eingelassenen Platte. */
export function TextField({ className, small, ...props }: { small?: boolean } & ComponentProps<"input">) {
  return (
    <label className={cn("field", small && "s", className)}>
      <input autoComplete="off" spellCheck={false} {...props} />
    </label>
  );
}

export function TextArea({ className, ...props }: ComponentProps<"textarea">) {
  return (
    <label className={cn("field area", className)}>
      <textarea spellCheck={false} {...props} />
    </label>
  );
}

export type Option = { value: string; label: string; disabled?: boolean };

/**
 * Auswahl als erhabene Platte mit eigener Pixel-Liste (Radix Select: Tastatur, Tippsuche, Scrollen).
 * Die Breite richtet sich nach der längsten Option, damit beim Wechseln nichts springt.
 */
export function Select({ value, onChange, options, label, small, className, id, ariaLabel, disabled, placeholder = "Keine Auswahl" }: {
  value: string; onChange: (v: string) => void; options: Option[]; label?: string; small?: boolean; className?: string; id?: string; ariaLabel?: string; disabled?: boolean; placeholder?: string;
}) {
  // Radix erlaubt keine leeren Werte: „“ gilt als „nichts gewählt“.
  const items = options.filter((o) => o.value !== "");
  return (
    <S.Root value={value || undefined} onValueChange={onChange} disabled={disabled || !items.length}>
      {/* Name: ariaLabel, sonst die sichtbare Beschriftung (der Wert gehört nicht in den Namen) */}
      <S.Trigger id={id} className={cn("psel fx", small && "s", className)} aria-label={ariaLabel ?? label}>
        {label && <span className="lab">{label}</span>}
        <span className="val">
          <S.Value placeholder={placeholder} />
          {items.length <= 40 && items.map((o) => <span key={o.value} className="sizer" aria-hidden>{o.label}</span>)}
        </span>
        <S.Icon asChild>
          <span className="chev"><Icon name="chevd" small /></span>
        </S.Icon>
      </S.Trigger>
      <S.Portal>
        <S.Content className="rpop selpop" position="popper" sideOffset={6} collisionPadding={8} align="start">
          <S.ScrollUpButton className="selscroll"><Icon name="chevd" small className="flipy" /></S.ScrollUpButton>
          <S.Viewport>
            {items.map((o) => (
              <S.Item key={o.value} value={o.value} disabled={o.disabled} className="mitem selitem">
                <S.ItemText>{o.label}</S.ItemText>
                <S.ItemIndicator className="ck"><Icon name="check5" small /></S.ItemIndicator>
              </S.Item>
            ))}
          </S.Viewport>
          <S.ScrollDownButton className="selscroll"><Icon name="chevd" small /></S.ScrollDownButton>
        </S.Content>
      </S.Portal>
    </S.Root>
  );
}

/**
 * Pfeiltasten in einer Reihe von Tabs oder Radios: Fokus wandert, Auswahl folgt (WAI-ARIA Tabs/Radio).
 * `axis`: x = ←/→ (waagerechte Tabs), y = ↑/↓ (senkrechte Tabs, aria-orientation="vertical"), xy = beide (Radios).
 * Gibt das neue Element zurück (false, wenn die Taste nicht verbraucht wurde oder der Fokus blieb).
 */
function rove(e: KeyboardEvent<HTMLElement>, items: HTMLElement[], axis: "x" | "y" | "xy" = "x") {
  const keys = ["Home", "End", ...(axis !== "y" ? ["ArrowLeft", "ArrowRight"] : []), ...(axis !== "x" ? ["ArrowUp", "ArrowDown"] : [])];
  if (!keys.includes(e.key) || e.altKey || e.ctrlKey || e.metaKey || !items.length) return false;
  const i = items.indexOf(document.activeElement as HTMLElement);
  if (i < 0) return false;
  e.preventDefault();
  const n = items.length;
  const j = e.key === "Home" ? 0 : e.key === "End" ? n - 1 : (i + (e.key === "ArrowRight" || e.key === "ArrowDown" ? 1 : -1) + n) % n;
  items[j].focus();
  return items[j] !== items[i] ? items[j] : false;
}

/**
 * Segment-Umschalter (Poster/Liste, Alle/Mods …). `tabs` setzt role=tab und aria-selected, sonst role=radio.
 * Ein Tab-Stopp (Roving-Tabindex), Pfeile/Pos1/Ende wechseln.
 */
export function Seg<V extends string>({ value, onChange, options, small, icons, label, tabs, className }: {
  value: V; onChange: (v: V) => void; options: { value: V; label: ReactNode; icon?: IconName; count?: number; tip?: string; disabled?: boolean }[];
  small?: boolean; icons?: boolean; label: string; tabs?: boolean; className?: string;
}) {
  // Tab-Stopp: das gewählte Segment, sonst das erste freie
  const stop = options.some((o) => o.value === value && !o.disabled) ? value : options.find((o) => !o.disabled)?.value;
  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    const items = [...e.currentTarget.querySelectorAll<HTMLButtonElement>("button:not(:disabled)")];
    const next = rove(e, items, tabs ? "x" : "xy");
    if (!next) return;
    onChange(next.dataset.v as V);
    requestAnimationFrame(() => next.isConnected && document.activeElement !== next && next.focus({ preventScroll: true }));
  }
  return (
    <div className={cn("seg", small && "s", icons && "ico", className)} role={tabs ? "tablist" : "radiogroup"} aria-label={label} onKeyDown={onKeyDown}>
      {options.map((o) => {
        const on = o.value === value;
        const btn = (
          <button
            key={o.value}
            type="button"
            className="fx"
            data-v={o.value}
            role={tabs ? "tab" : "radio"}
            aria-selected={tabs ? on : undefined}
            aria-checked={tabs ? undefined : on}
            tabIndex={o.value === stop ? 0 : -1}
            disabled={o.disabled}
            onClick={() => onChange(o.value)}
          >
            {o.icon && <Icon name={o.icon} />}
            {icons ? <span className="sr">{o.label}</span> : o.label}
            {o.count != null && <span className="num">{o.count}</span>}
          </button>
        );
        return o.tip ? <Tip key={o.value} label={o.tip}>{btn}</Tip> : btn;
      })}
    </div>
  );
}

export function Checkbox({ checked, indeterminate, onChange, label, disabled }: { checked: boolean; indeterminate?: boolean; onChange: (v: boolean) => void; label: string; disabled?: boolean }) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = !!indeterminate;
  }, [indeterminate]);
  return (
    <label className="cb">
      <input ref={ref} type="checkbox" checked={checked} disabled={disabled} aria-label={label} onChange={(e) => onChange(e.target.checked)} />
      <span className="box" />
      <IconSvg name="check5" />
      <span className="dash" />
      <span className="fring" />
    </label>
  );
}

export function Switch({ checked, onChange, label, disabled, id }: { checked: boolean; onChange: (v: boolean) => void; label: string; disabled?: boolean; id?: string }) {
  return (
    <label className="sw">
      <input id={id} type="checkbox" role="switch" checked={checked} disabled={disabled} aria-label={label} onChange={(e) => onChange(e.target.checked)} />
      <span className="tr" />
      <span className="kn" />
      <span className="fring" />
    </label>
  );
}

export function Radio({ name, checked, onChange, children, disabled }: { name: string; checked: boolean; onChange: () => void; children: ReactNode; disabled?: boolean }) {
  return (
    <label className="radio">
      <input type="radio" name={name} checked={checked} disabled={disabled} onChange={onChange} />
      <span className="rb"><span className="fring" /></span>
      <span>{children}</span>
    </label>
  );
}

/**
 * Arbeitsspeicher als 16 Segmente (1 bis 16 GB) mit Griffblock. Pfeile, Pos1, Ende.
 * Segmente über `max` sind gesperrt (mehr hat der PC nicht übrig).
 */
export function SegSlider({ value, onChange, disabled, max = 16, label = "Arbeitsspeicher", id }: { value: number; onChange: (gb: number) => void; disabled?: boolean; max?: number; label?: string; id?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const top = Math.max(1, Math.min(16, Math.floor(max)));
  const v = Math.max(1, Math.min(top, Math.round(value)));
  const set = (n: number) => onChange(Math.max(1, Math.min(top, Math.round(n))));
  const fromX = (clientX: number) => {
    const r = ref.current!.getBoundingClientRect();
    set(1 + ((clientX - r.left) / r.width) * 16 - 0.5);
  };
  function onPointerDown(e: PointerEvent<HTMLDivElement>) {
    if (disabled) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    fromX(e.clientX);
  }
  function onKey(e: KeyboardEvent<HTMLDivElement>) {
    if (disabled) return;
    const k = e.key;
    if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End", "PageUp", "PageDown"].includes(k)) return;
    e.preventDefault();
    set(k === "Home" ? 1 : k === "End" ? top : v + (["ArrowRight", "ArrowUp", "PageUp"].includes(k) ? 1 : -1));
  }
  return (
    <div
      ref={ref}
      id={id}
      className="slider"
      role="slider"
      tabIndex={disabled ? -1 : 0}
      aria-label={label}
      aria-valuemin={1}
      aria-valuemax={top}
      aria-valuenow={v}
      aria-valuetext={`${v} GB`}
      aria-disabled={disabled || undefined}
      onPointerDown={onPointerDown}
      onPointerMove={(e) => e.currentTarget.hasPointerCapture(e.pointerId) && fromX(e.clientX)}
      onKeyDown={onKey}
    >
      <div className="trk">
        {Array.from({ length: 16 }, (_, k) => (
          <i key={k} className={cn(k < v && "on", k >= top && "x")} />
        ))}
      </div>
      <div className="th" style={{ left: `${((v - 0.5) / 16) * 100}%` }} />
    </div>
  );
}

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
          <T.Content className="rtip" side={side} sideOffset={8} collisionPadding={8}>
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
        <El ref={ref as never} className={cn("ell", className)} style={style}>{text}</El>
      </T.Trigger>
      <T.Portal>
        <T.Content className="rtip pass" side={side} sideOffset={8} collisionPadding={8} aria-hidden>
          {text}
        </T.Content>
      </T.Portal>
    </T.Root>
  );
}

// ---------- Menüs (Dropdown und Kontextmenü mit gleichen Einträgen) ----------

export type MenuEntry =
  | "-"
  | { label: string }
  | { id: string; text: ReactNode; icon?: IconName; bad?: boolean; disabled?: boolean; onSelect: () => void; sub?: ReactNode; lead?: ReactNode; checked?: boolean };

function entries(list: MenuEntry[], Item: typeof DM.Item | typeof CM.Item, Sep: typeof DM.Separator | typeof CM.Separator, Label: typeof DM.Label | typeof CM.Label) {
  return list.map((e, i) => {
    if (e === "-") return <Sep key={`s${i}`} className="msep" />;
    if ("label" in e) return <Label key={`l${i}`} className="mlabel">{e.label}</Label>;
    return (
      <Item key={e.id} className={cn("mitem", e.bad && "bad", (e.sub || e.lead) && "tall")} disabled={e.disabled} onSelect={e.onSelect}>
        {e.lead ?? (e.icon ? <Icon name={e.icon} /> : null)}
        {e.sub ? (
          <span className="sub2 ell"><b className="ell">{e.text}</b><span className="ell">{e.sub}</span></span>
        ) : (
          <span className="ell">{e.text}</span>
        )}
        {e.checked && <Icon name="check5" small className="ck ml-auto text-copper" />}
      </Item>
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

/** Dropdown-Menü an einem Auslöser. */
export function Menu({ trigger, items, align = "end", className, open, onOpenChange, children }: { trigger: ReactNode; items?: MenuEntry[]; align?: "start" | "end"; className?: string; open?: boolean; onOpenChange?: (o: boolean) => void; children?: ReactNode }) {
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
        <DM.Content className={cn("rpop", className)} align={align} sideOffset={6} collisionPadding={8} onFocus={keepFocusWhenClosed}>
          {items && entries(items, DM.Item, DM.Separator, DM.Label)}
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
        <CM.Content className="rpop" collisionPadding={8} onFocus={keepFocusWhenClosed}>
          {entries(items, CM.Item, CM.Separator, CM.Label)}
        </CM.Content>
      </CM.Portal>
    </CM.Root>
  );
}

export const MenuItem = DM.Item;
export const MenuSep = DM.Separator;
export const MenuLabel = DM.Label;

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
 * --acc am Auslöser (berechnet, also auch geerbt). Ein Gefahrknopf überschreibt --acc nur für sich, dann zählt sein Umfeld.
 * Nur wenn es vom globalen Kupfer abweicht; die Ableitungen (--acc-hi/-mid/-lo) rechnet pixelkino.css über [style*="--acc:"].
 */
function accentOf(el: HTMLElement | null) {
  if (!el?.isConnected) return undefined;
  const src = el.closest(".btn-d")?.parentElement ?? el;
  const v = getComputedStyle(src).getPropertyValue("--acc").trim();
  return v && v !== getComputedStyle(document.documentElement).getPropertyValue("--acc").trim() ? v : undefined;
}

/** Erstes Ziel nach Priorität, nicht in Dokument-Reihenfolge: markiert → Eingabe → Hauptknopf → erstes Bedienbare. */
const AUTOFOCUS = [
  "[data-autofocus], [autofocus]",
  ".dlg-b input:not([type=checkbox]):not([type=radio]):not([type=file]):not(:disabled), .dlg-b textarea:not(:disabled)",
  ".dlg-f .btn-p:not(:disabled)",
  "button:not(:disabled), [href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]",
];

function autoFocusTarget(root: HTMLElement) {
  for (const sel of AUTOFOCUS) {
    // Sichtbar, per Tab erreichbar und nicht im Kopf (das Schließen-Kreuz bekommt nie den Startfokus)
    const el = [...root.querySelectorAll<HTMLElement>(sel)].find((n) => n.tabIndex >= 0 && n.getClientRects().length > 0 && !n.closest(".dlg-h"));
    if (el) return el;
  }
  return null;
}

/**
 * Tab-Leisten im Dialog, die nicht aus Seg stammen (z. B. „Weg“ in „Neue Instanz“): Pfeile/Pos1/Ende und ein Tab-Stopp.
 * Seg regelt das selbst und setzt defaultPrevented. Senkrechte Leisten (aria-orientation="vertical") nutzen ↑/↓.
 */
function tablistKeys(e: KeyboardEvent<HTMLElement>) {
  if (e.defaultPrevented) return;
  const list = (e.target as HTMLElement).closest?.("[role=tablist]");
  if (!list || list.classList.contains("seg")) return;
  const axis = list.getAttribute("aria-orientation") === "vertical" ? "y" : "x";
  const next = rove(e, [...list.querySelectorAll<HTMLElement>("[role=tab]:not(:disabled)")], axis);
  if (!next) return;
  next.click();
  // Ein Autofokus im neuen Tab-Inhalt (Suchfeld) darf den Fokus nicht aus der Tab-Leiste ziehen.
  requestAnimationFrame(() => next.isConnected && document.activeElement !== next && next.focus({ preventScroll: true }));
}

/** Nur der gewählte Tab ist per Tab erreichbar (React verwaltet tabIndex dort nicht). Nach Klick/Taste im nächsten Frame. */
function syncTabStops(root: Element | null) {
  requestAnimationFrame(() => root?.querySelectorAll("[role=tablist]:not(.seg)").forEach((list) => {
    const tabs = [...list.querySelectorAll<HTMLElement>("[role=tab]")];
    const sel = tabs.find((t) => t.getAttribute("aria-selected") === "true") ?? tabs[0];
    tabs.forEach((t) => (t.tabIndex = t === sel ? 0 : -1));
  }));
}

/**
 * Dialog mit fester Höhe (kein Nachrutschen, wenn sich der Inhalt ändert): Kopf, scrollender Körper, Fuß.
 * `height` fest in px; ohne passt er sich an.
 */
export function Dialog({ open, onOpenChange, trigger, title, sub, width = 560, height, footer, footLeft, children, onOpenAutoFocus, role = "dialog", describedBy }: {
  open?: boolean; onOpenChange?: (o: boolean) => void; trigger?: ReactNode; title: ReactNode; sub?: ReactNode; width?: number; height?: number;
  footer?: ReactNode; footLeft?: ReactNode; children: ReactNode; onOpenAutoFocus?: (e: Event) => void;
  /** alertdialog für Rückfragen, die eine Entscheidung verlangen. */
  role?: "dialog" | "alertdialog";
  /** id des Texts, der den Dialog beschreibt (wird beim Öffnen vorgelesen). */
  describedBy?: string;
}) {
  const ret = useReturnFocus(open);
  return (
    <D.Root open={open} onOpenChange={onOpenChange}>
      {trigger && <D.Trigger asChild>{trigger}</D.Trigger>}
      <D.Portal>
        <D.Overlay className="scrimbg" />
        <D.Content
          className="dlg"
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
          <div className="dlg-h">
            <div className="min-w-0 flex-1">
              <D.Title asChild><h2>{title}</h2></D.Title>
              {sub && <p className="dlg-sub">{sub}</p>}
            </div>
            <D.Close asChild>
              <Btn variant="g" iconOnly icon="x" aria-label="Schließen" />
            </D.Close>
          </div>
          <div className="dlg-b">{children}</div>
          {(footer || footLeft) && (
            <div className="dlg-f">
              {footLeft && <span className="left">{footLeft}</span>}
              {footer}
            </div>
          )}
        </D.Content>
      </D.Portal>
    </D.Root>
  );
}

export const DialogClose = D.Close;

/**
 * Rückfrage vor einer Aktion, z. B. Löschen oder „Minecraft beenden?“.
 * `danger` (Standard): roter Hauptknopf, Startfokus auf „Abbrechen“ (Enter löst nichts Unumkehrbares aus), role=alertdialog.
 * Ohne `danger`: Akzentknopf mit Startfokus. `text` beschreibt den Dialog (aria-describedby).
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
      footer={
        <>
          <D.Close asChild><Btn data-autofocus={danger || undefined}>{cancelLabel}</Btn></D.Close>
          <Btn variant={danger ? "d" : "p"} full style={{ width: 130 }} disabled={pending} onClick={onConfirm}>{pending ? pendingLabel : confirmLabel}</Btn>
        </>
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
          className="sheet"
          aria-describedby={undefined}
          style={acc || ret.acc ? ({ "--acc": acc ?? ret.acc } as CSSProperties) : undefined}
          onInteractOutside={(e) => e.preventDefault()}
          onOpenAutoFocus={ret.remember}
          onCloseAutoFocus={ret.restore}
        >
          <div className="sheet-h">
            <div className="grow">
              <D.Title asChild><h2>{title}</h2></D.Title>
              {sub && <p>{sub}</p>}
            </div>
            <D.Close asChild>
              <Btn variant="g" iconOnly icon="x" aria-label="Panel schließen" />
            </D.Close>
          </div>
          {tools && <div className="sheet-t">{tools}</div>}
          <div className="sheet-b">{children}</div>
        </D.Content>
      </D.Portal>
    </D.Root>
  );
}

// ---------- Zustände ----------

/** Leerzustand: Bild, Überschrift, ein Satz, Aktionen. */
export function Empty({ ill, title, children, actions, minHeight, page }: { ill?: ReactNode; title: string; children?: ReactNode; actions?: ReactNode; minHeight?: number; page?: boolean }) {
  // `page`: der Leerzustand ist die ganze Seite, sein Titel die Seitenüberschrift (h1)
  const H = page ? "h1" : "h2";
  return (
    <div className="empty" style={minHeight != null ? { minHeight } : undefined}>
      {ill && <div className="ill">{ill}</div>}
      <H>{title}</H>
      {children && <p>{children}</p>}
      {actions && <div className="row">{actions}</div>}
    </div>
  );
}

const message = (error: unknown) => (error instanceof Error ? error.message : String(error));

/** Fehler in Alltagssprache; mit `title` ist die Backend-Meldung das Detail. */
export function ErrorBox({ error, title, onRetry, className }: { error: unknown; title?: string; onRetry?: () => void; className?: string }) {
  return (
    <div role="alert" className={cn("errbox", className)}>
      <Icon name="warn" />
      <div className="et">
        <b>{title ?? message(error)}</b>
        {title && <span>{message(error)}</span>}
      </div>
      {onRetry && <Btn size="s" icon="redo" onClick={onRetry}>Erneut versuchen</Btn>}
    </div>
  );
}

export function Skel({ className, style }: { className?: string; style?: CSSProperties }) {
  return <i className={cn("skl block", className)} style={style} aria-hidden />;
}

// ---------- Bilder aus dem Katalog ----------

/** Projekt-Bild in Pixelrahmen; ohne Bild (oder kaputt) eine feste Glyphe aus der ID. */
export function ProjectIcon({ url, seed, big, className }: { url?: string | null; seed: string; big?: boolean; className?: string }) {
  const [broken, setBroken] = useState(false);
  if (!url || broken) {
    const [g, p] = glyphFor(seed);
    return <Glyph name={g} pal={p} big={big} className={className} />;
  }
  return (
    <span className={cn("mi img", big && "l", className)} aria-hidden>
      <img src={url} alt="" loading="lazy" referrerPolicy="no-referrer" onError={() => setBroken(true)} />
    </span>
  );
}

// ---------- Toasts ----------

export function Toaster() {
  return (
    <Sonner
      position="bottom-right"
      closeButton
      gap={8}
      offset={20}
      visibleToasts={4}
      containerAriaLabel="Benachrichtigungen"
      icons={{
        success: <Icon name="check" />,
        info: <Icon name="info" />,
        warning: <Icon name="warn" />,
        error: <Icon name="warn" />,
        loading: <Icon name="hour" />,
        close: <IconSvg name="x5" />,
      }}
      toastOptions={{
        unstyled: true,
        duration: 6500,
        closeButtonAriaLabel: "Schließen",
        classNames: {
          toast: "stoast",
          actionButton: "btn btn-g s acc fx",
          cancelButton: "btn btn-g s fx",
          closeButton: "fx",
        },
      }}
    />
  );
}
