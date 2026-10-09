/**
 * Dialog und Rückfrage des Kits. Verhalten (Radix, Fokus-Rückgabe, Akzent-Weitergabe, Startfokus) kommt aus dialogBehavior.ts
 * (`useReturnFocus`, `autoFocusTarget`); Aussehen aus look/dialog.css, Maße und Anordnung als Tailwind-Utilities hier.
 * Breite und Höhe wählt der Aufrufer per `className` an der Fläche (`[--dw:480px]`, `h-[380px]`); `size`/`height` sind die Kurzformen.
 */
import { isValidElement, useId, type ReactNode } from "react";
import { Dialog as D } from "radix-ui";
import { useI18n } from "@/i18n";
import { cn } from "@/lib/utils";
import { autoFocusTarget, useReturnFocus } from "./dialogBehavior";
import { cssVars, flag, hasContent } from "./util";
import type { IconName } from "./types";
import { Button, IconButton } from "./Button";
import { Heading } from "./Panel";

/**
 * Abdunklung hinter einer modalen Fläche (Dialog, Rückfrage, Vollbildansicht). Muss unter einem Radix-`Dialog.Root` stehen, dessen
 * Zustand das Ein- und Ausblenden steuert. `className` ergänzt die Lage (Standard: das ganze Fenster, Ebene 64 unter den Flächen bei 66).
 */
export function Scrim({ className }: { className?: string }) {
  return <D.Overlay className={cn("lk-scrim fixed inset-0 z-64", className)} />;
}

/** Breite (--dw): s 480 (Rückfrage, Name), m 640 (Standard), l 860 (zweispaltig). Das Fenster begrenzt über `w-[min(…)]`. */
const WIDTH = { s: "[--dw:480px]", m: "[--dw:640px]", l: "[--dw:860px]" } as const;
/** Feste Höhe (kein Nachrutschen, wenn sich der Inhalt ändert): s 380, m 580, l 700; das Fenster begrenzt über `max-h`. */
const HEIGHT = { s: "h-[380px]", m: "h-[580px]", l: "h-[700px]" } as const;

/**
 * Dialog: Kopf (Titel Stufe dialog, Schließen = IconButton s), scrollender Körper, Fuß. Ohne `height` passt er sich an.
 * Startfokus: [data-autofocus] → erstes Eingabefeld im Körper → Primärknopf im Fuß → erstes Bedienbare; nie das Kreuz.
 * `busy`: die Aktion läuft und ließe sich nicht mehr aufhalten; Kreuz, Esc und Klick daneben schließen dann nicht.
 */
export function Dialog({ open, onOpenChange, title, sub, size = "m", height, className, footer, footLeft, children, role = "dialog", describedBy, busy, fill }: {
  open: boolean; onOpenChange: (o: boolean) => void; title: ReactNode; sub?: ReactNode; size?: keyof typeof WIDTH; height?: keyof typeof HEIGHT; className?: string;
  footer?: ReactNode; footLeft?: ReactNode; children: ReactNode;
  /** alertdialog für Rückfragen, die eine Entscheidung verlangen. */
  role?: "dialog" | "alertdialog";
  /** id des Texts, der den Dialog beschreibt (wird beim Öffnen vorgelesen). */
  describedBy?: string;
  busy?: boolean;
  /** Der Körper scrollt nicht selbst, sondern ist eine Spalte, die der Inhalt füllt (Eingabefeld oben, darunter eine scrollende Liste: `min-h-0 flex-1`). Braucht `height`. */
  fill?: boolean;
}) {
  const ret = useReturnFocus(open);
  const { t } = useI18n();
  return (
    <D.Root open={open} onOpenChange={(o) => !busy && onOpenChange(o)}>
      <D.Portal>
        <Scrim />
        <D.Content
          className={cn(
            "lk-dlg fixed top-1/2 left-1/2 z-66 flex flex-col p-u2 [transform:translate(-50%,-50%)]",
            "w-[min(var(--dw),calc(var(--vw1,1vw)*100_-_32px))] max-h-[calc(var(--vh1,1vh)*100_-_80px)]",
            WIDTH[size], height && HEIGHT[height], className,
          )}
          data-ctx="overlay"
          data-kit-overlay="dialog"
          role={role}
          aria-describedby={describedBy}
          onOpenAutoFocus={(e) => {
            const target = autoFocusTarget(e.currentTarget as HTMLElement);
            if (!target) return;
            e.preventDefault();
            target.focus({ preventScroll: true });
          }}
          onCloseAutoFocus={ret.restore}
          style={cssVars({ "--acc": ret.acc })}
        >
          <div className="flex min-h-0 flex-1 flex-col gap-u2">
            <div className={cn("lk-dlg-h flex flex-none items-center gap-3 py-1 pr-1 pl-3", sub && "py-2")} data-kit-part="dialog-head">
              <div className="min-w-0 flex-1">
                <D.Title asChild><Heading level="dialog" as="h2">{title}</Heading></D.Title>
                {sub && <p className="lk-dlg-sub mt-1.5 text-ctl-s">{sub}</p>}
              </div>
              <D.Close asChild>
                <IconButton icon="close" label={t("common.close")} size="s" tip={false} disabled={busy} />
              </D.Close>
            </div>
            <div className={cn("lk-dlg-b lk-pit min-h-0 flex-1 p-4 [scrollbar-gutter:stable] [&_p]:max-w-[60ch] [&_p]:leading-normal", fill ? "flex flex-col overflow-hidden" : "overflow-y-auto")} data-kit-part="dialog-body">{children}</div>
            {(footer || footLeft) && (
              <div className="lk-dlg-f flex flex-none flex-wrap items-center justify-end gap-3 p-1.5" data-kit-part="dialog-foot">
                {footLeft && <span className="lk-dlg-left mr-auto pl-1.5 text-ctl-s">{footLeft}</span>}
                {footer}
              </div>
            )}
          </div>
        </D.Content>
      </D.Portal>
    </D.Root>
  );
}

type ConfirmSpec = {
  label: ReactNode;
  /** Klassen des Knopfs, z. B. eine feste Breite (`w-[130px]`), damit „Speichern“ ↔ „Einen Moment“ nichts verschiebt. */
  className?: string;
  variant?: "primary" | "danger";
  icon?: IconName;
  disabled?: boolean;
  /** Fokus beim Einblenden, wenn die Hauptaktion erst nach dem Öffnen erscheint (Fokus läge sonst auf dem Dialog). */
  autoFocus?: boolean;
  /** id eines <form>: Knopf ist dann dessen Absenden (type=submit). */
  form?: string;
  onClick?: () => void;
};
type CancelSpec = { label: ReactNode; className?: string; autoFocus?: boolean; disabled?: boolean };
const isCancelSpec = (c: unknown): c is CancelSpec => !!c && typeof c === "object" && !isValidElement(c) && "label" in c;

/**
 * Fuß eines Dialogs: rechts „Abbrechen“ (schließt) und die Hauptaktion; ein Hinweis links gehört an `Dialog.footLeft`.
 * `cancel` als Text oder mit `autoFocus` (Gefahr: Enter löst nichts Unumkehrbares aus).
 */
export function DialogActions({ cancel, confirm }: { cancel?: ReactNode | CancelSpec; confirm?: ConfirmSpec }) {
  const c: CancelSpec | null = isCancelSpec(cancel) ? cancel : hasContent(cancel) ? { label: cancel } : null;
  return (
    <>
      {c && (
        <D.Close asChild>
          <Button variant="ghost" className={c.className} disabled={c.disabled} data-autofocus={flag(c.autoFocus)}>{c.label}</Button>
        </D.Close>
      )}
      {confirm && (
        <Button
          variant={confirm.variant ?? "primary"}
          className={confirm.className}
          icon={confirm.icon}
          disabled={confirm.disabled}
          autoFocus={confirm.autoFocus}
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
 * Rückfrage vor einer Aktion, z. B. Löschen. `danger` (Standard): roter Hauptknopf, Startfokus auf „Abbrechen“, role=alertdialog.
 * Ohne `danger`: Akzentknopf mit Startfokus. `text` beschreibt den Dialog. Während `pending` ist alles gesperrt.
 */
export function ConfirmDialog({ open, onOpenChange, title, text, confirmLabel, cancelLabel, pendingLabel, pending, danger = true, onConfirm }: {
  open: boolean; onOpenChange: (o: boolean) => void; title: string; text?: ReactNode; confirmLabel?: string; cancelLabel?: string; pendingLabel?: string;
  pending?: boolean; danger?: boolean; onConfirm: () => void;
}) {
  const { t } = useI18n();
  const textId = useId();
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={title}
      size="s"
      role={danger ? "alertdialog" : "dialog"}
      describedBy={text ? textId : undefined}
      busy={pending}
      footer={
        <DialogActions
          cancel={{ label: cancelLabel ?? t("common.cancel"), autoFocus: danger, disabled: pending }}
          confirm={{ label: pending ? (pendingLabel ?? t("ui.dialog.pending")) : (confirmLabel ?? t("common.delete")), variant: danger ? "danger" : "primary", className: "w-[130px]", disabled: pending, onClick: onConfirm }}
        />
      }
    >
      {text && <p id={textId}>{text}</p>}
    </Dialog>
  );
}
