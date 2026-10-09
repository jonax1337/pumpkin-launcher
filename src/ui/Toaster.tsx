/**
 * Toasts (Sonner) des Kits, unten rechts: Advancement-Platte (Steinplatte), Symbol im Slot (Farbe je Art), Text, Aktion als
 * Geistknopf s rechts daneben, Schließen als Symbolknopf s. Aussehen: look/toast.css (lk-*), Raster und Maße als Tailwind-Klassen je Teil
 * (Sonner reicht sie über `classNames` durch). Sonner hält einen globalen Speicher: pro App genau ein Toaster.
 */
import { Toaster as Sonner } from "sonner";
import { useI18n } from "@/i18n";
import { cn } from "@/lib/utils";
import { Icon } from "./Icon";
import { cssVars } from "./util";

/** So lange bleibt ein Toast stehen. */
const TOAST_DURATION_MS = 6500;

/**
 * Raster Symbol | Text (≥ 120 px) | Aktion | Schließen, Mindesthöhe 56. Ohne Symbol fällt die erste Spalte weg. Beide Knöpfe (Abbrechen und
 * Aktion) passen neben dem Text nicht in die Breite: sie liegen nebeneinander in der Zeile darunter (`group/toast`).
 */
const TOAST = [
  "lk-toast group/toast grid min-h-14 w-(--lk-toast-w,460px) grid-cols-[42px_minmax(120px,1fr)_auto_32px] items-center gap-x-3 py-3 pr-2 pl-3 text-ctl-m",
  "not-has-[>[data-icon]]:grid-cols-[0_minmax(120px,1fr)_auto_32px] not-has-[>[data-icon]]:pl-1.5",
  "has-[[data-cancel]]:has-[[data-action]]:gap-y-2",
].join(" ");

/** Symbol im eigenen Slot 42. `relative`: Sonners Lade-Symbol (`.sonner-loader`) ist absolut mittig und braucht den Slot als Bezug, sonst sitzt es in der Mitte des Toasts. */
const ICON = "lk-toast-i relative col-1 row-1 m-0 grid size-[42px] place-items-center";
/** Text bricht um und wird nie abgeschnitten (Fehlermeldungen tragen die Ursache); Sonner misst die Höhe beim Einblenden. */
const CONTENT = "col-2 row-1 flex min-w-0 flex-col gap-0.5 group-has-[[data-cancel]]/toast:group-has-[[data-action]]/toast:col-[2/4]";
const TITLE = "lk-toast-t text-[length:calc(15px*var(--tz))] leading-[1.3] wrap-anywhere";
const DESCRIPTION = "lk-toast-d text-ctl-s leading-[1.4] wrap-anywhere";

/** Geistknopf s (32 hoch, Innenabstand 8, Schrift 13; die Versalmitte der Schrift sitzt 1 px tiefer, wie `--b-nudge` am Knopf). */
const BUTTON = "lk-tbtn relative m-0 inline-flex h-ctl-s shrink-0 items-center justify-center px-2 pt-[2px] text-ctl-s whitespace-nowrap";
const ACTION = cn(BUTTON, "col-3 row-1 justify-self-end group-has-[[data-cancel]]/toast:row-2");
const CANCEL = cn(BUTTON, "col-3 row-1 justify-self-end group-has-[[data-action]]/toast:col-2 group-has-[[data-action]]/toast:row-2");
/** Schließen: Symbolknopf s (32 × 32); das Symbol sitzt wie am Geistknopf s 1 px tiefer (Innenabstand oben 2). */
const CLOSE = "lk-tbtn relative inset-auto col-4 row-1 m-0 inline-flex size-ctl-s shrink-0 transform-none items-center justify-center p-0 pt-[2px]";

/**
 * Toasts (Sonner) unten rechts. Einmal in der App einhängen, eigene Breite per `className` (`[--lk-toast-w:520px]`).
 * Alle Arten tragen ein Symbol im Symbol-Slot (Erfolg Haken, Info, Warnung/Fehler Warnsymbol, Laden Uhr) und die Statusfarbe.
 */
export function Toaster({ className }: { className?: string }) {
  const { t } = useI18n();
  return (
    <Sonner
      className={cn("lk-toaster [--lk-toast-w:460px]", className)}
      style={cssVars({ "--width": "var(--lk-toast-w)" })}
      position="bottom-right"
      closeButton
      gap={12}
      offset={24}
      visibleToasts={4}
      containerAriaLabel={t("ui.toast.containerAria")}
      icons={{
        success: <Icon name="check" />,
        info: <Icon name="info" />,
        warning: <Icon name="warn" />,
        error: <Icon name="warn" />,
        loading: <Icon name="clock" />,
        close: <Icon name="close" size="s" />,
      }}
      toastOptions={{
        unstyled: true,
        duration: TOAST_DURATION_MS,
        closeButtonAriaLabel: t("common.close"),
        classNames: {
          toast: TOAST,
          icon: ICON,
          content: CONTENT,
          title: TITLE,
          description: DESCRIPTION,
          actionButton: ACTION,
          cancelButton: CANCEL,
          closeButton: CLOSE,
        },
      }}
    />
  );
}
