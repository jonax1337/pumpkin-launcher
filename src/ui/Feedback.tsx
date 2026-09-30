/**
 * Rückmeldungen des Kits: Leerzustand, Statusplatte (Fehler/Hinweis/Gefahr), Fortschritt, laufender Vorgang,
 * Platzhalter beim Laden, Toasts. Aussehen: ui/feedback.css (vx-*).
 */
import { type CSSProperties, type ReactElement, type ReactNode } from "react";
import { Toaster as Sonner } from "sonner";
import { cn } from "@/lib/utils";
import { Buddy } from "@/branding/Brand";
import { ICON_DATA } from "@/pixel/icon-data";
import { Icon } from "./Icon";
import { Button, IconButton, buttonClass } from "./Button";
import { Count } from "./Chip";
import type { IconName, Tone } from "./types";

// ---------- Leerzustand ----------

const isIconName = (v: unknown): v is IconName => typeof v === "string" && v in ICON_DATA;

/**
 * Leerzustand: Bild, Überschrift, ein Satz, Aktionen. `ill` als Icon-Name (Icon xl, 56 px) oder freies Bild (Glyphe, Szene).
 * `size`: page = ganze Fläche (Überschrift 26, min. 360 px), section = Abschnitt/Liste (22, min. 280), pane = Dialog/Panel (20, min. 200).
 * `asPage`: Der Leerzustand ist die ganze Seite, sein Titel die Seitenüberschrift (h1, sonst h2).
 */
export function Empty({ ill, title, children, actions, size = "section", asPage, className }: {
  ill?: IconName | ReactNode; title: ReactNode; children?: ReactNode; actions?: ReactNode; size?: "page" | "section" | "pane"; asPage?: boolean; className?: string;
}) {
  const H = asPage ? "h1" : "h2";
  return (
    <div className={cn("vx-empty", className)} data-size={size}>
      {ill !== false && <div className="vx-empty-ill">{ill == null || isIconName(ill) ? <Buddy size={96} mood={ill === 'tasks' || ill === 'term' ? 'sleep' : 'idle'} /> : ill}</div>}
      <H className="vx-empty-t">{title}</H>
      {children && <p className="vx-empty-p">{children}</p>}
      {actions && <div className="vx-empty-a">{actions}</div>}
    </div>
  );
}

// ---------- Statusplatte ----------

/**
 * Getönte Platte mit Icon, Text und Aktionen rechts (ersetzt .errbox, .logstat, .danger und Hinweis-Boxen).
 * `title` fett in der ersten Zeile, `children` als Detail darunter (grau). `size`: s = 44 px, eine Zeile, Text mit Auslassung
 * (Statuszeile über dem Protokoll); m = min. 56 px, Text bricht um.
 * `role`: alert für Fehler, die sofort angesagt werden sollen; status für wechselnde Zustände.
 */
export function StatusPanel({ tone = "neutral", icon, title, children, actions, size = "m", role, id, className }: {
  tone?: Tone; icon?: IconName | ReactElement | false; title?: ReactNode; children?: ReactNode; actions?: ReactNode; size?: "s" | "m"; role?: "alert" | "status"; id?: string; className?: string;
}) {
  return (
    <div id={id} role={role} className={cn("vx-status", className)} data-tone={tone === "neutral" ? undefined : tone} data-size={size}>
      {icon !== false && (icon != null && !isIconName(icon) ? icon : <Icon name={icon ?? (tone === "bad" || tone === "warn" ? "warn" : tone === "run" ? "check" : "info")} size="m" className="vx-status-i" />)}
      <div className="vx-status-t">
        {title != null && title !== "" && <b>{title}</b>}
        {children != null && children !== "" && <span>{children}</span>}
      </div>
      {actions && <div className="vx-status-a">{actions}</div>}
    </div>
  );
}

const message = (error: unknown) => (error instanceof Error ? error.message : String(error));

/** Fehler in Alltagssprache; mit `title` ist die Backend-Meldung das Detail. `onRetry` → „Erneut versuchen“. */
export function ErrorBox({ error, title, onRetry, className }: { error: unknown; title?: string; onRetry?: () => void; className?: string }) {
  return (
    <StatusPanel
      tone="bad"
      icon={<Buddy mood="oops" size={48} />}
      role="alert"
      className={className}
      title={title ?? message(error)}
      actions={onRetry && <Button size="s" icon="redo" onClick={onRetry}>Erneut versuchen</Button>}
    >
      {title ? message(error) : undefined}
    </StatusPanel>
  );
}

// ---------- Fortschritt ----------

/**
 * Segmentierter Fortschritt: Zellen 2 Einheiten, Lücke 1 (Höhe 3 Einheiten, `thin` 2); `p` 0–1, ohne `p` unbestimmt.
 * `label` ist der zugängliche Name (worum es geht, z. B. „Mods herunterladen“); `decorative` blendet ihn für Screenreader aus,
 * wenn derselbe Fortschritt schon anders angesagt wird. `tone`: Füllfarbe (Standard Akzent).
 */
export function Progress({ p, thin, tone, label = "Fortschritt", decorative, width, className, style }: {
  p?: number | null; thin?: boolean; tone?: "acc" | "bad" | "run" | "warn"; label?: string; decorative?: boolean; width?: number | "full"; className?: string; style?: CSSProperties;
}) {
  const ind = p == null;
  const v = ind ? 0 : Math.max(0, Math.min(1, p));
  const look = {
    className: cn("vx-prog", className),
    "data-thin": thin ? "" : undefined,
    "data-ind": ind ? "" : undefined,
    "data-tone": tone && tone !== "acc" ? tone : undefined,
    style: { ...style, ...(width != null && { width: width === "full" ? "100%" : width }), ["--p" as string]: v },
  };
  if (decorative) return <span aria-hidden {...look} />;
  return <span role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={ind ? undefined : Math.round(v * 100)} {...look} />;
}

/**
 * Laufender Vorgang in einer Zeile oder Liste: Beschriftung (+ Prozent), Segmentbalken, optional `sub` darunter
 * und „Abbrechen“ (IconButton s) rechts. Ersetzt JobCell (Katalog) und den Balken der Aufgabenliste.
 * `width`: feste Breite der Spalte (112 Kachel, 120 Zeile, 230 groß); ohne füllt es die Breite. Ab 230 ist der Balken 3 Einheiten hoch.
 */
export function JobProgress({ label, sub, p, width, onCancel, cancelLabel, className }: {
  label: string; sub?: ReactNode; p: number | null; width?: 112 | 120 | 230; onCancel?: () => void; cancelLabel?: string; className?: string;
}) {
  return (
    <div className={cn("vx-job", className)}>
      <div className="vx-job-m" role="status" style={width ? { width } : undefined} data-w={width ? "" : undefined}>
        <span className="vx-job-l">
          <span className="vx-trunc">{label}</span>
          {p != null && <Count value={`${Math.floor(p * 100)} %`} size={16} />}
        </span>
        <Progress thin={width !== 230} p={p} label={label} />
        {sub != null && sub !== "" && <span className="vx-job-s vx-trunc">{sub}</span>}
      </div>
      {onCancel && <IconButton icon="x" size="s" label={cancelLabel ?? `${label} abbrechen`} tip="Abbrechen" onClick={onCancel} />}
    </div>
  );
}

// ---------- Laden ----------

/** Platzhalter beim Laden: dunkle Fläche mit Kerbe, pulsiert in Stufen. Größe per `w`/`h` (px oder CSS-Länge) oder style. */
export function Skel({ w, h, className, style }: { w?: number | string; h?: number | string; className?: string; style?: CSSProperties }) {
  return <i className={cn("vx-skel", className)} style={{ ...style, ...(w != null && { width: w }), ...(h != null && { height: h }) }} aria-hidden />;
}

// ---------- Toasts ----------

/**
 * Toasts (Sonner) unten rechts: Platte mit Bevel, Icon m (Farbe je Art), Text, Aktion als Geist-Knopf s darunter,
 * Schließen als Symbolknopf s. Einmal in main.tsx eingehängt.
 */
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
        success: <Buddy mood="success" size={48} />,
        info: <Buddy mood="hello" size={48} />,
        warning: <Icon name="warn" />,
        error: <Buddy mood="oops" size={48} />,
        loading: <Buddy mood="loading" size={48} />,
        close: <Icon name="x" size="s" />,
      }}
      toastOptions={{
        unstyled: true,
        duration: 6500,
        closeButtonAriaLabel: "Schließen",
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
