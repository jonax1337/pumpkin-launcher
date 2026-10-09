import type { ReactNode } from "react";
import { Select as S } from "radix-ui";
import { useI18n } from "@/i18n";
import { cn } from "@/lib/utils";
import { Icon } from "./Icon";
import { useFieldProps } from "./Field";
import { POP_BOX } from "./Menu";

export type Option = { value: string; label: string; disabled?: boolean };

/** Bis zu dieser Zahl bestimmen unsichtbare Platzhalter aller Optionen die Breite; bei mehr bleibt sie nach dem Wert. */
const SIZER_MAX_OPTIONS = 40;

const TRIGGER = {
  m: "[--sel-h:var(--lk-h-m)] [--sel-nudge:1px] pl-3 text-[calc(15px*var(--tz))]",
  s: "[--sel-h:var(--lk-h-s)] [--sel-nudge:0px] pl-2.5 text-ctl-m",
};

/**
 * Auswahl als Slot mit Pfeil-Steinknopf und eigener Pixel-Liste (Radix Select: Tastatur, Tippsuche, Scrollen).
 * Die Breite richtet sich nach der längsten Option (bis `SIZER_MAX_OPTIONS`), damit beim Wechseln nichts springt; `className` überstimmt sie.
 * `label`: sichtbares Präfix im Knopf („Sortieren: …“) und Name; sonst `ariaLabel` oder ein Field/FormRow darum.
 * `labelClassName`: Klassen des Präfixes, z. B. `le-1280:hidden`, wenn es in Fenstern bis einschließlich 1280 px entfallen soll (der Name bleibt).
 */
export function Select({ value, onChange, options, label, labelClassName, size = "m", className, id, ariaLabel, disabled, placeholder }: {
  value: string; onChange: (v: string) => void; options: Option[]; label?: string; labelClassName?: string; size?: "s" | "m"; className?: string; id?: string; ariaLabel?: string; disabled?: boolean; placeholder?: string;
}) {
  const { t } = useI18n();
  const f = useFieldProps({ id });
  const none = placeholder ?? t("ui.select.placeholder");
  // Radix erlaubt keine leeren Werte: „“ gilt als „nichts gewählt“.
  const items = options.filter((o) => o.value !== "");
  return (
    <S.Root value={value} onValueChange={onChange} disabled={disabled || !items.length}>
      {/* Name: ariaLabel, sonst die sichtbare Beschriftung (der Wert gehört nicht in den Namen) */}
      <S.Trigger
        className={cn("lk-select lk-slot relative inline-flex h-(--sel-h) flex-none items-center justify-between gap-2 pr-u1 whitespace-nowrap", TRIGGER[size], className)}
        aria-label={ariaLabel ?? label}
        {...f}
      >
        {label && <span className={cn("lk-sel-lab text-[calc(16px*var(--tz))] leading-none", labelClassName)}>{label}</span>}
        <span className="lk-sel-val grid min-w-0 translate-y-(--sel-nudge) *:col-start-1 *:row-start-1 *:overflow-hidden *:text-ellipsis">
          <S.Value placeholder={none} />
          {items.length <= SIZER_MAX_OPTIONS && items.map((o) => <span key={o.value} className="invisible col-start-1 row-start-1 h-0 overflow-hidden" aria-hidden>{o.label}</span>)}
        </span>
        <S.Icon asChild>
          <span className="lk-sel-chev grid size-[calc(var(--sel-h)-var(--px)*4)] flex-none place-items-center"><Icon name="chev-down" size="s" /></span>
        </S.Icon>
      </S.Trigger>
      <S.Portal>
        {/* Fläche der Liste: lk-pop (Item-Tooltip-Rahmen, look/overlay.css) */}
        <S.Content className={cn(POP_BOX, "flex max-h-[min(360px,var(--radix-select-content-available-height))] min-w-[max(var(--radix-select-trigger-width),180px)] flex-col overflow-y-hidden p-u2")} position="popper" sideOffset={6} collisionPadding={8} align="start">
          <S.ScrollUpButton className="lk-selscroll grid h-[22px] flex-none place-items-center"><Icon name="chev-up" size="s" /></S.ScrollUpButton>
          <S.Viewport>
            {items.map((o) => (
              <S.Item key={o.value} value={o.value} disabled={o.disabled} className="lk-selitem relative flex h-9 items-center gap-3 pr-2 pl-3 whitespace-nowrap text-[calc(15px*var(--tz))]">
                <S.ItemText>{o.label}</S.ItemText>
                <S.ItemIndicator className="lk-sel-ck ml-auto grid"><Icon name="check" size="s" /></S.ItemIndicator>
              </S.Item>
            ))}
          </S.Viewport>
          <S.ScrollDownButton className="lk-selscroll grid h-[22px] flex-none place-items-center"><Icon name="chev-down" size="s" /></S.ScrollDownButton>
        </S.Content>
      </S.Portal>
    </S.Root>
  );
}

/**
 * Aufklappbarer Bereich („Erweitert“): Zusammenfassung wie ein Geist-Knopf s (Hover-Platte, bündig mit der Kante),
 * Pfeil dreht sich, echter Fokusring. `open` = Startzustand; `onToggle` meldet Auf- und Zuklappen.
 * `summaryClassName`: Klassen der Zusammenfassung; sie ersetzen die Vorgaben (`-ml-1.5 h-ctl-s pl-1.5`).
 */
export function Disclosure({ summary, open, onToggle, className, summaryClassName, children }: {
  summary: ReactNode; open?: boolean; onToggle?: (open: boolean) => void; className?: string; summaryClassName?: string; children: ReactNode;
}) {
  return (
    <details className={cn("lk-disc", className)} open={open || undefined} onToggle={(e) => onToggle?.(e.currentTarget.open)}>
      <summary className={cn("lk-disc-s inline-flex list-none items-center pr-2 outline-none", summaryClassName ?? "-ml-1.5 h-ctl-s pl-1.5")}>
        <span className="lk-disc-c inline-flex items-center gap-1">
          <Icon name="chev-right" size="s" />
          {summary}
        </span>
      </summary>
      <div className="pt-2">{children}</div>
    </details>
  );
}
