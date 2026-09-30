/**
 * Pixelkino-Bausteine. Aussehen kommt aus styles/pixelkino.css (Klassen wie im Mockup),
 * Verhalten für Menü, Tooltip, Dialog und Seitenpanel aus Radix.
 */
import { useEffect, useRef, useState, type CSSProperties, type ComponentProps, type KeyboardEvent, type PointerEvent, type ReactNode } from "react";
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

/** Segmentierter Fortschritt: Zellen 2 Einheiten, Lücke 1; `p` 0–1, ohne `p` unbestimmt. */
export function Progress({ p, thin, bad, className, style, label }: { p?: number | null; thin?: boolean; bad?: boolean; className?: string; style?: CSSProperties; label?: string }) {
  const ind = p == null;
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
      <S.Trigger id={id} className={cn("psel fx", small && "s", className)} aria-label={ariaLabel}>
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

/** Segment-Umschalter (Poster/Liste, Alle/Mods …). `tabs` setzt role=tab und aria-selected. */
export function Seg<V extends string>({ value, onChange, options, small, icons, label, tabs, className }: {
  value: V; onChange: (v: V) => void; options: { value: V; label: ReactNode; icon?: IconName; count?: number; tip?: string; disabled?: boolean }[];
  small?: boolean; icons?: boolean; label: string; tabs?: boolean; className?: string;
}) {
  return (
    <div className={cn("seg", small && "s", icons && "ico", className)} role={tabs ? "tablist" : "group"} aria-label={label}>
      {options.map((o) => {
        const on = o.value === value;
        const btn = (
          <button
            key={o.value}
            type="button"
            className="fx"
            role={tabs ? "tab" : undefined}
            aria-selected={tabs ? on : undefined}
            aria-pressed={tabs ? undefined : on}
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
      <span className="rb" />
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

/** Item-Tooltip (dunkel, Verlaufsrahmen), 450 ms Verzögerung. */
export function Tip({ label, children, side = "bottom", show = true }: { label: ReactNode; children: ReactNode; side?: "top" | "bottom" | "left" | "right"; show?: boolean }) {
  if (!show || label == null || label === "") return <>{children}</>;
  return (
    <T.Root delayDuration={450}>
      <T.Trigger asChild>{children}</T.Trigger>
      <T.Portal>
        <T.Content className="rtip" side={side} sideOffset={8} collisionPadding={8}>
          {label}
        </T.Content>
      </T.Portal>
    </T.Root>
  );
}

export const TipProvider = T.Provider;

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

/** Dropdown-Menü an einem Auslöser. */
export function Menu({ trigger, items, align = "end", className, open, onOpenChange, children }: { trigger: ReactNode; items?: MenuEntry[]; align?: "start" | "end"; className?: string; open?: boolean; onOpenChange?: (o: boolean) => void; children?: ReactNode }) {
  return (
    <DM.Root open={open} onOpenChange={onOpenChange} modal={false}>
      <DM.Trigger asChild>{trigger}</DM.Trigger>
      <DM.Portal>
        <DM.Content className={cn("rpop", className)} align={align} sideOffset={6} collisionPadding={8}>
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
    <CM.Root modal={false}>
      <CM.Trigger asChild>{children}</CM.Trigger>
      <CM.Portal>
        <CM.Content className="rpop" collisionPadding={8}>
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
 * Dialog mit fester Höhe (kein Nachrutschen, wenn sich der Inhalt ändert): Kopf, scrollender Körper, Fuß.
 * `height` fest in px; ohne passt er sich an.
 */
export function Dialog({ open, onOpenChange, trigger, title, sub, width = 560, height, footer, footLeft, children, onOpenAutoFocus }: {
  open?: boolean; onOpenChange?: (o: boolean) => void; trigger?: ReactNode; title: ReactNode; sub?: ReactNode; width?: number; height?: number;
  footer?: ReactNode; footLeft?: ReactNode; children: ReactNode; onOpenAutoFocus?: (e: Event) => void;
}) {
  return (
    <D.Root open={open} onOpenChange={onOpenChange}>
      {trigger && <D.Trigger asChild>{trigger}</D.Trigger>}
      <D.Portal>
        <D.Overlay className="scrimbg" />
        <D.Content
          className="dlg"
          aria-describedby={undefined}
          onOpenAutoFocus={(e) => {
            onOpenAutoFocus?.(e);
            if (e.defaultPrevented) return;
            // Wie im Mockup: erstes Eingabefeld im Körper, sonst der Hauptknopf im Fuß – nie das Schließen-Kreuz.
            const root = e.currentTarget as HTMLElement;
            const target = root.querySelector<HTMLElement>("[autofocus], .dlg-b input:not([type=checkbox]):not([type=radio]):not([type=file]), .dlg-b textarea, .dlg-f .btn-p:not(:disabled), .dlg-b button");
            if (target) {
              e.preventDefault();
              target.focus({ preventScroll: true });
            }
          }}
          style={{ ["--dw" as string]: `${width}px`, height: height ? `min(${height}px, calc(100vh - 64px))` : undefined }}
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

/** Bestätigen, z. B. vor dem Löschen. */
export function ConfirmDialog({ open, onOpenChange, title, text, confirmLabel = "Löschen", pending, danger = true, onConfirm }: {
  open: boolean; onOpenChange: (o: boolean) => void; title: string; text?: ReactNode; confirmLabel?: string; pending?: boolean; danger?: boolean; onConfirm: () => void;
}) {
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={title}
      width={460}
      footer={
        <>
          <D.Close asChild><Btn>Abbrechen</Btn></D.Close>
          <Btn variant={danger ? "d" : "p"} full style={{ width: 130 }} disabled={pending} onClick={onConfirm}>{pending ? "Einen Moment" : confirmLabel}</Btn>
        </>
      }
    >
      {text && <p>{text}</p>}
    </Dialog>
  );
}

/** Seitenpanel rechts (Katalog im Kontext einer Instanz). Nicht modal: die Liste daneben bleibt bedienbar. */
export function Sheet({ open, onOpenChange, title, sub, acc, children, tools }: { open: boolean; onOpenChange: (o: boolean) => void; title: ReactNode; sub?: ReactNode; acc?: string; children: ReactNode; tools?: ReactNode }) {
  return (
    <D.Root open={open} onOpenChange={onOpenChange} modal={false}>
      <D.Portal>
        <D.Content className="sheet" aria-describedby={undefined} style={acc ? ({ "--acc": acc } as CSSProperties) : undefined} onInteractOutside={(e) => e.preventDefault()}>
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
export function Empty({ ill, title, children, actions, minHeight }: { ill?: ReactNode; title: string; children?: ReactNode; actions?: ReactNode; minHeight?: number }) {
  return (
    <div className="empty" style={minHeight != null ? { minHeight } : undefined}>
      {ill && <div className="ill">{ill}</div>}
      <h2>{title}</h2>
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
        classNames: {
          toast: "stoast",
          actionButton: "btn btn-g s acc",
          cancelButton: "btn btn-g s",
        },
      }}
    />
  );
}
