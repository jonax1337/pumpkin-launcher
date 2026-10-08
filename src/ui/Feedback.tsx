/**
 * Rückmeldungen des Kits: Leerzustand, Statusplatte (Fehler/Hinweis/Gefahr), Fortschritt, laufender Vorgang,
 * Platzhalter beim Laden, Toasts. Aussehen: ui/feedback.css (vx-*).
 */
import { type CSSProperties, type ReactElement, type ReactNode } from "react";
import { Toaster as Sonner } from "sonner";
import { cn } from "@/lib/utils";
import { Buddy, type BuddyMood } from "@/branding/Brand";
import { useI18n } from "@/i18n";
import { Icon } from "./Icon";
import { Button, IconButton, buttonClass } from "./Button";
import { Count } from "./Chip";
import { clamp, cssVars, flag, hasContent, widthStyle } from "./util";
import type { IconName, Tone } from "./types";

// ---------- Leerzustand ----------

/**
 * Leerzustand: Bild, Überschrift, ein Satz, Aktionen. `ill` ist ein freies Bild (Glyphe, Szene); ohne steht der Buddy
 * in Stimmung `mood`, `false` lässt das Bild weg.
 * `size`: page = ganze Fläche (Überschrift 26, min. 360 px), section = Abschnitt/Liste (22, min. 280), pane = Dialog/Panel (20, min. 200).
 * `as`: Element der Überschrift; h1, wenn der Leerzustand die ganze Seite ist und sein Titel die Seitenüberschrift.
 */
export function Empty({ ill, mood = "idle", title, children, actions, size = "section", as: Heading = "h2", className }: {
  ill?: ReactNode; mood?: BuddyMood; title: ReactNode; children?: ReactNode; actions?: ReactNode; size?: "page" | "section" | "pane"; as?: "h1" | "h2"; className?: string;
}) {
  return (
    <div className={cn("vx-empty", className)} data-size={size}>
      {ill !== false && <div className="vx-empty-ill">{ill ?? <Buddy size={96} mood={mood} />}</div>}
      <Heading className="vx-empty-t">{title}</Heading>
      {children && <p className="vx-empty-p">{children}</p>}
      {actions && <div className="vx-empty-a">{actions}</div>}
    </div>
  );
}

// ---------- Statusplatte ----------

const TONE_ICON: Record<Tone, IconName> = { neutral: "info", acc: "info", warn: "warn", bad: "warn", run: "check" };

/** Eigenes Element, Icon-Name oder das Standard-Icon der Tonart; `false` = kein Icon. */
function StatusIcon({ icon, tone }: { icon?: IconName | ReactElement | false; tone: Tone }) {
  if (icon === false) return null;
  if (icon != null && typeof icon !== "string") return icon;
  return <Icon name={icon ?? TONE_ICON[tone]} size="m" className="vx-status-i" />;
}

/**
 * Hinweisplatte (eingelassen) mit Icon in der Tonfarbe, Text und Aktionen rechts (Fehler, Statuszeile, Gefahrenbereich, Hinweis-Boxen).
 * `title` fett in der ersten Zeile, `children` als Detail darunter (grau). `size`: s = 40 px, eine Zeile, Text mit Auslassung
 * (Statuszeile über dem Protokoll); m = min. 48 px, Text bricht um.
 * `role`: alert für Fehler, die sofort angesagt werden sollen; status für wechselnde Zustände.
 */
export function StatusPanel({ tone = "neutral", icon, title, children, actions, size = "m", role, id, className }: {
  tone?: Tone; icon?: IconName | ReactElement | false; title?: ReactNode; children?: ReactNode; actions?: ReactNode; size?: "s" | "m"; role?: "alert" | "status"; id?: string; className?: string;
}) {
  return (
    <div id={id} role={role} className={cn("vx-status vx-pit", className)} data-tone={tone === "neutral" ? undefined : tone} data-size={size}>
      <StatusIcon icon={icon} tone={tone} />
      <div className="vx-status-t">
        {hasContent(title) && <b>{title}</b>}
        {hasContent(children) && <span>{children}</span>}
      </div>
      {actions && <div className="vx-status-a">{actions}</div>}
    </div>
  );
}

const message = (error: unknown) => (error instanceof Error ? error.message : String(error));

/** Fehler in Alltagssprache; mit `title` ist die Backend-Meldung das Detail. `onRetry` → „Erneut versuchen“. */
export function ErrorBox({ error, title, onRetry, className }: { error: unknown; title?: string; onRetry?: () => void; className?: string }) {
  const { t } = useI18n();
  return (
    <StatusPanel
      tone="bad"
      icon={<Buddy mood="oops" size={48} />}
      role="alert"
      className={className}
      title={title ?? message(error)}
      actions={onRetry && <Button size="s" icon="refresh" onClick={onRetry}>{t("common.retry")}</Button>}
    >
      {title ? message(error) : undefined}
    </StatusPanel>
  );
}

// ---------- Fortschritt ----------

/**
 * XP-Leiste im Slot: Segmente alle 4 Einheiten, Akzentfüllung mit heller Kopfreihe (Höhe 5 Einheiten, `thin` 3); `p` 0–1, ohne `p` unbestimmt.
 * `label` ist der zugängliche Name (worum es geht, z. B. „Mods herunterladen“); `decorative` blendet ihn für Screenreader aus,
 * wenn derselbe Fortschritt schon anders angesagt wird. `tone`: Füllfarbe (Standard Akzent). `width`: feste Breite in px.
 */
export function Progress({ p, thin, tone, label, decorative, width, className, style }: {
  p?: number | null; thin?: boolean; tone?: Exclude<Tone, "neutral">; label?: string; decorative?: boolean; width?: number; className?: string; style?: CSSProperties;
}) {
  const { t } = useI18n();
  const indeterminate = p == null;
  const name = label ?? t("ui.progress.label");
  const v = indeterminate ? 0 : clamp(p, 0, 1);
  const look = {
    className: cn("vx-prog", className),
    "data-thin": flag(thin),
    "data-ind": flag(indeterminate),
    "data-tone": tone && tone !== "acc" ? tone : undefined,
    style: { ...widthStyle(width, style), ...cssVars({ "--p": v }) },
  };
  if (decorative) return <span aria-hidden {...look} />;
  return <span role="progressbar" aria-label={name} aria-valuemin={0} aria-valuemax={100} aria-valuenow={indeterminate ? undefined : Math.round(v * 100)} {...look} />;
}

/** Breite der großen Vorgangsanzeige; erst ab hier ist der Balken 5 statt 3 Einheiten hoch. */
const LARGE_JOB_WIDTH = 230;

/**
 * Laufender Vorgang in einer Zeile oder Liste: Beschriftung (+ Prozent), Segmentbalken, optional `sub` darunter
 * und „Abbrechen“ (IconButton s) rechts.
 * `width`: feste Breite der Spalte (112 Kachel, 120 Zeile, 230 groß); ohne füllt es die Breite.
 * `full`: voller Balken (5 Einheiten) auch ohne große Breite, z. B. im Aufgaben-Popover.
 */
export function JobProgress({ label, sub, p, width, full, onCancel, cancelLabel, className }: {
  label: string; sub?: ReactNode; p: number | null; width?: 112 | 120 | typeof LARGE_JOB_WIDTH; full?: boolean; onCancel?: () => void; cancelLabel?: string; className?: string;
}) {
  const { t } = useI18n();
  return (
    <div className={cn("vx-job", className)}>
      <div className="vx-job-m" role="status" style={widthStyle(width)} data-w={flag(width)}>
        <span className="vx-job-l">
          <span className="vx-trunc">{label}</span>
          {p != null && <Count value={`${Math.floor(p * 100)} %`} size={16} />}
        </span>
        <Progress thin={width !== LARGE_JOB_WIDTH && !full} p={p} label={label} />
        {hasContent(sub) && <span className="vx-job-s vx-trunc">{sub}</span>}
      </div>
      {onCancel && <IconButton icon="close" size="s" label={cancelLabel ?? t("ui.job.cancelAria", { label })} tip={t("common.cancel")} onClick={onCancel} />}
    </div>
  );
}

// ---------- Laden ----------

/** Platzhalter beim Laden: dunkle Fläche mit Kerbe, pulsiert in Stufen. Größe per `w`/`h` (px oder CSS-Länge) oder style. */
export function Skel({ w, h, className, style }: { w?: number | string; h?: number | string; className?: string; style?: CSSProperties }) {
  return <i className={cn("vx-skel", className)} style={{ ...style, ...(w != null && { width: w }), ...(h != null && { height: h }) }} aria-hidden />;
}

// ---------- Toasts ----------

/** So lange bleibt ein Toast stehen. */
const TOAST_DURATION_MS = 6500;

/**
 * Toasts (Sonner) unten rechts: Advancement-Platte (Steinplatte), Symbol im Slot (Farbe je Art), Text, Aktion als Geist-Knopf s
 * rechts daneben, Schließen als Symbolknopf s. Fehler und Warnung tragen Warnsymbol und Statusfarbe im Symbol-Slot.
 * Einmal in main.tsx eingehängt.
 */
export function Toaster() {
  const { t } = useI18n();
  return (
    <Sonner
      position="bottom-right"
      closeButton
      gap={12}
      offset={24}
      visibleToasts={4}
      containerAriaLabel={t("ui.toast.containerAria")}
      icons={{
        success: <Buddy mood="success" size={48} />,
        info: <Buddy mood="hello" size={48} />,
        warning: <Icon name="warn" />,
        error: <Icon name="warn" />,
        loading: <Buddy mood="loading" size={48} />,
        close: <Icon name="close" size="s" />,
      }}
      toastOptions={{
        unstyled: true,
        duration: TOAST_DURATION_MS,
        closeButtonAriaLabel: t("common.close"),
        classNames: {
          toast: "vx-toast",
          actionButton: buttonClass({ variant: "ghost", size: "s", tone: "acc" }),
          cancelButton: buttonClass({ variant: "ghost", size: "s" }),
          closeButton: cn(buttonClass({ variant: "ghost", size: "s" }), "vx-ib"),
        },
      }}
    />
  );
}
