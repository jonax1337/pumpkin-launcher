/**
 * Rückmeldungen des Kits: Leerzustand, Statusplatte, Fortschritt, laufender Vorgang, Platzhalter beim Laden.
 * Aussehen: look/feedback.css (lk-*), Layout: Tailwind in dieser Datei. Toasts: Toaster.tsx.
 */
import type { ComponentProps, CSSProperties, ReactElement, ReactNode } from "react";
import { useI18n } from "@/i18n";
import { cn } from "@/lib/utils";
import { Icon } from "./Icon";
import type { IconName, Tone } from "./types";
import { clamp, cssVars, flag, hasContent } from "./util";
import { IconButton } from "./Button";
import { Count } from "./Chip";
import { Heading } from "./Panel";

// ---------- Leerzustand ----------

const EMPTY = {
  page: { box: "min-h-[360px] gap-3 py-14", level: "dialog" },
  section: { box: "min-h-[280px] gap-3 py-10", level: "section" },
  pane: { box: "min-h-[200px] gap-2.5 py-6", level: "sub" },
} as const;

/**
 * Leerzustand: Bild, Überschrift, ein Satz, Aktionen. `ill` ist ein optionales freies Bild (Glyphe, Szene); ohne wird keines gezeigt.
 * Größe: page 360 · section 280 · pane 200 (Mindesthöhe).
 */
export function Empty({ ill, title, children, actions, size = "section", as = "h2", className }: {
  ill?: ReactNode; title: ReactNode; children?: ReactNode; actions?: ReactNode; size?: keyof typeof EMPTY; as?: "h1" | "h2"; className?: string;
}) {
  return (
    <div className={cn("flex flex-col items-center justify-center px-4 text-center", EMPTY[size].box, className)}>
      {ill != null && ill !== false && <div className="grid min-h-16 min-w-16 place-items-center">{ill}</div>}
      <Heading level={EMPTY[size].level} as={as} className="leading-none">{title}</Heading>
      {children && <p className="lk-empty-p max-w-[44ch]">{children}</p>}
      {actions && <div className="mt-1.5 flex items-center gap-2">{actions}</div>}
    </div>
  );
}

// ---------- Statusplatte ----------

const TONE_ICON: Record<Tone, IconName> = { neutral: "info", acc: "info", warn: "warn", bad: "warn", run: "check" };

const STATUS = {
  m: { box: "min-h-12 gap-3 px-3.5 py-2.5", text: "flex-col gap-0.5" },
  s: { box: "min-h-10 gap-2.5 py-1.5 pr-2.5 pl-3", text: "flex-row flex-wrap items-baseline gap-x-2 text-ctl-s" },
};

/**
 * Hinweisplatte (eingelassen) mit Icon in der Tonfarbe, Text und Aktionen rechts. `icon`: eigenes Element, Icon-Name oder (Standard)
 * das Icon der Tonart; `false` = kein Icon. `title` fett in der ersten Zeile, `children` als Detail (grau). `size` s = eine Zeile
 * (40 px), m = min. 48 px. `role`: alert für Fehler, die sofort angesagt werden sollen; status für wechselnde Zustände.
 */
export function StatusPanel({ tone = "neutral", icon, title, children, actions, size = "m", role, id, as: Tag = "div", className }: {
  tone?: Tone; icon?: IconName | ReactElement | false; title?: ReactNode; children?: ReactNode; actions?: ReactNode; size?: "s" | "m"; role?: "alert" | "status"; id?: string;
  /** `span`: für Platz in einem Absatz (<p>), in dem kein <div> stehen darf. */
  as?: "div" | "span"; className?: string;
}) {
  const lead = icon === false ? null : icon != null && typeof icon !== "string" ? icon : <Icon name={icon ?? TONE_ICON[tone]} size="m" className="lk-status-i" />;
  return (
    <Tag id={id} role={role} className={cn("lk-status lk-pit flex items-center", STATUS[size].box, className)} data-tone={tone === "neutral" ? undefined : tone}>
      {lead}
      <Tag className={cn("lk-status-t flex min-w-0 flex-1", STATUS[size].text)}>
        {hasContent(title) && <b>{title}</b>}
        {hasContent(children) && <span className="text-ctl-s [overflow-wrap:anywhere]">{children}</span>}
      </Tag>
      {actions && <Tag className="flex flex-none items-center gap-2">{actions}</Tag>}
    </Tag>
  );
}

// ---------- Fortschritt ----------

/**
 * XP-Leiste im Slot: Segmente alle 4 Einheiten, Akzentfüllung mit heller Kopfreihe (Höhe 5 Einheiten, `thin` 3); `p` 0–1, ohne `p` unbestimmt.
 * `label` ist der zugängliche Name; `decorative` blendet ihn für Screenreader aus, wenn derselbe Fortschritt schon anders angesagt wird.
 * `tone`: Füllfarbe (Standard Akzent). Die Breite regelt der Aufrufer (`w-48`); ohne füllt die Leiste ihre Zeile.
 */
export function Progress({ p, thin, tone, label, decorative, className, style }: {
  p?: number | null; thin?: boolean; tone?: Exclude<Tone, "neutral">; label?: string; decorative?: boolean; className?: string; style?: CSSProperties;
}) {
  const { t } = useI18n();
  const indeterminate = p == null;
  const v = indeterminate ? 0 : clamp(p, 0, 1);
  const common = {
    className: cn("lk-prog block", thin ? "h-(--u3)" : "h-[calc(var(--px)*5)]", className),
    "data-thin": flag(thin),
    "data-ind": flag(indeterminate),
    "data-tone": tone && tone !== "acc" ? tone : undefined,
    style: { ...style, ...cssVars({ "--p": v }) },
  };
  if (decorative) return <span aria-hidden {...common} />;
  return <span role="progressbar" aria-label={label ?? t("ui.progress.label")} aria-valuemin={0} aria-valuemax={100} aria-valuenow={indeterminate ? undefined : Math.round(v * 100)} {...common} />;
}

/**
 * Laufender Vorgang in einer Zeile oder Liste: Beschriftung (+ Prozent), Segmentbalken, optional `sub` darunter und „Abbrechen“ rechts.
 * Breite der Spalte per `className` (`w-28`, `w-[230px]`); ohne füllt es die Zeile. `full`: voller Balken (5 Einheiten), sonst dünn.
 */
export function JobProgress({ label, sub, p, full, onCancel, cancelLabel, className }: {
  label: string; sub?: ReactNode; p: number | null; full?: boolean; onCancel?: () => void; cancelLabel?: string; className?: string;
}) {
  const { t } = useI18n();
  return (
    <div className="flex min-w-0 items-center gap-2">
      <div className={cn("flex min-w-0 flex-1 flex-col gap-[5px]", className)} role="status">
        <span className="lk-job-l flex min-w-0 items-baseline gap-1.5 text-ctl-s">
          <span className="truncate">{label}</span>
          {p != null && <Count value={`${Math.floor(p * 100)} %`} size={16} className="flex-none" />}
        </span>
        <Progress thin={!full} p={p} label={label} />
        {hasContent(sub) && <span className="lk-job-s truncate text-ctl-s">{sub}</span>}
      </div>
      {onCancel && <IconButton icon="close" size="s" label={cancelLabel ?? t("ui.job.cancelAria", { label })} tip={t("common.cancel")} onClick={onCancel} />}
    </div>
  );
}

// ---------- Laden ----------

/** Platzhalter beim Laden: dunkle Fläche mit Kerbe, pulsiert in Stufen. Größe per Tailwind (`h-14 w-48`) oder `style`. */
export function Skel({ className, style }: { className?: string; style?: CSSProperties }) {
  return <i className={cn("lk-skel block", className)} style={style} aria-hidden />;
}

// ---------- Schritte ----------

/**
 * Fortschritt eines Assistenten: `total` Felder in einer Reihe, die ersten `current` sind gefüllt (Kupfer), die übrigen offen.
 * Das Ganze ist ein Bild mit dem Namen `label`; den Außenabstand setzt der Aufrufer per `className`.
 */
export function Steps({ current, total, label, className }: { current: number; total: number; label: string; className?: string }) {
  return (
    <div className={cn("flex gap-u2", className)} role="img" aria-label={label}>
      {Array.from({ length: total }, (_, i) => (
        <i key={i} className="lk-step h-[calc(var(--px)*5)] w-12" data-done={flag(i < current)} />
      ))}
    </div>
  );
}

// ---------- Ablagefläche ----------

/**
 * Ablagefläche für Dateien: eingelassene Fläche mit gestricheltem Rand, Inhalt (Text, `<b>` hervorgehoben) mittig untereinander.
 * `over`: eine Datei liegt darüber (Text hell, Fläche kupfern getönt). Die Höhe gibt der Aufrufer vor (`h-[190px]`).
 * `overlay`: liegt über dem umgebenden `relative`-Container und füllt ihn; der Inhalt beginnt oben (ein `sticky`-Hinweis bleibt beim Scrollen im Blick).
 */
export function DropZone({ over, overlay, className, ...props }: { over?: boolean; overlay?: boolean } & ComponentProps<"div">) {
  return <div className={cn("lk-drop relative isolate flex flex-col items-center justify-center gap-2 text-center", overlay && "absolute inset-0 z-10 justify-start", className)} data-over={flag(over)} {...props} />;
}
