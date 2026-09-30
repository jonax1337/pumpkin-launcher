/**
 * Pixelkino-Bausteine. Aussehen kommt aus styles/pixelkino.css (Klassen wie im Mockup),
 * Verhalten aus Radix. Überlagerungen (Tip, Menü, Dialog, Seitenpanel, Toaster) kommen aus dem Kit (@/ui) und werden hier weitergereicht.
 */
import { useEffect, useRef, useState, type CSSProperties, type ComponentProps, type KeyboardEvent, type PointerEvent, type ReactNode } from "react";
import { Link, type LinkProps } from "react-router";
import { DropdownMenu as DM, Select as S } from "radix-ui";
import * as K from "@/ui/Overlay";
import { Tip } from "@/ui/Overlay";
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

// ---------- Überlagerungen (verschoben nach src/ui/Overlay.tsx) ----------

/*
 * Tip, Trunc, Menü, Kontextmenü, Dialog, Rückfrage und Seitenpanel liegen jetzt im Kit (@/ui). Der Bestand importiert
 * weiter von hier. Menü, Kontextmenü, Seitenpanel und Trunc setzen dabei zusätzlich die Altklassen (rpop, mitem, sheet, ell),
 * weil Bestandsregeln daran hängen (.rpop.addto, .me .mitem, .sheet .proj-h …). MenuItem/MenuSep/MenuLabel bleiben die
 * rohen Radix-Teile (Aufrufer setzen mitem/msep/mlabel selbst). Bis Phase C.
 */
export { ConfirmDialog, Dialog, DialogClose, Tip, TipProvider, type MenuEntry } from "@/ui/Overlay";
export { Toaster } from "@/ui/Feedback";
export const MenuItem = DM.Item;
export const MenuSep = DM.Separator;
export const MenuLabel = DM.Label;

export function Menu(props: ComponentProps<typeof K.Menu>) {
  return <K.LegacyClasses><K.Menu {...props} /></K.LegacyClasses>;
}
export function ContextMenu(props: ComponentProps<typeof K.ContextMenu>) {
  return <K.LegacyClasses><K.ContextMenu {...props} /></K.LegacyClasses>;
}
export function Sheet(props: ComponentProps<typeof K.Sheet>) {
  return <K.LegacyClasses><K.Sheet {...props} /></K.LegacyClasses>;
}
export function Trunc(props: ComponentProps<typeof K.Trunc>) {
  return <K.LegacyClasses><K.Trunc {...props} /></K.LegacyClasses>;
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
