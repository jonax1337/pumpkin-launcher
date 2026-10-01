/**
 * Dialog, Rückfrage und Seitenpanel des Kits. Verhalten aus Radix; Fokus-Rückgabe, Akzent-Weitergabe und
 * Autofokus-Priorität ergänzt. Aussehen: ui/overlay.css (vx-dlg, vx-sheet). Innerhalb gilt der hellere Hover-Kontext (data-ctx="overlay", tokens.css).
 */
import { isValidElement, useId, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { Dialog as D } from "radix-ui";
import { useI18n } from "@/i18n";
import { Button, IconButton } from "./Button";
import { recentMenuOrigin } from "./menuOrigin";
import { cssVars, flag, hasContent } from "./util";
import type { IconName } from "./types";

/** Dialoghöhe bleibt so weit unter dem Fenster (Rand oben und unten). */
const VIEWPORT_MARGIN_PX = 64;

/**
 * Fokus zurück an den Auslöser. Dialoge öffnen kontrolliert ohne Radix-Trigger; Radix fiele dann auf body zurück.
 * Der Auslöser wird beim Öffnen gemerkt (Fokus liegt noch dort), `restore` gehört in onCloseAutoFocus.
 * Kommt der Dialog aus einem Menüeintrag, zählt der Auslöser des Menüs.
 */
function useReturnFocus(open: boolean) {
  const back = useRef<HTMLElement | null>(null);
  const [acc, setAcc] = useState<string>();
  // Schon beim Öffnen merken, bevor der Inhalt (Portal, eine Runde später) per autoFocus ein Feld fokussiert.
  // onOpenAutoFocus käme dafür zu spät.
  useLayoutEffect(() => {
    if (!open) return;
    const active = document.activeElement;
    back.current = active instanceof HTMLElement && active !== document.body && !active.closest("[role=menu]") ? active : recentMenuOrigin();
    setAcc(accentOf(back.current));
  }, [open]);
  return {
    /** Instanz-Akzent des Auslösers (das Portal erbt --acc nicht); undefined = Kupfer von :root. */
    acc,
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
 * --acc am Auslöser (berechnet, also auch geerbt). Ein Gefahrknopf (data-variant="danger") überschreibt
 * --acc nur für sich, dann zählt sein Umfeld. Nur wenn es vom globalen Kupfer abweicht; die Ableitungen
 * (--acc-hi/-mid/-lo) rechnet pixelkino.css über [style*="--acc:"].
 */
function accentOf(el: HTMLElement | null) {
  if (!el?.isConnected) return undefined;
  const src = el.closest(".vx-btn[data-variant='danger']")?.parentElement ?? el;
  const v = getComputedStyle(src).getPropertyValue("--acc").trim();
  return v && v !== getComputedStyle(document.documentElement).getPropertyValue("--acc").trim() ? v : undefined;
}

/**
 * Erstes Ziel nach Priorität, nicht in Dokument-Reihenfolge: markiert → Eingabe → Hauptknopf → erstes Bedienbare.
 * Hauptknopf: Kit-Primärknopf im Fuß.
 */
const AUTOFOCUS = [
  "[data-autofocus], [autofocus]",
  ".vx-dlg-b input:not([type=checkbox]):not([type=radio]):not([type=file]):not(:disabled), .vx-dlg-b textarea:not(:disabled)",
  ".vx-dlg-f .vx-btn[data-variant='primary']:not(:disabled)",
  "button:not(:disabled), [href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]",
];

function autoFocusTarget(root: HTMLElement) {
  for (const sel of AUTOFOCUS) {
    // Sichtbar, per Tab erreichbar und nicht im Kopf (das Schließen-Kreuz bekommt nie den Startfokus)
    const el = [...root.querySelectorAll<HTMLElement>(sel)].find((n) => n.tabIndex >= 0 && n.getClientRects().length > 0 && !n.closest(".vx-dlg-h"));
    if (el) return el;
  }
  return null;
}

const HEADER_CLASSES = {
  dialog: { head: "vx-dlg-h", text: "vx-dlg-ht", sub: "vx-dlg-sub" },
  sheet: { head: "vx-sheet-h", text: "vx-sheet-ht", sub: "vx-sheet-sub" },
} as const;

/** Kopf von Dialog und Seitenpanel: Titel, Unterzeile, Schließen-Kreuz (IconButton). */
function DialogHeader({ kind, title, sub, closeLabel, busy }: { kind: keyof typeof HEADER_CLASSES; title: ReactNode; sub?: ReactNode; closeLabel: string; busy?: boolean }) {
  const cls = HEADER_CLASSES[kind];
  return (
    <div className={cls.head}>
      <div className={cls.text}>
        <D.Title asChild><h2>{title}</h2></D.Title>
        {sub && <p className={cls.sub}>{sub}</p>}
      </div>
      <D.Close asChild>
        <IconButton icon="x" label={closeLabel} tip={false} disabled={busy} />
      </D.Close>
    </div>
  );
}

/**
 * Dialog mit fester Höhe (kein Nachrutschen, wenn sich der Inhalt ändert): Kopf (Titel 26 px, Schließen = IconButton m),
 * scrollender Körper, Fuß. `height` fest in px; ohne passt er sich an. Fuß: `footer` (meist <DialogActions>) und `footLeft`.
 * Startfokus: [data-autofocus] → erstes Eingabefeld im Körper → Primärknopf im Fuß → erstes Bedienbare; nie das Kreuz.
 * `busy`: die Aktion läuft und ließe sich nicht mehr aufhalten; Kreuz, Esc und Klick daneben schließen dann nicht.
 */
export function Dialog({ open, onOpenChange, title, sub, width = 560, height, footer, footLeft, children, role = "dialog", describedBy, busy }: {
  open: boolean; onOpenChange: (o: boolean) => void; title: ReactNode; sub?: ReactNode; width?: number; height?: number;
  footer?: ReactNode; footLeft?: ReactNode; children: ReactNode;
  /** alertdialog für Rückfragen, die eine Entscheidung verlangen. */
  role?: "dialog" | "alertdialog";
  /** id des Texts, der den Dialog beschreibt (wird beim Öffnen vorgelesen). */
  describedBy?: string;
  busy?: boolean;
}) {
  const ret = useReturnFocus(open);
  const { t } = useI18n();
  return (
    <D.Root open={open} onOpenChange={(o) => !busy && onOpenChange(o)}>
      <D.Portal>
        <D.Overlay className="vx-scrim" />
        <D.Content
          className="vx-dlg"
          data-ctx="overlay"
          role={role}
          aria-describedby={describedBy}
          onOpenAutoFocus={(e) => {
            const target = autoFocusTarget(e.currentTarget as HTMLElement);
            if (!target) return;
            e.preventDefault();
            target.focus({ preventScroll: true });
          }}
          onCloseAutoFocus={ret.restore}
          style={{ ...cssVars({ "--dw": `${width}px`, "--acc": ret.acc }), height: height ? `min(${height}px, calc(100vh - ${VIEWPORT_MARGIN_PX}px))` : undefined }}
        >
          <div className="vx-ov-col">
            <DialogHeader kind="dialog" title={title} sub={sub} closeLabel={t("common.close")} busy={busy} />
            <div className="vx-dlg-b">{children}</div>
            {(footer || footLeft) && (
              <div className="vx-dlg-f">
                {footLeft && <span className="vx-dlg-left">{footLeft}</span>}
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
  /** Feste Breite (px), damit „Speichern“ ↔ „Einen Moment“ nichts verschiebt. */
  width?: number;
  variant?: "primary" | "danger";
  icon?: IconName;
  disabled?: boolean;
  /** id eines <form>: Knopf ist dann dessen Absenden (type=submit). */
  form?: string;
  onClick?: () => void;
};
type CancelSpec = { label: ReactNode; width?: number; autoFocus?: boolean; disabled?: boolean };
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
          <Button width={c.width} disabled={c.disabled} data-autofocus={flag(c.autoFocus)}>{c.label}</Button>
        </D.Close>
      )}
      {confirm && (
        <Button
          variant={confirm.variant ?? "primary"}
          width={confirm.width}
          icon={confirm.icon}
          disabled={confirm.disabled}
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
 * Rückfrage vor einer Aktion, z. B. Löschen oder „Minecraft beenden?“.
 * `danger` (Standard): roter Hauptknopf, Startfokus auf „Abbrechen“ (Enter löst nichts Unumkehrbares aus), role=alertdialog.
 * Ohne `danger`: Akzentknopf mit Startfokus. `text` beschreibt den Dialog (aria-describedby).
 * Während `pending` ist alles gesperrt: die Aktion läuft schon, „Abbrechen“ hielte sie nicht mehr auf.
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
      width={460}
      role={danger ? "alertdialog" : "dialog"}
      describedBy={text ? textId : undefined}
      busy={pending}
      footer={
        <DialogActions
          cancel={{ label: cancelLabel ?? t("common.cancel"), autoFocus: danger, disabled: pending }}
          confirm={{ label: pending ? (pendingLabel ?? t("ui.dialog.pending")) : (confirmLabel ?? t("common.delete")), variant: danger ? "danger" : "primary", width: 130, disabled: pending, onClick: onConfirm }}
        />
      }
    >
      {text && <p id={textId}>{text}</p>}
    </Dialog>
  );
}

/** Seitenpanel rechts (Katalog im Kontext einer Instanz). Nicht modal: die Liste daneben bleibt bedienbar. */
export function Sheet({ open, onOpenChange, title, sub, acc, children, tools }: { open: boolean; onOpenChange: (o: boolean) => void; title: ReactNode; sub?: ReactNode; acc?: string; children: ReactNode; tools?: ReactNode }) {
  const { t } = useI18n();
  const ret = useReturnFocus(open);
  return (
    <D.Root open={open} onOpenChange={onOpenChange} modal={false}>
      <D.Portal>
        <D.Content
          className="vx-sheet"
          data-ctx="overlay"
          aria-describedby={undefined}
          style={cssVars({ "--acc": acc ?? ret.acc })}
          onInteractOutside={(e) => e.preventDefault()}
          onCloseAutoFocus={ret.restore}
        >
          <div className="vx-ov-col">
            <DialogHeader kind="sheet" title={title} sub={sub} closeLabel={t("ui.sheet.closeAria")} />
            {tools && <div className="vx-sheet-t">{tools}</div>}
            <div className="vx-sheet-b">{children}</div>
          </div>
        </D.Content>
      </D.Portal>
    </D.Root>
  );
}
