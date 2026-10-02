import { useEffect, useId, useRef, type ReactNode } from "react";
import { Icon } from "./Icon";
import { flag } from "./util";

/**
 * Schalter 40×22: Bahn eingelassen, Knauf als Block; an = Kupferbahn, Knauf rechts (Stufen).
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
        <span className="vx-sw-tr" />
        <span className="vx-sw-kn" />
        <span className="vx-fring" />
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
 * Checkbox 20×20, eingelassen; an = Kupferblock + 5×5-Haken (Icon s: bei Pixelstufe groß füllt er die Fläche), teilweise = Strich.
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
        <span className="vx-cb-box" />
        <Icon name="check" size="s" />
        <span className="vx-cb-dash" />
        <span className="vx-fring" />
      </span>
      {children && <span className="vx-tl">{children}</span>}
    </label>
  );
}

/** Radio 20×20, zweistufig gekerbt; an = Kupferrahmen + 2×2-Kern. Beschriftung = children. Pfeiltasten regelt der Browser (gleicher name). */
export function Radio({ name, checked, onChange, disabled, value, id, children }: { name: string; checked: boolean; onChange: () => void; disabled?: boolean; value?: string; id?: string; children: ReactNode }) {
  return (
    <label className="vx-radio" data-disabled={flag(disabled)}>
      <input type="radio" id={id} name={name} value={value} checked={checked} disabled={disabled} onChange={onChange} />
      <span className="vx-rb"><span className="vx-fring" /></span>
      <span className="vx-tl">{children}</span>
    </label>
  );
}
