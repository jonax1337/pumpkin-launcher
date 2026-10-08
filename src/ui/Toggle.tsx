import { useEffect, useId, useRef, type ReactNode } from "react";
import { Icon } from "./Icon";
import { flag } from "./util";

/**
 * Schalter: Bahn (Slot) mit Steinknauf, der um ganze Einheiten springt; an = Akzentbahn, Knauf rechts.
 * `label` ist der Name; `visibleLabel` zeigt ihn rechts daneben (klickbar). `stateText` = [an, aus] als leiser Text
 * daneben (feste Breite, nur sichtbar; der Zustand selbst wird vom Schalter angesagt). `description`: was „an“ bedeutet,
 * nur für Screenreader (der Name bleibt rein).
 */
export function Switch({ checked, onChange, label, description, stateText, visibleLabel, disabled, id }: {
  checked: boolean; onChange: (v: boolean) => void; label: string; description?: string; stateText?: [on: string, off: string]; visibleLabel?: boolean; disabled?: boolean; id?: string;
}) {
  const descriptionId = useId();
  return (
    <label className="vx-switch" data-disabled={flag(disabled)}>
      <span className="vx-sw">
        <input id={id} type="checkbox" role="switch" checked={checked} disabled={disabled} aria-label={visibleLabel ? undefined : label} aria-describedby={description ? descriptionId : undefined} onChange={(e) => onChange(e.target.checked)} />
        <span className="vx-sw-tr vx-slot" />
        <span className="vx-sw-kn" />
      </span>
      {visibleLabel && <span className="vx-tl">{label}</span>}
      {description && <span id={descriptionId} className="sr">{description}</span>}
      {stateText && (
        <span className="vx-sw-st" aria-hidden>
          <span data-on={flag(checked)}>{stateText[0]}</span>
          <span data-on={flag(!checked)}>{stateText[1]}</span>
        </span>
      )}
    </label>
  );
}

/**
 * Checkbox: Box 24 (--vx-box) als Slot; an = Akzent-Haken (Icon s) auf getönter Fläche, teilweise = Strich.
 * Mit `children` steht die Beschriftung sichtbar daneben und ist der Name; ohne ist `label` der Name.
 */
export function Checkbox({ checked, indeterminate, onChange, label, disabled, id, children }: {
  checked: boolean; indeterminate?: boolean; onChange: (v: boolean) => void; disabled?: boolean; id?: string;
} & ({ label: string; children?: never } | { label?: string; children: ReactNode })) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = !!indeterminate;
  }, [indeterminate]);
  return (
    <label className="vx-check" data-bare={flag(!children)} data-disabled={flag(disabled)}>
      <span className="vx-cb">
        <input ref={ref} id={id} type="checkbox" checked={checked} disabled={disabled} aria-label={children ? undefined : label} onChange={(e) => onChange(e.target.checked)} />
        <span className="vx-cb-box vx-slot" />
        <Icon name="check" size="s" />
        <span className="vx-cb-dash" />
      </span>
      {children && <span className="vx-tl">{children}</span>}
    </label>
  );
}

/** Radio: Box 24 (--vx-box) als Slot; an = Akzent-Punkt. Beschriftung = children. Pfeiltasten regelt der Browser (gleicher name). */
export function Radio({ name, checked, onChange, disabled, value, id, children }: { name: string; checked: boolean; onChange: () => void; disabled?: boolean; value?: string; id?: string; children: ReactNode }) {
  return (
    <label className="vx-radio" data-disabled={flag(disabled)}>
      <input type="radio" id={id} name={name} value={value} checked={checked} disabled={disabled} onChange={onChange} />
      <span className="vx-rb vx-slot" />
      <span className="vx-tl">{children}</span>
    </label>
  );
}
