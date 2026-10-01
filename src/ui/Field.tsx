import { createContext, useContext, useId, type ComponentProps, type CSSProperties, type ReactNode } from "react";
import { Select as S } from "radix-ui";
import { useI18n } from "@/i18n";
import { cn } from "@/lib/utils";
import { Icon } from "./Icon";
import { IconButton } from "./Button";
import type { IconName } from "./types";

// ---------- Kontext: Beschriftung und Beschreibung automatisch ----------

/**
 * Field/FormRow reichen id (nur ohne eigenes htmlFor), aria-describedby (Hilfe, Fehler) und aria-invalid an
 * TextField, TextArea, SearchField und Select darin. Schalter/Checkbox/Radio tragen eigene Namen und lesen das nicht.
 */
type FieldCtx = { id?: string; describedBy?: string; invalid?: boolean };
const FieldContext = createContext<FieldCtx>({});

/** Props der Eingabe mit Kontext zusammenführen (eigene Angaben zuerst). */
function useFieldProps(id?: string, describedBy?: string, invalid?: ComponentProps<"input">["aria-invalid"]) {
  const ctx = useContext(FieldContext);
  return {
    id: id ?? ctx.id,
    "aria-describedby": cn(describedBy, ctx.describedBy) || undefined,
    "aria-invalid": invalid ?? (ctx.invalid || undefined),
  };
}

// ---------- Formular: Abschnitt und Zeile ----------

/**
 * Formularabschnitt mit Überschrift (20 px, Versalien) und Linie unten (nicht beim letzten).
 * Container für das Zeilenraster: unter 1100 px Breite rutscht die Hilfe unter das Steuerelement.
 */
export function FormSection({ title, srOnlyTitle, level = 2, className, children }: { title: string; srOnlyTitle?: boolean; level?: 2 | 3; className?: string; children: ReactNode }) {
  const H = level === 3 ? "h3" : "h2";
  return (
    <section className={cn("vx-fsec", className)}>
      <H className={srOnlyTitle ? "sr" : "vx-fsec-h"}>{title}</H>
      {children}
    </section>
  );
}

/**
 * Formularzeile: Label (220 px, unter 900 px Fenster 170) | Steuerelement (bis 560 px) | Hilfe `aside` (rechte Spalte, höchstens 60 Zeichen).
 * `htmlFor`: Label für genau eine Eingabe; hint + aside beschreiben sie (per Kontext automatisch).
 * `group`: Auswahlgruppe (Radios) bzw. Gruppe; Label ist ihr Name, hint + aside ihre Beschreibung.
 * `wide`: Inhalt spannt über Steuer- und Hilfespalte (Bildwahl).
 */
export function FormRow({ label, hint, htmlFor, group, aside, wide, children }: {
  label: ReactNode; hint?: ReactNode; htmlFor?: string; group?: "radiogroup" | "group"; aside?: ReactNode; wide?: boolean; children: ReactNode;
}) {
  const id = useId();
  const desc = cn(hint && `${id}-h`, aside && `${id}-a`) || undefined;
  const lab = (
    <>
      <span id={`${id}-l`}>{label}</span>
      {hint && <small id={`${id}-h`}>{hint}</small>}
    </>
  );
  return (
    <div className="vx-frow">
      {htmlFor ? <label htmlFor={htmlFor} className="vx-fl">{lab}</label> : <div className="vx-fl">{lab}</div>}
      <div className="vx-fc" data-wide={wide ? "" : undefined} role={group} aria-labelledby={group ? `${id}-l` : undefined} aria-describedby={group ? desc : undefined}>
        <FieldContext value={{ describedBy: htmlFor ? desc : undefined }}>{children}</FieldContext>
      </div>
      {aside && <div className="vx-fh" id={`${id}-a`}>{aside}</div>}
    </div>
  );
}

// ---------- Feld (Label über der Eingabe) ----------

/**
 * Label über der Eingabe, darunter Hilfe oder Fehler (Nachfolger von .nf). Die Eingabe darin bekommt id (ohne `htmlFor`),
 * aria-describedby und aria-invalid automatisch. `reserveLines`: Platz für 1–2 Zeilen Hilfe/Fehler, damit nichts springt.
 * `group`: Inhalt ist eine Gruppe (Segmente, Radios); Label und Hilfe gehen an ein role=group darum.
 */
export function Field({ label, htmlFor, help, error, optional, reserveLines, group, className, children }: {
  label: ReactNode; htmlFor?: string; help?: ReactNode; error?: ReactNode; optional?: boolean; reserveLines?: 1 | 2; group?: boolean; className?: string; children: ReactNode;
}) {
  const { t } = useI18n();
  const uid = useId();
  const id = htmlFor ?? `${uid}-i`;
  const bad = error != null && error !== false && error !== "";
  const hasHelp = bad || (help != null && help !== false && help !== "");
  const descId = `${uid}-d`;
  const lab = (
    <>
      {label}
      {optional && <span className="vx-opt"> {t("ui.field.optional")}</span>}
    </>
  );
  return (
    <div className={cn("vx-field", className)} data-invalid={bad ? "" : undefined}>
      {group ? <span className="vx-field-l" id={`${uid}-l`}>{lab}</span> : <label className="vx-field-l" htmlFor={id}>{lab}</label>}
      {group ? (
        <div role="group" aria-labelledby={`${uid}-l`} aria-describedby={hasHelp ? descId : undefined}>{children}</div>
      ) : (
        <FieldContext value={{ id: htmlFor ? undefined : id, describedBy: hasHelp ? descId : undefined, invalid: bad }}>{children}</FieldContext>
      )}
      {(hasHelp || reserveLines) && (
        <div className="vx-help" data-reserve={reserveLines}>
          {bad ? <Hint tone="bad" live id={descId}>{error}</Hint> : hasHelp && <span id={descId}>{help}</span>}
        </div>
      )}
    </div>
  );
}

const HINT_ICON: Record<"neutral" | "warn" | "bad" | "ok", IconName | undefined> = { neutral: undefined, warn: "warn", bad: "warn", ok: "check" };

/**
 * Kurzer Hinweis unter/neben einem Steuerelement (12,5 px). Warnung und Fehler immer mit Symbol (nie nur Farbe).
 * `live`: wird angesagt, wenn er erscheint oder sich ändert (Fehler als alert, sonst status).
 */
export function Hint({ tone = "neutral", icon, live, id, className, children }: { tone?: "neutral" | "warn" | "bad" | "ok"; icon?: IconName | false; live?: boolean; id?: string; className?: string; children: ReactNode }) {
  const ico = icon === false ? undefined : (icon ?? HINT_ICON[tone]);
  return (
    <span id={id} className={cn("vx-hint", className)} data-tone={tone === "neutral" ? undefined : tone} role={live ? (tone === "bad" ? "alert" : "status") : undefined}>
      {ico && <Icon name={ico} size="s" />}
      <span className="vx-hint-t">{children}</span>
    </span>
  );
}

// ---------- Eingaben ----------

type FieldLook = {
  /** Höhe 40 (m) oder 32 (s). */
  size?: "s" | "m";
  /** Breite: s 160 · m 240 · l 360 · full · Zahl in px; ohne Angabe füllt das Feld seinen Platz. */
  width?: "s" | "m" | "l" | "full" | number;
};

const widthData = (width: FieldLook["width"]) => (typeof width === "string" ? width : undefined);
const widthStyle = (width: FieldLook["width"], style?: CSSProperties) => (typeof width === "number" ? { ...style, width } : style);

/** Eingabefeld in der eingelassenen Platte. Props (auch ref) gehen an das <input>. */
export function TextField({ size = "m", width, className, style, id, "aria-describedby": describedBy, "aria-invalid": invalid, ...props }: FieldLook & Omit<ComponentProps<"input">, "size">) {
  const f = useFieldProps(id, describedBy, invalid);
  return (
    <label className={cn("vx-input", className)} data-size={size} data-w={widthData(width)} style={widthStyle(width, style)}>
      <input autoComplete="off" spellCheck={false} {...f} {...props} />
    </label>
  );
}

/** Mehrzeilig (Konsole-Schrift), ohne Größenziehen. */
export function TextArea({ width, className, style, id, "aria-describedby": describedBy, "aria-invalid": invalid, ...props }: Pick<FieldLook, "width"> & ComponentProps<"textarea">) {
  const f = useFieldProps(id, describedBy, invalid);
  return (
    <label className={cn("vx-input", className)} data-area="" data-w={widthData(width)} style={widthStyle(width, style)}>
      <textarea spellCheck={false} {...f} {...props} />
    </label>
  );
}

/** Suchfeld mit Lupe (Icon s) und Leeren-Knopf (Symbolknopf s, nur bei Inhalt sichtbar; Platz bleibt). Esc leert. */
export function SearchField({ value, onChange, placeholder, size = "m", width, autoFocus, label, id, className }: {
  value: string; onChange: (v: string) => void; placeholder: string; autoFocus?: boolean; label?: string; id?: string; className?: string;
} & FieldLook) {
  const { t } = useI18n();
  const f = useFieldProps(id);
  return (
    <label className={cn("vx-input", className)} data-size={size} data-lead="" data-w={widthData(width)} data-has={value ? "" : undefined} style={widthStyle(width)}>
      <Icon name="search" size="s" />
      <input
        type="search"
        value={value}
        placeholder={placeholder}
        aria-label={label ?? placeholder}
        autoComplete="off"
        spellCheck={false}
        autoFocus={autoFocus}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => e.key === "Escape" && value && (e.stopPropagation(), onChange(""))}
        {...f}
      />
      <IconButton icon="x" label={t("ui.search.clearAria")} tip={false} size="s" className="vx-clear" tabIndex={-1} onClick={() => onChange("")} />
    </label>
  );
}

export type Option = { value: string; label: string; disabled?: boolean };

/**
 * Auswahl als erhabene Platte mit eigener Pixel-Liste (Radix Select: Tastatur, Tippsuche, Scrollen).
 * Die Breite richtet sich nach der längsten Option (bis 40 Optionen), damit beim Wechseln nichts springt.
 * `label`: sichtbares Präfix im Knopf („Sortieren: …“) und Name; sonst `ariaLabel` oder ein Field/FormRow darum.
 */
export function Select({ value, onChange, options, label, size = "m", className, id, ariaLabel, disabled, placeholder }: {
  value: string; onChange: (v: string) => void; options: Option[]; label?: string; size?: "s" | "m"; className?: string; id?: string; ariaLabel?: string; disabled?: boolean; placeholder?: string;
}) {
  const { t } = useI18n();
  const f = useFieldProps(id);
  const none = placeholder ?? t("ui.select.placeholder");
  // Radix erlaubt keine leeren Werte: „“ gilt als „nichts gewählt“.
  const items = options.filter((o) => o.value !== "");
  return (
    <S.Root value={value || undefined} onValueChange={onChange} disabled={disabled || !items.length}>
      {/* Name: ariaLabel, sonst die sichtbare Beschriftung (der Wert gehört nicht in den Namen) */}
      <S.Trigger className={cn("vx-select fx", className)} data-size={size} aria-label={ariaLabel ?? label} {...f}>
        {label && <span className="vx-sel-lab">{label}</span>}
        <span className="vx-sel-val">
          <S.Value placeholder={none} />
          {items.length <= 40 && items.map((o) => <span key={o.value} className="vx-sel-sizer" aria-hidden>{o.label}</span>)}
        </span>
        <S.Icon asChild>
          <span className="vx-sel-chev"><Icon name="chevd" size="s" /></span>
        </S.Icon>
      </S.Trigger>
      <S.Portal>
        <S.Content className="vx-pop vx-selpop" position="popper" sideOffset={6} collisionPadding={8} align="start">
          <S.ScrollUpButton className="vx-selscroll"><Icon name="chevd" size="s" flip="y" /></S.ScrollUpButton>
          <S.Viewport>
            {items.map((o) => (
              <S.Item key={o.value} value={o.value} disabled={o.disabled} className="vx-selitem">
                <S.ItemText>{o.label}</S.ItemText>
                <S.ItemIndicator className="vx-sel-ck"><Icon name="check" size="s" /></S.ItemIndicator>
              </S.Item>
            ))}
          </S.Viewport>
          <S.ScrollDownButton className="vx-selscroll"><Icon name="chevd" size="s" /></S.ScrollDownButton>
        </S.Content>
      </S.Portal>
    </S.Root>
  );
}

/**
 * Aufklappbarer Bereich („Erweitert“): Zusammenfassung wie ein Geist-Knopf s (Hover-Platte, bündig mit der Kante),
 * Pfeil dreht sich, echter Fokusring. `open` = Startzustand; `onToggle` meldet Auf- und Zuklappen.
 */
export function Disclosure({ summary, open, onToggle, className, children }: {
  summary: ReactNode; open?: boolean; onToggle?: (open: boolean) => void; className?: string; children: ReactNode;
}) {
  return (
    <details className={cn("vx-disc", className)} open={open || undefined} onToggle={(e) => onToggle?.(e.currentTarget.open)}>
      <summary className="vx-disc-s fx">
        <span className="vx-disc-c">
          <Icon name="chev" size="s" />
          {summary}
        </span>
      </summary>
      <div className="vx-disc-b">{children}</div>
    </details>
  );
}
