import { useEffect, useId, useRef, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import { Icon } from "./Icon";
import { flag } from "./util";

/* Layout (Tailwind), gemeinsam: Zeile mit Beschriftung (15 px), Mindesthöhe 32, Abstand 12; Kästchen fest 24 (--lk-box). */
const ROW = "lk-toggle flex w-fit items-center gap-3 min-h-ctl-s text-[calc(15px*var(--tz))]";
/** Unsichtbarer, aber bedienbarer Eingabeknoten über dem gezeichneten Kästchen. */
const HIT = "peer absolute inset-0 z-2 m-0 opacity-0";
/** Beschriftung: Versalmitte liegt ~1,4 px über der Zeilenmitte; 1 px tiefer sitzt sie auf der Mitte des Kästchens. */
const LABEL = "min-w-0 translate-y-px";
const BOX = "absolute inset-0 pointer-events-none";

/**
 * Schalter: Bahn (Slot) mit Steinknauf, der um ganze Einheiten springt; an = Akzentbahn, Knauf rechts.
 * `label` ist der Name; `visibleLabel` zeigt ihn rechts daneben (klickbar). `stateText` = [an, aus] als leiser Text daneben.
 * `description`: was „an“ bedeutet, nur für Screenreader.
 */
export function Switch({ checked, onChange, label, description, stateText, visibleLabel, disabled, id, className }: {
  checked: boolean; onChange: (v: boolean) => void; label: string; description?: string; stateText?: [on: string, off: string]; visibleLabel?: boolean; disabled?: boolean; id?: string; className?: string;
}) {
  const descriptionId = useId();
  return (
    <label className={cn(ROW, "gap-(--sw-gap)", className)} data-disabled={flag(disabled)}>
      <span className="lk-sw relative inline-block h-(--lk-box) w-[calc(var(--lk-box)*2)] flex-none [--sw-kn:calc(var(--lk-box)-var(--px)*2)]">
        <input id={id} type="checkbox" role="switch" className={HIT} checked={checked} disabled={disabled} aria-label={visibleLabel ? undefined : label} aria-describedby={description ? descriptionId : undefined} onChange={(e) => onChange(e.target.checked)} />
        <span className="lk-sw-tr lk-slot absolute inset-0" />
        <span className="lk-sw-kn absolute left-u1 top-u1 size-(--sw-kn) peer-checked:left-[calc(var(--px)+var(--lk-box))]" />
      </span>
      {visibleLabel && <span className={LABEL}>{label}</span>}
      {description && <span id={descriptionId} className="sr-only">{description}</span>}
      {stateText && (
        <span className="lk-sw-st inline-grid min-w-(--sw-st-w) text-[20px] leading-none" aria-hidden>
          <span className="col-start-1 row-start-1" data-on={flag(checked)}>{stateText[0]}</span>
          <span className="col-start-1 row-start-1" data-on={flag(!checked)}>{stateText[1]}</span>
        </span>
      )}
    </label>
  );
}

/**
 * Checkbox: Box 24 als Slot; an = Akzent-Haken (Icon s) auf getönter Fläche, teilweise = Strich.
 * Mit `children` steht die Beschriftung sichtbar daneben und ist der Name; ohne ist `label` der Name.
 */
export function Checkbox({ checked, indeterminate, onChange, label, disabled, id, className, children }: {
  checked: boolean; indeterminate?: boolean; onChange: (v: boolean) => void; disabled?: boolean; id?: string; className?: string;
} & ({ label: string; children?: never } | { label?: string; children: ReactNode })) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = !!indeterminate;
  }, [indeterminate]);
  return (
    <label className={cn(ROW, "lk-check select-none", !children && "min-h-0", className)} data-disabled={flag(disabled)}>
      <span className="lk-cb relative inline-grid size-(--lk-box) flex-none place-items-center">
        <input ref={ref} id={id} type="checkbox" className={HIT} checked={checked} disabled={disabled} aria-label={children ? undefined : label} onChange={(e) => onChange(e.target.checked)} />
        <span className={cn("lk-cb-box lk-slot", BOX)} />
        <Icon name="check" size="s" className="lk-cb-ico relative" />
        <span className="lk-cb-dash absolute inset-x-[calc(var(--lk-box)/4)] top-[round(down,calc(50%_-_var(--px)_/_2),1px)] h-u1" />
      </span>
      {children && <span className={LABEL}>{children}</span>}
    </label>
  );
}

/** Radio: Box 24 als Slot; an = Akzent-Raute. Beschriftung = children. Pfeiltasten regelt der Browser (gleicher name). */
export function Radio({ name, checked, onChange, disabled, value, id, className, children }: { name: string; checked: boolean; onChange: () => void; disabled?: boolean; value?: string; id?: string; className?: string; children: ReactNode }) {
  return (
    <label className={cn(ROW, "lk-radio w-auto", className)} data-disabled={flag(disabled)}>
      <input type="radio" id={id} name={name} value={value} className="absolute size-px opacity-0" checked={checked} disabled={disabled} onChange={onChange} />
      <span className="lk-rb lk-slot relative grid size-(--lk-box) flex-none place-items-center" />
      <span className={LABEL}>{children}</span>
    </label>
  );
}
