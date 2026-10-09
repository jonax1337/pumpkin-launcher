import { createContext, useContext, useId, type ComponentProps, type ReactNode } from "react";
import { useI18n } from "@/i18n";
import { cn } from "@/lib/utils";
import { Icon } from "./Icon";
import type { IconName, Tone } from "./types";
import { flag, hasContent } from "./util";
import { Heading } from "./Panel";

// ---------- Kontext: Beschriftung und Beschreibung automatisch ----------

/**
 * Field/FormRow reichen id (nur ohne eigenes htmlFor), aria-describedby (Hilfe, Fehler) und aria-invalid an
 * Input, TextArea, SearchField und Select darin. Schalter/Checkbox/Radio tragen eigene Namen und lesen das nicht.
 */
type FieldCtx = { id?: string; describedBy?: string; invalid?: boolean };
const FieldContext = createContext<FieldCtx>({});

type FieldA11y = Pick<ComponentProps<"input">, "id" | "aria-describedby" | "aria-invalid">;

/** Props der Eingabe mit dem Kontext zusammenführen (eigene Angaben zuerst); die übrigen Props bleiben unverändert dabei. */
export function useFieldProps<P extends FieldA11y>({ id, "aria-describedby": describedBy, "aria-invalid": invalid, ...rest }: P) {
  const ctx = useContext(FieldContext);
  return {
    id: id ?? ctx.id,
    "aria-describedby": cn(describedBy, ctx.describedBy) || undefined,
    "aria-invalid": invalid ?? (ctx.invalid || undefined),
    ...rest,
  };
}

// ---------- Formular: Körper, Abschnitt und Zeile ----------

/** Stil, den Abschnitte und Zeilen von ihrem Formular erben: `flat` = Einstellungsseite (kein Kartenrahmen, Zeilen mit Linie). */
const FormStyle = createContext({ flat: false });
const FLAT = { flat: true };
const PLAIN = { flat: false };

/**
 * Körper eines Formulars: Container für das Zeilenraster (`FormRow` darin wird bei Platzmangel einspaltig).
 * `flat`: alle Abschnitte darin ohne Karte, mit Abstand 28 und gedämpftem Titel in Kartengröße; alle Zeilen mit Trennlinie
 * unten, 16 Innenabstand und betonter Beschriftung (15 px, fett). Der Stil gilt für Abschnitte und Zeilen darin, auch für
 * Dialoge, die darin gerendert werden: ein verschachteltes `Form` ohne `flat` stellt den Standard wieder her.
 */
export function Form({ flat, className, ...props }: { flat?: boolean } & ComponentProps<"div">) {
  return (
    <FormStyle value={flat ? FLAT : PLAIN}>
      <div className={cn("@container", className)} {...props} />
    </FormStyle>
  );
}

/**
 * Formularabschnitt mit Überschrift (Stufe sub) und Linie unten (nicht beim letzten). Container für das Zeilenraster:
 * unter 1100 px Breite rutscht die Hilfe unter das Steuerelement. `plate`: eigene gewölbte Platte statt Linie.
 * `flat`: ohne Karte und Linie, 28 Abstand nach oben (nicht beim ersten), Titel gedämpft in Kartengröße, Zeilen darin mit Linie
 * (Standard: vom umgebenden `Form`). `danger`: Gefahrenzone, roter Rand (mit `plate`) und roter Titel.
 */
export function FormSection({ title, srOnlyTitle, level = 2, plate, flat: flatProp, danger, className, children, ...props }: {
  title: string; srOnlyTitle?: boolean; level?: 2 | 3; plate?: boolean; flat?: boolean; danger?: boolean;
} & Omit<ComponentProps<"section">, "title">) {
  const inherited = useContext(FormStyle).flat;
  const flat = flatProp ?? inherited;
  return (
    <section className={cn("lk-fsec @container py-[22px]", plate && "px-[22px] pt-[18px] pb-2.5", flat && "mt-7 p-0 first:mt-0", className)} data-plate={flag(plate)} data-flat={flag(flat)} data-danger={flag(danger)} {...props}>
      <Heading level={flat ? "card" : "sub"} as={level === 3 ? "h3" : "h2"} className={srOnlyTitle ? "sr-only" : cn("leading-none", flat ? "mb-3" : "mb-3.5")}>{title}</Heading>
      <FormStyle value={flat ? FLAT : PLAIN}>{children}</FormStyle>
    </section>
  );
}

/** Das erste Steuerelement der Zeile ist 32 hoch (Schalter, Kästchen, Radio, Knopf/Reiter s, auch als erstes Kind einer Gruppe): das Label sitzt ab 521 px Containerbreite 4 px höher auf dessen Mitte. */
const DENSE_LABEL = "@min-[521px]:group-has-[>div:nth-child(2)>:first-child:is(.lk-toggle,.lk-tabs[data-size=s],.lk-btn[data-size=s])]/frow:pt-1.5 @min-[521px]:group-has-[>div:nth-child(2)>:first-child>:first-child:is(.lk-toggle,.lk-btn[data-size=s])]/frow:pt-1.5";

/**
 * Formularzeile: Label (--form-lab) | Steuerelement (bis 560 px) | Hilfe `aside` (rechte Spalte, höchstens 60 Zeichen).
 * Schmaler als 1100 px steht die Hilfe unter dem Steuerelement, unter 520 px das Label über allem (Container-Abfragen).
 * `htmlFor`: Label für genau eine Eingabe; `hint` + `aside` beschreiben sie (per Kontext automatisch).
 * `group`: Auswahlgruppe (Radios) bzw. Gruppe; Label ist ihr Name. `wide`: Inhalt spannt über Steuer- und Hilfespalte.
 * `divided`: Linie unten (nicht an der letzten Zeile) und 16 Innenabstand statt 10; in einem `Form flat` Standard, dort außerdem
 * betonte Beschriftung (15 px, fett) und nur 4 Innenabstand oben, wenn die Zeile als erste unter dem Titel oder im Formular steht.
 */
export function FormRow({ label, hint, htmlFor, group, aside, wide, divided, className, children }: {
  label: ReactNode; hint?: ReactNode; htmlFor?: string; group?: "radiogroup" | "group"; aside?: ReactNode; wide?: boolean; divided?: boolean; className?: string; children: ReactNode;
}) {
  const id = useId();
  const { flat } = useContext(FormStyle);
  const line = divided ?? flat;
  const desc = cn(hint && `${id}-h`, aside && `${id}-a`) || undefined;
  const name = <span id={`${id}-l`}>{label}</span>;
  return (
    <div
      className={cn(
        "lk-frow group/frow grid grid-cols-[var(--form-lab)_minmax(0,560px)_minmax(0,1fr)] items-start gap-x-form-gap gap-y-2 py-2.5",
        "@max-[1099px]:grid-cols-[var(--form-lab)_minmax(0,640px)] @max-[520px]:grid-cols-1",
        aside && "@min-[521px]:@max-[1099px]:grid-rows-[auto_1fr]",
        line && "py-4",
        flat && "first:pt-1 [:is(h2,h3):not(.sr-only)+&]:pt-1",
        className,
      )}
      data-divided={flag(line)}
      data-strong={flag(flat)}
    >
      {/* Der Hinweis steht neben dem Label, nicht darin: sonst gehörte er zum Namen der Eingabe statt zu ihrer Beschreibung. */}
      <div className={cn("lk-fl pt-2.5 @max-[520px]:pt-0", flat && "text-[length:calc(15px*var(--tz))]", DENSE_LABEL, aside && "@min-[521px]:@max-[1099px]:row-span-2")}>
        {htmlFor ? <label htmlFor={htmlFor}>{name}</label> : name}
        {hint && <small id={`${id}-h`} className="lk-fl-sub mt-0.5 block text-ctl-s">{hint}</small>}
      </div>
      <div
        className={cn("col-start-2 flex min-w-0 flex-col gap-2.5 @max-[520px]:col-start-1 [&>.lk-btn]:self-start [&>:is(p,.lk-hint):first-child]:py-2.5", wide && "col-[2/-1] @max-[520px]:col-[1/-1]")}
        role={group}
        aria-labelledby={group ? `${id}-l` : undefined}
        aria-describedby={group ? desc : undefined}
      >
        <FieldContext value={{ describedBy: htmlFor ? desc : undefined }}>{children}</FieldContext>
      </div>
      {aside && (
        <div id={`${id}-a`} className="lk-fh col-start-3 ml-3 max-w-[60ch] pt-2 pr-0 pb-0.5 pl-4 text-ctl-s leading-normal @max-[1099px]:col-start-2 @max-[1099px]:ml-0 @max-[1099px]:p-0 @max-[1099px]:shadow-none @max-[520px]:col-start-1">
          {aside}
        </div>
      )}
    </div>
  );
}

// ---------- Feld (Label über der Eingabe) ----------

/**
 * Label über der Eingabe, darunter Hilfe oder Fehler. Die Eingabe darin bekommt id (ohne `htmlFor`),
 * aria-describedby und aria-invalid automatisch. `reserveLines`: Platz für 1–2 Zeilen Hilfe/Fehler, damit nichts springt.
 * `group`: Inhalt ist eine Gruppe (Segmente, Radios); Label und Hilfe gehen an ein role=group darum.
 */
export function Field({ label, htmlFor, help, error, optional, reserveLines, group, className, children }: {
  label: ReactNode; htmlFor?: string; help?: ReactNode; error?: ReactNode; optional?: boolean; reserveLines?: 1 | 2; group?: boolean; className?: string; children: ReactNode;
}) {
  const { t } = useI18n();
  const uid = useId();
  const id = htmlFor ?? `${uid}-i`;
  const bad = hasContent(error);
  const hasHelp = bad || hasContent(help);
  const descId = `${uid}-d`;
  const labelClass = "lk-field-l text-ctl-m";
  const lab = (
    <>
      {label}
      {optional && <span className="lk-opt"> {t("ui.field.optional")}</span>}
    </>
  );
  return (
    <div className={cn("flex flex-col gap-1.5 not-last:mb-4", className)} data-invalid={flag(bad)}>
      {group ? <span className={labelClass} id={`${uid}-l`}>{lab}</span> : <label className={labelClass} htmlFor={id}>{lab}</label>}
      {group ? (
        <div role="group" aria-labelledby={`${uid}-l`} aria-describedby={hasHelp ? descId : undefined}>{children}</div>
      ) : (
        <FieldContext value={{ id: htmlFor ? undefined : id, describedBy: hasHelp ? descId : undefined, invalid: bad }}>{children}</FieldContext>
      )}
      {(hasHelp || reserveLines) && (
        <div className={cn("lk-help text-ctl-s leading-5", reserveLines === 1 && "min-h-5", reserveLines === 2 && "min-h-10")}>
          {bad ? <Hint tone="bad" live id={descId}>{error}</Hint> : hasHelp && <span id={descId}>{help}</span>}
        </div>
      )}
    </div>
  );
}

type HintTone = Extract<Tone, "neutral" | "warn" | "bad"> | "ok";

const HINT_ICON: Record<HintTone, IconName | undefined> = { neutral: undefined, warn: "warn", bad: "warn", ok: "check" };

/**
 * Kurzer Hinweis unter/neben einem Steuerelement. Warnung und Fehler immer mit Symbol (nie nur Farbe).
 * `live`: wird angesagt, wenn er erscheint oder sich ändert (Fehler als alert, sonst status).
 */
export function Hint({ tone = "neutral", icon, live, id, className, children }: { tone?: HintTone; icon?: IconName | false; live?: boolean; id?: string; className?: string; children: ReactNode }) {
  const ico = icon === false ? undefined : (icon ?? HINT_ICON[tone]);
  return (
    <span id={id} className={cn("lk-hint flex items-start gap-1 text-ctl-s leading-5", className)} data-tone={tone === "neutral" ? undefined : tone} role={live ? (tone === "bad" ? "alert" : "status") : undefined}>
      {ico && <Icon name={ico} size="s" className="-ml-0.5" />}
      <span className="min-w-0">{children}</span>
    </span>
  );
}
